-- Shared, private YouTube response cache. No credentials or user tokens are stored.
create table public.youtube_live_api_cache (
  cache_key text primary key check (cache_key ~ '^[a-f0-9]{64}$'),
  stage text not null check (stage in ('channels', 'search', 'videos')),
  payload jsonb,
  fetched_at timestamptz,
  next_retry_at timestamptz not null default '-infinity',
  lease_id uuid,
  lease_until timestamptz,
  check ((payload is null) = (fetched_at is null)),
  check (payload is null or (jsonb_typeof(payload) = 'object' and octet_length(payload::text) <= 262144))
);
create table public.youtube_live_api_attempts (
  id bigint generated always as identity primary key,
  bucket text not null check (bucket in ('search', 'general')),
  requested_at timestamptz not null default clock_timestamp()
);
create index youtube_live_api_attempts_time on public.youtube_live_api_attempts(requested_at);
create index youtube_live_api_attempts_bucket_time on public.youtube_live_api_attempts(bucket, requested_at);
alter table public.youtube_live_api_cache enable row level security;
alter table public.youtube_live_api_attempts enable row level security;
revoke all on public.youtube_live_api_cache, public.youtube_live_api_attempts from public, anon, authenticated;
grant all on public.youtube_live_api_cache, public.youtube_live_api_attempts to service_role;
revoke all on sequence public.youtube_live_api_attempts_id_seq from public, anon, authenticated;
grant usage, select on sequence public.youtube_live_api_attempts_id_seq to service_role;

create function public.youtube_claim_live_api(p_cache_key text, p_stage text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  cached public.youtube_live_api_cache%rowtype;
  moment timestamptz := clock_timestamp();
  ttl interval;
  bucket_name text;
  budget integer;
  used integer;
  new_lease uuid;
begin
  if p_stage not in ('channels', 'search', 'videos') or p_cache_key !~ '^[a-f0-9]{64}$' then
    raise exception 'Invalid YouTube cache request';
  end if;
  ttl := case p_stage when 'channels' then interval '24 hours' when 'search' then interval '1 hour' else interval '60 seconds' end;
  insert into public.youtube_live_api_cache(cache_key, stage) values(p_cache_key, p_stage) on conflict do nothing;
  select * into cached from public.youtube_live_api_cache where cache_key = p_cache_key for update;
  moment := clock_timestamp();
  if cached.stage <> p_stage then raise exception 'YouTube cache stage mismatch'; end if;
  if cached.fetched_at <= moment and cached.fetched_at > moment - ttl then
    return jsonb_build_object('state','cached','payload',cached.payload,'fetchedAt',cached.fetched_at);
  end if;
  if cached.lease_until > moment or cached.next_retry_at > moment then
    return jsonb_build_object('state','unavailable');
  end if;
  -- Serialize budget reservation across all function instances and cache keys.
  perform pg_catalog.pg_advisory_xact_lock(20260912, 124226);
  moment := clock_timestamp();
  delete from public.youtube_live_api_attempts where requested_at <= moment - interval '24 hours';
  bucket_name := case p_stage when 'search' then 'search' else 'general' end;
  budget := case bucket_name when 'search' then 96 else 9000 end;
  select count(*) into used from public.youtube_live_api_attempts where bucket = bucket_name;
  if used >= budget then
    return jsonb_build_object('state','unavailable');
  end if;
  insert into public.youtube_live_api_attempts(bucket, requested_at) values(bucket_name, moment);
  new_lease := gen_random_uuid();
  update public.youtube_live_api_cache set lease_id = new_lease, lease_until = moment + interval '15 seconds' where cache_key = p_cache_key;
  return jsonb_build_object('state','claimed','leaseId',new_lease,'fetchedAt',moment);
end;
$$;

create function public.youtube_finish_live_api(p_cache_key text, p_lease_id uuid, p_payload jsonb)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare cached public.youtube_live_api_cache%rowtype; moment timestamptz := clock_timestamp();
begin
  select * into cached from public.youtube_live_api_cache where cache_key = p_cache_key for update;
  moment := clock_timestamp();
  if not found or cached.lease_id is distinct from p_lease_id or cached.lease_until <= moment then return false; end if;
  if p_payload is not null and (jsonb_typeof(p_payload) <> 'object' or not (p_payload ? 'items') or octet_length(p_payload::text) > 262144) then
    raise exception 'Invalid YouTube cache response';
  end if;
  update public.youtube_live_api_cache set
    payload = case when p_payload is not null then p_payload else payload end,
    fetched_at = case when p_payload is not null then cached.lease_until - interval '15 seconds' else fetched_at end,
    next_retry_at = case when p_payload is not null then '-infinity'::timestamptz else moment + case cached.stage when 'search' then interval '1 hour' else interval '60 seconds' end end,
    lease_id = null, lease_until = null
  where cache_key = p_cache_key;
  return true;
end;
$$;
revoke all on function public.youtube_claim_live_api(text,text), public.youtube_finish_live_api(text,uuid,jsonb) from public, anon, authenticated;
grant execute on function public.youtube_claim_live_api(text,text), public.youtube_finish_live_api(text,uuid,jsonb) to service_role;
