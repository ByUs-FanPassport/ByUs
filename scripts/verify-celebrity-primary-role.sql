\set ON_ERROR_STOP on
begin;

create function pg_temp.primary_role_questions() returns jsonb language sql immutable as $$
  select jsonb_agg(jsonb_build_object(
    'position', q, 'promptKo', '질문 '||q, 'promptEn', 'Question '||q, 'active', true,
    'options', (select jsonb_agg(jsonb_build_object(
      'position', o, 'labelKo', '보기 '||o, 'labelEn', 'Option '||o,
      'isCorrect', o=1, 'active', true
    ) order by o) from generate_series(1,4) o)
  ) order by q) from generate_series(1,3) q
$$;

do $$
declare
  actor uuid := '95400000-0000-4000-8000-000000000001';
  viewer uuid := '95400000-0000-4000-8000-000000000002';
  correlation uuid := '95400000-0000-4000-8000-000000000003';
  target uuid;
  unclassified uuid;
  archived uuid := '95400000-0000-4000-8000-000000000004';
  quiz uuid;
  result jsonb;
  invalid jsonb;
  rejected boolean;
  selected text;
  payload jsonb := '{"slug":"primary-role-proof","imageUrl":"/roles.jpg","imagePosition":"center","displayOrder":1,"fanCount":null,"primaryRole":"actor","localizations":{"ko":{"name":"대표 직군 검증","summary":"분류 검증","imageAlt":"직군 검증"},"en":{"name":"Role proof","summary":"Role validation","imageAlt":"Role proof"}},"themes":[],"socialLinks":[]}'::jsonb;
