drop trigger if exists instagram_owner_live_guard on public.instagram_connections;
drop trigger if exists instagram_guard_owned_identity on public.instagram_connections;
drop function if exists public.instagram_owner_live_guard();
drop function if exists public.instagram_guard_owned_identity();
drop function if exists public.instagram_owner_transition(text,text,uuid,text,jsonb);
drop function if exists public.instagram_owner_accounts(uuid,public.content_locale);
drop function if exists public.instagram_owner_settings(uuid,uuid,uuid,boolean,public.content_locale);
drop function if exists public.instagram_owner_disconnect(uuid,uuid,uuid);
drop function if exists public.instagram_expire_credentials(uuid,uuid);
drop function if exists public.instagram_owner_match(text);
drop table if exists public.instagram_owner_flows;

drop function public.instagram_finish_live_sync(uuid,uuid,uuid,timestamptz,jsonb);
alter function public.instagram_finish_live_sync_before_owner(uuid,uuid,uuid,timestamptz,jsonb) rename to instagram_finish_live_sync;
drop function public.instagram_read_live_discovery(text,text);
alter function public.instagram_read_live_discovery_before_owner(text,text) rename to instagram_read_live_discovery;

create or replace function public.instagram_claim_live_sync(p_limit integer default 25)
returns setof public.instagram_connections language plpgsql security invoker set search_path='' as $$
begin
 return query with due as (
  select c.celebrity_id from public.instagram_connections c
  join public.celebrities ce on ce.id=c.celebrity_id and ce.status='published'
  join public.celebrity_social_links sl on sl.celebrity_id=c.celebrity_id and sl.platform='instagram' and sl.active
  where c.connected_at is not null and c.token_ciphertext is not null and c.token_expires_at>now()
   and c.live_next_sync_at<=now() and (c.live_lease_until is null or c.live_lease_until<=now())
   and lower(sl.url) in ('https://instagram.com/'||lower(c.identity->>'username'),'https://instagram.com/'||lower(c.identity->>'username')||'/',
    'https://www.instagram.com/'||lower(c.identity->>'username'),'https://www.instagram.com/'||lower(c.identity->>'username')||'/')
  order by c.live_next_sync_at,c.celebrity_id for update of c skip locked limit least(greatest(coalesce(p_limit,25),1),25)
 ) update public.instagram_connections c set live_lease_id=extensions.gen_random_uuid(),live_lease_until=now()+interval '45 seconds',live_next_sync_at=now()+interval '3 minutes'
 from due where c.celebrity_id=due.celebrity_id returning c.*;
end; $$;

alter table public.instagram_connections drop constraint instagram_connection_complete;
update public.instagram_connections set identity=null,ig_user_id=null,ig_scoped_id=null,authorization_started_at=null
where owner_app_user_id is not null and token_ciphertext is null;
alter table public.instagram_connections add constraint instagram_connection_complete check (
 (identity is null and ig_user_id is null and ig_scoped_id is null and token_ciphertext is null and token_issued_at is null and token_expires_at is null and authorization_started_at is null and connected_at is null)
 or (identity is not null and ig_user_id is not null and ig_scoped_id is not null and token_ciphertext is not null and token_issued_at is not null and token_expires_at>token_issued_at and authorization_started_at is not null and connected_at is not null));
alter table public.instagram_connections drop column live_enabled,drop column owner_app_user_id;

create or replace function public.instagram_claim_sync(p_limit integer default 10,p_celebrity_id uuid default null)
returns setof public.instagram_connections language plpgsql security invoker set search_path='' as $$
begin
 delete from public.instagram_connection_flows where expires_at<=now();
 delete from public.instagram_deletion_receipts where expires_at<=now();
 delete from public.instagram_revocations where expires_at<=now();
 return query with due as (select celebrity_id from public.instagram_connections where token_ciphertext is not null and next_sync_at<=now()
  and (lease_until is null or lease_until<=now()) and (p_celebrity_id is null or celebrity_id=p_celebrity_id)
  order by next_sync_at,celebrity_id for update skip locked limit least(greatest(coalesce(p_limit,10),1),25))
 update public.instagram_connections c set lease_id=extensions.gen_random_uuid(),lease_until=now()+interval '5 minutes'
 from due where c.celebrity_id=due.celebrity_id returning c.*;
end; $$;

create or replace function public.instagram_delete_subject(p_scoped_id text,p_issued_at timestamptz,p_confirmation_hash text)
returns void language plpgsql security invoker set search_path='' as $$
declare slot public.instagram_connections;
begin
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_scoped_id,8092026));
 insert into public.instagram_revocations(subject_hash,issued_at) values(encode(extensions.digest(p_scoped_id,'sha256'),'hex'),p_issued_at)
 on conflict(subject_hash) do update set issued_at=greatest(instagram_revocations.issued_at,excluded.issued_at),expires_at=greatest(instagram_revocations.expires_at,excluded.expires_at);
 for slot in select c.* from public.instagram_connections c where
  (c.ig_scoped_id=p_scoped_id and c.authorization_started_at<=p_issued_at+interval '1 second')
  or exists(select 1 from public.instagram_connection_flows f where f.celebrity_id=c.celebrity_id and f.payload->'identity'->>'id'=p_scoped_id and f.authorization_started_at<=p_issued_at+interval '1 second')
  for update loop perform public.instagram_disconnect(slot.celebrity_id,slot.generation);end loop;
 insert into public.instagram_deletion_receipts(confirmation_hash) values(p_confirmation_hash) on conflict do nothing;
end; $$;

revoke all on function public.instagram_claim_live_sync(integer),public.instagram_finish_live_sync(uuid,uuid,uuid,timestamptz,jsonb),public.instagram_read_live_discovery(text,text) from public,anon,authenticated;
grant execute on function public.instagram_claim_live_sync(integer),public.instagram_finish_live_sync(uuid,uuid,uuid,timestamptz,jsonb),public.instagram_read_live_discovery(text,text) to service_role;
revoke all on function public.instagram_claim_sync(integer,uuid),public.instagram_delete_subject(text,timestamptz,text) from public,anon,authenticated;
grant execute on function public.instagram_claim_sync(integer,uuid),public.instagram_delete_subject(text,timestamptz,text) to service_role;
