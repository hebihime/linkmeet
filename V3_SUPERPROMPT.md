# LinkMeet v3 — Consumer Event Finder + Multi-Mode Access (one-shot build spec)

You are extending **LinkMeet**, a live production web app, in a **single pass**. This is an **incremental, additive** feature build — **not** a rebuild. The existing v2 app (login → profile → Explore → Connect deck → Requests → Chats → "we met") already works and must **keep working unchanged**. Build exactly what §§3–9 describe, end to end, no placeholders, no `TODO`s, no stubbed screens. Everything must actually work against the real Neon + R2 services. When something is ambiguous, choose the option that best serves the product intent in **§1** and keep moving — do not stop to ask.

**Where to build:** the existing repo (Next.js 16 App Router, on branch `v2`). Modify app code in place; **preserve all existing in-event behavior and the async request/accept model.** Do not delete or rewrite the core loop. This change touches only: the landing page, the organizer create-event flow, the login screen, the upload route, `queries.ts`, `actions.ts`, and `db/schema.sql`.

**Already scaffolded (verify, don't redo):**
- `db/schema.sql` already has the three new `events` columns added (see §3). Run `npm run migrate` to apply them to the DB.
- `qrcode` + `@types/qrcode` are already installed (`package.json`).

---

## 1. What this is (product intent — use this to make taste calls)

LinkMeet is **"walled-garden Tinder-as-a-service" for professional conventions** — attendees swipe a deck of other attendees to meet, rejection-safe and ephemeral, scoped to one event. (Full mechanic unchanged from v2; do not touch it.)

**This build changes how people *get to* an event.** Two shifts:

1. **The landing page becomes a consumer *finder*, not an organizer surface.** A convention attendee lands on `/`, searches for their event by name, sees a **carousel of event logos**, taps theirs, and lands on that event's login. The whole consumer story is two steps: **1. Link · 2. Meet.** Creating events is an organizer job, moved out of the consumer's way.

2. **Organizers choose how their event is gated,** because one size doesn't fit walk-up meetups, booths, and managed-roster cons. Three per-event **access modes** (§4). This is the seed of the B2B model (the attendee email list is the eventual product), so keep email as the identity key everywhere.

Non-negotiable truths for this build:
- **A gate is only a gate if its key lives outside the thing it gates.** A shared join code must appear **only** on the organizer's success screen (to print on venue signage) and on **no attendee-facing or public surface** — never in the finder, never on the login page, never returned to a client. Otherwise it's just "open" with a pointless step.
- **The finder lists every event publicly** (name + logo) for now. Listing ≠ access — you still pass the event's gate to get in.
- **Nothing regresses.** The v2 in-event experience is untouched.

---

## 2. Tech stack (locked — do not substitute)

Same as v2: **Next.js 16** (App Router, RSC, Server Actions, `nodejs` route handler for uploads; `cookies()` is async, route `params` is a `Promise` to `await`) · **Neon Postgres** via `postgres` (postgres.js) · **Cloudflare R2** via `@aws-sdk/client-s3` · **`jose`** session cookie (HS256, `lm_session`) · **Tailwind v4** · **`nanoid`** ids/codes · **`qrcode`** for the link QR (already installed). ⚠️ This Next.js version has breaking changes — **read the relevant guide in `node_modules/next/dist/docs/` before writing code.** No new services, no email provider (out of scope, §10).

Env vars are already provisioned (`DATABASE_URL`, `SESSION_SECRET`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_PUBLIC_URL`). Read from env; never hardcode.

---

## 3. Data model (additive migration — nothing else changes)

Only the `events` table gains columns. **Existing events default to `access_mode='roster'`, preserving today's exact behavior.** These are already in `db/schema.sql`; make sure the migration applies them:

```sql
alter table events add column if not exists logo_url text;              -- finder carousel logo; null -> initials placeholder
alter table events add column if not exists access_mode text not null default 'roster'
  check (access_mode in ('open','code','roster'));
alter table events add column if not exists join_code text;             -- set ONLY when access_mode='code'
```

`access_codes` stays exactly as-is (used only by roster mode). No other table changes.

---

## 4. The three access modes (get the gating exactly right)

Identity is **always keyed on email** (`profiles` is unique on `(event_id, email)`, and the session carries `email`), so all three modes converge on the same profile/session flow. They differ only in what the attendee must prove at the door:

| Mode | Attendee provides | Validated against | Organizer setup |
|---|---|---|---|
| **open** | email only | nothing (just claims an identity) | none |
| **code** | email + one shared code | `events.join_code` (case-insensitive) | sets/gets one code, distributes out-of-band |
| **roster** | email + personal code | `access_codes` triple (today's flow) | uploads attendee emails; we mint one code each |

**`createEvent` (server action) — change to an options object.** Its one current caller is `/new`; update it and the golden-path test.

```ts
export type AccessMode = "open" | "code" | "roster";

export type CreateEventInput = {
  name: string;
  startsAtIso: string;
  accessMode: AccessMode;
  logoUrl?: string | null;   // from the logo upload; may be null (placeholder used)
  joinCode?: string;         // 'code' mode only; if blank/omitted, auto-generate with newCode()
  emails?: string;           // 'roster' mode only; newline/comma separated
  seedCount?: number;        // test attendees, clamp 1–50, 0 = none
};

export type CreatedEvent = {
  eventId: string;
  name: string;
  accessMode: AccessMode;
  logoUrl: string | null;
  joinCode: string | null;                      // populated for 'code', else null
  codes: { email: string; code: string }[];     // populated for 'roster', else []
};
```

Behavior:
- Validate `name` non-empty and `startsAtIso` a real date (as today).
- **open:** no code/emails required. Insert event with `access_mode='open'`, `join_code=null`.
- **code:** `joinCode` = `input.joinCode?.trim().toUpperCase()` or, if empty, `newCode()`. Store in `events.join_code`. Return it in `CreatedEvent.joinCode`.
- **roster:** parse/dedupe/validate emails exactly as the current code does; require ≥1 valid email; mint `access_codes` rows; return `codes`. Insert event with `access_mode='roster'`, `join_code=null`.
- Always persist `logo_url` (nullable). Seed test users when `seedCount > 0` (unchanged §9 v2 behavior).

**`login` (server action) — keep the signature `login(eventId, email, code)`.** Branch on the event's `access_mode` (query it inside the action, along with `join_code`):
- Validate `email` is a well-formed address in all modes (it's the identity key).
- **open:** ignore `code`. Proceed to the profile lookup + `setSession` path.
- **code:** require `code.trim().toUpperCase() === events.join_code`; else return `{ error: "That event code isn't right." }`. Then proceed.
- **roster:** unchanged — match the `(event_id, email, code)` triple in `access_codes`, set `claimed_at` once, else the existing error.
- All three then run the existing profile-lookup + `setSession({ eventId, email, profileId })` + `{ ok, hasProfile }` return.

**`join_code` must never reach a client.** `login` reads it server-side only. `getEvent` (whose result is passed to the client `LoginForm`) must expose `access_mode` and `logo_url` but **not** `join_code`.

---

## 5. Queries (`queries.ts`)

- **`getEvent`** — add `access_mode` and `logo_url` to the select and to `EventRow`. **Do not** select `join_code` here (it flows to the client). Add `access_mode: AccessMode; logo_url: string | null` to the type.
- **`listEvents()`** — new: `select id, name, logo_url from events order by created_at desc`. Returns `{ id: string; name: string; logo_url: string | null }[]`. Used by the finder. (All events; `unlisted` filtering is out of scope.)

---

## 6. Routes & screens

### `/` — Consumer event finder (replaces the old value-prop landing)
Server component fetches `listEvents()`, passes to a client `EventFinder`. Keep the existing dark theme, `max-w-md` centered column, and the gradient `LinkMeet` wordmark. Layout, top to bottom:

- **`LinkMeet`** (gradient wordmark) + subheader **`Quick connections for conventions`**.
- **Step 1 · Link** — a **search input** (placeholder e.g. `Search for your event…`) over a **horizontal carousel of event logo tiles**. Typing filters tiles by case-insensitive name substring. Each tile is a `Link` to `/{id}` showing the logo image, or an **initials-on-gradient placeholder** (indigo→fuchsia, initials = first letters of the first one or two words of the name) when `logo_url` is null. Tapping a tile navigates to that event's login.
- **Step 2 · Meet** — a short descriptive caption (e.g. `Tap in and start swiping.`); the actual meeting happens once you're inside the event.
- Empty states: no events at all → a friendly "No events yet." No search matches → "No events match ‘{query}’."
- Footer: a **discreet** link → `/new`, e.g. `Organizing an event? Create your link →`. The consumer flow must not foreground event creation.

The carousel must scroll smoothly (native momentum; `overflow-x-auto`, hidden scrollbar, snap is a nice-to-have) and never cause horizontal body scroll.

### `/new` — Organizer create-link flow (re-scoped; still ungated)
Keep the existing form's look. Fields:
- **Event name** (required) · **Start date/time** (`starts_at`, unchanged semantics).
- **Logo** — image upload reusing the profile-photo pattern (`/api/upload` with `kind=logo`, §7). Preview the uploaded logo; it's optional (placeholder used if absent).
- **Access mode** — a 3-option segmented control: **Open · Code · Roster**, with one-line explanations. Conditionals:
  - **Code** → an optional **join code** input (placeholder `Auto-generate if left blank`, force-uppercase).
  - **Roster** → the existing **attendee emails** textarea.
  - **Open** → no extra field; a note that anyone with the link can join.
- Keep the **seed test attendees** toggle + count (default on, 10).

Submit calls `createEvent(input)`. **Success screen** (branch on `created.accessMode`), always showing: the shareable `/{eventId}` link + **Copy** button + a **QR code** (render with `qrcode`'s `toDataURL(link)` into an `<img>` — the fastest path to the link at a physical venue). Then:
- **open:** just a line — "Anyone with this link can join."
- **code:** the **join code shown large and prominent**, with copy, framed as *"Print this at your venue — attendees enter it to join."* (This is the only place the code is ever shown.)
- **roster:** the existing email→code table + **Download CSV** + the "shown once" warning.

### `/{eventId}` — Login (mode-aware)
`page.tsx` passes `event.access_mode` into `LoginForm`. `LoginForm` renders by mode:
- **open:** email field only; copy like "Enter your email to join {event}."
- **code:** email + a single **Event code** field; copy like "Enter your email and the event code."
- **roster:** email + **Access code** (today's UI/copy, unchanged).
Submit still calls `login(eventId, email, code)` (pass `""` for code in open mode) and routes to `/{eventId}/{hasProfile ? "explore" : "profile"}` exactly as now.

Everything under `/{eventId}/*` (profile, explore, connect, requests, chats, we-met) is **unchanged**.

---

## 7. Upload route (`/api/upload`) — allow event logos

Add a `kind` form field:
- **`kind=logo`:** used by `/new` **before any event/session exists**, so **do not require a session**. Store under key `events/logos/{newId()}.{ext}`. (This is consistent with `/new` already being ungated; organizer auth is out of scope, §10.)
- **default / profile photo:** unchanged — require a session, key `profiles/{eventId}/{newId()}.{ext}`.
Keep the JPG/PNG/WebP + 8MB validation for both. Return `{ url }`.

---

## 8. Design language

Match v2 exactly (dark `#0a0a0a` / `#ededed`, gradient accents, `rounded-*`, mobile-first, thumb-reachable). The finder should feel like a polished native "pick your event" screen — logo tiles crisp and tappable, search instant. The segmented access-mode control and the QR/success screen should look confident and minimal, not like a settings form.

---

## 9. Keep the test suite green (and extend it)

- **`scripts/golden-path.mjs`:** its `createEvent` call currently passes positional args `["Golden Path Con", iso, EMAIL, 6]`. Update to the new single options-object arg: `[{ name, startsAtIso, accessMode: "roster", emails: EMAIL, seedCount: 6 }]`. The rest (roster login with the minted code) is unchanged.
- **`scripts/smoke.mjs`:** add a block that, at the SQL level, creates events in each of the three `access_mode` values and asserts the gate logic: open ignores code, code matches `join_code` case-insensitively (and rejects a wrong code), roster still needs the triple. Reuse the existing cascade-cleanup pattern.
- **Extend golden-path (or add a second script)** to drive `login` over the wire for an **open** event and a **code** event, proving both reach a session + profile. Keep it lean.

---

## 10. Definition of done

- `npm run build` succeeds; TypeScript clean (no `any`-escapes for real types); `npm run migrate` applies cleanly.
- **Finder:** `/` lists events, search filters the carousel live, logo-less events show initials, tapping a tile lands on `/{eventId}` login. No horizontal body scroll.
- **All three modes work against real Neon + R2:** create (with logo upload) → success screen (link + QR + the mode's credential) → login → profile → into the live app, for **open**, **code**, and **roster**.
- **`join_code` never appears** in the finder, the login page, `getEvent`'s client-facing result, or any network response to an attendee — only on the organizer success screen.
- The **entire v2 in-event loop still works unchanged** (Explore/Connect gating on `starts_at`, deck gestures, requests accept/decline, chat polling, mutual "we met").
- `golden-path` + `smoke` (with the §9 additions) pass.

---

## 11. Explicitly OUT of scope (do not build)

Defer all of this — building it here dilutes the one-shot:
- **Sending email** (no Resend/Postmark/SES, no templates). Roster codes are still delivered via the organizer's CSV download.
- **Attendee-email export dashboards / consent-capture UI** — email stays an auth key for now.
- **Organizer accounts / auth / billing.** `/new` remains open and unauthenticated.
- **Unlisted / private events** — the finder lists everything for now.
- **Mandatory logos / image resizing** — the initials placeholder stays; logos optional.
- Any change to the async request/accept model, the deck, or the in-event screens.

Build everything in §§3–9. Ship it complete and working, with the v2 experience fully intact.
