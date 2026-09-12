-- Private creator self-service Instagram ownership and live visibility controls.
alter table public.instagram_connections
  add column owner_app_user_id uuid references public.app_users(id) on delete restrict,
  add column live_enabled boolean not null default true;

alter table public.instagram_connections drop constraint instagram_connection_complete;
alter table public.instagram_connections add constraint instagram_connection_complete check (
  (identity is null and ig_user_id is null and ig_scoped_id is null and token_ciphertext is null
    and token_issued_at is null and token_expires_at is null and authorization_started_at is null and connected_at is null)
  or (identity is not null and ig_user_id is not null and ig_scoped_id is not null and token_ciphertext is not null
    and token_issued_at is not null and token_expires_at > token_issued_at and authorization_started_at is not null and connected_at is not null)
  or (owner_app_user_id is not null and identity is not null and ig_user_id is not null and ig_scoped_id is not null
    and token_ciphertext is null and token_issued_at is null and token_expires_at is null
    and authorization_started_at is not null and connected_at is null)
);

create table public.instagram_owner_flows (
  secret_hash text primary key check (secret_hash ~ '^[a-f0-9]{64}$'),
  actor_app_user_id uuid not null references public.app_users(id) on delete cascade,
  browser_hash text not null check (browser_hash ~ '^[a-f0-9]{64}$'),
  stage text not null check (stage in ('state','exchanging','pending')),
  locale public.content_locale not null,
  authorization_started_at timestamptz not null,
  celebrity_id uuid references public.instagram_connections(celebrity_id) on delete cascade,
  slot_generation uuid,
  payload jsonb not null default '{}'::jsonb,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint instagram_owner_flow_target check (
    (stage<>'pending' or (celebrity_id is not null and slot_generation is not null))
    and (stage<>'state' or (celebrity_id is null and slot_generation is null))),
  constraint instagram_owner_flow_payload_object check (jsonb_typeof(payload)='object')
);
create index instagram_owner_flows_actor on public.instagram_owner_flows(actor_app_user_id,expires_at);
create index instagram_owner_flows_expiry on public.instagram_owner_flows(expires_at);
alter table public.instagram_owner_flows enable row level security;
revoke all on public.instagram_owner_flows from public,anon,authenticated;
grant all on public.instagram_owner_flows to service_role;

create function public.instagram_owner_match(p_username text)
returns table(celebrity_id uuid,generation uuid,slug text,name text,image_url text,owner_app_user_id uuid,identity jsonb)
language sql stable security invoker set search_path='' as $$
  select ce.id,c.generation,ce.slug,coalesce(cl.name,ce.slug),ce.image_url,c.owner_app_user_id,c.identity
  from public.celebrities ce
  join public.celebrity_social_links sl on sl.celebrity_id=ce.id and sl.platform='instagram' and sl.active
  left join public.instagram_connections c on c.celebrity_id=ce.id
  left join public.celebrity_localizations cl on cl.celebrity_id=ce.id and cl.locale='ko'
  where ce.status='published' and ce.archived_at is null
    and lower(sl.url) in ('https://instagram.com/'||lower(p_username),'https://instagram.com/'||lower(p_username)||'/',
      'https://www.instagram.com/'||lower(p_username),'https://www.instagram.com/'||lower(p_username)||'/');
$$;

