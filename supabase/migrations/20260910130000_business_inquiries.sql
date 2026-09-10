-- Anonymous business inquiries are independent of fan identities and notifications.
create table public.business_inquiries (
  id uuid primary key,
  locale text not null check(locale in ('ko','en')),
  contact_name text, company text, email text, message text,
  consent_at timestamptz not null default now(),
  ip_hash text not null check(ip_hash ~ '^[0-9a-f]{64}$'),
  payload_hash text not null check(payload_hash ~ '^[0-9a-f]{64}$'),
  status text not null default 'pending' check(status in ('pending','claimed','sending','sent','failed','delivery_unknown')),
  created_at timestamptz not null default now(),
  available_at timestamptz not null default now(),
  lease_expires_at timestamptz, attempt_token uuid,
  attempt_count integer not null default 0,
  last_error text check(last_error in ('THROTTLED','REJECTED','DELIVERY_UNKNOWN')),
  provider_message_id text,
  check ((contact_name is null and company is null and email is null and message is null) or
    (char_length(contact_name) between 1 and 80 and char_length(company) between 1 and 120 and char_length(email) between 3 and 254 and char_length(message) between 1 and 4000))
);
create index business_inquiries_rate_idx on public.business_inquiries(ip_hash,created_at);
create index business_inquiries_pending_idx on public.business_inquiries(available_at,created_at) where status='pending';
alter table public.business_inquiries enable row level security;
revoke all on public.business_inquiries from public,anon,authenticated,service_role;

create function public.submit_business_inquiry(p_id uuid,p_locale text,p_name text,p_company text,p_email text,p_message text,p_consent boolean,p_ip_hash text,p_payload_hash text)
returns boolean language plpgsql security definer set search_path = pg_catalog,public as $$
declare old_hash text;
begin
  if p_id is null or p_locale is null or p_locale not in ('ko','en') or p_consent is distinct from true
    or p_name is null or char_length(btrim(p_name)) not between 1 and 80 or p_name ~ '[[:cntrl:]]'
    or p_company is null or char_length(btrim(p_company)) not between 1 and 120 or p_company ~ '[[:cntrl:]]'
    or p_email is null or char_length(p_email)>254 or p_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or p_email ~ '[[:cntrl:]]'
    or p_message is null or char_length(btrim(p_message)) not between 1 and 4000
    or p_ip_hash is null or p_ip_hash !~ '^[0-9a-f]{64}$' or p_payload_hash is null or p_payload_hash !~ '^[0-9a-f]{64}$'
  then raise exception 'INQUIRY_INVALID'; end if;
  -- One global lock is small and bounded (at most 100 new submissions/day).
  -- It serializes idempotency and BOTH limits without race-prone count/insert gaps.
  perform pg_advisory_xact_lock(9102026,1300);
  select payload_hash into old_hash from public.business_inquiries where id=p_id;
  if found then
    if old_hash<>p_payload_hash then raise exception 'INQUIRY_IDEMPOTENCY_CONFLICT'; end if;
    return true;
  end if;
  if (select count(*) from public.business_inquiries where ip_hash=p_ip_hash and created_at>now()-interval '1 hour')>=3
    or (select count(*) from public.business_inquiries where created_at>now()-interval '24 hours')>=100
  then raise exception 'INQUIRY_RATE_LIMITED'; end if;
  insert into public.business_inquiries(id,locale,contact_name,company,email,message,ip_hash,payload_hash)
    values(p_id,p_locale,btrim(p_name),btrim(p_company),p_email,btrim(p_message),p_ip_hash,p_payload_hash);
  return false;
end $$;

create function public.maintain_business_inquiries() returns void
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  -- Delete all payload/metadata at seven days even if sending was disabled or failed.
  delete from public.business_inquiries where created_at<now()-interval '7 days';
  update public.business_inquiries set status='delivery_unknown',last_error='DELIVERY_UNKNOWN',lease_expires_at=null
    where status='sending' and lease_expires_at<now();
  update public.business_inquiries set status='pending',attempt_token=null,lease_expires_at=null
    where status='claimed' and lease_expires_at<now();