begin
  if exists(select 1 from public.celebrities where status='published' and primary_role is null) then
    raise exception 'backfill left unclassified published profiles';
  end if;
  if has_table_privilege('anon', 'public.published_celebrities', 'select')
    or has_table_privilege('authenticated', 'public.published_celebrities', 'select')
    or not has_table_privilege('service_role', 'public.published_celebrities', 'select') then
    raise exception 'public projection ACL changed';
  end if;
  if has_function_privilege('anon','public.save_admin_celebrity(uuid,uuid,uuid,jsonb)','execute')
    or has_function_privilege('authenticated','public.set_admin_celebrity_publication(uuid,uuid,uuid,boolean)','execute')
    or not has_function_privilege('service_role','public.read_admin_celebrity_cms(uuid,uuid)','execute') then
    raise exception 'CMS RPC ACL changed';
  end if;
  insert into public.admin_allowlist(id,email,role,active) values
    (actor,'primary-role-proof@byus.test','admin',true),
    (viewer,'primary-role-viewer@byus.test','viewer',true);

  result := public.save_admin_celebrity(actor,correlation,null,payload);
  target := (result->>'id')::uuid;
  if result->>'primaryRole' is distinct from 'actor' or result->'roles' is distinct from '["artist"]'::jsonb then
    raise exception 'new create lost primary or compatibility activity';
  end if;
  for selected in select unnest(array['idol','singer','actor','creator','show_host']) loop
    result := public.save_admin_celebrity(actor,correlation,target,jsonb_set(payload,'{primaryRole}',to_jsonb(selected)));
    if result->>'primaryRole' is distinct from selected or result->'roles' is distinct from '["artist"]'::jsonb then
      raise exception 'new edit did not keep one primary and preserve legacy activities';
    end if;
  end loop;
  if (public.read_admin_celebrity_cms(actor,target)->0)->>'primaryRole' is distinct from 'show_host' then
    raise exception 'admin read lost primary role';
  end if;
  if not exists(select 1 from public.audit_logs where entity_id=target::text
    and before_after_summary->'before'->>'primaryRole'='creator'
    and before_after_summary->'after'->>'primaryRole'='show_host') then
    raise exception 'primary role audit missing';
  end if;
  result := public.save_admin_celebrity(actor,correlation,target,(payload-'primaryRole')||'{"roles":["artist","creator"]}');
  if result->>'primaryRole' is distinct from 'show_host' or result->'roles' is distinct from '["artist","creator"]'::jsonb then
    raise exception 'legacy edit damaged primary or lost legacy transport';
  end if;
  result := public.save_admin_celebrity(actor,correlation,target,payload-'primaryRole');
  if result->>'primaryRole' is distinct from 'show_host' or result->'roles' is distinct from '["artist","creator"]'::jsonb then
    raise exception 'omitted roles damaged classified profile';
  end if;
  for invalid in select value from jsonb_array_elements('[null,"",[],["actor"],"artist","unknown",12,{}]') loop
    rejected := false;
    begin
      perform public.save_admin_celebrity(actor,correlation,target,jsonb_set(payload,'{primaryRole}',invalid));
    exception when others then rejected := sqlerrm like '%invalid celebrity primary role%'; end;
    if not rejected then raise exception 'invalid scalar primary accepted: %',invalid; end if;
  end loop;
  rejected := false;
  begin perform public.save_admin_celebrity(actor,correlation,null,(payload-'primaryRole')||'{"roles":["artist"]}');
  exception when others then rejected := sqlerrm like '%requires a primary role%'; end;
  if not rejected then raise exception 'legacy-only new creation accepted'; end if;
  rejected := false;
  begin perform public.save_admin_celebrity(viewer,correlation,target,payload);
  exception when others then rejected := true; end;
  if not rejected then raise exception 'viewer changed primary role'; end if;
  rejected := false;
  begin perform public.save_admin_celebrity(actor,null,target,payload);
  exception when others then rejected := sqlerrm like '%correlation id%'; end;
  if not rejected then raise exception 'save without correlation accepted'; end if;
  if (select primary_role from public.celebrities where id=target) is distinct from 'show_host'::public.celebrity_primary_role then
    raise exception 'rejected edits damaged primary';
  end if;

  -- Legacy draft remains editable without inventing a new classification.
  insert into public.celebrities(slug,image_url,roles) values('primary-unclassified','/roles.jpg','{artist}') returning id into unclassified;
  result := public.save_admin_celebrity(actor,correlation,unclassified,jsonb_set(payload-'primaryRole','{slug}','"primary-unclassified"'));
  if result->'primaryRole' is distinct from 'null'::jsonb then raise exception 'legacy draft was automatically classified'; end if;
  rejected := false;
  begin perform public.set_admin_celebrity_publication(actor,correlation,unclassified,true);
  exception when others then rejected := sqlerrm like '%requires a primary role%'; end;
  if not rejected then raise exception 'unclassified draft RPC publish accepted'; end if;
  rejected := false;
  begin update public.celebrities set status='published' where id=unclassified;
  exception when check_violation then rejected := true; end;
  if not rejected then raise exception 'direct publish bypassed required primary'; end if;

  rejected := false;
  begin perform public.set_admin_celebrity_publication(actor,correlation,target,true);
  exception when others then rejected := sqlerrm like '%requires fan count%'; end;
  if not rejected then raise exception 'fan count publication gate regressed'; end if;
  update public.celebrities set fan_count=10 where id=target;
  rejected := false;
  begin perform public.set_admin_celebrity_publication(actor,correlation,target,true);
  exception when others then rejected := sqlerrm like '%exactly one published quiz%'; end;
  if not rejected then raise exception 'quiz publication gate regressed'; end if;
  perform public.save_admin_quiz_version(actor,correlation,target,null,pg_temp.primary_role_questions());
  select id into quiz from public.celebrity_quizzes where celebrity_id=target and version=1;
  perform public.publish_admin_quiz_version(actor,correlation,target,quiz);
  perform public.set_admin_celebrity_publication(actor,correlation,target,true);
  if (select count(*) from public.published_celebrities where slug='primary-role-proof' and primary_role='show_host') <> 2 then
    raise exception 'valid KO/EN public projection lost single primary';
  end if;
  rejected := false;
  begin update public.celebrities set primary_role=null where id=target;
  exception when check_violation then rejected := true; end;
  if not rejected then raise exception 'published role could be cleared'; end if;

  insert into public.celebrities(id,slug,image_url,roles,archived_at,archived_by_admin_allowlist_id,archive_reason)
  values(archived,'primary-archived','/roles.jpg','{artist}',now(),actor,'Local archived role validation');
  rejected := false;
  begin update public.celebrities set primary_role='idol' where id=archived;
  exception when others then rejected := sqlerrm like '%archived content is immutable%'; end;
  if not rejected then raise exception 'archived primary became mutable'; end if;
  rejected := false;
  begin perform public.save_admin_celebrity(actor,correlation,archived,payload);
  exception when others then rejected := sqlerrm like '%content not found%'; end;
  if not rejected then raise exception 'archived RPC edit became writable'; end if;
  raise notice 'PRIMARY_ROLE_PROOF scalar create/read/update, legacy edit preserve, invalid rejection, audit, permission, public ACL, publication gates, archive: PASS';
end $$;
rollback;
