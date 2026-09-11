-- Local disposable-database contract test. All fixtures are rolled back.
begin;

do $$
declare
  actor_a uuid := pg_catalog.gen_random_uuid();
  actor_b uuid := pg_catalog.gen_random_uuid();
  actor_viewer uuid := pg_catalog.gen_random_uuid();
  actor_operator uuid := pg_catalog.gen_random_uuid();
  actor_disabled uuid := pg_catalog.gen_random_uuid();
  actor_inactive uuid := pg_catalog.gen_random_uuid();
  actor_mismatch uuid := pg_catalog.gen_random_uuid();
  allow_a uuid := pg_catalog.gen_random_uuid();
  allow_b uuid := pg_catalog.gen_random_uuid();
  allow_viewer uuid := pg_catalog.gen_random_uuid();
  allow_operator uuid := pg_catalog.gen_random_uuid();
  allow_disabled uuid := pg_catalog.gen_random_uuid();
  allow_inactive uuid := pg_catalog.gen_random_uuid();
  allow_mismatch uuid := pg_catalog.gen_random_uuid();
  retained_user uuid := pg_catalog.gen_random_uuid();
begin
  insert into public.app_users (id, privy_user_id, verified_email, status) values
    (actor_a, 'did:privy:admin-directory-a-' || actor_a, 'admin-a@example.invalid', 'active'),
    (actor_b, 'did:privy:admin-directory-b-' || actor_b, 'admin-b@example.invalid', 'active'),
    (actor_viewer, 'did:privy:admin-directory-viewer-' || actor_viewer, 'viewer@example.invalid', 'active'),
    (actor_operator, 'did:privy:admin-directory-operator-' || actor_operator, 'operator@example.invalid', 'active'),
    (actor_disabled, 'did:privy:admin-directory-disabled-' || actor_disabled, 'disabled@example.invalid', 'disabled'),
    (actor_inactive, 'did:privy:admin-directory-inactive-' || actor_inactive, 'inactive@example.invalid', 'active'),
    (actor_mismatch, 'did:privy:admin-directory-mismatch-' || actor_mismatch, 'other@example.invalid', 'active'),
    (retained_user, 'did:privy:admin-directory-retained-' || retained_user, 'retained@example.invalid', 'active');

  insert into public.admin_allowlist (id, email, role, active, updated_at) values
    (allow_a, 'admin-a@example.invalid', 'admin', true, '2026-01-01T00:00:00.000001Z'),
    (allow_b, 'admin-b@example.invalid', 'admin', true, '2026-01-01T00:00:00.000002Z'),
    (allow_viewer, 'viewer@example.invalid', 'viewer', true, '2026-01-01T00:00:00.000003Z'),
    (allow_operator, 'operator@example.invalid', 'operator', true, '2026-01-01T00:00:00.000004Z'),
    (allow_disabled, 'disabled@example.invalid', 'admin', true, '2026-01-01T00:00:00.000005Z'),
    (allow_inactive, 'inactive@example.invalid', 'admin', false, '2026-01-01T00:00:00.000006Z'),
    (allow_mismatch, 'mismatch@example.invalid', 'admin', true, '2026-01-01T00:00:00.000007Z');

  perform pg_catalog.set_config('byus.admin_directory.actor_a', actor_a::text, true);
  perform pg_catalog.set_config('byus.admin_directory.actor_b', actor_b::text, true);
  perform pg_catalog.set_config('byus.admin_directory.actor_viewer', actor_viewer::text, true);
  perform pg_catalog.set_config('byus.admin_directory.actor_operator', actor_operator::text, true);
  perform pg_catalog.set_config('byus.admin_directory.actor_disabled', actor_disabled::text, true);
  perform pg_catalog.set_config('byus.admin_directory.actor_inactive', actor_inactive::text, true);
  perform pg_catalog.set_config('byus.admin_directory.actor_mismatch', actor_mismatch::text, true);
  perform pg_catalog.set_config('byus.admin_directory.allow_a', allow_a::text, true);
  perform pg_catalog.set_config('byus.admin_directory.allow_b', allow_b::text, true);
  perform pg_catalog.set_config('byus.admin_directory.allow_viewer', allow_viewer::text, true);
  perform pg_catalog.set_config('byus.admin_directory.allow_operator', allow_operator::text, true);
  perform pg_catalog.set_config('byus.admin_directory.allow_disabled', allow_disabled::text, true);
  perform pg_catalog.set_config('byus.admin_directory.allow_inactive', allow_inactive::text, true);
  perform pg_catalog.set_config('byus.admin_directory.allow_mismatch', allow_mismatch::text, true);
  perform pg_catalog.set_config('byus.admin_directory.retained_user', retained_user::text, true);
