-- Reservation-capable recurring LIVE foundation. Existing rows remain general
-- and retain their strict brand, end time, and attendance configuration.

create type public.live_event_type as enum ('general','recurring');
create type public.recurring_live_series_status as enum ('active','paused','retired');
create type public.recurring_live_rule_status as enum ('proposed','approved','rejected');
create type public.recurring_live_rule_reason as enum ('initial','rule_change','hiatus','source_conflict','duplicate');
create type public.recurring_live_observation_result as enum ('regular','irregular','unconfirmed');
create type public.recurring_live_verification as enum ('verified','inaccessible','not_found','conflicting');
create type public.recurring_live_run_mode as enum ('bootstrap','weekly','replenish');
create type public.recurring_live_run_status as enum ('running','completed','needs_review','failed');

create table public.recurring_live_runs (
  id uuid primary key,
  idempotency_key text not null unique check (length(pg_catalog.btrim(idempotency_key)) between 8 and 200),
  input_hash text not null check (input_hash ~ '^[0-9a-f]{64}$'),
  mode public.recurring_live_run_mode not null,
  status public.recurring_live_run_status not null default 'running',
  roster jsonb not null,
  summary jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default pg_catalog.clock_timestamp(),
  completed_at timestamptz,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  check (jsonb_typeof(roster)='object' and jsonb_typeof(summary)='object'),
  check ((status='running' and completed_at is null) or (status<>'running' and completed_at is not null))
);

