# LinkMeet — Trust & Safety plan (fast-follow after deck v2.1.x)

Status: **BUILT 2026-07-19** (all three features + interim auto-suspend),
verified green against a throwaway local Postgres (build/lint/smoke/golden/
live). Awaiting: JP eyeballing the `src/lib/moderation.ts` word list, the
Neon migration (`npm run migrate` — additive/idempotent), and push.
Locked in a planning session on 2026-07-18.
Three independent features, buildable in the order below. Recommended defaults
are marked `[default]` and are reversible — flip any before we build.

Migrations are called out explicitly; **none run without JP's authorization**
(Neon prod), and nothing pushes to `main` without the usual green
build/lint/smoke/golden/live pass.

---

## Feature 1 — 18+ age gate (refuse under 18)

Decided: the app is **18+ only.** No minors, no age-cohort partition. (We
considered allowing minors behind a bidirectional minor/adult wall — Yubo-style —
and rejected it: it's a child-safety partition standing on an unverified
self-reported DOB, plus COPPA / grooming / mandatory-reporting liability. Not
worth it for a professional-networking product that's adult by nature.)

We also considered **facial age estimation** ("the face scanning thing", e.g.
Yoti/Persona). Rejected for MVP: it's a paid, contractual third-party product;
it triggers biometric-privacy law (BIPA / GDPR Art. 9 / Texas CUBI); it adds
signup friction fatal to a walk-up-at-a-con flow; and it is **not legally
required** for a non-adult-content 18+ app (Tinder/Bumble/Hinge gate on
self-reported DOB + store policy). Keep the age check a **swappable step** so
Yoti can slot in later if we ever add adult content or hit a jurisdiction that
mandates it.

### Migration (needs authorization)
```sql
alter table profiles add column birth_date date;
-- lossy backfill of existing rows (year -> Jan 1); real users re-enter precisely
update profiles set birth_date = make_date(birth_year, 1, 1) where birth_year is not null;
```
`birth_year` goes dormant (one-commit revert, no data loss). All age reads move
to `birth_date`. Full date, not year — a self-reported *year* lets a
late-birthday 17-year-old through; a date makes the 18 boundary exact.

### Code
- `saveProfile` (`src/lib/actions.ts`): `birth_date` **required**; compute exact
  age; reject `age < 18` → *"You must be 18 or older to use LinkMeet."* Also read
  an **"I'm 18 or older" attestation checkbox** (the actual legal backstop).
- `ProfileForm.tsx`: number field → **DOB date picker** (required) + attestation
  checkbox.
- Deck age filter (`getDeckCards`, `filters.ts`): migrate the 18–65 math from
  `birth_year` to `birth_date`. `ageUnspecified` becomes near-dead (all new
  profiles have a date) → drop from the filter UI in cleanup.
- Seed users get a non-null `birth_date` (adult-aged; realistic for cons).

---

## Feature 2 — Tag / free-text safety filter

New swappable module `src/lib/moderation.ts`:
```
normalize(s)          // lowercase, strip diacritics + non-alphanumerics,
                      // de-leet (o0 i1l e3 a@ s$), collapse repeats
containsUnsafe(text)  // -> matched term | null  (word-boundary aware)
filterTags(tags)      // -> { clean, rejected }
```
- Engine (as built): **`obscenity` npm library + curated supplement**. The
  maintained English preset (leetspeak/confusables/whitelist hardening) minus
  two phrases removed as policy — "sex" (blocks real professionals) and "cum"
  ("summa cum laude") — plus EXTRA_TERMS the preset lacks (hate/violence,
  kys, onlyfans, extra slurs) and a spaced-letter rejoin pass ("f.u.c.k")
  the engine misses. Offline, deterministic, Scunthorpe-safe. Still structured
  swappable so an LLM pass (Haiku) can slot behind the same signature later.
- Scope: **tags + headline + company + name** `[default]` — every free-text
  field that renders on a card. (JP scoped it to tags; filtering only tags
  leaves the same hole open in headline/company.)
- Behavior: **reject-with-message**, not silent-strip (can't partially strip a
  headline; a silent drop makes users think a tag saved when it didn't).
- Out of scope for now: chat / invite message bodies (private, already-connected
  surface — separate call if we want it).
- **JP must eyeball the actual word list before it ships** — it's a judgment
  surface.

---

## Feature 3 — Verified "We met" → ratings → reputation / trust-safety

Today `markMet` is pure honor system: each side taps once, both taps confirm.
Anyone can tap unilaterally. Since verified-met now **feeds reputation and gates
post-event ratings**, it has to be tamper-resistant.

Three stacked systems. Build A first (everything depends on it); capture B's
schema alongside so ratings data starts accruing; C is a deliberate follow-up.

### Threat model (what we are and aren't defending against)
- **Two willing colluders** ("let's both fake it"): un-closeable on web by any
  method short of a trusted third party watching. Mitigated only by Phase-C
  graph/velocity discounting, not prevented.
- **One person unilaterally** faking a meet: this is the honor-system hole. QR
  closes it — you can't scan a code that isn't physically in front of your lens.
- **"Post-event" has no clock** (events have `starts_at`, no `ends_at`). The real
  gate is **the verified meet itself** — you can rate someone the moment you've
  QR-confirmed. Add optional `ends_at` only to *nudge* ("con's over, rate who you
  met"), never as a hard gate.

### Honest limits, stated up front
- **QR is not unforgeable** — two colluders can scan a screenshot off a second
  screen.
- **GPS is a signal, NOT proof, and NOT unfakeable.** On the web, location is the
  `navigator.geolocation` software API: spoofable via devtools Sensors panel,
  browser extensions, and mock-location apps — in seconds. Indoors it's also
  inaccurate (steel/concrete venues → 20–100m+ error), so it can't be a tight
  proximity *gate* without false-rejecting real meets. We use it as a
  **confidence + fraud-detection** signal, never as a hard gate or as "proof."

### Phase A — QR + GPS-signal verified meet  (build first)
- Thread UI: **"Show my code"** / **"Scan to confirm."**
- Show → server mints a signed, ~2-min token bound to `(connectionId, issuerId)`
  (reuse `jose`) → rendered as QR.
- Scan → counterparty's camera reads it (`getUserMedia` + `jsQR`; works on iOS
  Safari over Vercel HTTPS; `BarcodeDetector` where available) → posts token →
  server verifies signature + freshness + that the scanner is the *other* party
  in that connection → sets both met flags atomically. One scan confirms the pair.
- Both clients also send coords + accuracy at scan time.
- **Schema:**
  ```sql
  alter table connections add column met_method text;      -- 'qr' | null; only 'qr' counts
  alter table connections add column met_lat_a  double precision;
  alter table connections add column met_lng_a  double precision;
  alter table connections add column met_lat_b  double precision;
  alter table connections add column met_lng_b  double precision;
  alter table connections add column met_distance_m double precision;
  alter table connections add column met_confidence  int;   -- 0..100
  ```
- **Confidence** = QR-verified base; **+** GPS-consistent & inside event geofence;
  **−** if inconsistent. Wildly inconsistent (different cities) = hard fraud flag.
  Permission denied / no GPS → QR-only, still valid, lower confidence.
- **Never hard-reject a real meet on GPS distance alone** (indoor noise).
- Retire the honor tap as a weight-bearing state — only `met_method='qr'`
  unlocks rating/reputation. (A cosmetic "soft met" tap may stay but grants
  nothing.)
- Keep a **test-user bypass** so the loop stays solo-testable.

### Phase B — Ratings (gated on `met_method='qr'`)
Split into two channels — **do not** use one 5-star scale (it conflates a creep
and a dull conversationalist at "2 stars" and destroys the safety signal):
1. **Reputation (positive)** `[default]`: lightweight endorsement — "would
   connect again" + optional positive tags (great conversation / showed up /
   professional). Aggregates into a reputation signal.
2. **Safety report (negative, separate channel)** `[default]`: no-show /
   disrespectful / made me uncomfortable / harassment. Weighted heavily, routed
   to review — **not** a low star.

- **Visibility: private / aggregate** `[default]`, not public per-person reviews
  (public reviews invite retaliation, gaming, chilling on a networking app).
  Double-blind: never reveal who rated whom. One rating per connection.
- **Schema sketch:**
  ```sql
  create table ratings (
    id text primary key,
    connection_id text not null references connections(id) on delete cascade,
    rater_id text not null references profiles(id) on delete cascade,
    ratee_id text not null references profiles(id) on delete cascade,
    endorse boolean,               -- would connect again
    positives text[] not null default '{}',
    created_at timestamptz not null default now(),
    unique (connection_id, rater_id)
  );
  create table safety_reports (
    id text primary key,
    connection_id text references connections(id) on delete set null,
    reporter_id text not null references profiles(id) on delete cascade,
    reported_id text not null references profiles(id) on delete cascade,
    reason text not null,          -- 'no_show'|'disrespect'|'harassment'|'safety'
    detail text,
    status text not null default 'open',  -- 'open'|'reviewed'|'actioned'
    created_at timestamptz not null default now()
  );
  ```

### Phase C — Reputation + trust-safety response (deliberate follow-up)
- **Reputation** = endorsements + verified-meet count, weighted by
  **met_confidence**, with anti-gaming: cap contribution per unique counterparty,
  discount mutual-only rings, velocity checks (impossible meet sequences flagged).
  This is the real mitigation for the Phase-A collusion hole. MVP can start with
  "one endorsement per connection, capped."
- **The gap to know about:** trust-safety needs a place for reports to go, and
  there is **no admin/moderation surface** (con-admin is deferred). Interim
  options: (a) **automated threshold auto-suspend** `[default]` — N distinct
  safety reports → `profiles.suspended_at`, dropped from decks pending review;
  (b) email reports to the event organizer; (c) manual DB review. A real
  moderation queue is its own project.
  ```sql
  alter table profiles add column suspended_at timestamptz;
  ```

---

## Open decisions (recommended defaults locked above; flip before build)
1. Rating shape — split endorsement + safety report `[default]`, or unified stars?
2. Visibility — private/aggregate `[default]`, or public reviews?
3. Interim trust-safety response — auto-suspend threshold `[default]`, email
   organizer, or manual-only?
4. `ends_at` — add as optional nudge anchor `[default]`, or skip?

## Build sequencing
1. **Feature 1 (18+ gate)** + **Feature 2 (moderation)** — small, ship together.
2. **Phase A (QR + GPS verified meet)** — self-contained, unblocks the rest.
3. **Phase B schema + rating UI** — start accruing data.
4. **Phase C (reputation surfacing + trust-safety response)** — follow-up,
   partly blocked on a moderation surface.

## Verification (each phase)
- `npm run build` + lint clean.
- Extend `scripts/golden-path.mjs`: under-18 DOB bounces; clean 18+ saves;
  bad-tag save bounces; QR-verified meet unlocks a rating; unverified meet does
  not.
- `smoke` / `golden` / `live` green vs local `next start -p 3999` before any push.
