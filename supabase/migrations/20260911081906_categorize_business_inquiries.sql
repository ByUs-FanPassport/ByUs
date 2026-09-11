alter table public.business_inquiries
  add column inquiry_type text not null default 'fanmeeting'
  constraint business_inquiries_inquiry_type_check
  check (inquiry_type in ('fanmeeting','creator','partner'));

-- Keep the deployed nine-argument submit_business_inquiry RPC unchanged so
-- existing web deployments continue to write fanmeeting rows and preserve
-- their idempotency hashes. A distinct name avoids PostgREST overload routing.
create function public.submit_categorized_business_inquiry(
  p_id uuid,
  p_locale text,
  p_name text,
  p_company text,
  p_email text,
  p_message text,
  p_consent boolean,
  p_ip_hash text,
  p_payload_hash text,
  p_inquiry_type text
)
returns boolean language plpgsql security definer set search_path = pg_catalog,public as $$
declare old_hash text; old_type text;
begin
  if p_id is null or p_locale is null or p_locale not in ('ko','en') or p_consent is distinct from true
    or p_inquiry_type is null or p_inquiry_type not in ('creator','partner')
    or p_name is null or char_length(btrim(p_name)) not between 1 and 80 or p_name ~ '[[:cntrl:]]'
    or p_company is null or char_length(btrim(p_company)) not between 1 and 120 or p_company ~ '[[:cntrl:]]'
    or p_email is null or char_length(p_email)>254 or p_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or p_email ~ '[[:cntrl:]]'
    or p_message is null or char_length(btrim(p_message)) not between 1 and 4000
    or p_ip_hash is null or p_ip_hash !~ '^[0-9a-f]{64}$' or p_payload_hash is null or p_payload_hash !~ '^[0-9a-f]{64}$'
  then raise exception 'INQUIRY_INVALID'; end if;

  -- This is the same shared lock and quota window as the legacy RPC.
  perform pg_advisory_xact_lock(9102026,1300);
  select payload_hash,inquiry_type into old_hash,old_type from public.business_inquiries where id=p_id;
  if found then
    if old_hash<>p_payload_hash or old_type<>p_inquiry_type then raise exception 'INQUIRY_IDEMPOTENCY_CONFLICT'; end if;
    return true;
  end if;
  if (select count(*) from public.business_inquiries where ip_hash=p_ip_hash and created_at>now()-interval '1 hour')>=3
    or (select count(*) from public.business_inquiries where created_at>now()-interval '24 hours')>=100
  then raise exception 'INQUIRY_RATE_LIMITED'; end if;
  insert into public.business_inquiries(id,locale,contact_name,company,email,message,ip_hash,payload_hash,inquiry_type)
    values(p_id,p_locale,btrim(p_name),btrim(p_company),p_email,btrim(p_message),p_ip_hash,p_payload_hash,p_inquiry_type);
  return false;
end $$;

revoke all on function public.submit_categorized_business_inquiry(uuid,text,text,text,text,text,boolean,text,text,text)
  from public,anon,authenticated,service_role;
grant execute on function public.submit_categorized_business_inquiry(uuid,text,text,text,text,text,boolean,text,text,text)
  to service_role;
