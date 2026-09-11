begin;

do $$
declare
  v_actor_app uuid;
  v_actor_allowlist uuid;
  v_owner uuid;
  v_live_owner uuid;
  v_live_slug text;
  v_actor_role public.admin_role;
  v_asset jsonb;
  v_result jsonb;
  v_live_before jsonb;
  v_live_after jsonb;
  v_rejected boolean;
  v_audit_before bigint;
  v_history_before bigint;
  v_hash text := repeat('a', 64);
begin
  if pg_catalog.has_table_privilege('anon', 'public.public_image_assets', 'select')
    or pg_catalog.has_table_privilege('authenticated', 'public.public_image_role_bindings', 'select')
    or pg_catalog.has_table_privilege('service_role', 'public.public_image_assets', 'insert') then
    raise exception 'public image tables expose direct privileges';
  end if;
  if pg_catalog.has_function_privilege('anon', 'public.set_admin_public_image_role(uuid,uuid,uuid,text,uuid,text,integer,uuid,jsonb,jsonb)', 'execute')
    or pg_catalog.has_function_privilege('authenticated', 'public.read_admin_public_image_roles(uuid,uuid,text,uuid)', 'execute')
    or not pg_catalog.has_function_privilege('service_role', 'public.read_published_public_image_roles(text,text[])', 'execute') then
    raise exception 'public image RPC privileges are incorrect';
  end if;

  select users.id, admins.id, admins.role into v_actor_app, v_actor_allowlist, v_actor_role
  from public.admin_allowlist admins
  join public.app_users users on users.verified_email = admins.email
  where admins.active and admins.role in ('admin','operator') and users.status = 'active'
  order by admins.created_at
  limit 1;
  if v_actor_app is null then raise exception 'public image fixture requires an active writable administrator'; end if;

  select id into v_owner from public.celebrities where archived_at is null order by created_at limit 1;
  if v_owner is null then raise exception 'public image fixture requires a celebrity'; end if;
  delete from public.public_image_role_bindings where owner_type = 'celebrity' and owner_id = v_owner and role = 'profile';

  select count(*) into v_audit_before from public.audit_logs;
  update public.admin_allowlist set role = 'viewer' where id = v_actor_allowlist;
  v_rejected := false;
  begin
    perform public.set_admin_public_image_role(
      v_actor_app, v_actor_allowlist, extensions.gen_random_uuid(), 'celebrity', v_owner,
      'profile', 0, null, null, '{}'::jsonb
    );
  exception when others then
    if position('viewer is read-only' in sqlerrm) = 0 then raise; end if;
    v_rejected := true;
  end;
  update public.admin_allowlist set role = v_actor_role where id = v_actor_allowlist;
  if not v_rejected then raise exception 'viewer image-role write unexpectedly succeeded'; end if;
  if (select count(*) from public.audit_logs) <> v_audit_before then raise exception 'viewer rejection appended audit evidence'; end if;

  v_result := public.set_admin_public_image_role(
    v_actor_app, v_actor_allowlist, extensions.gen_random_uuid(), 'celebrity', v_owner,
    'profile', 0, null, null, '{}'::jsonb
  );
  if v_result->>'revision' <> '1' or v_result->'binding' <> 'null'::jsonb then
    raise exception 'initial tombstone did not create revision one';
  end if;

  v_rejected := false;
  select count(*) into v_audit_before from public.audit_logs;
  begin
    perform public.set_admin_public_image_role(
      v_actor_app, v_actor_allowlist, extensions.gen_random_uuid(), 'celebrity', v_owner,
      'profile', 0, null, null, '{}'::jsonb
    );
  exception when others then
    if position('revision conflict' in sqlerrm) = 0 then raise; end if;
    v_rejected := true;
  end;
  if not v_rejected then raise exception 'stale absent-row CAS unexpectedly succeeded'; end if;

  v_asset := public.register_admin_public_image_asset(
    v_actor_app, v_actor_allowlist, extensions.gen_random_uuid(), v_hash,
    'public-image-assets/' || v_hash || '.webp',
    'https://fixture.supabase.co/storage/v1/object/public/cms-assets/public-image-assets/' || v_hash || '.webp',
    440, 440, 'image/webp', 1024
  );
  select count(*) into v_audit_before from public.audit_logs;
  v_rejected := false;
  begin
    perform public.set_admin_public_image_role(
      v_actor_app, v_actor_allowlist, extensions.gen_random_uuid(), 'celebrity', v_owner,
      'profile', 1, (v_asset->>'id')::uuid, jsonb_build_object('ko',null,'en',null), '{}'::jsonb
    );
  exception when others then
    if position('invalid image alt text' in sqlerrm) = 0 then raise; end if;
    v_rejected := true;
  end;
  if not v_rejected then raise exception 'null alt text unexpectedly succeeded'; end if;
  if (select count(*) from public.audit_logs) <> v_audit_before then raise exception 'null alt rejection appended audit evidence'; end if;

  v_rejected := false;
  begin
    perform public.set_admin_public_image_role(
      v_actor_app, v_actor_allowlist, extensions.gen_random_uuid(), 'celebrity', v_owner,
      'profile', 1, (v_asset->>'id')::uuid, jsonb_build_object('ko','프로필','en','Profile'),
      jsonb_build_object('identity.square', jsonb_build_object('fit',null,'x',50,'y',50,'approvedAssetRevision',null))
    );
  exception when others then
    if position('invalid image frame' in sqlerrm) = 0 then raise; end if;
    v_rejected := true;
  end;
  if not v_rejected then raise exception 'null frame fit unexpectedly succeeded'; end if;
  if (select count(*) from public.audit_logs) <> v_audit_before then raise exception 'null frame rejection appended audit evidence'; end if;

  v_result := public.set_admin_public_image_role(
    v_actor_app, v_actor_allowlist, extensions.gen_random_uuid(), 'celebrity', v_owner,
    'profile', 1, (v_asset->>'id')::uuid, jsonb_build_object('ko','프로필','en','Profile'),
    jsonb_build_object('identity.square', jsonb_build_object('fit','cover','x',50,'y',50,'approvedAssetRevision',1))
  );
  if v_result->>'revision' <> '2' or v_result->'binding' is null then
    raise exception 'asset binding did not advance the revision';
  end if;

  v_rejected := false;
  begin
    perform public.set_admin_public_image_role(
      v_actor_app, v_actor_allowlist, extensions.gen_random_uuid(), 'live', v_owner,
      'poster', 0, null, null, '{}'::jsonb
    );
  exception when others then
    if position('image owner not found' in sqlerrm) = 0 then raise; end if;
    v_rejected := true;
  end;
  if not v_rejected then raise exception 'cross-owner identifier unexpectedly succeeded'; end if;

  v_result := public.set_admin_public_image_role(
    v_actor_app, v_actor_allowlist, extensions.gen_random_uuid(), 'celebrity', v_owner,
    'profile', 2, null, null, '{}'::jsonb
  );
  if v_result->>'revision' <> '3' or v_result->'binding' <> 'null'::jsonb then
    raise exception 'removal tombstone did not advance the revision';
  end if;

  select live.id, live.slug into v_live_owner, v_live_slug
  from public.live_events live
  join public.celebrities celebrity on celebrity.id = live.celebrity_id and celebrity.status = 'published'
  join public.brands brand on brand.id = live.brand_id and brand.status = 'published'
  where live.publication_status = 'published' and live.archived_at is null
    and public.live_effective_status_at(live.id, pg_catalog.now()) = 'ended'
  order by live.created_at limit 1;
  if v_live_owner is null then raise exception 'public image fixture requires an ended published LIVE'; end if;
  delete from public.public_image_role_bindings where owner_type = 'live' and owner_id = v_live_owner and role = 'landscape';
  select to_jsonb(live) into v_live_before from public.live_events live where id = v_live_owner;
  select count(*) into v_history_before from public.live_schedule_revisions where live_event_id = v_live_owner;

  perform public.set_admin_public_image_role(
    v_actor_app, v_actor_allowlist, extensions.gen_random_uuid(), 'live', v_live_owner,
    'landscape', 0, null, null, '{}'::jsonb
  );
  select to_jsonb(live) into v_live_after from public.live_events live where id = v_live_owner;
  if v_live_after is distinct from v_live_before then raise exception 'image role write changed LIVE source row'; end if;
  if (select count(*) from public.live_schedule_revisions where live_event_id = v_live_owner) <> v_history_before then
    raise exception 'image role write changed LIVE schedule history';
  end if;
  v_result := public.read_published_public_image_roles('live', array[v_live_slug]);
  if not exists (
    select 1 from pg_catalog.jsonb_array_elements(v_result) item
    where item->>'ownerSlug' = v_live_slug
      and item->'record'->>'role' = 'landscape'
      and item->'record'->'binding' = 'null'::jsonb
  ) then raise exception 'ended published LIVE tombstone was not projected'; end if;
end;
$$;

rollback;
