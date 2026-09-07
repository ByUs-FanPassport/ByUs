-- Private creator OAuth state and encrypted tokens. No browser role may access these objects.
create table public.instagram_connections (
  celebrity_id uuid primary key references public.celebrities(id) on delete cascade,
  generation uuid not null default extensions.gen_random_uuid(),
  identity jsonb,
  ig_user_id text unique,
  ig_scoped_id text unique,
  token_ciphertext text,
  token_issued_at timestamptz,
  token_expires_at timestamptz,
  authorization_started_at timestamptz,
  connected_at timestamptz,
  media jsonb not null default '[]'::jsonb check (jsonb_typeof(media) = 'array'),
  media_fetched_at timestamptz,
  next_sync_at timestamptz not null default now(),
  last_error text,
  lease_id uuid,
  lease_until timestamptz,
  constraint instagram_connection_complete check (
    (identity is null and ig_user_id is null and ig_scoped_id is null and token_ciphertext is null
      and token_issued_at is null and token_expires_at is null and authorization_started_at is null and connected_at is null)
    or (identity is not null and ig_user_id is not null and ig_scoped_id is not null and ig_user_id ~ '^[0-9]{1,30}$' and ig_scoped_id ~ '^[0-9]{1,30}$'
      and token_ciphertext is not null and token_issued_at is not null
      and token_expires_at > token_issued_at and authorization_started_at is not null and connected_at is not null)
  )
);
create table public.instagram_connection_flows (
  secret_hash text primary key check (secret_hash ~ '^[a-f0-9]{64}$'),
  celebrity_id uuid not null references public.instagram_connections(celebrity_id) on delete cascade,
  generation uuid not null,
  stage text not null check (stage in ('invite','state','exchanging','pending')),
  browser_hash text check (browser_hash ~ '^[a-f0-9]{64}$'),
  expected_username text not null check (expected_username ~ '^[a-z0-9._]{1,30}$'),
  expected_user_id text check (expected_user_id ~ '^[0-9]{1,30}$'),
  payload jsonb not null default '{}'::jsonb,
  authorization_started_at timestamptz,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index instagram_flows_celebrity on public.instagram_connection_flows(celebrity_id);
create index instagram_flows_expiry on public.instagram_connection_flows(expires_at);
create table public.instagram_deletion_receipts (
  confirmation_hash text primary key check (confirmation_hash ~ '^[a-f0-9]{64}$'),
  completed_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '30 days'
);
-- A short-lived hashed tombstone blocks a token exchange already in flight at deletion time.
create table public.instagram_revocations (
  subject_hash text primary key,
  issued_at timestamptz not null,
  expires_at timestamptz not null default now() + interval '2 days'
);

alter table public.instagram_connections enable row level security;
alter table public.instagram_connection_flows enable row level security;
alter table public.instagram_deletion_receipts enable row level security;
alter table public.instagram_revocations enable row level security;
revoke all on public.instagram_connections, public.instagram_connection_flows, public.instagram_deletion_receipts, public.instagram_revocations from public, anon, authenticated;
grant all on public.instagram_connections, public.instagram_connection_flows, public.instagram_deletion_receipts, public.instagram_revocations to service_role;

-- Mutations serialize on the durable celebrity slot before acquiring flow rows.
-- Keeping the slot after erasure prevents old invites/in-flight responses reviving data.
create function public.instagram_issue_invite(p_celebrity_id uuid, p_secret_hash text, p_username text, p_user_id text default null)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  insert into public.instagram_connections (celebrity_id) values (p_celebrity_id) on conflict do nothing;
  perform 1 from public.instagram_connections where celebrity_id = p_celebrity_id for update;
  update public.instagram_connections set generation = extensions.gen_random_uuid(), lease_id = null, lease_until = null where celebrity_id = p_celebrity_id;
  delete from public.instagram_connection_flows where celebrity_id = p_celebrity_id;
  insert into public.instagram_connection_flows(secret_hash, celebrity_id, generation, stage, expected_username, expected_user_id, expires_at)
  select p_secret_hash, celebrity_id, generation, 'invite', p_username, p_user_id, now() + interval '24 hours'
  from public.instagram_connections where celebrity_id = p_celebrity_id;
end;
$$;

-- peek is read-only; start/consume/pending/confirm/cancel atomically change a flow.
-- p_payload is server generated; the endpoint never forwards arbitrary client JSON.
create function public.instagram_transition(p_operation text, p_secret_hash text, p_browser_hash text default null, p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare f public.instagram_connection_flows; slot public.instagram_connections; result jsonb;
begin
  select * into f from public.instagram_connection_flows where secret_hash = p_secret_hash;
  if not found then raise exception 'Instagram flow unavailable'; end if;
  -- Subject lock precedes the slot lock in BOTH completion and signed deletion.
  -- This also covers deletion arriving while code exchange has not yet saved an identity.
  if p_operation in ('pending', 'confirm') then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
      case when p_operation = 'pending' then p_payload->'identity'->>'id' else f.payload->'identity'->>'id' end, 8092026));
  end if;
  select * into slot from public.instagram_connections where celebrity_id = f.celebrity_id for update;
  select * into f from public.instagram_connection_flows where secret_hash = p_secret_hash for update;
  if not found or f.expires_at <= now() or f.generation <> slot.generation then raise exception 'Instagram flow unavailable'; end if;
  result := to_jsonb(f) - 'secret_hash' - 'browser_hash';
  result := result || jsonb_build_object('celebrity_slug', (select slug from public.celebrities where id = f.celebrity_id),
    'celebrity_name', coalesce((select name from public.celebrity_localizations where celebrity_id = f.celebrity_id and locale = 'ko'), ''));
  if p_operation = 'peek_invite' and f.stage = 'invite' then return result; end if;
  if p_operation = 'start' and f.stage = 'invite' and p_browser_hash is not null then
    update public.instagram_connection_flows set secret_hash = p_payload->>'next_hash', stage = 'state', browser_hash = p_browser_hash,
      authorization_started_at = now(), expires_at = now() + interval '10 minutes' where secret_hash = p_secret_hash;
    return result;
  end if;
  if p_browser_hash is null or f.browser_hash is distinct from p_browser_hash then raise exception 'Instagram browser mismatch'; end if;
  if p_operation = 'consume' and f.stage = 'state' then
    update public.instagram_connection_flows set stage = 'exchanging' where secret_hash = p_secret_hash;
    return result;
  elsif p_operation = 'pending' and f.stage = 'exchanging' then
    if lower(p_payload->'identity'->>'username') is distinct from f.expected_username
      or (f.expected_user_id is not null and p_payload->'identity'->>'user_id' is distinct from f.expected_user_id)
      then raise exception 'Instagram account mismatch'; end if;
    if exists (select 1 from public.instagram_revocations where subject_hash = encode(extensions.digest(p_payload->'identity'->>'id', 'sha256'), 'hex')
      and issued_at + interval '1 second' >= f.authorization_started_at) then raise exception 'Instagram authorization revoked'; end if;
    update public.instagram_connection_flows set secret_hash = p_payload->>'next_hash', stage = 'pending',
      payload = p_payload - 'next_hash', expires_at = now() + interval '10 minutes' where secret_hash = p_secret_hash;
    return result;
  elsif p_operation = 'peek_pending' and f.stage = 'pending' then
    return result - 'payload' || jsonb_build_object('payload', jsonb_build_object('identity', f.payload->'identity'));
  elsif p_operation = 'confirm' and f.stage = 'pending' then
    if lower(f.payload->'identity'->>'username') is distinct from f.expected_username
      or (f.expected_user_id is not null and f.payload->'identity'->>'user_id' is distinct from f.expected_user_id)
      then raise exception 'Instagram account mismatch'; end if;
    if exists (select 1 from public.instagram_revocations where subject_hash = encode(extensions.digest(f.payload->'identity'->>'id', 'sha256'), 'hex')
      and issued_at + interval '1 second' >= f.authorization_started_at) then raise exception 'Instagram authorization revoked'; end if;
    update public.instagram_connections set identity = f.payload->'identity',
      ig_user_id = f.payload->'identity'->>'user_id', ig_scoped_id = f.payload->'identity'->>'id',
      token_ciphertext = f.payload->>'token_ciphertext', token_issued_at = (f.payload->>'token_issued_at')::timestamptz,
      token_expires_at = (f.payload->>'token_expires_at')::timestamptz,
      authorization_started_at = f.authorization_started_at, connected_at = now(),
      media = '[]'::jsonb, media_fetched_at = null, next_sync_at = now(), last_error = null,
      lease_id = null, lease_until = null, generation = extensions.gen_random_uuid()
    where celebrity_id = f.celebrity_id;
    delete from public.instagram_connection_flows where celebrity_id = f.celebrity_id;
    return result - 'payload';
  elsif p_operation = 'cancel' then
    delete from public.instagram_connection_flows where secret_hash = p_secret_hash;
    return '{}'::jsonb;
  end if;
  raise exception 'Instagram flow unavailable';
