create table public.outbound_link_visits (
  id uuid primary key default gen_random_uuid(),
  campaign text not null check (campaign ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(campaign) <= 100),
  created_at timestamptz not null default now()
);

create index outbound_link_visits_campaign_created_at_idx
  on public.outbound_link_visits (campaign, created_at);

alter table public.outbound_link_visits enable row level security;
revoke all on table public.outbound_link_visits from public, anon, authenticated;
grant select, insert on table public.outbound_link_visits to service_role;

comment on table public.outbound_link_visits is
  'Server-recorded outbound redirect requests, including repeat visits. No visitor identifiers; not unique people or confirmed destination arrivals.';