end;
$$;

set local role service_role;

do $$
declare
  actor_a uuid := current_setting('byus.admin_directory.actor_a')::uuid;
  actor_b uuid := current_setting('byus.admin_directory.actor_b')::uuid;
  actor_viewer uuid := current_setting('byus.admin_directory.actor_viewer')::uuid;
  actor_operator uuid := current_setting('byus.admin_directory.actor_operator')::uuid;
  actor_disabled uuid := current_setting('byus.admin_directory.actor_disabled')::uuid;
  actor_inactive uuid := current_setting('byus.admin_directory.actor_inactive')::uuid;
  actor_mismatch uuid := current_setting('byus.admin_directory.actor_mismatch')::uuid;
  allow_a uuid := current_setting('byus.admin_directory.allow_a')::uuid;
  allow_b uuid := current_setting('byus.admin_directory.allow_b')::uuid;
  allow_viewer uuid := current_setting('byus.admin_directory.allow_viewer')::uuid;
  allow_operator uuid := current_setting('byus.admin_directory.allow_operator')::uuid;
  allow_disabled uuid := current_setting('byus.admin_directory.allow_disabled')::uuid;
  allow_inactive uuid := current_setting('byus.admin_directory.allow_inactive')::uuid;
  allow_mismatch uuid := current_setting('byus.admin_directory.allow_mismatch')::uuid;
  retained_user uuid := current_setting('byus.admin_directory.retained_user')::uuid;
  created jsonb;
  changed jsonb;
  directory jsonb;
  target_id uuid;
  first_updated_at timestamptz;
  current_updated_at timestamptz;
  create_correlation uuid := pg_catalog.gen_random_uuid();
  update_correlation uuid := pg_catalog.gen_random_uuid();
  audit_before bigint;
  audit_after bigint;
  caught boolean;
