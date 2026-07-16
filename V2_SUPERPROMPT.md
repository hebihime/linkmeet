# LinkMeet v2 (web app) — one-shot build spec

You are building **LinkMeet v2**, a production-quality web app, in a **single pass**. Build the entire thing described below, end to end, with no placeholders, no `TODO`s, no stubbed screens. Everything specified here must actually work against the real services. When something is ambiguous, choose the option that best serves the product intent described in **§1** and keep moving — do not stop to ask.

**Where to build:** you are working inside an existing repo that already has the deployment wiring (Vercel, env vars, R2/Neon config, deploy scripts). This is a **clean-slate rebuild of the app** on a fresh branch — you may **replace/delete any existing application code** (old pages, components, schema, actions) freely; it is a throwaway MVP. Keep only the infrastructure/config plumbing (`.env.local`, `package.json` deps you still need, deploy scripts, Vercel/GitHub setup). Do not try to preserve or merge old app behavior — build to this spec.

---

## 1. What this is (product intent — use this to make taste calls)

LinkMeet is **social-connection-as-a-service for professional conventions** (healthcare, defense, corporate — the HIMSS / LVCC / MGM Grand crowd). Attendees badly want to meet each other but structurally can't: every hallway encounter dies on **timing**, and making the first move ("you seem cool, come with me / hit me up") takes hyper-extrovert courage almost nobody has.

**LinkMeet's job: democratize that move and strip the rejection sting out of it.** Make "come with me / let's connect" **async, low-risk, and rejection-safe** — for the duration of the convention only.

Non-negotiable product truths that shape every decision:
- **Rejection-safe & async.** Sending interest must never expose the sender to a visible "no." Declines are **silent** — the sender is never told they were declined.
- **Ephemeral.** No stay-connected-after-the-con features. The app is scoped to one event's lifetime.
- **Professional, no romance.** This is not a dating app. No romantic framing anywhere.
- **Whitelist-gated.** Access requires a pre-bound email + code. No open signup.
- **Native-feel web.** This ships as a web app that must *feel* like a native mobile app — buttery, gesture-driven, zero jank. The only thing consciously given up vs. native is haptic feedback.

---

## 2. Tech stack (locked — do not substitute)

- **Next.js 16** (App Router, Turbopack, React Server Components, Server Actions, Route Handlers). ⚠️ This Next.js version has breaking changes vs. older releases — **read the relevant guide in `node_modules/next/dist/docs/` before writing code** and heed deprecation notices. Known specifics: `cookies()` is **async**; route `params` is a **`Promise`** you must `await`; Server Actions are `"use server"`; the upload route handler needs `export const runtime = "nodejs"`.
- **Neon Postgres** (serverless) via the **`postgres`** npm driver (postgres.js). Single client singleton on `globalThis`, `ssl: "require"`.
- **Cloudflare R2** (S3-compatible) via **`@aws-sdk/client-s3`** for profile photos. Public reads via the R2 public URL.
- **Auth:** session cookie via **`jose`** (JWT HS256). **No passwords** — the credential is email + pre-bound code.
- **Tailwind CSS v4** (`@import "tailwindcss";`).
- **`nanoid`** for ids and human-typable codes.

No Redis. No Supabase. No ORM. No external UI/animation libraries for the deck — hand-roll the gestures (see §7).

### Environment (services already provisioned — read from env, never hardcode secrets)

Expect these env vars (in `.env.local` locally, and in Vercel for prod). Do **not** invent values; read them at runtime and throw a clear error if missing:

```
DATABASE_URL           # Neon Postgres connection string (use the -pooler string in prod)
SESSION_SECRET         # HS256 signing secret for jose
R2_ACCOUNT_ID
R2_ACCESS_KEY_ID
R2_SECRET_ACCESS_KEY
R2_BUCKET
R2_PUBLIC_URL          # public base URL for reading uploaded photos
```

Ship a `db/schema.sql` and a migrate script runnable via `node --env-file=.env.local scripts/migrate.mjs`.

---

## 3. Data model

All rows are scoped by `event_id` — that FK is the entire multi-tenancy. Ship this schema (idempotent `create table if not exists`, plus indexes):

