-- Immutable public editorial images and independently revisioned role bindings.

create table public.public_image_assets (
  id uuid primary key default extensions.gen_random_uuid(),
  content_sha256 text not null unique,
  storage_bucket text not null default 'cms-assets',
  storage_path text not null unique,
  url text not null unique,
  width integer not null check (width > 0),
  height integer not null check (height > 0),
  mime_type text not null check (mime_type in ('image/webp')),
  byte_size bigint not null check (byte_size between 1 and 8388608),
  revision integer not null default 1 check (revision = 1),
  created_by_app_user_id uuid not null references public.app_users(id) on delete restrict,
  created_by_admin_allowlist_id uuid not null references public.admin_allowlist(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint public_image_assets_sha256 check (content_sha256 ~ '^[0-9a-f]{64}$'),
  constraint public_image_assets_storage check (
    storage_bucket = 'cms-assets'
    and storage_path = 'public-image-assets/' || content_sha256 || '.webp'
    and url ~ '^https://[^/?#]+/storage/v1/object/public/cms-assets/public-image-assets/[0-9a-f]{64}\.webp$'
  )
);

create table public.public_image_role_bindings (
  owner_type text not null check (owner_type in ('celebrity', 'live')),
  owner_id uuid not null,
  celebrity_id uuid references public.celebrities(id) on delete cascade,
  live_event_id uuid references public.live_events(id) on delete cascade,
  role text not null check (role in ('profile', 'portrait', 'landscape', 'poster')),
  asset_id uuid references public.public_image_assets(id) on delete restrict,
  alt_ko text,
  alt_en text,
  frames jsonb not null default '{}'::jsonb,
  revision integer not null check (revision > 0),
  updated_by_app_user_id uuid not null references public.app_users(id) on delete restrict,
  updated_by_admin_allowlist_id uuid not null references public.admin_allowlist(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (owner_type, owner_id, role),
  constraint public_image_role_bindings_owner_fk check (
    (owner_type = 'celebrity' and celebrity_id = owner_id and live_event_id is null)
    or (owner_type = 'live' and live_event_id = owner_id and celebrity_id is null)
  ),
  constraint public_image_role_bindings_role check (
    (owner_type = 'celebrity' and role in ('profile', 'portrait', 'landscape'))
    or (owner_type = 'live' and role in ('landscape', 'portrait', 'poster'))
  ),
  constraint public_image_role_bindings_tombstone check (
    (asset_id is null and alt_ko is null and alt_en is null and frames = '{}'::jsonb)
    or (
      asset_id is not null
      and alt_ko is not null
      and alt_en is not null
      and length(btrim(alt_ko)) between 1 and 300
      and length(btrim(alt_en)) between 1 and 300
      and jsonb_typeof(frames) = 'object'
    )
  )
);

create index public_image_role_bindings_celebrity_idx
  on public.public_image_role_bindings (celebrity_id, role) where celebrity_id is not null;
create index public_image_role_bindings_live_idx
  on public.public_image_role_bindings (live_event_id, role) where live_event_id is not null;

alter table public.public_image_assets enable row level security;
alter table public.public_image_assets force row level security;
alter table public.public_image_role_bindings enable row level security;
alter table public.public_image_role_bindings force row level security;

revoke all on public.public_image_assets from public, anon, authenticated, service_role;
revoke all on public.public_image_role_bindings from public, anon, authenticated, service_role;

create function public.image_role_record_json(p_binding public.public_image_role_bindings)
returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'role', p_binding.role,
    'revision', p_binding.revision,
    'binding', case when p_binding.asset_id is null then null else jsonb_build_object(
      'asset', jsonb_build_object(
        'id', asset.id,
        'url', asset.url,
        'width', asset.width,
        'height', asset.height,
        'mimeType', asset.mime_type,
        'revision', asset.revision
      ),
      'alt', jsonb_build_object('ko', p_binding.alt_ko, 'en', p_binding.alt_en),
      'frames', p_binding.frames,
      'revision', p_binding.revision
    ) end
  )
  from (select 1) singleton
  left join public.public_image_assets asset on asset.id = p_binding.asset_id;
$$;

create function public.register_admin_public_image_asset(
  p_actor_app_user_id uuid,
  p_actor_admin_allowlist_id uuid,
  p_correlation_id uuid,
  p_content_sha256 text,
  p_storage_path text,
  p_url text,
  p_width integer,
  p_height integer,
  p_mime_type text,
  p_byte_size bigint
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_asset public.public_image_assets;
begin
  perform public.assert_active_admin(p_actor_app_user_id, p_actor_admin_allowlist_id, true);
  if p_content_sha256 !~ '^[0-9a-f]{64}$'
    or p_storage_path <> 'public-image-assets/' || p_content_sha256 || '.webp'
    or p_mime_type <> 'image/webp'
    or p_width is null or p_height is null or p_width < 1 or p_height < 1
    or p_width::bigint * p_height::bigint > 40000000
    or p_byte_size not between 1 and 8388608 then
    raise exception 'invalid public image asset';
  end if;

  insert into public.public_image_assets(
    content_sha256, storage_path, url, width, height, mime_type, byte_size,
    created_by_app_user_id, created_by_admin_allowlist_id
  ) values (
    p_content_sha256, p_storage_path, p_url, p_width, p_height, p_mime_type, p_byte_size,
    p_actor_app_user_id, p_actor_admin_allowlist_id
  )
  on conflict (content_sha256) do nothing;

  select * into v_asset from public.public_image_assets where content_sha256 = p_content_sha256;
  if v_asset.storage_path <> p_storage_path or v_asset.url <> p_url
    or v_asset.width <> p_width or v_asset.height <> p_height
    or v_asset.mime_type <> p_mime_type or v_asset.byte_size <> p_byte_size then
    raise exception 'immutable public image asset metadata mismatch';
  end if;

  insert into public.audit_logs(
    actor_app_user_id, actor_admin_allowlist_id, action, entity_type, entity_id,
    correlation_id, before_after_summary
  ) values (
    p_actor_app_user_id, p_actor_admin_allowlist_id, 'public_image.asset.registered',
    'public_image_asset', v_asset.id::text, p_correlation_id,
    jsonb_build_object('sha256', v_asset.content_sha256, 'width', v_asset.width, 'height', v_asset.height)
  );

  return jsonb_build_object(
    'id', v_asset.id, 'url', v_asset.url, 'width', v_asset.width,
    'height', v_asset.height, 'mimeType', v_asset.mime_type, 'revision', v_asset.revision
  );
end;
$$;

create function public.read_admin_public_image_roles(
  p_actor_app_user_id uuid,
  p_actor_admin_allowlist_id uuid,
  p_owner_type text,
  p_owner_id uuid
) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.assert_active_admin(p_actor_app_user_id, p_actor_admin_allowlist_id, false);
  if p_owner_type = 'celebrity' then
    if not exists (select 1 from public.celebrities where id = p_owner_id) then raise exception 'image owner not found'; end if;
  elsif p_owner_type = 'live' then
    if not exists (select 1 from public.live_events where id = p_owner_id) then raise exception 'image owner not found'; end if;
  else
    raise exception 'invalid image owner type';
  end if;
  return coalesce((
    select jsonb_agg(public.image_role_record_json(binding) order by binding.role)
    from public.public_image_role_bindings binding
    where binding.owner_type = p_owner_type and binding.owner_id = p_owner_id
  ), '[]'::jsonb);
end;
$$;

create function public.set_admin_public_image_role(
  p_actor_app_user_id uuid,
  p_actor_admin_allowlist_id uuid,
  p_correlation_id uuid,
  p_owner_type text,
  p_owner_id uuid,
  p_role text,
  p_expected_revision integer,
  p_asset_id uuid,
  p_alt jsonb,
  p_frames jsonb
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_before public.public_image_role_bindings;
  v_after public.public_image_role_bindings;
  v_asset public.public_image_assets;
  v_celebrity uuid;
  v_live uuid;
  v_frame record;
  v_slot_width integer;
  v_slot_height integer;
begin
  perform public.assert_active_admin(p_actor_app_user_id, p_actor_admin_allowlist_id, true);
  if p_expected_revision is null or p_expected_revision < 0 then raise exception 'invalid expected revision'; end if;
  -- A row lock cannot serialize the first write because the row does not exist yet.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_owner_type || ':' || p_owner_id::text || ':' || p_role, 0));

  if p_owner_type = 'celebrity' and p_role in ('profile', 'portrait', 'landscape') then
    select id into v_celebrity from public.celebrities where id = p_owner_id and archived_at is null for share;
    if not found then raise exception 'image owner not found'; end if;
  elsif p_owner_type = 'live' and p_role in ('landscape', 'portrait', 'poster') then
    select id into v_live from public.live_events where id = p_owner_id and archived_at is null for share;
    if not found then raise exception 'image owner not found'; end if;
  else
    raise exception 'invalid image owner role';
  end if;

  if p_asset_id is null then
    if p_alt is not null or coalesce(p_frames, '{}'::jsonb) <> '{}'::jsonb then
      raise exception 'removed image role must be an empty tombstone';
    end if;
    p_frames := '{}'::jsonb;
  else
    select * into v_asset from public.public_image_assets where id = p_asset_id;
    if not found then raise exception 'public image asset not found'; end if;
    if p_alt is null or p_frames is null
      or jsonb_typeof(p_alt) <> 'object' or jsonb_typeof(p_frames) <> 'object'
      or (select count(*) from pg_catalog.jsonb_object_keys(p_alt)) <> 2
      or not (p_alt ?& array['ko','en'])
      or jsonb_typeof(p_alt->'ko') is distinct from 'string'
      or jsonb_typeof(p_alt->'en') is distinct from 'string'
      or length(btrim(p_alt->>'ko')) not between 1 and 300
      or length(btrim(p_alt->>'en')) not between 1 and 300 then
      raise exception 'invalid image alt text';
    end if;

    for v_frame in select key, value from jsonb_each(p_frames) loop
      if jsonb_typeof(v_frame.value) <> 'object'
        or (select count(*) from pg_catalog.jsonb_object_keys(v_frame.value)) <> 4
        or not (v_frame.value ?& array['fit','x','y','approvedAssetRevision'])
        or jsonb_typeof(v_frame.value->'fit') is distinct from 'string'
        or v_frame.value->>'fit' not in ('contain','cover')
        or jsonb_typeof(v_frame.value->'x') <> 'number'
        or jsonb_typeof(v_frame.value->'y') <> 'number'
        or (v_frame.value->>'x')::numeric not between 0 and 100
        or (v_frame.value->>'y')::numeric not between 0 and 100 then
        raise exception 'invalid image frame';
      end if;

      select slot_width, slot_height into v_slot_width, v_slot_height
      from (values
        ('celebrity','profile','identity.square',440,440),
        ('celebrity','profile','identity.avatar',64,64),
        ('celebrity','profile','identity.passport',440,354),
        ('celebrity','portrait','creator.hero.mobile',440,470),
        ('celebrity','portrait','creator.vertical',72,96),
        ('celebrity','portrait','creator.calendar',320,392),
        ('celebrity','landscape','creator.hero.desktop',940,360),
        ('celebrity','landscape','creator.collection',640,440),
        ('live','landscape','event.home.desktop',1360,680),
        ('live','portrait','event.home.mobile',440,550),
        ('live','landscape','event.detail',960,480),
        ('live','poster','event.poster',960,480)
      ) slots(owner_type, role, slot, slot_width, slot_height)
      where slots.owner_type = p_owner_type and slots.role = p_role and slots.slot = v_frame.key;
      if not found then raise exception 'image frame does not match owner role'; end if;

      if v_frame.value->>'fit' = 'cover' then
        if jsonb_typeof(v_frame.value->'approvedAssetRevision') <> 'number'
          or v_frame.value->>'approvedAssetRevision' !~ '^[1-9][0-9]*$'
          or (v_frame.value->>'approvedAssetRevision')::integer <> v_asset.revision
          or v_asset.width < v_slot_width or v_asset.height < v_slot_height then
          raise exception 'cover frame requires approved current asset revision without upscaling';
        end if;
      elsif v_frame.value->'approvedAssetRevision' <> 'null'::jsonb then
        raise exception 'contain frame cannot approve a cover revision';
      end if;
    end loop;
  end if;

  select * into v_before from public.public_image_role_bindings
  where owner_type = p_owner_type and owner_id = p_owner_id and role = p_role
  for update;

  if not found then
    if p_expected_revision <> 0 then raise exception 'image role revision conflict'; end if;
    insert into public.public_image_role_bindings(
      owner_type, owner_id, celebrity_id, live_event_id, role, asset_id, alt_ko, alt_en,
      frames, revision, updated_by_app_user_id, updated_by_admin_allowlist_id
    ) values (
      p_owner_type, p_owner_id, v_celebrity, v_live, p_role, p_asset_id,
      case when p_asset_id is null then null else btrim(p_alt->>'ko') end,
      case when p_asset_id is null then null else btrim(p_alt->>'en') end,
      coalesce(p_frames, '{}'::jsonb), 1, p_actor_app_user_id, p_actor_admin_allowlist_id
    ) returning * into v_after;
  else
    if v_before.revision <> p_expected_revision then raise exception 'image role revision conflict'; end if;
    update public.public_image_role_bindings set
      asset_id = p_asset_id,
      alt_ko = case when p_asset_id is null then null else btrim(p_alt->>'ko') end,
      alt_en = case when p_asset_id is null then null else btrim(p_alt->>'en') end,
      frames = coalesce(p_frames, '{}'::jsonb),
      revision = revision + 1,
      updated_by_app_user_id = p_actor_app_user_id,
      updated_by_admin_allowlist_id = p_actor_admin_allowlist_id,
      updated_at = now()
    where owner_type = p_owner_type and owner_id = p_owner_id and role = p_role
    returning * into v_after;
  end if;

  insert into public.audit_logs(
    actor_app_user_id, actor_admin_allowlist_id, action, entity_type, entity_id,
    correlation_id, before_after_summary
  ) values (
    p_actor_app_user_id, p_actor_admin_allowlist_id, 'public_image.role.applied',
    p_owner_type || '_image_role', p_owner_id::text, p_correlation_id,
    jsonb_build_object('role', p_role, 'before', case when v_before.owner_id is null then null else public.image_role_record_json(v_before) end,
      'after', public.image_role_record_json(v_after))
  );
  return public.image_role_record_json(v_after);
end;
$$;

create function public.read_published_public_image_roles(
  p_owner_type text,
  p_slugs text[]
) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_owner_type not in ('celebrity','live') or cardinality(p_slugs) > 200 then
    raise exception 'invalid public image role query';
  end if;
  if p_owner_type = 'celebrity' then
    return coalesce((
      select jsonb_agg(jsonb_build_object('ownerSlug', owner.slug, 'record', public.image_role_record_json(binding)) order by owner.slug, binding.role)
      from (select distinct slug from public.published_celebrities where slug = any(p_slugs)) owner
      join public.celebrities celebrity on celebrity.slug = owner.slug
      join public.public_image_role_bindings binding on binding.celebrity_id = celebrity.id
    ), '[]'::jsonb);
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('ownerSlug', live.slug, 'record', public.image_role_record_json(binding)) order by live.slug, binding.role)
    from public.live_events live
    join public.celebrities celebrity on celebrity.id = live.celebrity_id and celebrity.status = 'published'
    join public.brands brand on brand.id = live.brand_id and brand.status = 'published'
    join public.public_image_role_bindings binding on binding.live_event_id = live.id
    where live.slug = any(p_slugs)
      and live.publication_status = 'published'
      and live.archived_at is null
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.image_role_record_json(public.public_image_role_bindings) from public, anon, authenticated, service_role;
revoke all on function public.register_admin_public_image_asset(uuid,uuid,uuid,text,text,text,integer,integer,text,bigint) from public, anon, authenticated;
revoke all on function public.read_admin_public_image_roles(uuid,uuid,text,uuid) from public, anon, authenticated;
revoke all on function public.set_admin_public_image_role(uuid,uuid,uuid,text,uuid,text,integer,uuid,jsonb,jsonb) from public, anon, authenticated;
revoke all on function public.read_published_public_image_roles(text,text[]) from public, anon, authenticated;
grant execute on function public.register_admin_public_image_asset(uuid,uuid,uuid,text,text,text,integer,integer,text,bigint) to service_role;
grant execute on function public.read_admin_public_image_roles(uuid,uuid,text,uuid) to service_role;
grant execute on function public.set_admin_public_image_role(uuid,uuid,uuid,text,uuid,text,integer,uuid,jsonb,jsonb) to service_role;
grant execute on function public.read_published_public_image_roles(text,text[]) to service_role;

comment on table public.public_image_assets is 'Immutable normalized public editorial image metadata; writes are guarded service-role RPCs only.';
comment on table public.public_image_role_bindings is 'CAS-revisioned celebrity and LIVE image role bindings. Null asset rows are explicit tombstones.';