end;
$$;

create function public.instagram_disconnect(p_celebrity_id uuid, p_generation uuid default null)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare slot public.instagram_connections;
begin
  select * into slot from public.instagram_connections where celebrity_id = p_celebrity_id for update;
  if not found or (p_generation is not null and slot.generation <> p_generation) then return null; end if;
  update public.instagram_connections set generation = extensions.gen_random_uuid(), identity = null, ig_user_id = null, ig_scoped_id = null,
    token_ciphertext = null, token_issued_at = null, token_expires_at = null, authorization_started_at = null, connected_at = null,
    media = '[]'::jsonb, media_fetched_at = null, last_error = null, lease_id = null, lease_until = null where celebrity_id = p_celebrity_id;
  delete from public.instagram_connection_flows where celebrity_id = p_celebrity_id;
  return jsonb_build_object('celebrity_id', slot.celebrity_id, 'identity', slot.identity, 'token_ciphertext', slot.token_ciphertext);
end;
$$;

-- Provider signed callbacks refer to the app-scoped ID, not the professional ID.
-- Also remove unconfirmed connections. issued_at prevents replay across reconnection.
create function public.instagram_delete_subject(p_scoped_id text, p_issued_at timestamptz, p_confirmation_hash text)
returns void language plpgsql security invoker set search_path = '' as $$
declare slot public.instagram_connections;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_scoped_id, 8092026));
  insert into public.instagram_revocations(subject_hash, issued_at)
    values(encode(extensions.digest(p_scoped_id, 'sha256'), 'hex'), p_issued_at)
    on conflict(subject_hash) do update set issued_at = greatest(instagram_revocations.issued_at, excluded.issued_at), expires_at = now() + interval '2 days';
  for slot in select c.* from public.instagram_connections c
    where (c.ig_scoped_id = p_scoped_id and c.authorization_started_at <= p_issued_at + interval '1 second')
      or exists (select 1 from public.instagram_connection_flows f where f.celebrity_id = c.celebrity_id
        and f.payload->'identity'->>'id' = p_scoped_id and f.authorization_started_at <= p_issued_at + interval '1 second')
    order by c.celebrity_id for update loop
    perform public.instagram_disconnect(slot.celebrity_id, slot.generation);
  end loop;
  insert into public.instagram_deletion_receipts(confirmation_hash) values(p_confirmation_hash) on conflict do nothing;