```sql
create table if not exists events (
  id          text primary key,               -- url slug, e.g. "himss-2026"
  name        text not null,
  starts_at   timestamptz not null,           -- deck unlocks at/after this; before = lobby only
  created_at  timestamptz not null default now()
);

-- Pre-bound: organizer supplies emails; we generate one code per email.
-- Login requires the exact (event_id, email, code) triple.
create table if not exists access_codes (
  id          text primary key,
  event_id    text not null references events(id) on delete cascade,
  email       text not null,
  code        text not null,
  claimed_at  timestamptz,
  unique (event_id, email),
  unique (event_id, code)
);

create table if not exists profiles (
  id          text primary key,
  event_id    text not null references events(id) on delete cascade,
  email       text not null,
  name        text not null,
  headline    text,
  tags        text[] not null default '{}',    -- interest tags, featured on the card
  photo_url   text,
  solo        boolean not null default false,   -- "attending solo" — feeds lobby stats
  is_test     boolean not null default false,
  created_at  timestamptz not null default now(),
  unique (event_id, email)
);

-- One row per (from -> to). Records the deck action AND, for non-pass kinds,
-- the async request lifecycle. 'pass' rows exist only to keep the deck from
-- re-showing that person; their status is 'none'.
create table if not exists intents (
  id           text primary key,
  event_id     text not null references events(id) on delete cascade,
  from_id      text not null references profiles(id) on delete cascade,
  to_id        text not null references profiles(id) on delete cascade,
  kind         text not null check (kind in ('meet','link','invite','pass')),
  message      text,                            -- invite description
  photo_url    text,                            -- optional invite photo
  status       text not null default 'pending'
                 check (status in ('pending','accepted','declined','none')),
  created_at   timestamptz not null default now(),
  responded_at timestamptz,
  unique (event_id, from_id, to_id)
);

-- Chat-enabled relationship. Created when a request is accepted, or immediately
-- for an invite. profile_a < profile_b (canonical) so a pair is one row.
create table if not exists connections (
  id               text primary key,
  event_id         text not null references events(id) on delete cascade,
  profile_a        text not null references profiles(id) on delete cascade,
  profile_b        text not null references profiles(id) on delete cascade,
  origin           text not null,               -- 'meet' | 'link' | 'invite'
  met_a            boolean not null default false,
  met_b            boolean not null default false,
  met_confirmed_at timestamptz,
  created_at       timestamptz not null default now(),
  unique (profile_a, profile_b)
);

create table if not exists messages (
  id            text primary key,
  connection_id text not null references connections(id) on delete cascade,
  sender_id     text not null references profiles(id) on delete cascade,
  body          text not null,
  created_at    timestamptz not null default now()
);

create index if not exists idx_profiles_event on profiles(event_id);
create index if not exists idx_intents_to on intents(event_id, to_id, status);
create index if not exists idx_intents_from on intents(event_id, from_id);
create index if not exists idx_connections_a on connections(profile_a);
create index if not exists idx_connections_b on connections(profile_b);
create index if not exists idx_messages_conn on messages(connection_id, created_at);
```

---

## 4. Auth (email + pre-bound code)

- Login form at `/{eventId}` takes **email + code**. Validate the exact `(event_id, email, code)` triple against `access_codes`. On success, set `claimed_at` (once) and set a signed session cookie.
- Session payload: `{ eventId, email, profileId? }`, HS256 via `jose`, httpOnly cookie (e.g. `lm_session`).
- A leaked code is useless without its bound email. No self-signup anywhere.
- After login: if the attendee has no profile → `/{eventId}/profile`; else → `/{eventId}/explore` (which forwards to the deck once the event is live — see §6).
- Every `/{eventId}/*` page (except the login page) must verify the session matches `eventId` and redirect to `/{eventId}` if not.

---

## 5. The async request/accept model (the core mechanic — get this exactly right)

This is what makes LinkMeet *LinkMeet*. A swipe is not a symmetric "both must like." It **sends a request**, and the receiver controls acceptance. Declines are **silent**.

**Four swipe actions on a deck card:**

| Direction | Intent | Effect |
|---|---|---|
| **Up ↑** | **Meet** | Sends a pending **Meet** request to that person (the high-commitment "come do this with me / let's actually connect" signal). |
| **Right →** | **Link** | Sends a pending **Link** request (the lighter "let's chat" signal). |
| **Down ↓** | **Invite** | Opens an **Invite composer** (free-text description + optional photo — "drinks at the north bar at 7?"). On send, **immediately opens a chat thread** (a `connection`) with the invite as the first message. No acceptance gate. |
| **Left ←** | **Pass** | Silent. Records a `pass` intent so the card never returns. No notification. |

**Lifecycle rules:**
- **Meet / Link** create an `intents` row with `status='pending'`. The receiver sees it in their **Requests inbox** (§6) and can **Accept** or **Decline**.
  - **Accept** → set `status='accepted'`, create a `connection` (origin = the intent kind), which opens chat.
  - **Decline** → set `status='declined'`. **The sender is never told.** It simply never becomes a connection. (Rejection-safe.)