create function public.instagram_owner_transition(p_operation text,p_secret_hash text,p_actor_app_user_id uuid,p_browser_hash text,p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare f public.instagram_owner_flows; slot public.instagram_connections; matched record; match_count integer; subject text; result jsonb;
begin
  if p_operation='start' then
    if p_actor_app_user_id is null or not exists(select 1 from public.app_users where id=p_actor_app_user_id and status='active') then raise exception 'OWNER_AUTH'; end if;
    delete from public.instagram_owner_flows where actor_app_user_id=p_actor_app_user_id;
    insert into public.instagram_owner_flows(secret_hash,actor_app_user_id,browser_hash,stage,locale,authorization_started_at,expires_at)
    values(p_secret_hash,p_actor_app_user_id,p_browser_hash,'state',(p_payload->>'locale')::public.content_locale,now(),now()+interval '10 minutes');
    return '{}'::jsonb;
  end if;
  select * into f from public.instagram_owner_flows where secret_hash=p_secret_hash;
  if not found or f.expires_at<=now() or p_browser_hash is null or f.browser_hash is distinct from p_browser_hash
    or (p_actor_app_user_id is not null and f.actor_app_user_id is distinct from p_actor_app_user_id) then raise exception 'OWNER_FLOW'; end if;
  if p_operation in ('peek_pending','confirm') and (p_actor_app_user_id is null
    or not exists(select 1 from public.app_users where id=p_actor_app_user_id and status='active')) then raise exception 'OWNER_AUTH'; end if;
  if p_operation='cancel' and f.stage='pending' and (p_actor_app_user_id is null
    or not exists(select 1 from public.app_users where id=p_actor_app_user_id and status='active')) then raise exception 'OWNER_AUTH'; end if;
  p_actor_app_user_id:=f.actor_app_user_id;
  if p_operation='pending' then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_payload->'identity'->>'id',8092026));
  elsif p_operation='confirm' then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(f.payload->'identity'->>'id',8092026));
  end if;
  if p_operation='resolve' then
    select count(*) into match_count from public.instagram_owner_match(p_payload->'identity'->>'username');
    if match_count<>1 then raise exception 'OWNER_ACCOUNT_MISMATCH'; end if;
    select * into matched from public.instagram_owner_match(p_payload->'identity'->>'username');
    insert into public.instagram_connections(celebrity_id) values(matched.celebrity_id) on conflict do nothing;
    select * into slot from public.instagram_connections where celebrity_id=matched.celebrity_id for update;
  elsif p_operation in ('pending','confirm') then
    if f.celebrity_id is null then raise exception 'OWNER_FLOW'; end if;
    select * into slot from public.instagram_connections where celebrity_id=f.celebrity_id for update;
    if not found then raise exception 'OWNER_STALE'; end if;
  end if;
  select * into f from public.instagram_owner_flows where secret_hash=p_secret_hash for update;
  if not found or f.expires_at<=now() or f.actor_app_user_id is distinct from p_actor_app_user_id
    or f.browser_hash is distinct from p_browser_hash then raise exception 'OWNER_FLOW'; end if;
  if p_operation='peek_state' and f.stage in ('state','exchanging') then return jsonb_build_object('locale',f.locale,'stage',f.stage); end if;
  if p_operation='consume' and f.stage='state' then
    update public.instagram_owner_flows set stage='exchanging' where secret_hash=p_secret_hash;
    return jsonb_build_object('locale',f.locale,'authorization_started_at',f.authorization_started_at);
  end if;
  if p_operation='resolve' and f.stage='exchanging' then
    select count(*) into match_count from public.instagram_owner_match(p_payload->'identity'->>'username');
    if match_count<>1 then raise exception 'OWNER_ACCOUNT_MISMATCH'; end if;
    select * into matched from public.instagram_owner_match(p_payload->'identity'->>'username');
    if f.celebrity_id is not null and f.celebrity_id<>matched.celebrity_id then raise exception 'OWNER_STALE'; end if;
    insert into public.instagram_connections(celebrity_id) values(matched.celebrity_id) on conflict do nothing;
    select * into slot from public.instagram_connections where celebrity_id=matched.celebrity_id for update;
    if slot.owner_app_user_id is not null and slot.owner_app_user_id<>p_actor_app_user_id then raise exception 'OWNER_CONFLICT'; end if;
    if slot.owner_app_user_id is null and slot.identity is not null and slot.identity->>'user_id' is distinct from p_payload->'identity'->>'user_id' then raise exception 'OWNER_ACCOUNT_MISMATCH'; end if;
    update public.instagram_owner_flows set celebrity_id=slot.celebrity_id,slot_generation=slot.generation where secret_hash=p_secret_hash;
    return jsonb_build_object('celebrity_id',slot.celebrity_id,'generation',slot.generation,'locale',f.locale);
  end if;
  if p_operation='pending' and f.stage='exchanging' then
    subject:=p_payload->'identity'->>'id';
    if exists(select 1 from public.instagram_revocations where subject_hash=encode(extensions.digest(subject,'sha256'),'hex') and issued_at+interval '1 second'>=f.authorization_started_at) then raise exception 'OWNER_REVOKED'; end if;
    select count(*) into match_count from public.instagram_owner_match(p_payload->'identity'->>'username');
    if match_count<>1 then raise exception 'OWNER_ACCOUNT_MISMATCH'; end if;
    select * into matched from public.instagram_owner_match(p_payload->'identity'->>'username');
    if f.celebrity_id is null or matched.celebrity_id<>f.celebrity_id then raise exception 'OWNER_STALE'; end if;
    select * into slot from public.instagram_connections where celebrity_id=f.celebrity_id for update;
    if slot.generation<>f.slot_generation then raise exception 'OWNER_STALE'; end if;
    if slot.owner_app_user_id is not null and slot.owner_app_user_id<>p_actor_app_user_id then raise exception 'OWNER_CONFLICT'; end if;
    if slot.owner_app_user_id is null and slot.identity is not null and slot.identity->>'user_id' is distinct from p_payload->'identity'->>'user_id' then raise exception 'OWNER_ACCOUNT_MISMATCH'; end if;
    update public.instagram_owner_flows set secret_hash=p_payload->>'next_hash',stage='pending',celebrity_id=slot.celebrity_id,
      slot_generation=slot.generation,payload=p_payload-'next_hash',expires_at=now()+interval '10 minutes' where secret_hash=p_secret_hash;
    return jsonb_build_object('celebrity_id',slot.celebrity_id,'generation',slot.generation,'locale',f.locale);
  end if;
  if p_operation='peek_pending' and f.stage='pending' then
    select * into slot from public.instagram_connections where celebrity_id=f.celebrity_id;
    return jsonb_build_object('celebrity_id',f.celebrity_id,'generation',f.slot_generation,'locale',f.locale,'payload',f.payload,
      'account',jsonb_build_object('celebrityId',f.celebrity_id,'slug',(select slug from public.celebrities where id=f.celebrity_id),
       'name',coalesce((select name from public.celebrity_localizations where celebrity_id=f.celebrity_id and locale=f.locale),(select slug from public.celebrities where id=f.celebrity_id)),
       'username',f.payload->'identity'->>'username','avatarUrl',(select image_url from public.celebrities where id=f.celebrity_id),
       'generation',f.slot_generation,'liveEnabled',slot.live_enabled,'needsReconnect',false,'mediaStatus','syncing'));
  end if;
  if p_operation='cancel' then delete from public.instagram_owner_flows where secret_hash=p_secret_hash; return '{}'::jsonb; end if;
  if p_operation='confirm' and f.stage='pending' then
    subject:=f.payload->'identity'->>'id';
    if exists(select 1 from public.instagram_revocations where subject_hash=encode(extensions.digest(subject,'sha256'),'hex') and issued_at+interval '1 second'>=f.authorization_started_at) then raise exception 'OWNER_REVOKED'; end if;
    select count(*) into match_count from public.instagram_owner_match(f.payload->'identity'->>'username');
    if match_count<>1 then raise exception 'OWNER_ACCOUNT_MISMATCH'; end if;
    select * into matched from public.instagram_owner_match(f.payload->'identity'->>'username');
    select * into slot from public.instagram_connections where celebrity_id=f.celebrity_id for update;
    if matched.celebrity_id<>f.celebrity_id or slot.generation<>f.slot_generation then raise exception 'OWNER_STALE'; end if;
    if slot.owner_app_user_id is not null and slot.owner_app_user_id<>p_actor_app_user_id then raise exception 'OWNER_CONFLICT'; end if;
    if slot.owner_app_user_id is null and slot.identity is not null and slot.identity->>'user_id' is distinct from f.payload->'identity'->>'user_id' then raise exception 'OWNER_ACCOUNT_MISMATCH'; end if;
    update public.instagram_connections set owner_app_user_id=p_actor_app_user_id,identity=f.payload->'identity',ig_user_id=f.payload->'identity'->>'user_id',
      ig_scoped_id=subject,token_ciphertext=f.payload->>'token_ciphertext',token_issued_at=(f.payload->>'token_issued_at')::timestamptz,
      token_expires_at=(f.payload->>'token_expires_at')::timestamptz,authorization_started_at=f.authorization_started_at,connected_at=now(),
      media='[]'::jsonb,media_fetched_at=null,next_sync_at=now(),last_error=null,lease_id=null,lease_until=null,generation=extensions.gen_random_uuid()
      where celebrity_id=f.celebrity_id;
    delete from public.instagram_owner_flows where celebrity_id=f.celebrity_id or actor_app_user_id=p_actor_app_user_id;
    return jsonb_build_object('celebrity_id',slot.celebrity_id);
  end if;
  raise exception 'OWNER_FLOW';
