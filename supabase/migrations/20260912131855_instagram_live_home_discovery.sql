-- Observe connected public Instagram creators without requiring a ByUs event.
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
    order by c.live_next_sync_at,c.celebrity_id for update of c skip locked limit least(greatest(coalesce(p_limit,25),1),25)
  ) update public.instagram_connections c set live_lease_id=extensions.gen_random_uuid(),
    live_lease_until=now()+interval '45 seconds', live_next_sync_at=now()+interval '3 minutes'
    from due where c.celebrity_id=due.celebrity_id returning c.*;
end;
$$;

create or replace function public.instagram_finish_live_sync(p_celebrity_id uuid,p_generation uuid,p_lease_id uuid,p_token_issued_at timestamptz,p_observation jsonb)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare slot public.instagram_connections; observation jsonb; observed_at timestamptz; started_at timestamptz; username text; permalink text; moment timestamptz;
begin
  select * into slot from public.instagram_connections where celebrity_id=p_celebrity_id for update;
  moment := clock_timestamp();
  if not found or slot.generation is distinct from p_generation or slot.live_lease_id is distinct from p_lease_id
    or slot.live_lease_id is null or slot.live_lease_until <= moment or slot.token_ciphertext is null
    or slot.token_expires_at <= moment or slot.token_issued_at is distinct from p_token_issued_at then return false; end if;
  observed_at := (p_observation->>'observedAt')::timestamptz;
  if observed_at is null or observed_at > moment or observed_at <= moment-interval '90 seconds'
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
  -- A failed probe is not proof that a broadcast ended. Never redate prior proof.
  if p_observation->>'state'='unavailable' and slot.live_generation=p_generation
    and slot.live_observation->>'state'='live'
    and (slot.live_observation->>'observedAt')::timestamptz <= moment
    and (slot.live_observation->>'observedAt')::timestamptz > moment-interval '5 minutes' then
    observation := slot.live_observation;
  end if;
  update public.instagram_connections set live_observation=observation,live_generation=p_generation,
    live_lease_id=null,live_lease_until=null where celebrity_id=p_celebrity_id;
  return true;
exception when invalid_datetime_format or datetime_field_overflow then return false;
end;
$$;

-- Private projection only: connection eligibility is never part of the public contract.
create function public.instagram_read_live_discovery(p_creator_slug text,p_username text)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare slot public.instagram_connections; ob jsonb; observed_at timestamptz;
  unavailable jsonb := jsonb_build_object('state','unavailable','observedAt',now());
begin
  select c.* into slot from public.instagram_connections c
  join public.celebrities ce on ce.id=c.celebrity_id and ce.slug=p_creator_slug and ce.status='published'
  join public.celebrity_social_links sl on sl.celebrity_id=c.celebrity_id and sl.platform='instagram' and sl.active
  where c.connected_at is not null and c.token_ciphertext is not null and c.token_expires_at > now()
    and c.live_generation=c.generation and lower(c.identity->>'username')=p_username
    and lower(sl.url) in ('https://instagram.com/'||p_username,'https://instagram.com/'||p_username||'/',
      'https://www.instagram.com/'||p_username,'https://www.instagram.com/'||p_username||'/');
  if not found then return unavailable; end if;
  ob := slot.live_observation;
  observed_at := (ob->>'observedAt')::timestamptz;
  if observed_at is null or observed_at > now() or observed_at <= now()-interval '5 minutes' then return unavailable; end if;
  if ob->>'state'='offline' then return jsonb_build_object('state','offline','observedAt',ob->>'observedAt'); end if;
  if ob->>'state'='live' and ob->>'userId'=slot.ig_user_id and ob->>'username'=p_username
    and ob->>'mediaId' ~ '^[0-9]{1,30}$'
    and ob->>'permalink' ~ '^https://(www\.)?instagram\.com/stories/[A-Za-z0-9._]{1,30}/[0-9]{1,30}/?$'
    and lower(split_part(ob->>'permalink','/',5))=p_username
    and (ob->>'actualStartTime')::timestamptz <= observed_at then
    return jsonb_build_object('state','live','observedAt',ob->>'observedAt',
      'userId',ob->>'userId','username',ob->>'username','mediaId',ob->>'mediaId',
      'actualStartTime',ob->>'actualStartTime','permalink',ob->>'permalink');
  end if;
  return unavailable;
exception when invalid_datetime_format or datetime_field_overflow then return unavailable;
end;
$$;

-- Registered-event redirects retain their separate event-window and manual-link checks.
create or replace function public.instagram_read_live_observation(p_creator_slug text,p_username text)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare observation jsonb;
begin
  observation := public.instagram_read_live_discovery(p_creator_slug,p_username);
  return case when observation->>'state'='live' then observation else null end;
end;
$$;
revoke all on function public.instagram_claim_live_sync(integer), public.instagram_finish_live_sync(uuid,uuid,uuid,timestamptz,jsonb),
  public.instagram_read_live_observation(text,text), public.instagram_read_live_discovery(text,text) from public,anon,authenticated;
grant execute on function public.instagram_claim_live_sync(integer), public.instagram_finish_live_sync(uuid,uuid,uuid,timestamptz,jsonb),
  public.instagram_read_live_observation(text,text), public.instagram_read_live_discovery(text,text) to service_role;