- **Invite** → create the `intents` row `status='accepted'` immediately **and** create the `connection` (origin `'invite'`) immediately, seeding `messages` with the invite text (and photo if present) as the first message from the sender. The receiver can reply or ignore.
- **Reciprocal auto-accept (the delight moment):** if you send a Meet/Link to someone who **already has a pending Meet/Link toward you**, auto-accept both immediately → create the connection and show an **"It's a connection!"** celebration. This is the instant-gratification payoff; make it feel great.
- **Deck exclusion:** the deck never shows anyone you already have any `intents` row toward (any kind, including pass), nor yourself, nor people you're already connected to.

---

## 6. Routes & screens

Mobile-first, `max-w-md` centered column, dark theme (see §8). Persistent bottom nav on the in-event screens, in this order:

**Explore · Connect · Requests · Chats · Profile**

- **Explore** → `/{eventId}/explore` — the "who's here" discovery/stats screen (the lobby; see item 5).
- **Connect** → `/{eventId}/connect` — the swipe deck where you send Meet/Link/Invite intents (see item 6). This is the primary at-event action; make it the visual center of the nav.
- **Requests** → `/{eventId}/requests` — incoming request inbox, with an unread badge.
- **Chats** → `/{eventId}/chats` — your connections/threads.
- **Profile** → `/{eventId}/profile` — edit your profile.

1. **`/`** — Landing. One-screen explanation of LinkMeet + a link to `/new`. Tasteful, not a wall of text.

2. **`/new`** — Organizer creates an event (ungated for now). Fields: **event name**, **start date/time** (`starts_at`), **attendee emails** (textarea, newline/comma separated), and a **"seed test attendees"** toggle + count (default on, 10). On submit: create the event, generate one **pre-bound code per email**, seed test users if requested (§9), then show a **results view** with the shareable `/{eventId}` link, a **copyable table** of email→code, and a **Download CSV** button. Codes are shown once.

3. **`/{eventId}`** — Login (email + code). Errors inline. Redirects per §4.

4. **`/{eventId}/profile`** — Build/edit profile: **photo upload** (to R2 via a `nodejs` route handler — validate JPG/PNG/WebP, ~8MB max, key `profiles/{eventId}/{id}.{ext}`, return the public URL), **name** (required), **headline**, **interest tags** (comma-entry, featured on the card, cap ~8), **"I'm attending solo"** checkbox. First-time save triggers the test-user interactions in §9, then routes to the lobby/deck.

5. **`/{eventId}/explore`** (nav: **Explore**) — Pre-event **aggregate shared-signal stats**, computed against the viewer's own profile. Show: the live **signup counter** ("1,247 attendees joined {event}"), **"N people share your interest in {tag}"** for each of the viewer's tags, and **"N attendees are also here solo"** (if the viewer is solo). **No individual browsing or swiping pre-event** — this builds anticipation without front-loading rejection. If `now < starts_at`, show a **countdown** to when Connect opens. If `now >= starts_at`, Connect is live: keep the stats visible but surface a prominent **"Connect is live →"** CTA to `/{eventId}/connect`.

6. **`/{eventId}/connect`** (nav: **Connect**) — The swipe deck (§7). Only accessible when `now >= starts_at`; otherwise redirect to `/{eventId}/explore`.

7. **`/{eventId}/requests`** — Incoming **Requests inbox**: pending Meet/Link requests *to* the viewer, each showing the sender's card + the intent, with **Accept** / **Decline**. Accept opens the new chat; decline removes it silently. Show an empty state.

8. **`/{eventId}/chats`** — List of the viewer's connections (most recent message first), each linking to its thread. Empty state encourages swiping.

9. **`/{eventId}/chats/{connectionId}`** — Chat thread. Message list + composer. **Poll** for new messages on a short interval (e.g. every 3s) — no websockets. Header shows the other person + a **"We met" button**: tapping sets the viewer's `met_*` flag; when **both** have tapped, set `met_confirmed_at` and show a confirmed state ("You met 🎉"). This is the product's headline metric — make the confirmation legible.

---

## 7. The native-feel swipe deck (spend real effort here)

This is the screen that has to feel native. The MVP failed because it had **no gestures** and **stalled on a network round-trip every swipe**. Do not repeat that. Requirements:

- **Prefetched queue.** Load a batch (~12) of un-swiped cards server-side; hold them in client state. When the queue drops to ~4, fetch more in the background (a server action that excludes ids already in hand or just-acted-on). The next face is **always already there** — never wait on the network to advance.
- **Optimistic commit.** When a card is swiped, it flies off **instantly** and the next card is live immediately. The `intents` write + any connection/celebration happens in the background; surface the "It's a connection!" celebration whenever the server confirms it.
- **Finger-following drag, on the compositor.** Use Pointer Events (works for touch + mouse). During drag, mutate the card node's `transform` **directly via ref** (translate3d + a subtle rotation, e.g. `dx / 18` degrees) — **do not** re-render React per pointer-move. Use `touch-action: none` and `will-change: transform`. Transform-only; never touch layout properties.
- **Four-direction intents with live overlays.** Horizontal drag = **Link (→)** / **Pass (←)**; vertical drag = **Meet (↑)** / **Invite (↓)**. Show a directional label/stamp that fades in with drag distance in each of the four positions (MEET / LINK / INVITE / PASS). Whichever axis dominates wins.
- **Commit by distance OR velocity.** Release commits if the drag passed a threshold (~110px) **or** the fling velocity is high (~0.55 px/ms); otherwise spring back with a smooth ease. On commit, animate the card off-screen in that direction (~180ms) then advance the queue.
- **Invite (↓) is special:** a downward commit opens the **Invite composer modal** (description + optional photo) instead of firing immediately; on send, animate the card down and create the invite/connection. Cancel springs the card back.
- **Buttons too.** Render tap targets for all four intents that trigger the identical animated commit (drive the same code path as gestures). Keyboard: arrow keys map to the four intents (nice-to-have).
- **Depth.** Render the next card peeking behind the top one (slightly scaled/offset) so the stack reads as physical.
- **Empty state.** "You're all caught up — check back as more people join," linking to Chats.

Target 60fps on a mid-range phone. No layout thrash, no jank on rapid swipes.

---

## 8. Design language

- **Dark theme:** background `#0a0a0a`, foreground `#ededed`. System sans font.
- Cards: `rounded-3xl`, subtle `border-neutral-800`, photo area with an indigo→fuchsia gradient fallback (show initials when no photo).
- Accent moments (connection celebration, "we met") use the fuchsia/indigo accent. Tasteful, confident, minimal — think a well-made native app, not a busy web page.
- Everything mobile-first and thumb-reachable. Motion should feel physical and quick.

---

## 9. Test data (make the whole loop testable solo)

Real matching needs other people, so the app must be fully exercisable by one person:

- **On event creation** with seed count N (clamp 1–50): insert N realistic **test profiles** (`is_test=true`) with varied names, professional headlines, interest tags, `https://i.pravatar.cc/400?u={id}` photos, and a realistic mix of `solo` true/false.
- **On the real attendee's first profile save:** have **~half** the test users send that attendee a **pending Meet/Link request** (mix of kinds) so the **Requests inbox has content** to accept/decline immediately.
- **Test users auto-accept:** any Meet/Link the real attendee sends to a test user is **auto-accepted** (creating a connection), and test users **reply once** in chat, so **connections, chat, polling, and "we met"** are all testable end to end by a single human.

---

## 10. Definition of done

- `npm run build` succeeds; TypeScript is clean (no `any`-escapes for real types).
- The full flow works against **real Neon + R2**: create event → get codes → log in → build profile (with photo upload) → **Explore** stats → **Connect** deck → all four intents → requests inbox accept/decline → connection → chat (with polling) → mutual "we met" confirmation.
- The async model behaves per §5, including **silent decline** and **reciprocal auto-accept**.
- The **Connect** deck feels native per §7 (gestures, prefetch queue, optimistic commit, no per-swipe stall).
- **Explore/Connect gate correctly on `starts_at`** (before start: Explore + countdown, Connect locked).
- Ship: `db/schema.sql`, `scripts/migrate.mjs`, and at least one smoke script that exercises the core loop against the DB.

---

## 11. Explicitly OUT of scope (do not build)

Do **not** build any of these — they are separate, later efforts. Building them here dilutes the one-shot:

- The **con-admin platform** (multi-tenant dashboard, whitelist UI, per-con config, branding, analytics). Event creation via `/new` is the only organizer surface for now.
- **OAuth identity verification** (LinkedIn / TikTok / X).
- **Reputation / trust-safety / rehabilitation deck / reporting-blocking.**
- **Personality & enrichment** (OCEAN, Myers-Briggs, astrology, quizzes) — interest tags + "solo" are the only matching signals for now.
- **Realtime** anything (websockets/SSE) — chat polls.
- **Native iOS/Android apps**, push notifications, QR "we met" bump.

Build everything in §§3–10. Ship it complete and working.