end;
$$;

create function public.instagram_owner_accounts(p_actor_app_user_id uuid,p_locale public.content_locale)
returns setof jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('celebrityId',c.celebrity_id,'slug',ce.slug,'name',coalesce(cl.name,ce.slug),'username',c.identity->>'username',
  'avatarUrl',ce.image_url,'generation',c.generation,'liveEnabled',c.live_enabled,'needsReconnect',c.token_ciphertext is null or c.token_expires_at<=now(),
  'mediaStatus',case when c.token_ciphertext is null or c.last_error is not null then 'unavailable' when c.media_fetched_at is null then 'syncing' else 'connected' end)
 from public.instagram_connections c join public.celebrities ce on ce.id=c.celebrity_id
 left join public.celebrity_localizations cl on cl.celebrity_id=ce.id and cl.locale=p_locale
 where c.owner_app_user_id=p_actor_app_user_id and ce.status='published' and ce.archived_at is null
   and exists(select 1 from public.app_users actor where actor.id=p_actor_app_user_id and actor.status='active') order by ce.slug;
$$;

create function public.instagram_owner_settings(p_actor_app_user_id uuid,p_celebrity_id uuid,p_generation uuid,p_live_enabled boolean,p_locale public.content_locale)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare account jsonb;
begin
 if p_actor_app_user_id is null or not exists(select 1 from public.app_users where id=p_actor_app_user_id and status='active') then raise exception 'OWNER_AUTH'; end if;
 update public.instagram_connections set live_enabled=p_live_enabled,generation=extensions.gen_random_uuid(),live_observation=null,live_generation=null,
  live_lease_id=null,live_lease_until=null,live_next_sync_at=case when p_live_enabled then now() else live_next_sync_at end
 where celebrity_id=p_celebrity_id and owner_app_user_id=p_actor_app_user_id and generation=p_generation;
 if not found then raise exception 'OWNER_STALE'; end if;
 select value into account from public.instagram_owner_accounts(p_actor_app_user_id,p_locale) value where value->>'celebrityId'=p_celebrity_id::text;
 return account;