end $$;

create function public.claim_business_inquiry() returns setof public.business_inquiries
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  perform public.maintain_business_inquiries();
  return query with candidate as (
    select id from public.business_inquiries where status='pending' and available_at<=now()
      and created_at>now()-interval '7 days' order by created_at for update skip locked limit 1
  ) update public.business_inquiries b set status='claimed',attempt_token=gen_random_uuid(),lease_expires_at=now()+interval '60 seconds'
    from candidate c where b.id=c.id returning b.*;
end $$;

create function public.begin_business_inquiry_send(p_id uuid,p_token uuid) returns boolean
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  update public.business_inquiries set status='sending',attempt_count=attempt_count+1,lease_expires_at=now()+interval '60 seconds'
    where id=p_id and attempt_token=p_token and status='claimed' and lease_expires_at>now() and created_at>now()-interval '7 days';
  return found;
end $$;

create function public.finish_business_inquiry(p_id uuid,p_token uuid,p_outcome text,p_provider_id text default null) returns boolean
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if p_outcome is null or p_outcome not in ('sent','throttled','rejected','unknown') then raise exception 'INQUIRY_INVALID'; end if;
  if p_outcome='sent' and (p_provider_id is null or char_length(p_provider_id) not between 1 and 256) then raise exception 'INQUIRY_INVALID'; end if;
  update public.business_inquiries set
    status=case when p_outcome='sent' then 'sent' when p_outcome='throttled' and attempt_count<3 then 'pending' when p_outcome='unknown' then 'delivery_unknown' else 'failed' end,
    last_error=case p_outcome when 'throttled' then 'THROTTLED' when 'rejected' then 'REJECTED' when 'unknown' then 'DELIVERY_UNKNOWN' else null end,
    available_at=now()+interval '5 minutes',lease_expires_at=null,
    provider_message_id=case when p_outcome='sent' then p_provider_id else null end,
    contact_name=case when p_outcome='sent' then null else contact_name end,
    company=case when p_outcome='sent' then null else company end,
    email=case when p_outcome='sent' then null else email end,
    message=case when p_outcome='sent' then null else message end
    where id=p_id and attempt_token=p_token and status='sending' and lease_expires_at>now();
  return found;
end $$;

-- PII-free operator query. No payload or destinations are returned or logged.
create function public.business_inquiry_health() returns jsonb
language sql security definer set search_path=pg_catalog,public as $$
select jsonb_build_object('pending',count(*) filter(where status in ('pending','claimed','sending')),
  'old_pending',count(*) filter(where status in ('pending','claimed') and created_at<now()-interval '1 hour'),
  'failed',count(*) filter(where status='failed'),'delivery_unknown',count(*) filter(where status='delivery_unknown'))
from public.business_inquiries;
$$;

revoke all on function public.submit_business_inquiry(uuid,text,text,text,text,text,boolean,text,text) from public,anon,authenticated;
revoke all on function public.maintain_business_inquiries() from public,anon,authenticated;
revoke all on function public.claim_business_inquiry() from public,anon,authenticated;
revoke all on function public.begin_business_inquiry_send(uuid,uuid) from public,anon,authenticated;
revoke all on function public.finish_business_inquiry(uuid,uuid,text,text) from public,anon,authenticated;
revoke all on function public.business_inquiry_health() from public,anon,authenticated;
grant execute on function public.submit_business_inquiry(uuid,text,text,text,text,text,boolean,text,text),public.maintain_business_inquiries(),public.claim_business_inquiry(),public.begin_business_inquiry_send(uuid,uuid),public.finish_business_inquiry(uuid,uuid,text,text),public.business_inquiry_health() to service_role;

-- Existing infrastructure installs pg_cron. Retention must not depend on email/Lambda availability.
select cron.schedule('business-inquiry-retention','17 * * * *','select public.maintain_business_inquiries()');
