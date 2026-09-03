-- Phase 4 Benefit economy foundations. Legacy direct claims and application
-- selection remain untouched; campaign Benefits are an additive allocation path.

create type public.benefit_campaign_status as enum ('draft', 'published');
create type public.benefit_draw_candidate_result as enum ('won', 'not_selected');
create type public.benefit_fulfillment_method as enum (
  'digital', 'physical_shipping', 'on_site_pickup'
);
create type public.benefit_fulfillment_status as enum (
  'information_required', 'ready', 'shipping_preparing', 'shipping_in_transit',
  'shipping_completed', 'pickup_available', 'pickup_completed', 'digital_delivered'
);

create table public.live_benefit_campaigns (
  id uuid primary key default extensions.gen_random_uuid(),
  live_event_id uuid not null unique references public.live_events(id) on delete restrict,
  status public.benefit_campaign_status not null default 'draft',
  entry_opens_at timestamptz not null,
  entry_closes_at timestamptz not null,
  revision integer not null default 1 check (revision > 0),
  actor_app_user_id uuid not null references public.app_users(id) on delete restrict,
  actor_admin_allowlist_id uuid not null references public.admin_allowlist(id) on delete restrict,
  published_at timestamptz,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  constraint live_benefit_campaign_window_ordered check (entry_opens_at < entry_closes_at),
  constraint live_benefit_campaign_publication_shape check (
    (status = 'draft' and published_at is null)
    or (status = 'published' and published_at is not null)
  )
);

create table public.live_benefit_campaign_items (
  id uuid primary key default extensions.gen_random_uuid(),
  campaign_id uuid not null references public.live_benefit_campaigns(id) on delete restrict,
  benefit_id uuid not null references public.benefits(id) on delete restrict,
  priority integer not null check (priority > 0),
  per_fan_ticket_limit integer,
  winner_quantity integer not null default 1 check (winner_quantity > 0),
  created_at timestamptz not null default pg_catalog.now(),
  unique (campaign_id, benefit_id),
  unique (campaign_id, priority),
  constraint live_benefit_campaign_item_limit_positive check (
    per_fan_ticket_limit is null or per_fan_ticket_limit > 0
  )
);

create table public.benefit_ticket_entries (
  id uuid primary key default extensions.gen_random_uuid(),
  idempotency_key uuid not null unique,
  campaign_id uuid not null references public.live_benefit_campaigns(id) on delete restrict,
  benefit_id uuid not null references public.benefits(id) on delete restrict,
  app_user_id uuid not null references public.app_users(id) on delete restrict,
  ticket_amount integer not null check (ticket_amount > 0),
  ticket_ledger_id uuid not null unique references public.fan_ticket_ledger(id) on delete restrict,
  entered_at timestamptz not null default pg_catalog.now(),
  unique (id, campaign_id, benefit_id, app_user_id),
  foreign key (campaign_id, benefit_id)
    references public.live_benefit_campaign_items(campaign_id, benefit_id) on delete restrict
);

create table public.benefit_draws (
  id uuid primary key default extensions.gen_random_uuid(),
  campaign_id uuid not null unique references public.live_benefit_campaigns(id) on delete restrict,
  idempotency_key uuid not null unique,
  algorithm text not null check (algorithm = 'sha256-weighted-rank-v1'),
  seed_hash text not null check (seed_hash ~ '^[0-9a-f]{64}$'),
  actor_app_user_id uuid not null references public.app_users(id) on delete restrict,
  actor_admin_allowlist_id uuid not null references public.admin_allowlist(id) on delete restrict,
  correlation_id uuid not null,
  executed_at timestamptz not null default pg_catalog.now(),
  unique (id, campaign_id)
);

create table public.benefit_draw_secrets (
  draw_id uuid primary key references public.benefit_draws(id) on delete restrict,
  raw_seed bytea not null check (octet_length(raw_seed) = 32),
  created_at timestamptz not null default pg_catalog.now()
);

create table public.benefit_draw_candidates (
  id uuid primary key default extensions.gen_random_uuid(),
  draw_id uuid not null references public.benefit_draws(id) on delete restrict,
  campaign_id uuid not null references public.live_benefit_campaigns(id) on delete restrict,
  benefit_id uuid not null references public.benefits(id) on delete restrict,
  app_user_id uuid not null references public.app_users(id) on delete restrict,
  weight integer not null check (weight > 0),
  digest text not null check (digest ~ '^[0-9a-f]{64}$'),
  uniform_value numeric not null check (uniform_value > 0 and uniform_value < 1),
  rank_value double precision not null check (rank_value >= 0),
  result public.benefit_draw_candidate_result not null,
  created_at timestamptz not null default pg_catalog.now(),
  unique (draw_id, benefit_id, app_user_id),
  foreign key (draw_id, campaign_id) references public.benefit_draws(id, campaign_id) on delete restrict,
  foreign key (campaign_id, benefit_id)
    references public.live_benefit_campaign_items(campaign_id, benefit_id) on delete restrict
);

