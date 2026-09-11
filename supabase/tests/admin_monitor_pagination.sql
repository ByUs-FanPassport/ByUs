-- Local synthetic fixtures only. All writes roll back.
\set ON_ERROR_STOP on
begin;

do $$
declare
  actor uuid := 'a9120000-0000-4000-8000-000000000010';
  allowlist uuid := 'a9120000-0000-4000-8000-000000000011';
  notification uuid := 'a9120000-0000-4000-8000-000000000012';
  celebrity uuid := 'a9120000-0000-4000-8000-000000000013';
  benefit uuid := 'a9120000-0000-4000-8000-000000000014';
  shared_time timestamptz := '2099-01-01T00:00:00Z';
  blockchain_first uuid[];
  blockchain_second uuid[];
  notification_first jsonb;
  notification_second jsonb;
  rejected boolean := false;
  index integer;
begin
  insert into public.app_users (id, privy_user_id, verified_email, status)
  values (actor, 'did:privy:admin-monitor-pagination', 'admin-monitor-pagination@example.invalid', 'active');
  insert into public.admin_allowlist (id, email, role, active)
  values (allowlist, 'admin-monitor-pagination@example.invalid', 'admin', true);
  insert into public.celebrities (id, slug, status, image_url, roles, primary_role)
  values (celebrity, 'admin-monitor-pagination', 'draft', '/admin-monitor-pagination.webp', '{artist}', 'idol');
  insert into public.benefits (id, slug, celebrity_id, delivery_type, claim_opens_at, claim_closes_at)
  values (benefit, 'admin-monitor-pagination', celebrity, 'text', shared_time - interval '1 day', shared_time + interval '1 day');
  insert into public.fan_notifications (
    id, app_user_id, kind, source_key, benefit_id, scheduled_for, created_at
  ) values (
    notification, actor, 'benefit_available', 'admin-monitor-pagination', benefit, shared_time, shared_time
  );

  insert into public.blockchain_jobs (
    id, entity_type, entity_id, operation_key, payload, created_at, updated_at, next_attempt_at
  ) values
    ('a9120000-0000-4000-8000-000000000001', 'passport', extensions.gen_random_uuid(), 'admin-pagination-1-' || extensions.gen_random_uuid(), '{}', shared_time, shared_time, shared_time),
    ('a9120000-0000-4000-8000-000000000002', 'passport', extensions.gen_random_uuid(), 'admin-pagination-2-' || extensions.gen_random_uuid(), '{}', shared_time, shared_time, shared_time),
    ('a9120000-0000-4000-8000-000000000003', 'passport', extensions.gen_random_uuid(), 'admin-pagination-3-' || extensions.gen_random_uuid(), '{}', shared_time, shared_time, shared_time);

  select array_agg(page.id order by page.created_at desc, page.id desc) into blockchain_first
  from public.get_admin_blockchain_jobs(actor, allowlist, null, null, 2, null, null) page;
  if blockchain_first is distinct from array[
    'a9120000-0000-4000-8000-000000000003'::uuid,
    'a9120000-0000-4000-8000-000000000002'::uuid
  ] then raise exception 'Blockchain first page order is unstable: %', blockchain_first; end if;

  select array_agg(page.id order by page.created_at desc, page.id desc) into blockchain_second
  from public.get_admin_blockchain_jobs(
    actor, allowlist, null, null, 2, shared_time,
    'a9120000-0000-4000-8000-000000000002'
  ) page;
  if blockchain_second is distinct from array[
    'a9120000-0000-4000-8000-000000000001'::uuid
  ] then raise exception 'Blockchain cursor skipped or duplicated a tied row: %', blockchain_second; end if;

  for index in 1..3 loop
    insert into public.push_subscriptions (
      id, app_user_id, endpoint, endpoint_hash, p256dh, auth_secret, created_at, updated_at
    ) values (
      ('a9120000-0000-4000-8000-00000000010' || index)::uuid,
      actor,
      'https://example.invalid/admin-pagination-' || index,
      encode(extensions.digest('admin-pagination-' || index, 'sha256'), 'hex'),
      repeat('p', 32), repeat('a', 16), shared_time, shared_time
    );
    insert into public.notification_delivery_outbox (
      id, notification_id, subscription_id, status, available_at, created_at, updated_at
    ) values (
      ('a9120000-0000-4000-8000-00000000020' || index)::uuid,
      notification,
      ('a9120000-0000-4000-8000-00000000010' || index)::uuid,
      'pending', shared_time, shared_time, shared_time
    );
  end loop;

  notification_first := public.get_admin_notification_deliveries(actor, allowlist, 'pending', 2, null, null);
  if notification_first #>> '{items,0,id}' <> 'a9120000-0000-4000-8000-000000000203'
    or notification_first #>> '{items,1,id}' <> 'a9120000-0000-4000-8000-000000000202'
  then raise exception 'Notification first page order is unstable: %', notification_first->'items'; end if;

  notification_second := public.get_admin_notification_deliveries(
    actor, allowlist, 'pending', 2, shared_time,
    'a9120000-0000-4000-8000-000000000202'
  );
  if notification_second #>> '{items,0,id}' <> 'a9120000-0000-4000-8000-000000000201'
  then raise exception 'Notification cursor skipped a tied row: %', notification_second->'items'; end if;
  if exists (
    select 1 from jsonb_array_elements(notification_second->'items') item
    where item->>'id' in ('a9120000-0000-4000-8000-000000000202', 'a9120000-0000-4000-8000-000000000203')
  ) then raise exception 'Notification cursor duplicated a first-page row'; end if;

  begin
    perform public.get_admin_blockchain_jobs(extensions.gen_random_uuid(), allowlist, null, null, 2, null, null);
  exception when raise_exception then rejected := true;
  end;
  if not rejected then raise exception 'Blockchain monitor accepted a mismatched actor'; end if;
  rejected := false;
  begin
    perform public.get_admin_notification_deliveries(extensions.gen_random_uuid(), allowlist, null, 2, null, null);
  exception when raise_exception then rejected := true;
  end;
  if not rejected then raise exception 'Notification monitor accepted a mismatched actor'; end if;

  if has_function_privilege('anon', 'public.get_admin_blockchain_jobs(uuid,uuid,uuid,public.blockchain_job_status,integer,timestamptz,uuid)', 'execute')
    or has_function_privilege('authenticated', 'public.get_admin_blockchain_jobs(uuid,uuid,uuid,public.blockchain_job_status,integer,timestamptz,uuid)', 'execute')
    or not has_function_privilege('service_role', 'public.get_admin_blockchain_jobs(uuid,uuid,uuid,public.blockchain_job_status,integer,timestamptz,uuid)', 'execute')
  then raise exception 'Blockchain pagination RPC grant boundary is wrong'; end if;
  if has_function_privilege('anon', 'public.get_admin_notification_deliveries(uuid,uuid,public.notification_delivery_status,integer,timestamptz,uuid)', 'execute')
    or has_function_privilege('authenticated', 'public.get_admin_notification_deliveries(uuid,uuid,public.notification_delivery_status,integer,timestamptz,uuid)', 'execute')
    or not has_function_privilege('service_role', 'public.get_admin_notification_deliveries(uuid,uuid,public.notification_delivery_status,integer,timestamptz,uuid)', 'execute')
  then raise exception 'Notification pagination RPC grant boundary is wrong'; end if;
  if (
    select procedure.provolatile <> 'v'
    from pg_catalog.pg_proc procedure
    where procedure.oid = 'public.get_admin_notification_deliveries(uuid,uuid,public.notification_delivery_status,integer,timestamptz,uuid)'::regprocedure
  ) then raise exception 'Notification monitor must remain volatile for its locking authorization check'; end if;
end $$;

select jsonb_build_object(
  'status', 'PASS',
  'stableCursor', '(created_at,id)',
  'monitors', 2,
  'syntheticOnly', true
) as admin_monitor_pagination_result;
rollback;