end;
$$;

create function public.instagram_owner_disconnect(p_actor_app_user_id uuid,p_celebrity_id uuid,p_generation uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare slot public.instagram_connections;
begin
 if p_actor_app_user_id is null or not exists(select 1 from public.app_users where id=p_actor_app_user_id and status='active') then raise exception 'OWNER_AUTH'; end if;
 select * into slot from public.instagram_connections where celebrity_id=p_celebrity_id for update;
 if not found or slot.owner_app_user_id is distinct from p_actor_app_user_id or slot.generation is distinct from p_generation then raise exception 'OWNER_STALE'; end if;
 update public.instagram_connections set owner_app_user_id=null,generation=extensions.gen_random_uuid(),identity=null,ig_user_id=null,ig_scoped_id=null,
  token_ciphertext=null,token_issued_at=null,token_expires_at=null,authorization_started_at=null,connected_at=null,media='[]'::jsonb,media_fetched_at=null,
  next_sync_at=now(),last_error=null,lease_id=null,lease_until=null,live_observation=null,live_generation=null,live_lease_id=null,live_lease_until=null where celebrity_id=p_celebrity_id;
 delete from public.instagram_owner_flows where celebrity_id=p_celebrity_id or actor_app_user_id=p_actor_app_user_id;
 return jsonb_build_object('celebrity_id',slot.celebrity_id,'identity',slot.identity,'token_ciphertext',slot.token_ciphertext);
end;
$$;

create function public.instagram_expire_credentials(p_celebrity_id uuid,p_generation uuid)
returns boolean language plpgsql security invoker set search_path='' as $$
begin
 update public.instagram_connections set generation=extensions.gen_random_uuid(),token_ciphertext=null,token_issued_at=null,token_expires_at=null,
  connected_at=null,media='[]'::jsonb,media_fetched_at=null,last_error=null,lease_id=null,lease_until=null,
  live_observation=null,live_generation=null,live_lease_id=null,live_lease_until=null where celebrity_id=p_celebrity_id and generation=p_generation and owner_app_user_id is not null;
 return found;
end; $$;

create function public.instagram_guard_owned_identity() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if new.identity is null then new.owner_app_user_id:=null; end if;
 if old.owner_app_user_id is not null and new.owner_app_user_id=old.owner_app_user_id and new.identity is not null
   and new.identity->>'user_id' is distinct from old.identity->>'user_id' then raise exception 'OWNER_IDENTITY_CONFLICT'; end if;
 return new;
end; $$;
create trigger instagram_guard_owned_identity before update on public.instagram_connections for each row execute function public.instagram_guard_owned_identity();

-- Signed deletion also removes exchanged owner secrets before writing the tombstone.
create or replace function public.instagram_delete_subject(p_scoped_id text,p_issued_at timestamptz,p_confirmation_hash text)
returns void language plpgsql security invoker set search_path='' as $$
declare slot public.instagram_connections;
begin
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_scoped_id,8092026));
 insert into public.instagram_revocations(subject_hash,issued_at) values(encode(extensions.digest(p_scoped_id,'sha256'),'hex'),p_issued_at)
 on conflict(subject_hash) do update set issued_at=greatest(instagram_revocations.issued_at,excluded.issued_at),expires_at=greatest(instagram_revocations.expires_at,excluded.expires_at);
 delete from public.instagram_owner_flows where payload->'identity'->>'id'=p_scoped_id and authorization_started_at<=p_issued_at+interval '1 second';
 for slot in select c.* from public.instagram_connections c where
   (c.ig_scoped_id=p_scoped_id and c.authorization_started_at<=p_issued_at+interval '1 second')
   or exists(select 1 from public.instagram_connection_flows f where f.celebrity_id=c.celebrity_id and f.payload->'identity'->>'id'=p_scoped_id and f.authorization_started_at<=p_issued_at+interval '1 second')
   for update loop perform public.instagram_disconnect(slot.celebrity_id,slot.generation); end loop;
 insert into public.instagram_deletion_receipts(confirmation_hash) values(p_confirmation_hash) on conflict do nothing;