create table public.benefit_draw_winners (
  id uuid primary key default extensions.gen_random_uuid(),
  draw_id uuid not null references public.benefit_draws(id) on delete restrict,
  campaign_id uuid not null references public.live_benefit_campaigns(id) on delete restrict,
  benefit_id uuid not null references public.benefits(id) on delete restrict,
  app_user_id uuid not null references public.app_users(id) on delete restrict,
  candidate_id uuid not null unique references public.benefit_draw_candidates(id) on delete restrict,
  selected_at timestamptz not null default pg_catalog.now(),
  unique (draw_id, benefit_id, app_user_id),
  foreign key (draw_id, campaign_id) references public.benefit_draws(id, campaign_id) on delete restrict,
  foreign key (campaign_id, benefit_id)
    references public.live_benefit_campaign_items(campaign_id, benefit_id) on delete restrict
);

create table public.benefit_fulfillments (
  id uuid primary key default extensions.gen_random_uuid(),
  winner_id uuid not null unique references public.benefit_draw_winners(id) on delete restrict,
  method public.benefit_fulfillment_method not null,
  status public.benefit_fulfillment_status not null,
  revision integer not null default 1 check (revision > 0),
  updated_at timestamptz not null default pg_catalog.now(),
  created_at timestamptz not null default pg_catalog.now()
);

create table public.benefit_fulfillment_events (
  id uuid primary key default extensions.gen_random_uuid(),
  fulfillment_id uuid not null references public.benefit_fulfillments(id) on delete restrict,
  from_status public.benefit_fulfillment_status,
  to_status public.benefit_fulfillment_status not null,
  carrier text,
  tracking_number text,
  operator_memo text,
  actor_app_user_id uuid references public.app_users(id) on delete restrict,
  actor_admin_allowlist_id uuid references public.admin_allowlist(id) on delete restrict,
  correlation_id uuid not null,
  created_at timestamptz not null default pg_catalog.now()
);

create table public.benefit_recipient_private (
  winner_id uuid primary key references public.benefit_draw_winners(id) on delete restrict,
  consent_version text not null check (length(trim(consent_version)) between 1 and 100),
  consented_at timestamptz not null,
  name text not null check (length(trim(name)) between 1 and 120),
  phone text not null check (length(trim(phone)) between 7 and 40),
  postal_code text,
  address1 text,
  address2 text,
  updated_at timestamptz not null default pg_catalog.now(),
  created_at timestamptz not null default pg_catalog.now()
);

create table public.benefit_recipient_access_audits (
  id uuid primary key default extensions.gen_random_uuid(),
  winner_id uuid not null references public.benefit_draw_winners(id) on delete restrict,
  access_type text not null check (access_type in ('revealed', 'purged')),
  actor_app_user_id uuid references public.app_users(id) on delete restrict,
  actor_admin_allowlist_id uuid references public.admin_allowlist(id) on delete restrict,
  correlation_id uuid,
  accessed_at timestamptz not null default pg_catalog.now()
);

create index benefit_ticket_entries_owner_idx
  on public.benefit_ticket_entries(app_user_id, entered_at desc, id desc);
create index benefit_ticket_entries_weight_idx
  on public.benefit_ticket_entries(campaign_id, benefit_id, app_user_id);
create index benefit_draw_candidates_rank_idx
  on public.benefit_draw_candidates(draw_id, benefit_id, rank_value, app_user_id);
create index benefit_draw_winners_owner_idx
  on public.benefit_draw_winners(app_user_id, selected_at desc, id desc);
create index benefit_fulfillment_events_history_idx
  on public.benefit_fulfillment_events(fulfillment_id, created_at, id);

create function public.reject_benefit_economy_history_mutation()
returns trigger language plpgsql set search_path = '' as $$
begin raise exception 'benefit economy history is append-only'; end;
$$;
create function public.reject_benefit_economy_history_truncate()
returns trigger language plpgsql set search_path = '' as $$
begin raise exception 'benefit economy history cannot be truncated'; end;
$$;

do $$
declare t text;
begin
  foreach t in array array[
    'benefit_ticket_entries','benefit_draws','benefit_draw_secrets',
    'benefit_draw_candidates','benefit_draw_winners','benefit_fulfillment_events',
    'benefit_recipient_access_audits'
  ] loop
    execute format(
      'create trigger %I before update or delete on public.%I for each row execute function public.reject_benefit_economy_history_mutation()',
      t || '_reject_update_delete', t
    );
    execute format(
      'create trigger %I before truncate on public.%I for each statement execute function public.reject_benefit_economy_history_truncate()',
      t || '_reject_truncate', t
    );
  end loop;