begin
  if has_table_privilege('service_role', 'public.admin_allowlist', 'INSERT')
     or has_table_privilege('service_role', 'public.admin_allowlist', 'UPDATE')
     or has_table_privilege('service_role', 'public.admin_allowlist', 'DELETE')
     or not has_table_privilege('service_role', 'public.admin_allowlist', 'SELECT') then
    raise exception 'admin_allowlist service-role grant boundary is wrong';
  end if;

  if has_function_privilege('anon', 'public.read_admin_directory(uuid,uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.read_admin_directory(uuid,uuid)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.read_admin_directory(uuid,uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.create_admin_directory_entry(uuid,uuid,uuid,text,public.admin_role)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.create_admin_directory_entry(uuid,uuid,uuid,text,public.admin_role)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.create_admin_directory_entry(uuid,uuid,uuid,text,public.admin_role)', 'EXECUTE')
     or has_function_privilege('anon', 'public.update_admin_directory_entry(uuid,uuid,uuid,uuid,public.admin_role,boolean,timestamptz)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.update_admin_directory_entry(uuid,uuid,uuid,uuid,public.admin_role,boolean,timestamptz)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.update_admin_directory_entry(uuid,uuid,uuid,uuid,public.admin_role,boolean,timestamptz)', 'EXECUTE')
     or has_function_privilege('service_role', 'public.assert_admin_directory_actor(uuid,uuid)', 'EXECUTE')
     or has_function_privilege('service_role', 'public.set_admin_allowlist_updated_at()', 'EXECUTE') then
    raise exception 'admin directory RPC grant boundary is wrong';
  end if;

  directory := public.read_admin_directory(actor_a, allow_a);
  if (directory ->> 'actorId')::uuid <> allow_a
     or jsonb_array_length(directory -> 'items') <> 7
     or exists (
       select 1
       from (
         select item ->> 'email' email,
                lag(item ->> 'email') over (order by ordinal) previous_email
         from jsonb_array_elements(directory -> 'items') with ordinality entries(item, ordinal)
       ) ordered
       where previous_email > email
     ) then
    raise exception 'directory read contract or ordering is wrong';
  end if;

  caught := false;
  begin perform public.read_admin_directory(actor_viewer, allow_viewer);
  exception when raise_exception then caught := sqlerrm = 'ADMIN_DIRECTORY_FORBIDDEN'; end;
  if not caught then raise exception 'viewer actor was accepted'; end if;
  caught := false;
  begin perform public.read_admin_directory(actor_operator, allow_operator);
  exception when raise_exception then caught := sqlerrm = 'ADMIN_DIRECTORY_FORBIDDEN'; end;
  if not caught then raise exception 'operator actor was accepted'; end if;
  caught := false;
  begin perform public.read_admin_directory(actor_disabled, allow_disabled);
  exception when raise_exception then caught := sqlerrm = 'ADMIN_DIRECTORY_FORBIDDEN'; end;
  if not caught then raise exception 'disabled app user was accepted'; end if;
  caught := false;
  begin perform public.read_admin_directory(actor_inactive, allow_inactive);
  exception when raise_exception then caught := sqlerrm = 'ADMIN_DIRECTORY_FORBIDDEN'; end;
  if not caught then raise exception 'inactive allowlist actor was accepted'; end if;
  caught := false;
  begin perform public.read_admin_directory(actor_mismatch, allow_mismatch);
  exception when raise_exception then caught := sqlerrm = 'ADMIN_DIRECTORY_FORBIDDEN'; end;
  if not caught then raise exception 'email-mismatched actor was accepted'; end if;
  caught := false;
  begin perform public.read_admin_directory(actor_a, allow_b);
  exception when raise_exception then caught := sqlerrm = 'ADMIN_DIRECTORY_FORBIDDEN'; end;
  if not caught then raise exception 'cross-paired actor IDs were accepted'; end if;

  caught := false;
  begin
    insert into public.admin_allowlist(email, role) values ('direct@example.invalid', 'viewer');
  exception when insufficient_privilege then caught := true; end;
  if not caught then raise exception 'direct allowlist insert was accepted'; end if;
  caught := false;
  begin update public.admin_allowlist set active = false where id = allow_b;
  exception when insufficient_privilege then caught := true; end;
  if not caught then raise exception 'direct allowlist update was accepted'; end if;
  caught := false;
  begin delete from public.admin_allowlist where id = allow_b;
  exception when insufficient_privilege then caught := true; end;
  if not caught then raise exception 'direct allowlist delete was accepted'; end if;

  audit_before := (select count(*) from public.audit_logs where action like 'admin_directory.%');
  created := public.create_admin_directory_entry(
    actor_a, allow_a, create_correlation, '  NEW.OPERATOR@EXAMPLE.INVALID  ', 'operator'
  );
  target_id := (created ->> 'id')::uuid;
  first_updated_at := (created ->> 'updatedAt')::timestamptz;
  if created ->> 'email' <> 'new.operator@example.invalid'
     or created ->> 'role' <> 'operator'
     or (created ->> 'active')::boolean is not true
     or created ->> 'createdAt' is null
     or created ->> 'updatedAt' is null then
    raise exception 'created directory item contract is wrong';
  end if;
  audit_after := (select count(*) from public.audit_logs where action like 'admin_directory.%');
  if audit_after <> audit_before + 1 then raise exception 'create audit count is wrong'; end if;
  if not exists (
    select 1
    from public.audit_logs logs
    where logs.action = 'admin_directory.created'
      and logs.entity_type = 'admin_allowlist'
      and logs.entity_id = target_id::text
      and logs.actor_app_user_id = actor_a
      and logs.actor_admin_allowlist_id = allow_a
      and logs.correlation_id = create_correlation
      and logs.before_after_summary -> 'before' = 'null'::jsonb
      and logs.before_after_summary #>> '{after,id}' = target_id::text
      and logs.before_after_summary #>> '{after,role}' = 'operator'
      and (logs.before_after_summary #>> '{after,active}')::boolean
  ) then
    raise exception 'create audit actor/correlation/before/after contract is wrong';
  end if;

  caught := false;
  begin
    perform public.create_admin_directory_entry(
      actor_a, allow_a, pg_catalog.gen_random_uuid(), 'new.operator@example.invalid', 'viewer'
    );
  exception when raise_exception then caught := sqlerrm = 'ADMIN_DIRECTORY_DUPLICATE_EMAIL'; end;
  if not caught then raise exception 'duplicate canonical email was accepted'; end if;
  if (select count(*) from public.audit_logs where action like 'admin_directory.%') <> audit_after then
    raise exception 'duplicate create did not roll back atomically';
  end if;

  caught := false;
  begin
    perform public.create_admin_directory_entry(
      actor_a, allow_a, pg_catalog.gen_random_uuid(), repeat('a', 250) || '@x.invalid', 'viewer'
    );
  exception when raise_exception then caught := sqlerrm = 'ADMIN_DIRECTORY_INVALID_INPUT'; end;
  if not caught then raise exception 'overlong email was accepted'; end if;
  caught := false;
  begin
    perform public.create_admin_directory_entry(
      actor_a, allow_a, pg_catalog.gen_random_uuid(), '   ', 'viewer'
    );
  exception when raise_exception then caught := sqlerrm = 'ADMIN_DIRECTORY_INVALID_INPUT'; end;
  if not caught then raise exception 'blank email was accepted'; end if;
  caught := false;
  begin
    perform public.create_admin_directory_entry(
      actor_a, allow_a, pg_catalog.gen_random_uuid(), null, 'viewer'
    );
  exception when raise_exception then caught := sqlerrm = 'ADMIN_DIRECTORY_INVALID_INPUT'; end;
  if not caught then raise exception 'null email was accepted'; end if;

  target_id := allow_operator;
  first_updated_at := (
    select updated_at from public.admin_allowlist where id = target_id
  );
  audit_before := (select count(*) from public.audit_logs where action = 'admin_directory.updated');
  changed := public.update_admin_directory_entry(
    actor_a, allow_a, update_correlation, target_id, 'viewer', true, first_updated_at
  );
  current_updated_at := (changed ->> 'updatedAt')::timestamptz;
  if changed ->> 'role' <> 'viewer' or current_updated_at <= first_updated_at then
    raise exception 'role update or updatedAt precision contract is wrong';
  end if;
  if changed ->> 'updatedAt' <> (
       select to_jsonb(updated_at) #>> '{}' from public.admin_allowlist where id = target_id
     ) then
    raise exception 'updatedAt JSON text did not preserve the database value';
  end if;
  if (select count(*) from public.audit_logs where action = 'admin_directory.updated') <> audit_before + 1 then
    raise exception 'successful update did not append exactly one audit record';
  end if;
  if not exists (
    select 1
    from public.audit_logs logs
    where logs.action = 'admin_directory.updated'
      and logs.entity_type = 'admin_allowlist'
      and logs.entity_id = target_id::text
      and logs.actor_app_user_id = actor_a
      and logs.actor_admin_allowlist_id = allow_a
      and logs.correlation_id = update_correlation
      and logs.before_after_summary #>> '{before,id}' = target_id::text
      and logs.before_after_summary #>> '{before,role}' = 'operator'
      and (logs.before_after_summary #>> '{before,active}')::boolean
      and logs.before_after_summary #>> '{after,id}' = target_id::text
      and logs.before_after_summary #>> '{after,role}' = 'viewer'
      and (logs.before_after_summary #>> '{after,active}')::boolean
  ) then
    raise exception 'update audit actor/correlation/before/after contract is wrong';
  end if;

  audit_before := (select count(*) from public.audit_logs where action = 'admin_directory.updated');
  caught := false;
  begin
    perform public.update_admin_directory_entry(
      actor_a, allow_a, pg_catalog.gen_random_uuid(), target_id, 'admin', false, first_updated_at
    );
  exception when raise_exception then caught := sqlerrm = 'ADMIN_DIRECTORY_CONFLICT'; end;
  if not caught then raise exception 'stale optimistic update was accepted'; end if;
  if (select role from public.admin_allowlist where id = target_id) <> 'viewer'
     or (select count(*) from public.audit_logs where action = 'admin_directory.updated') <> audit_before then
    raise exception 'stale update did not roll back atomically';
  end if;

  changed := public.update_admin_directory_entry(
    actor_a, allow_a, pg_catalog.gen_random_uuid(), target_id, 'viewer', false, current_updated_at
  );
  current_updated_at := (changed ->> 'updatedAt')::timestamptz;
  if (changed ->> 'active')::boolean then raise exception 'access was not revoked'; end if;
  changed := public.update_admin_directory_entry(
    actor_a, allow_a, pg_catalog.gen_random_uuid(), target_id, 'admin', true, current_updated_at
  );
  if changed ->> 'role' <> 'admin' or not (changed ->> 'active')::boolean then
    raise exception 'admin role/reactivation flow failed';
  end if;
  current_updated_at := (changed ->> 'updatedAt')::timestamptz;
  audit_before := (select count(*) from public.audit_logs where action = 'admin_directory.updated');
  perform public.update_admin_directory_entry(
    actor_a, allow_a, pg_catalog.gen_random_uuid(), target_id, 'admin', true, current_updated_at
  );
  if (select count(*) from public.audit_logs where action = 'admin_directory.updated') <> audit_before then
    raise exception 'no-op update appended an audit record';
  end if;

  -- A matching member record is deliberately independent from allowlist access.
  created := public.create_admin_directory_entry(
    actor_a, allow_a, pg_catalog.gen_random_uuid(), 'retained@example.invalid', 'viewer'
  );
  changed := public.update_admin_directory_entry(
    actor_a, allow_a, pg_catalog.gen_random_uuid(), (created ->> 'id')::uuid,
    'viewer', false, (created ->> 'updatedAt')::timestamptz
  );
  if not exists(select 1 from public.app_users where id = retained_user and status = 'active') then
    raise exception 'revoking admin access removed or disabled the app user';
  end if;

  caught := false;
  begin
    perform public.update_admin_directory_entry(
      actor_a, allow_a, pg_catalog.gen_random_uuid(), allow_a, 'operator', true,
      (select updated_at from public.admin_allowlist where id = allow_a)
    );
  exception when raise_exception then caught := sqlerrm = 'ADMIN_DIRECTORY_SELF_CHANGE'; end;
  if not caught then raise exception 'self-demotion was accepted'; end if;

  caught := false;
  begin
    perform public.update_admin_directory_entry(
      actor_a, allow_a, pg_catalog.gen_random_uuid(), pg_catalog.gen_random_uuid(), 'viewer', true, now()
    );
  exception when raise_exception then caught := sqlerrm = 'ADMIN_DIRECTORY_NOT_FOUND'; end;
  if not caught then raise exception 'missing entry did not return the bounded error'; end if;

  if exists (
    select 1 from public.audit_logs logs
    where logs.action like 'admin_directory.%'
      and logs.before_after_summary::text ~* '(email|@example)'
  ) then
    raise exception 'admin directory audit leaked email PII';
  end if;
end;
$$;

reset role;

-- Force the audit append to fail and prove both create and update mutations are
-- statement-atomic with their audit record. This trigger exists only inside the
-- surrounding rollback transaction and is removed before later assertions.
create function pg_temp.reject_admin_directory_audit_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.action like 'admin_directory.%' then
    raise exception 'FORCED_ADMIN_DIRECTORY_AUDIT_FAILURE' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger admin_directory_test_reject_audit_insert
before insert on public.audit_logs
for each row execute function pg_temp.reject_admin_directory_audit_insert();

set local role service_role;

do $$
declare
  actor_a uuid := current_setting('byus.admin_directory.actor_a')::uuid;
  allow_a uuid := current_setting('byus.admin_directory.allow_a')::uuid;
  target_id uuid := current_setting('byus.admin_directory.allow_b')::uuid;
  target_before public.admin_allowlist%rowtype;
  audit_before bigint;
  caught boolean := false;
begin
  select * into strict target_before
  from public.admin_allowlist
  where id = target_id;
  audit_before := (select count(*) from public.audit_logs where action like 'admin_directory.%');

  begin
    perform public.create_admin_directory_entry(
      actor_a, allow_a, pg_catalog.gen_random_uuid(),
      'audit-failure-create@example.invalid', 'viewer'
    );
  exception when raise_exception then
    caught := sqlerrm = 'FORCED_ADMIN_DIRECTORY_AUDIT_FAILURE';
  end;
  if not caught then raise exception 'forced create audit failure was not observed'; end if;
  if exists (
       select 1 from public.admin_allowlist
       where email = 'audit-failure-create@example.invalid'
     ) or (select count(*) from public.audit_logs where action like 'admin_directory.%') <> audit_before then
    raise exception 'create mutation survived its failed audit append';
  end if;

  caught := false;
  begin
    perform public.update_admin_directory_entry(
      actor_a, allow_a, pg_catalog.gen_random_uuid(), target_id,
      'operator', false, target_before.updated_at
    );
  exception when raise_exception then
    caught := sqlerrm = 'FORCED_ADMIN_DIRECTORY_AUDIT_FAILURE';
  end;
  if not caught then raise exception 'forced update audit failure was not observed'; end if;
  if not exists (
       select 1 from public.admin_allowlist current_row
       where current_row.id = target_before.id
         and current_row.role = target_before.role
         and current_row.active = target_before.active
         and current_row.updated_at = target_before.updated_at
     ) or (select count(*) from public.audit_logs where action like 'admin_directory.%') <> audit_before then
    raise exception 'update mutation survived its failed audit append';
  end if;
end;
$$;

reset role;
drop trigger admin_directory_test_reject_audit_insert on public.audit_logs;

-- Reduce the fixture to one active admin, then prove its own RPC cannot remove
-- the final administrator. The rejected statement leaves the count unchanged.
update public.admin_allowlist
set active = false
where id <> current_setting('byus.admin_directory.allow_a')::uuid
  and active
  and role = 'admin';

set local role service_role;

do $$
declare caught boolean := false;
  actor_a uuid := current_setting('byus.admin_directory.actor_a')::uuid;
  allow_a uuid := current_setting('byus.admin_directory.allow_a')::uuid;
begin
  begin
    perform public.update_admin_directory_entry(
      actor_a, allow_a, pg_catalog.gen_random_uuid(), allow_a, 'admin', false,
      (select updated_at from public.admin_allowlist where id = allow_a)
    );
  exception when raise_exception then
    caught := sqlerrm = 'ADMIN_DIRECTORY_SELF_CHANGE';
  end;
  if not caught then raise exception 'final active admin self-protection failed'; end if;
  if (select count(*) from public.admin_allowlist where active and role = 'admin') <> 1 then
    raise exception 'final active admin count changed after rejection';
  end if;
end;
$$;

reset role;

rollback;

select jsonb_build_object(
  'status', 'PASS',
  'contract', 'admin-directory',
  'coverage', jsonb_build_array(
    'read', 'create', 'role-update', 'deactivate', 'reactivate',
    'permission-denial', 'duplicate', 'stale-conflict', 'audit',
    'member-retention', 'self-change', 'last-admin'
  )
) as admin_directory_test_result;
