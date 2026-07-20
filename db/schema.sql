-- LinkMeet v2 schema
-- Everything is scoped by event_id. That FK is the entire "multi-tenancy".
-- Idempotent and additive against the v1 database: v1's swipes/matches tables
-- are left alone until v2 is cut over (drop them afterwards with:
--   drop table if exists swipes, matches;)

create table if not exists events (
  id          text primary key,               -- url slug, e.g. "himss-2026"
  name        text not null,
  starts_at   timestamptz not null default now(), -- deck unlocks at/after this
  logo_url    text,                            -- shown in the /  finder carousel
  -- how attendees get in:
  --   'open'   -> email only, no gate
  --   'code'   -> one shared join_code, distributed out-of-band (venue signage)
  --   'roster' -> per-person access_codes, emailed (the default / legacy path)
  access_mode text not null default 'roster'
                check (access_mode in ('open','code','roster')),
  join_code   text,                            -- set only when access_mode = 'code'
  created_at  timestamptz not null default now()
);
alter table events add column if not exists starts_at timestamptz not null default now();
alter table events add column if not exists logo_url text;
alter table events add column if not exists access_mode text not null default 'roster'
  check (access_mode in ('open','code','roster'));
alter table events add column if not exists join_code text;

-- Roster mode only: organizer supplies emails; we generate one code per email.
-- Login requires the exact (event_id, email, code) triple. A leaked code is
-- useless without its matching email.
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
  solo        boolean not null default false,  -- "attending solo" — feeds Explore stats
  is_test     boolean not null default false,
  created_at  timestamptz not null default now(),
  unique (event_id, email)
);
alter table profiles add column if not exists solo boolean not null default false;
alter table profiles add column if not exists is_test boolean not null default false;
-- Deck v2: photos[] is the full gallery; photo_url stays as the denormalized
-- cover (= photos[1]) so cards/chats/requests keep one cheap column.
alter table profiles add column if not exists photos text[] not null default '{}';
alter table profiles add column if not exists birth_year int;      -- year only, not DOB — enough for an age range
alter table profiles add column if not exists gender text;         -- 'man' | 'woman' | 'nonbinary' | null
alter table profiles add column if not exists show_me text not null default 'everyone'
  check (show_me in ('men','women','everyone'));
alter table profiles add column if not exists company text;
update profiles set photos = array[photo_url]
  where photo_url is not null and photos = '{}';
-- Trust & safety: full DOB (not year) so the 18+ boundary is exact.
-- birth_year goes dormant; lossy backfill (year -> Jan 1) for existing rows.
alter table profiles add column if not exists birth_date date;
update profiles set birth_date = make_date(birth_year, 1, 1)
  where birth_year is not null and birth_date is null;
-- Set when safety reports cross the auto-suspend threshold; suspended profiles
-- are dropped from decks and request inboxes pending review.
alter table profiles add column if not exists suspended_at timestamptz;

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

-- Verified "we met": only met_method = 'qr' (one party scanned the other's
-- signed QR token) is weight-bearing — it gates ratings and feeds reputation.
-- The legacy honor tap still sets met_a/met_b/met_confirmed_at but leaves
-- met_method null and grants nothing. GPS coords are a confidence/fraud
-- signal, never proof: web geolocation is spoofable and indoor-inaccurate,
-- so distance discounts met_confidence but never hard-rejects a scan.
alter table connections add column if not exists met_method text;
alter table connections add column if not exists met_lat_a double precision;
alter table connections add column if not exists met_lng_a double precision;
alter table connections add column if not exists met_lat_b double precision;
alter table connections add column if not exists met_lng_b double precision;
alter table connections add column if not exists met_distance_m double precision;
alter table connections add column if not exists met_confidence int; -- 0..100
-- Per-side read cursor for the unread badge: last time each participant opened
-- the thread. A thread is "unread" for me if the other party has a message
-- newer than my cursor (null cursor = never opened = everything unread).
alter table connections add column if not exists read_a timestamptz;
alter table connections add column if not exists read_b timestamptz;

create table if not exists messages (
  id            text primary key,
  connection_id text not null references connections(id) on delete cascade,
  sender_id     text not null references profiles(id) on delete cascade,
  body          text not null,
  created_at    timestamptz not null default now()
);

-- Post-meet feedback, split into two channels on purpose: a positive
-- endorsement (reputation) and a separate safety report. Never one star
-- scale — it would conflate "dull conversation" with "unsafe" and destroy
-- the safety signal. Both are private/aggregate and double-blind.
create table if not exists ratings (
  id            text primary key,
  connection_id text not null references connections(id) on delete cascade,
  rater_id      text not null references profiles(id) on delete cascade,
  ratee_id      text not null references profiles(id) on delete cascade,
  endorse       boolean,                      -- "would connect again"
  positives     text[] not null default '{}', -- positive chips
  created_at    timestamptz not null default now(),
  unique (connection_id, rater_id)
);

create table if not exists safety_reports (
  id            text primary key,
  connection_id text references connections(id) on delete set null,
  reporter_id   text not null references profiles(id) on delete cascade,
  reported_id   text not null references profiles(id) on delete cascade,
  reason        text not null
                  check (reason in ('no_show','disrespect','harassment','safety')),
  detail        text,
  status        text not null default 'open'
                  check (status in ('open','reviewed','actioned')),
  created_at    timestamptz not null default now()
);

create index if not exists idx_ratings_ratee on ratings(ratee_id);
create index if not exists idx_safety_reported on safety_reports(reported_id);

create index if not exists idx_profiles_event on profiles(event_id);
create index if not exists idx_intents_to on intents(event_id, to_id, status);
create index if not exists idx_intents_from on intents(event_id, from_id);
create index if not exists idx_connections_a on connections(profile_a);
create index if not exists idx_connections_b on connections(profile_b);
create index if not exists idx_messages_conn on messages(connection_id, created_at);