create table public.recurring_live_series (
  id uuid primary key default extensions.gen_random_uuid(),
  celebrity_id uuid not null references public.celebrities(id) on delete restrict,
  series_key text not null check (series_key ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' and length(series_key)<=120),
  status public.recurring_live_series_status not null default 'active',
  current_rule_revision_id uuid,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  unique (celebrity_id,series_key)
);

create table public.recurring_live_observations (
  id uuid primary key default extensions.gen_random_uuid(),
  run_id uuid not null references public.recurring_live_runs(id) on delete restrict,
  celebrity_id uuid not null references public.celebrities(id) on delete restrict,
  result public.recurring_live_observation_result not null,
  verification public.recurring_live_verification not null,
  source_url text not null check (
    source_url=pg_catalog.btrim(source_url) and length(source_url) between 8 and 2048
    and source_url ~ '^https://[^[:space:]@]+$'
  ),
  source_account text not null check (length(pg_catalog.btrim(source_account)) between 1 and 240),
  source_published_at timestamptz,
  observed_at timestamptz not null,
  original_text text not null check (length(original_text) between 1 and 12000),
  evidence_path text not null check (
    length(pg_catalog.btrim(evidence_path)) between 1 and 1024
    and evidence_path !~ '(^|/)\.\.(/|$)'
  ),
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  normalized_rule jsonb,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  unique (run_id,celebrity_id,content_hash),
  check (normalized_rule is null or jsonb_typeof(normalized_rule)='object')
);

create table public.recurring_live_rule_revisions (
  id uuid primary key default extensions.gen_random_uuid(),
  series_id uuid not null references public.recurring_live_series(id) on delete restrict,
  revision integer not null check (revision>0),
  status public.recurring_live_rule_status not null default 'proposed',
  rule jsonb not null check (jsonb_typeof(rule)='object'),
  source_observation_ids uuid[] not null check (
    cardinality(source_observation_ids) between 1 and 100
    and array_position(source_observation_ids,null) is null
  ),
  proposal_hash text not null check (proposal_hash ~ '^[0-9a-f]{64}$'),
  reason public.recurring_live_rule_reason not null,
  review_payload jsonb not null default '{}'::jsonb check (jsonb_typeof(review_payload)='object'),
  approved_actor_app_user_id uuid references public.app_users(id) on delete restrict,
  approved_actor_admin_allowlist_id uuid references public.admin_allowlist(id) on delete restrict,
  approved_at timestamptz,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  unique (series_id,revision),
  check (
    (status='approved' and approved_actor_app_user_id is not null and approved_actor_admin_allowlist_id is not null and approved_at is not null)
    or (status<>'approved' and approved_actor_app_user_id is null and approved_actor_admin_allowlist_id is null and approved_at is null)
  )
);

alter table public.recurring_live_series add constraint recurring_live_series_current_rule_fk
  foreign key (current_rule_revision_id) references public.recurring_live_rule_revisions(id) on delete restrict;
create unique index recurring_live_rule_revisions_one_pending_hash
  on public.recurring_live_rule_revisions(series_id,proposal_hash) where status='proposed';
create index recurring_live_observations_latest_idx
  on public.recurring_live_observations(celebrity_id,observed_at desc,id desc);
create index recurring_live_rule_revisions_review_idx
  on public.recurring_live_rule_revisions(status,created_at,id);

alter table public.live_events
  add column live_type public.live_event_type not null default 'general',
  add column recurring_series_id uuid references public.recurring_live_series(id) on delete restrict,
  add column recurring_slot_id uuid,
  add column recurrence_week date,
  add column recurring_rule_revision_id uuid references public.recurring_live_rule_revisions(id) on delete restrict;

alter table public.live_events
  alter column ends_at drop not null,
  alter column brand_id drop not null,
  alter column fan_code_hash drop not null,
  alter column attendance_valid_from drop not null,
  alter column attendance_valid_until drop not null,
  drop constraint live_events_schedule_ordered,
  drop constraint live_events_attendance_window_valid,
  drop constraint live_events_fan_code_hash_complete;

alter table public.live_events
  add constraint live_events_schedule_ordered check (
    reservation_opens_at < reservation_closes_at
    and reservation_closes_at <= starts_at
    and (ends_at is null or starts_at < ends_at)
  ),
  add constraint live_events_general_required_fields check (
    live_type<>'general' or (
      brand_id is not null and ends_at is not null and fan_code_hash is not null
      and attendance_valid_from is not null and attendance_valid_until is not null
    )
  ),
  add constraint live_events_recurring_identity check (
    (live_type='general' and recurring_series_id is null and recurring_slot_id is null
      and recurrence_week is null and recurring_rule_revision_id is null)
    or
    (live_type='recurring' and recurring_series_id is not null and recurring_slot_id is not null
      and recurrence_week is not null and recurring_rule_revision_id is not null)
  ),
  add constraint live_events_attendance_configuration check (
    (fan_code_hash is null and attendance_valid_from is null and attendance_valid_until is null)
    or
    (fan_code_hash is not null and attendance_valid_from is not null
      and attendance_valid_until is not null and attendance_valid_from < attendance_valid_until)
  ),
  add constraint live_events_fan_code_hash_complete check (
    fan_code_hash is null or (
      fan_code_hash=pg_catalog.btrim(fan_code_hash)
      and fan_code_hash ~ '^\$2[aby]\$(1[0-4])\$[./A-Za-z0-9]{53}$'
    )
  );

create unique index live_events_recurring_occurrence_identity
  on public.live_events(recurring_series_id,recurring_slot_id,recurrence_week)
  where live_type='recurring';
create index live_events_recurring_series_schedule_idx
  on public.live_events(recurring_series_id,starts_at) where live_type='recurring';

alter table public.live_schedule_revisions
  alter column before_ends_at drop not null,
  alter column before_attendance_valid_from drop not null,
  alter column before_attendance_valid_until drop not null,
  alter column after_ends_at drop not null,
  alter column after_attendance_valid_from drop not null,
  alter column after_attendance_valid_until drop not null,
  drop constraint live_schedule_revisions_before_ordered,
  drop constraint live_schedule_revisions_after_ordered;
alter table public.live_schedule_revisions
  add constraint live_schedule_revisions_before_ordered check (
    before_reservation_opens_at < before_reservation_closes_at
    and before_reservation_closes_at <= before_starts_at
    and (before_ends_at is null or before_starts_at < before_ends_at)
    and ((before_attendance_valid_from is null and before_attendance_valid_until is null)
      or (before_attendance_valid_from is not null and before_attendance_valid_until is not null
        and before_attendance_valid_from < before_attendance_valid_until))
  ),
  add constraint live_schedule_revisions_after_ordered check (
    after_reservation_opens_at < after_reservation_closes_at
    and after_reservation_closes_at <= after_starts_at
    and (after_ends_at is null or after_starts_at < after_ends_at)
    and ((after_attendance_valid_from is null and after_attendance_valid_until is null)
      or (after_attendance_valid_from is not null and after_attendance_valid_until is not null
        and after_attendance_valid_from < after_attendance_valid_until))
  );

create or replace function public.default_live_attendance_window()
returns trigger language plpgsql set search_path='' as $$
begin
  if new.live_type='general' then
    new.attendance_valid_from:=coalesce(new.attendance_valid_from,new.starts_at);
    new.attendance_valid_until:=coalesce(new.attendance_valid_until,new.ends_at);
  end if;
  return new;
end $$;

create or replace function public.assert_live_event_publishable(target_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare current_live public.live_events%rowtype; celebrity_status public.content_status; brand_status public.content_status;
begin
  select * into current_live from public.live_events where id=target_id;
  if not found or current_live.publication_status<>'published' then return; end if;
  select status into celebrity_status from public.celebrities where id=current_live.celebrity_id;
  if celebrity_status<>'published' then raise exception 'published live event requires a published celebrity'; end if;
  if current_live.live_type='general' and current_live.brand_id is null then
    raise exception 'published general live event requires a brand';
  end if;
  if current_live.brand_id is not null then
    select status into brand_status from public.brands where id=current_live.brand_id;
    if brand_status is distinct from 'published' then raise exception 'published live event requires a published brand'; end if;
  end if;
  if (select count(*) from public.live_event_localizations where live_event_id=target_id)<>2
    or exists(select 1 from pg_catalog.unnest(enum_range(null::public.content_locale)) required(locale)
      where not exists(select 1 from public.live_event_localizations localization
        where localization.live_event_id=target_id and localization.locale=required.locale)) then
    raise exception 'published live event requires complete ko and en localizations';
  end if;
end $$;

create or replace function public.live_effective_status_at(target_live_event_id uuid,target_at timestamptz)
returns public.live_content_status language plpgsql stable security definer set search_path='' as $$
declare live_record public.live_events%rowtype; override_status public.live_content_status;
begin
  select * into live_record from public.live_events where id=target_live_event_id;
  if not found then raise exception 'live event not found'; end if;
  if live_record.content_status='cancelled' then return 'cancelled'; end if;
  select override.effective_status into override_status from public.live_status_overrides override
    where override.live_event_id=target_live_event_id and override.effective_from<=target_at
      and (override.effective_until is null or target_at<override.effective_until)
    order by override.effective_from desc,override.created_at desc,override.id desc limit 1;
  if override_status is not null then return override_status; end if;
  if target_at<live_record.starts_at then return 'scheduled'; end if;
  if live_record.ends_at is null then return 'scheduled'; end if;
  if target_at<live_record.ends_at then return 'live'; end if;
  return 'ended';
end $$;

create or replace function public.enforce_live_attendance_window()
returns trigger language plpgsql set search_path='' as $$
declare opens_at timestamptz; closes_at timestamptz; clock_time timestamptz:=statement_timestamp();
begin
  select attendance_valid_from,attendance_valid_until into strict opens_at,closes_at
  from public.live_events where id=new.live_event_id;
  if opens_at is null or closes_at is null then
    raise exception 'G3_ATTENDANCE_NOT_CONFIGURED' using errcode='23514';
  end if;
  if clock_time<opens_at then raise exception 'G3_ATTENDANCE_NOT_OPEN' using errcode='23514'; end if;
  if clock_time>=closes_at then raise exception 'G3_ATTENDANCE_ENDED' using errcode='23514'; end if;
  return new;
end $$;

alter function public.attend_owned_live_event(uuid,text,uuid,text,uuid,text,text)
  rename to attend_owned_live_event_before_recurring_live;
create function public.attend_owned_live_event(
  p_app_user_id uuid,p_live_slug text,p_idempotency_key uuid,p_normalized_code text,
  p_stamp_id uuid,p_stamp_operation_key text,p_stamp_issuance_id text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare configured boolean;
begin
  -- The delegated latest producer retains fan_action_native_enabled(3,p_app_user_id)
  -- and its GIWA outbox branch; this wrapper only adds fail-closed configuration.
  select fan_code_hash is not null and attendance_valid_from is not null and attendance_valid_until is not null
    into configured from public.live_events where slug=p_live_slug and publication_status='published';
  if configured is distinct from true then raise exception 'G3_ATTENDANCE_NOT_CONFIGURED' using errcode='23514'; end if;
  return public.attend_owned_live_event_before_recurring_live(
    p_app_user_id,p_live_slug,p_idempotency_key,p_normalized_code,p_stamp_id,p_stamp_operation_key,p_stamp_issuance_id);
end $$;

create function public.protect_recurring_live_identity()
returns trigger language plpgsql set search_path='' as $$
declare collision_id uuid;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('recurring-live:creator:'||new.celebrity_id::text,0));
  if new.live_type='recurring' and pg_catalog.current_setting('byus.recurring_live_writer',true) is distinct from 'on' then
    if tg_op='INSERT' or (tg_op='UPDATE' and (
      new.live_type is distinct from old.live_type
      or new.recurring_series_id is distinct from old.recurring_series_id
      or new.recurring_slot_id is distinct from old.recurring_slot_id
      or new.recurrence_week is distinct from old.recurrence_week
      or new.recurring_rule_revision_id is distinct from old.recurring_rule_revision_id)) then
      raise exception 'recurring LIVE identity requires the recurring scheduler';
    end if;
  end if;
  if new.live_type='general' then
    select live.id into collision_id from public.live_events live
    join public.recurring_live_rule_revisions revision on revision.id=live.recurring_rule_revision_id
    where live.id<>new.id and live.live_type='recurring' and live.celebrity_id=new.celebrity_id and live.archived_at is null
      and (live.starts_at at time zone (revision.rule->>'timeZone'))::date
        =(new.starts_at at time zone (revision.rule->>'timeZone'))::date
    order by live.starts_at,live.id limit 1;
    if collision_id is not null then raise exception 'recurring LIVE day collision; reuse or review existing id %',collision_id; end if;
  end if;
  return new;
end $$;
create trigger live_events_protect_recurring_identity
before insert or update of live_type,celebrity_id,starts_at,live_provider,external_live_url,
  recurring_series_id,recurring_slot_id,recurrence_week,recurring_rule_revision_id
on public.live_events for each row execute function public.protect_recurring_live_identity();

create function public.reject_recurring_observation_mutation()
returns trigger language plpgsql set search_path='' as $$ begin raise exception 'recurring LIVE observations are append-only'; end $$;
create trigger recurring_live_observations_append_only before update or delete on public.recurring_live_observations
for each row execute function public.reject_recurring_observation_mutation();
create trigger recurring_live_observations_reject_truncate before truncate on public.recurring_live_observations
for each statement execute function public.reject_recurring_observation_mutation();

alter table public.recurring_live_runs enable row level security;
alter table public.recurring_live_runs force row level security;
alter table public.recurring_live_series enable row level security;
alter table public.recurring_live_series force row level security;
alter table public.recurring_live_rule_revisions enable row level security;
alter table public.recurring_live_rule_revisions force row level security;
alter table public.recurring_live_observations enable row level security;
alter table public.recurring_live_observations force row level security;
revoke all on public.recurring_live_runs,public.recurring_live_series,public.recurring_live_rule_revisions,
  public.recurring_live_observations from public,anon,authenticated,service_role;
revoke all on function public.attend_owned_live_event_before_recurring_live(uuid,text,uuid,text,uuid,text,text),
  public.default_live_attendance_window(),public.enforce_live_attendance_window(),public.protect_recurring_live_identity(),
  public.reject_recurring_observation_mutation() from public,anon,authenticated,service_role;
revoke all on function public.attend_owned_live_event(uuid,text,uuid,text,uuid,text,text) from public,anon,authenticated;
grant execute on function public.attend_owned_live_event(uuid,text,uuid,text,uuid,text,text) to service_role;

comment on table public.recurring_live_observations is 'Private append-only official-source evidence; never exposed to browser clients.';
comment on column public.live_events.recurrence_week is 'ISO-local Monday used with series and stable slot identity; schedule time is not identity.';
