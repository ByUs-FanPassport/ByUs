\set ON_ERROR_STOP on
begin;

do $$
declare
  actor uuid := '95100000-0000-4000-8000-000000000001';
  viewer uuid := '95100000-0000-4000-8000-000000000002';
  correlation uuid := '95100000-0000-4000-8000-000000000003';
  target uuid;
  archived uuid := '95100000-0000-4000-8000-000000000004';
  result jsonb;
  invalid jsonb;
  invalid_array public.celebrity_role[];
  rejected boolean;
  payload jsonb := '{"slug":"roles-proof","imageUrl":"/roles.jpg","imagePosition":"center","displayOrder":1,"fanCount":null,"roles":["show_host","creator"],"localizations":{"ko":{"name":"직군 검증","summary":"분류 검증","imageAlt":"직군 검증"},"en":{"name":"Role proof","summary":"Role validation","imageAlt":"Role proof"}},"themes":[],"socialLinks":[]}'::jsonb;
begin
  if exists(select 1 from public.celebrities where roles is null or cardinality(roles) = 0) then
    raise exception 'backfill left unclassified profiles';
  end if;
  if has_table_privilege('anon', 'public.published_celebrities', 'select')
    or has_table_privilege('authenticated', 'public.published_celebrities', 'select')
    or not has_table_privilege('service_role', 'public.published_celebrities', 'select') then
    raise exception 'public projection ACL changed';
  end if;

  insert into public.admin_allowlist(id, email, role, active) values
    (actor, 'roles-proof@byus.test', 'admin', true),
    (viewer, 'roles-viewer@byus.test', 'viewer', true);
  result := public.save_admin_celebrity(actor, correlation, null, payload);
  target := (result->>'id')::uuid;
  if result->'roles' is distinct from '["show_host","creator"]'::jsonb then raise exception 'create lost role order'; end if;
  if (public.read_admin_celebrity_cms(actor,target)->0)->'roles' is distinct from result->'roles' then raise exception 'admin read lost roles'; end if;

  result := public.save_admin_celebrity(actor, correlation, target, payload - 'roles');
  if result->'roles' is distinct from '["show_host","creator"]'::jsonb then raise exception 'old edit erased roles'; end if;
  result := public.save_admin_celebrity(actor, correlation, target, jsonb_set(payload, '{roles}', '["artist","creator","show_host"]'));
  if result->'roles' is distinct from '["artist","creator","show_host"]'::jsonb then raise exception 'three roles not preserved'; end if;
  if not exists(select 1 from public.audit_logs where entity_id = target::text
    and before_after_summary->'before'->'roles' = '["show_host","creator"]'::jsonb
    and before_after_summary->'after'->'roles' = '["artist","creator","show_host"]'::jsonb) then
    raise exception 'role audit before/after missing';
  end if;

  for invalid in select value from jsonb_array_elements('[[],null,"artist",["artist","artist"],["host"],[null],["artist","creator","show_host","artist"],[["artist"]]]') loop
    rejected := false;
    begin
      perform public.save_admin_celebrity(actor,correlation,target,jsonb_set(payload,'{roles}',invalid));
    exception when others then rejected := true;
    end;
    if not rejected then raise exception 'invalid role payload accepted: %', invalid; end if;
  end loop;
  rejected := false;
  begin perform public.save_admin_celebrity(actor,correlation,null,jsonb_set(payload-'roles','{slug}','"roles-missing"'));
  exception when others then rejected := sqlerrm like '%roles are required%'; end;
  if not rejected then raise exception 'new profile without roles accepted'; end if;
  rejected := false;
  begin perform public.save_admin_celebrity(viewer,correlation,target,payload);
  exception when others then rejected := true; end;
  if not rejected then raise exception 'viewer changed roles'; end if;
  rejected := false;
  begin perform public.save_admin_celebrity(actor,null,target,payload);
  exception when others then rejected := sqlerrm like '%correlation id%'; end;
  if not rejected then raise exception 'save without correlation accepted'; end if;

  for invalid_array in select value from (values
    ('{}'::public.celebrity_role[]),
    ('{artist,artist}'::public.celebrity_role[]),
    ('{artist,creator,artist}'::public.celebrity_role[]),
    ('{artist,NULL}'::public.celebrity_role[]),
    ('[0:0]={artist}'::public.celebrity_role[]),
    ('{{artist,creator}}'::public.celebrity_role[]),
    (null::public.celebrity_role[])
  ) invalids(value) loop
    rejected := false;
    begin update public.celebrities set roles=invalid_array where id=target;
    exception when others then rejected := true; end;
    if not rejected then raise exception 'invalid direct role array accepted: %', invalid_array; end if;
  end loop;
  if (select roles from public.celebrities where id=target) is distinct from '{artist,creator,show_host}'::public.celebrity_role[] then
    raise exception 'rejected mutation damaged prior roles';
  end if;

  rejected := false;
  begin perform public.set_admin_celebrity_publication(actor,correlation,target,true);
  exception when others then rejected := sqlerrm like '%requires fan count%'; end;
  if not rejected then raise exception 'fan count gate regressed'; end if;
  update public.celebrities set fan_count=10 where id=target;
  rejected := false;
  begin perform public.set_admin_celebrity_publication(actor,correlation,target,true);
  exception when others then rejected := sqlerrm like '%exactly one published quiz%'; end;
  if not rejected then raise exception 'quiz publication gate regressed'; end if;
  if exists(select 1 from public.published_celebrities where slug='roles-proof') then raise exception 'draft leaked to public projection'; end if;
  if exists(select 1 from public.published_celebrities where roles is null or cardinality(roles)=0) then raise exception 'public role projection incomplete'; end if;

  insert into public.celebrities(id,slug,image_url,roles,archived_at,archived_by_admin_allowlist_id,archive_reason)
  values(archived,'roles-archived','/roles.jpg','{artist}',now(),actor,'Local archived role validation');
  rejected := false;
  begin
    insert into public.celebrities(slug,image_url,roles,archived_at,archived_by_admin_allowlist_id,archive_reason)
    values('roles-invalid-archive','/roles.jpg','{}',now(),actor,'Invalid archived role validation');
  exception when check_violation then rejected := true; end;
  if not rejected then raise exception 'new archived profile accepted empty roles'; end if;
  rejected := false;
  begin update public.celebrities set roles='{creator}' where id=archived;
  exception when others then rejected := sqlerrm like '%archived content is immutable%'; end;
  if not rejected then raise exception 'archived update guard was not restored'; end if;
  rejected := false;
  begin perform public.save_admin_celebrity(actor,correlation,archived,payload);
  exception when others then rejected := sqlerrm like '%content not found%'; end;
  if not rejected then raise exception 'archived edit became writable'; end if;
  raise notice 'ROLE_PROOF required backfill, create/read/update/order, old edit preserve, invalid rejection, audit, permission, public ACL, publication gates, archive: PASS';
end $$;

rollback;