end;
$$;

create trigger live_benefit_campaigns_set_updated_at before update on public.live_benefit_campaigns
for each row execute function public.set_updated_at();
create trigger benefit_fulfillments_set_updated_at before update on public.benefit_fulfillments
for each row execute function public.set_updated_at();
create trigger benefit_recipient_private_set_updated_at before update on public.benefit_recipient_private
for each row execute function public.set_updated_at();

create function public.get_admin_benefit_campaigns(
  p_actor_app_user_id uuid, p_actor_admin_allowlist_id uuid
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_result jsonb;
begin
  perform public.assert_active_admin(p_actor_app_user_id,p_actor_admin_allowlist_id,false);
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',c.id,'liveEventId',c.live_event_id,'status',c.status,
    'entryOpensAt',c.entry_opens_at,'entryClosesAt',c.entry_closes_at,
    'revision',c.revision,'publishedAt',c.published_at,
    'benefits',coalesce((select jsonb_agg(jsonb_build_object(
      'benefitId',i.benefit_id,'priority',i.priority,
      'perFanTicketLimit',i.per_fan_ticket_limit,'winnerQuantity',i.winner_quantity
    ) order by i.priority,i.benefit_id) from public.live_benefit_campaign_items i
      where i.campaign_id=c.id),'[]'::jsonb)
  ) order by c.created_at desc,c.id desc),'[]'::jsonb) into v_result
  from public.live_benefit_campaigns c;
  return v_result;
end;
$$;