end;
$$;

create function public.instagram_claim_sync(p_limit integer default 10, p_celebrity_id uuid default null)
returns setof public.instagram_connections language plpgsql security invoker set search_path = '' as $$
begin
  delete from public.instagram_connection_flows where expires_at <= now();
  delete from public.instagram_deletion_receipts where expires_at <= now();
  delete from public.instagram_revocations where expires_at <= now();
  return query with due as (
    select celebrity_id from public.instagram_connections where token_ciphertext is not null and next_sync_at <= now()
      and (p_celebrity_id is null or celebrity_id = p_celebrity_id)
      and (lease_until is null or lease_until < now()) order by next_sync_at for update skip locked limit least(greatest(p_limit, 1), 10)
  ) update public.instagram_connections c set lease_id = extensions.gen_random_uuid(), lease_until = now() + interval '5 minutes'
    from due where c.celebrity_id = due.celebrity_id returning c.*;
end;
$$;
create function public.instagram_finish_sync(p_celebrity_id uuid, p_generation uuid, p_lease_id uuid, p_result jsonb)
returns boolean language plpgsql security invoker set search_path = '' as $$
begin
  update public.instagram_connections set
    media = case when p_result->>'error' is null then p_result->'media' else '[]'::jsonb end,
    media_fetched_at = case when p_result->>'error' is null then now() else null end,
    last_error = p_result->>'error', next_sync_at = now() + interval '1 hour', lease_id = null, lease_until = null,
    token_ciphertext = coalesce(p_result->>'token_ciphertext', token_ciphertext),
    token_issued_at = coalesce((p_result->>'token_issued_at')::timestamptz, token_issued_at),
    token_expires_at = coalesce((p_result->>'token_expires_at')::timestamptz, token_expires_at)
  where celebrity_id = p_celebrity_id and generation = p_generation and lease_id = p_lease_id;
  return found;
end;
$$;

revoke all on function public.instagram_issue_invite(uuid,text,text,text), public.instagram_transition(text,text,text,jsonb),
  public.instagram_disconnect(uuid,uuid), public.instagram_delete_subject(text,timestamptz,text),
  public.instagram_claim_sync(integer,uuid), public.instagram_finish_sync(uuid,uuid,uuid,jsonb) from public, anon, authenticated;
grant execute on function public.instagram_issue_invite(uuid,text,text,text), public.instagram_transition(text,text,text,jsonb),
  public.instagram_disconnect(uuid,uuid), public.instagram_delete_subject(text,timestamptz,text),
  public.instagram_claim_sync(integer,uuid), public.instagram_finish_sync(uuid,uuid,uuid,jsonb) to service_role;