end; $$;

-- Cleanup and live polling honor owner flow expiry and the owner visibility switch.
create or replace function public.instagram_claim_sync(p_limit integer default 10,p_celebrity_id uuid default null)
returns setof public.instagram_connections language plpgsql security invoker set search_path='' as $$
begin
 delete from public.instagram_connection_flows where expires_at<=now(); delete from public.instagram_owner_flows where expires_at<=now();
 delete from public.instagram_deletion_receipts where expires_at<=now(); delete from public.instagram_revocations where expires_at<=now();
 return query with due as (select celebrity_id from public.instagram_connections where token_ciphertext is not null and next_sync_at<=now()
  and (lease_until is null or lease_until<=now()) and (p_celebrity_id is null or celebrity_id=p_celebrity_id)
  order by next_sync_at,celebrity_id for update skip locked limit least(greatest(coalesce(p_limit,10),1),25))
 update public.instagram_connections c set lease_id=extensions.gen_random_uuid(),lease_until=now()+interval '5 minutes'
 from due where c.celebrity_id=due.celebrity_id returning c.*;
end; $$;

-- Amend latest live functions with the visibility predicate at claim/read/finish.
create or replace function public.instagram_owner_live_guard() returns trigger language plpgsql security invoker set search_path='' as $$
begin if not new.live_enabled then new.live_observation=null;new.live_generation=null;new.live_lease_id=null;new.live_lease_until=null; end if; return new; end $$;
create trigger instagram_owner_live_guard before update of live_enabled on public.instagram_connections for each row execute function public.instagram_owner_live_guard();