create function public.save_admin_benefit_campaign(
  p_actor_app_user_id uuid,
  p_actor_admin_allowlist_id uuid,
  p_correlation_id uuid,
  p_campaign_id uuid,
  p_expected_revision integer,
  p_live_event_id uuid,
  p_entry_opens_at timestamptz,
  p_entry_closes_at timestamptz,
  p_benefits jsonb
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid := coalesce(p_campaign_id,extensions.gen_random_uuid());
  v_revision integer;
  v_before jsonb;
  v_count integer;
begin
  perform public.assert_active_admin(p_actor_app_user_id,p_actor_admin_allowlist_id,true);
  if p_entry_opens_at >= p_entry_closes_at then raise exception 'invalid campaign entry window'; end if;
  if jsonb_typeof(p_benefits) <> 'array' or jsonb_array_length(p_benefits)=0 then
    raise exception 'campaign benefits required';
  end if;
  select count(*) into v_count from jsonb_to_recordset(p_benefits)
    as x("benefitId" uuid,"priority" integer,"perFanTicketLimit" integer,"winnerQuantity" integer)
    where x."priority" is null or x."priority" <= 0
      or (x."perFanTicketLimit" is not null and x."perFanTicketLimit" <= 0)
      or coalesce(x."winnerQuantity",1) <= 0;
  if v_count > 0 then raise exception 'invalid campaign benefit constraint'; end if;

  if p_campaign_id is null then
    insert into public.live_benefit_campaigns(
      id,live_event_id,entry_opens_at,entry_closes_at,actor_app_user_id,actor_admin_allowlist_id
    ) values(v_id,p_live_event_id,p_entry_opens_at,p_entry_closes_at,p_actor_app_user_id,p_actor_admin_allowlist_id);
  else
    select c.revision,to_jsonb(c) into v_revision,v_before
      from public.live_benefit_campaigns c where c.id=p_campaign_id for update;
    if not found then raise exception 'benefit campaign not found'; end if;
    if v_revision <> p_expected_revision then raise exception 'benefit campaign revision conflict'; end if;
    if v_before->>'status' <> 'draft' then raise exception 'published campaign is immutable'; end if;
    update public.live_benefit_campaigns set
      live_event_id=p_live_event_id,entry_opens_at=p_entry_opens_at,
      entry_closes_at=p_entry_closes_at,revision=revision+1,
      actor_app_user_id=p_actor_app_user_id,actor_admin_allowlist_id=p_actor_admin_allowlist_id
    where id=v_id;
    delete from public.live_benefit_campaign_items where campaign_id=v_id;
  end if;

  insert into public.live_benefit_campaign_items(
    campaign_id,benefit_id,priority,per_fan_ticket_limit,winner_quantity
  ) select v_id,x."benefitId",x."priority",x."perFanTicketLimit",coalesce(x."winnerQuantity",1)
    from jsonb_to_recordset(p_benefits)
      as x("benefitId" uuid,"priority" integer,"perFanTicketLimit" integer,"winnerQuantity" integer);

  insert into public.audit_logs(
    actor_app_user_id,actor_admin_allowlist_id,action,entity_type,entity_id,
    correlation_id,before_after_summary
  ) values(
    p_actor_app_user_id,p_actor_admin_allowlist_id,'benefit_campaign.saved',
    'live_benefit_campaign',v_id::text,p_correlation_id,
    jsonb_build_object('liveEventId',p_live_event_id,'benefitCount',jsonb_array_length(p_benefits))
  );
  return v_id;
end;
$$;

create function public.publish_admin_benefit_campaign(
  p_actor_app_user_id uuid,
  p_actor_admin_allowlist_id uuid,
  p_correlation_id uuid,
  p_campaign_id uuid,
  p_expected_revision integer
) returns void language plpgsql security definer set search_path = '' as $$
declare v public.live_benefit_campaigns%rowtype;
begin
  perform public.assert_active_admin(p_actor_app_user_id,p_actor_admin_allowlist_id,true);
  select * into v from public.live_benefit_campaigns where id=p_campaign_id for update;
  if not found then raise exception 'benefit campaign not found'; end if;
  if v.revision <> p_expected_revision then raise exception 'benefit campaign revision conflict'; end if;
  if v.status <> 'draft' then raise exception 'benefit campaign is immutable'; end if;
  if not exists(select 1 from public.live_benefit_campaign_items where campaign_id=v.id) then
    raise exception 'campaign benefits required';
  end if;
  if exists(
    select 1 from public.live_benefit_campaign_items i join public.benefits b on b.id=i.benefit_id
    where i.campaign_id=v.id and b.publication_status <> 'published'
  ) then raise exception 'campaign requires published benefits'; end if;
  update public.live_benefit_campaigns set status='published',published_at=pg_catalog.now(),revision=revision+1
    where id=v.id;
  insert into public.audit_logs(
    actor_app_user_id,actor_admin_allowlist_id,action,entity_type,entity_id,
    correlation_id,before_after_summary
  ) values(
    p_actor_app_user_id,p_actor_admin_allowlist_id,'benefit_campaign.published',
    'live_benefit_campaign',v.id::text,p_correlation_id,
    jsonb_build_object('from','draft','to','published')
  );
end;
$$;

revoke all on table public.live_benefit_campaigns from anon,authenticated,service_role;
revoke all on table public.live_benefit_campaign_items from anon,authenticated,service_role;
revoke all on table public.benefit_ticket_entries from anon,authenticated,service_role;
revoke all on table public.benefit_draws from anon,authenticated,service_role;
revoke all on table public.benefit_draw_secrets from anon,authenticated,service_role;
revoke all on table public.benefit_draw_candidates from anon,authenticated,service_role;
revoke all on table public.benefit_draw_winners from anon,authenticated,service_role;
revoke all on table public.benefit_fulfillments from anon,authenticated,service_role;
revoke all on table public.benefit_fulfillment_events from anon,authenticated,service_role;
revoke all on table public.benefit_recipient_private from anon,authenticated,service_role;
revoke all on table public.benefit_recipient_access_audits from anon,authenticated,service_role;

alter table public.live_benefit_campaigns enable row level security;
alter table public.live_benefit_campaigns force row level security;
alter table public.live_benefit_campaign_items enable row level security;
alter table public.live_benefit_campaign_items force row level security;
alter table public.benefit_ticket_entries enable row level security;
alter table public.benefit_ticket_entries force row level security;
alter table public.benefit_draws enable row level security;
alter table public.benefit_draws force row level security;
alter table public.benefit_draw_secrets enable row level security;
alter table public.benefit_draw_secrets force row level security;
alter table public.benefit_draw_candidates enable row level security;
alter table public.benefit_draw_candidates force row level security;
alter table public.benefit_draw_winners enable row level security;
alter table public.benefit_draw_winners force row level security;
alter table public.benefit_fulfillments enable row level security;
alter table public.benefit_fulfillments force row level security;
alter table public.benefit_fulfillment_events enable row level security;
alter table public.benefit_fulfillment_events force row level security;
alter table public.benefit_recipient_private enable row level security;
alter table public.benefit_recipient_private force row level security;
alter table public.benefit_recipient_access_audits enable row level security;
alter table public.benefit_recipient_access_audits force row level security;

grant execute on function public.get_admin_benefit_campaigns(uuid,uuid) to service_role;
grant execute on function public.save_admin_benefit_campaign(uuid,uuid,uuid,uuid,integer,uuid,timestamptz,timestamptz,jsonb) to service_role;
grant execute on function public.publish_admin_benefit_campaign(uuid,uuid,uuid,uuid,integer) to service_role;
