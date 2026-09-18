create table public.chzzk_live_observations (
  channel_id text primary key check (channel_id ~ '^[a-f0-9]{32}$'),
  state text not null check (state in ('live', 'offline')),
  observed_at timestamptz not null,
  title text,
  updated_at timestamptz not null default pg_catalog.now(),
  constraint chzzk_live_observations_title_matches_state check (
    (state = 'live' and length(trim(title)) between 1 and 160)
    or (state = 'offline' and title is null)
  )
);

alter table public.chzzk_live_observations enable row level security;
revoke all on table public.chzzk_live_observations from anon, authenticated;
grant select, insert, update on table public.chzzk_live_observations to service_role;