create or replace function public.instagram_claim_live_sync(p_limit integer default 25)
returns setof public.instagram_connections language plpgsql security invoker set search_path='' as $$
begin
 return query with due as (
  select c.celebrity_id from public.instagram_connections c
  join public.celebrities ce on ce.id=c.celebrity_id and ce.status='published'
  join public.celebrity_social_links sl on sl.celebrity_id=c.celebrity_id and sl.platform='instagram' and sl.active
  where c.live_enabled and c.connected_at is not null and c.token_ciphertext is not null and c.token_expires_at>now()
   and c.live_next_sync_at<=now() and (c.live_lease_until is null or c.live_lease_until<=now())
   and lower(sl.url) in ('https://instagram.com/'||lower(c.identity->>'username'),'https://instagram.com/'||lower(c.identity->>'username')||'/',
    'https://www.instagram.com/'||lower(c.identity->>'username'),'https://www.instagram.com/'||lower(c.identity->>'username')||'/')
  order by c.live_next_sync_at,c.celebrity_id for update of c skip locked limit least(greatest(coalesce(p_limit,25),1),25)
 ) update public.instagram_connections c set live_lease_id=extensions.gen_random_uuid(),live_lease_until=now()+interval '45 seconds',live_next_sync_at=now()+interval '3 minutes'
 from due where c.celebrity_id=due.celebrity_id returning c.*;
end; $$;

alter function public.instagram_finish_live_sync(uuid,uuid,uuid,timestamptz,jsonb) rename to instagram_finish_live_sync_before_owner;
create function public.instagram_finish_live_sync(p_celebrity_id uuid,p_generation uuid,p_lease_id uuid,p_token_issued_at timestamptz,p_observation jsonb)
returns boolean language plpgsql security invoker set search_path='' as $$
declare enabled boolean;
begin
 select live_enabled into enabled from public.instagram_connections where celebrity_id=p_celebrity_id for update;
 if not found or not enabled then return false; end if;
 return public.instagram_finish_live_sync_before_owner(p_celebrity_id,p_generation,p_lease_id,p_token_issued_at,p_observation);
end; $$;

alter function public.instagram_read_live_discovery(text,text) rename to instagram_read_live_discovery_before_owner;
create function public.instagram_read_live_discovery(p_creator_slug text,p_username text)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
begin
 if not exists(select 1 from public.instagram_connections c join public.celebrities ce on ce.id=c.celebrity_id
  where ce.slug=p_creator_slug and c.live_enabled) then return jsonb_build_object('state','unavailable','observedAt',now()); end if;
 return public.instagram_read_live_discovery_before_owner(p_creator_slug,p_username);
end; $$;

revoke all on function public.instagram_owner_match(text),public.instagram_owner_transition(text,text,uuid,text,jsonb),
 public.instagram_owner_accounts(uuid,public.content_locale),public.instagram_owner_settings(uuid,uuid,uuid,boolean,public.content_locale),
 public.instagram_owner_disconnect(uuid,uuid,uuid),public.instagram_expire_credentials(uuid,uuid),public.instagram_guard_owned_identity(),public.instagram_owner_live_guard() from public,anon,authenticated;
revoke all on function public.instagram_finish_live_sync_before_owner(uuid,uuid,uuid,timestamptz,jsonb),public.instagram_read_live_discovery_before_owner(text,text) from public,anon,authenticated;
revoke all on function public.instagram_finish_live_sync(uuid,uuid,uuid,timestamptz,jsonb),public.instagram_read_live_discovery(text,text) from public,anon,authenticated;
grant execute on function public.instagram_owner_transition(text,text,uuid,text,jsonb),public.instagram_owner_accounts(uuid,public.content_locale),
 public.instagram_owner_settings(uuid,uuid,uuid,boolean,public.content_locale),public.instagram_owner_disconnect(uuid,uuid,uuid),public.instagram_expire_credentials(uuid,uuid),
 public.instagram_owner_match(text),public.instagram_finish_live_sync_before_owner(uuid,uuid,uuid,timestamptz,jsonb),public.instagram_read_live_discovery_before_owner(text,text) to service_role;
grant execute on function public.instagram_finish_live_sync(uuid,uuid,uuid,timestamptz,jsonb),public.instagram_read_live_discovery(text,text) to service_role;
