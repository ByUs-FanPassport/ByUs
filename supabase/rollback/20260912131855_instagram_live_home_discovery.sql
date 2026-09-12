create or replace function public.instagram_claim_live_sync(p_limit integer default 25)
returns setof public.instagram_connections language plpgsql security invoker set search_path = '' as $$
begin
  return query with due as (
    select c.celebrity_id from public.instagram_connections c
    join public.celebrities ce on ce.id=c.celebrity_id and ce.status='published'
    join public.celebrity_social_links sl on sl.celebrity_id=c.celebrity_id and sl.platform='instagram' and sl.active
    where c.connected_at is not null and c.token_ciphertext is not null and c.token_expires_at > now()
      and c.live_next_sync_at <= now() and (c.live_lease_until is null or c.live_lease_until <= now())
      and lower(sl.url) in ('https://instagram.com/'||lower(c.identity->>'username'), 'https://instagram.com/'||lower(c.identity->>'username')||'/',
        'https://www.instagram.com/'||lower(c.identity->>'username'), 'https://www.instagram.com/'||lower(c.identity->>'username')||'/')
      and exists (select 1 from public.live_events l where l.celebrity_id=c.celebrity_id
        and l.publication_status='published' and l.live_provider='instagram' and l.starts_at <= now() and now() < l.ends_at
        and lower(l.external_live_url) in ('https://instagram.com/'||lower(c.identity->>'username'), 'https://instagram.com/'||lower(c.identity->>'username')||'/',
          'https://www.instagram.com/'||lower(c.identity->>'username'), 'https://www.instagram.com/'||lower(c.identity->>'username')||'/'))
    order by c.live_next_sync_at,c.celebrity_id for update of c skip locked limit least(greatest(coalesce(p_limit,25),1),25)
  ) update public.instagram_connections c set live_lease_id=extensions.gen_random_uuid(),
    live_lease_until=now()+interval '45 seconds', live_next_sync_at=now()+interval '45 seconds'
    from due where c.celebrity_id=due.celebrity_id returning c.*;
end;
$$;

create or replace function public.instagram_finish_live_sync(p_celebrity_id uuid,p_generation uuid,p_lease_id uuid,p_token_issued_at timestamptz,p_observation jsonb)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare slot public.instagram_connections; observation jsonb; observed_at timestamptz; started_at timestamptz; username text; permalink text;
begin
  select * into slot from public.instagram_connections where celebrity_id=p_celebrity_id for update;
  if not found or slot.generation is distinct from p_generation or slot.live_lease_id is distinct from p_lease_id
    or slot.live_lease_id is null or slot.live_lease_until <= now() or slot.token_ciphertext is null
    or slot.token_expires_at <= now() or slot.token_issued_at is distinct from p_token_issued_at then return false; end if;
  observed_at := (p_observation->>'observedAt')::timestamptz;
  if observed_at is null or observed_at > now() or observed_at <= now()-interval '90 seconds'
    or coalesce(p_observation->>'state','') not in ('live','offline','unavailable') then return false; end if;
  observation := jsonb_build_object('state',p_observation->>'state','observedAt',observed_at);
  if p_observation->>'state'='live' then
    username := lower(slot.identity->>'username'); permalink := p_observation->>'permalink';
    started_at := (p_observation->>'actualStartTime')::timestamptz;
    if p_observation->>'userId' is distinct from slot.ig_user_id
      or p_observation->>'username' is distinct from username
      or coalesce(p_observation->>'mediaId','') !~ '^[0-9]{1,30}$'
      or started_at is null or started_at > observed_at
      or permalink is null or permalink !~ '^https://(www\.)?instagram\.com/stories/[A-Za-z0-9._]{1,30}/[0-9]{1,30}/?$'
      or lower(split_part(permalink,'/',5)) is distinct from username then return false; end if;
    observation := observation || jsonb_build_object('userId',slot.ig_user_id,'username',username,
      'mediaId',p_observation->>'mediaId','actualStartTime',started_at,'permalink',permalink);
  end if;
  update public.instagram_connections set live_observation=observation,live_generation=p_generation,
    live_lease_id=null,live_lease_until=null where celebrity_id=p_celebrity_id;
  return true;
exception when invalid_datetime_format or datetime_field_overflow then return false;
end;
$$;

-- The anonymous watch handler can only receive this whitelisted, current projection.
create or replace function public.instagram_read_live_observation(p_creator_slug text,p_username text)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object('state',c.live_observation->>'state','observedAt',c.live_observation->>'observedAt',
    'userId',c.live_observation->>'userId','username',c.live_observation->>'username','mediaId',c.live_observation->>'mediaId',
    'actualStartTime',c.live_observation->>'actualStartTime','permalink',c.live_observation->>'permalink')
  from public.instagram_connections c
  join public.celebrities ce on ce.id=c.celebrity_id and ce.slug=p_creator_slug and ce.status='published'
  join public.celebrity_social_links sl on sl.celebrity_id=c.celebrity_id and sl.platform='instagram' and sl.active
  where c.connected_at is not null and c.token_expires_at > now() and c.live_generation=c.generation
    and c.live_observation->>'state'='live'
    and c.live_observation->>'userId'=c.ig_user_id
    and c.live_observation->>'username'=lower(c.identity->>'username') and lower(c.identity->>'username')=p_username
    and lower(sl.url) in ('https://instagram.com/'||p_username,'https://instagram.com/'||p_username||'/',
      'https://www.instagram.com/'||p_username,'https://www.instagram.com/'||p_username||'/')
    and (c.live_observation->>'observedAt')::timestamptz <= now()
    and (c.live_observation->>'observedAt')::timestamptz > now()-interval '90 seconds';
$$;

revoke all on function public.instagram_clear_live_observation(),public.instagram_claim_live_sync(integer),
  public.instagram_finish_live_sync(uuid,uuid,uuid,timestamptz,jsonb),public.instagram_read_live_observation(text,text) from public,anon,authenticated;
grant execute on function public.instagram_clear_live_observation(),public.instagram_claim_live_sync(integer),
  public.instagram_finish_live_sync(uuid,uuid,uuid,timestamptz,jsonb),public.instagram_read_live_observation(text,text) to service_role;

drop function if exists public.instagram_read_live_discovery(text,text);
