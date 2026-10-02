-- Deploy the worker that accepts byus_day_rsvp_received before applying this migration.
-- The RSVP remains durable when Telegram is disabled or not configured.
alter table public.telegram_alert_outbox alter column source_id drop not null;
alter table public.telegram_alert_outbox drop constraint telegram_alert_outbox_kind_check;
alter table public.telegram_alert_outbox add constraint telegram_alert_outbox_kind_check
  check(kind in ('member_joined','fan_joined','live_reserved','live_attended','draw_published','cs_inquiry_created','cs_user_replied','campaign_visited','raffle_entered','benefit_claimed','reaction_completed','mission_submitted','journey_completed','collectible_claimed','invite_redeemed','certification_approved','certification_rejected','fulfillment_updated','fulfillment_unclaimed','business_received','business_failed','mint_completed','mint_failed','delivery_failed','live_published','live_cancelled','live_rescheduled','campaign_outbound','fan_post_created','fan_post_commented','fan_post_liked','fan_lounge_posted','notice_commented','daily_checked_in','byus_day_rsvp_received'));

create table public.byus_day_rsvps (
  id uuid primary key,
  locale text not null check(locale in ('ko','en')),
  korean_name text not null check(char_length(korean_name) between 1 and 80 and korean_name !~ '[[:cntrl:]]'),
  english_name text not null check(char_length(english_name) between 1 and 80 and english_name !~ '[[:cntrl:]]'),
  phone_e164 text not null check(phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  affiliation text not null check(char_length(affiliation) between 1 and 120 and affiliation !~ '[[:cntrl:]]'),
  occupation text not null check(char_length(occupation) between 1 and 120 and occupation !~ '[[:cntrl:]]'),
  email_normalized text not null check(char_length(email_normalized)<=254 and email_normalized=lower(email_normalized) and email_normalized ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  nationality text not null check(nationality ~ '^[A-Z]{2}$'),
  resident_registration_number_encrypted text not null check(resident_registration_number_encrypted ~ '^v1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{18}$'),
  consented_at timestamptz not null default clock_timestamp(),
  ip_hash text not null check(ip_hash ~ '^[0-9a-f]{64}$'),
  payload_hash text not null check(payload_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default clock_timestamp(),
  unique(email_normalized,phone_e164)
);

create table public.byus_day_rsvp_rate_limits (
  ip_hash text primary key check(ip_hash ~ '^[0-9a-f]{64}$'),
  window_started_at timestamptz not null,
  submission_count integer not null check(submission_count>0)
);

create table public.byus_day_rsvp_idempotency (
  id uuid primary key,
  payload_hash text not null check(payload_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default clock_timestamp()
);

alter table public.byus_day_rsvps enable row level security;
alter table public.byus_day_rsvps force row level security;
alter table public.byus_day_rsvp_rate_limits enable row level security;
alter table public.byus_day_rsvp_rate_limits force row level security;
alter table public.byus_day_rsvp_idempotency enable row level security;
alter table public.byus_day_rsvp_idempotency force row level security;
revoke all on public.byus_day_rsvps,public.byus_day_rsvp_rate_limits,public.byus_day_rsvp_idempotency from public,anon,authenticated,service_role;

create function public.byus_day_rsvp_now() returns timestamptz
language sql volatile security definer set search_path='' as $$select clock_timestamp()$$;
revoke all on function public.byus_day_rsvp_now() from public,anon,authenticated,service_role;

create function public.submit_byus_day_rsvp(
  p_id uuid,p_locale text,p_korean_name text,p_english_name text,p_phone_e164 text,
  p_affiliation text,p_occupation text,p_email text,p_nationality text,p_resident_registration_number_encrypted text,p_consent boolean,
  p_ip_hash text,p_payload_hash text
) returns boolean language plpgsql security definer set search_path=pg_catalog,public as $$
declare old_hash text; cfg public.telegram_alert_settings; total integer; now_at timestamptz:=public.byus_day_rsvp_now();
begin
  if now_at>='2026-10-23 00:00:00+09'::timestamptz then raise exception 'RSVP_CLOSED'; end if;
  if p_id is null or p_locale is null or p_locale not in ('ko','en') or p_consent is distinct from true
    or p_korean_name is null or char_length(btrim(p_korean_name)) not between 1 and 80 or p_korean_name ~ '[[:cntrl:]]'
    or p_english_name is null or char_length(btrim(p_english_name)) not between 1 and 80 or p_english_name ~ '[[:cntrl:]]'
    or p_phone_e164 is null or p_phone_e164 !~ '^\+[1-9][0-9]{7,14}$'
    or p_affiliation is null or char_length(btrim(p_affiliation)) not between 1 and 120 or p_affiliation ~ '[[:cntrl:]]'
    or p_occupation is null or char_length(btrim(p_occupation)) not between 1 and 120 or p_occupation ~ '[[:cntrl:]]'
    or p_email is null or p_email<>lower(p_email) or char_length(p_email)>254 or p_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or p_email ~ '[[:cntrl:]]'
    or p_nationality is null or p_nationality !~ '^[A-Z]{2}$'
    or p_resident_registration_number_encrypted is null or p_resident_registration_number_encrypted !~ '^v1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{18}$'
    or p_ip_hash is null or p_ip_hash !~ '^[0-9a-f]{64}$' or p_payload_hash is null or p_payload_hash !~ '^[0-9a-f]{64}$'
  then raise exception 'RSVP_INVALID'; end if;

  -- ponytail: one event-wide lock is sufficient for this bounded RSVP volume; shard only if measured contention appears.
  perform pg_advisory_xact_lock(10222026,1830);
  select payload_hash into old_hash from public.byus_day_rsvp_idempotency where id=p_id;
  if found then
    if old_hash<>p_payload_hash then raise exception 'RSVP_IDEMPOTENCY_CONFLICT'; end if;
    return true;
  end if;

  -- Every new idempotency key spends the same durable request budget before
  -- contact lookup, so accepted-vs-existing contacts cannot be enumerated.
  insert into public.byus_day_rsvp_rate_limits(ip_hash,window_started_at,submission_count)
  values(p_ip_hash,now_at,1)
  on conflict(ip_hash) do update set
    window_started_at=case when public.byus_day_rsvp_rate_limits.window_started_at<=now_at-interval '1 hour' then now_at else public.byus_day_rsvp_rate_limits.window_started_at end,
    submission_count=case when public.byus_day_rsvp_rate_limits.window_started_at<=now_at-interval '1 hour' then 1 else public.byus_day_rsvp_rate_limits.submission_count+1 end;
  select submission_count into total from public.byus_day_rsvp_rate_limits where ip_hash=p_ip_hash;
  if total>3 then raise exception 'RSVP_RATE_LIMITED'; end if;
  insert into public.byus_day_rsvp_idempotency(id,payload_hash) values(p_id,p_payload_hash);
  if exists(select 1 from public.byus_day_rsvps where email_normalized=p_email and phone_e164=p_phone_e164) then return true; end if;

  insert into public.byus_day_rsvps(id,locale,korean_name,english_name,phone_e164,affiliation,occupation,email_normalized,nationality,resident_registration_number_encrypted,ip_hash,payload_hash)
  values(p_id,p_locale,btrim(p_korean_name),btrim(p_english_name),p_phone_e164,btrim(p_affiliation),btrim(p_occupation),p_email,p_nationality,p_resident_registration_number_encrypted,p_ip_hash,p_payload_hash);

  -- Shared Telegram queue order is always settings, then outbox.
  select * into cfg from public.telegram_alert_settings where singleton for update;
  if coalesce(cfg.enabled,false) then
    select count(*)::integer into total from public.byus_day_rsvps;
    insert into public.telegram_alert_outbox(kind,source_id,activation_id,chat_id,occurred_at,activity_context,activity_quantity)
    values('byus_day_rsvp_received',null,cfg.activation_id,cfg.chat_id,now_at,'누적 '||total::text||'명',total);
  end if;
  return true;
end $$;

revoke all on function public.submit_byus_day_rsvp(uuid,text,text,text,text,text,text,text,text,text,boolean,text,text) from public,anon,authenticated,service_role;
grant execute on function public.submit_byus_day_rsvp(uuid,text,text,text,text,text,text,text,text,text,boolean,text,text) to service_role;
