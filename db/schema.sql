-- LinkMeet MVP schema
-- Everything is scoped by event_id. That FK is the entire "multi-tenancy".

create table if not exists events (
  id          text primary key,              -- url slug, e.g. "himss-2026"
  name        text not null,
  created_at  timestamptz not null default now()
);

-- Pre-bound: organizer supplies (email) list, we generate one code per email.
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

-- One profile per (event, email). Created on first successful login (claim).
create table if not exists profiles (
  id          text primary key,
  event_id    text not null references events(id) on delete cascade,
  email       text not null,
  name        text not null,
  headline    text,
  tags        text[] not null default '{}',
  photo_url   text,
  created_at  timestamptz not null default now(),
  unique (event_id, email)
);

-- Directional swipe. liked = true (Meet/yes) or false (Pass).
create table if not exists swipes (
  swiper_id   text not null references profiles(id) on delete cascade,
  target_id   text not null references profiles(id) on delete cascade,
  event_id    text not null references events(id) on delete cascade,
  liked       boolean not null,
  created_at  timestamptz not null default now(),
  primary key (swiper_id, target_id)
);

-- Mutual like. profile_a < profile_b (canonical order) so a pair is one row.
create table if not exists matches (
  id          text primary key,
  event_id    text not null references events(id) on delete cascade,
  profile_a   text not null references profiles(id) on delete cascade,
  profile_b   text not null references profiles(id) on delete cascade,
  created_at  timestamptz not null default now(),
  unique (profile_a, profile_b)
);

alter table profiles add column if not exists is_test boolean not null default false;

create index if not exists idx_profiles_event on profiles(event_id);
create index if not exists idx_swipes_event_swiper on swipes(event_id, swiper_id);
create index if not exists idx_matches_event on matches(event_id);
create index if not exists idx_matches_a on matches(profile_a);
create index if not exists idx_matches_b on matches(profile_b);
