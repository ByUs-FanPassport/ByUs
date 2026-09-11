-- Local synthetic fixtures only. Never run this file against production.
\set ON_ERROR_STOP on
begin;

create function pg_temp.expect_error(statement text, expected text)
returns void language plpgsql as $$
declare
  caught boolean := false;
begin
  begin
    execute statement;
  exception when others then
    if position(expected in sqlerrm) = 0 then
      raise exception 'Unexpected error %, wanted %', sqlerrm, expected;
    end if;
    caught := true;
  end;
  if not caught then
    raise exception 'Expected error was not raised: %', expected;
  end if;
end $$;

create function pg_temp.assert_exact_keys(value jsonb, expected text[])
returns void language plpgsql as $$
declare
  actual text[];
  normalized_expected text[];
begin
  select array_agg(key order by key) into actual from jsonb_object_keys(value) key;
  select array_agg(item order by item) into normalized_expected from unnest(expected) item;
  if actual is distinct from normalized_expected then
    raise exception 'JSON keys differ: actual %, expected %', actual, normalized_expected;
  end if;
end $$;

insert into public.app_users(id, privy_user_id, verified_email, status) values
  ('c5000000-0000-4000-8000-000000000001', 'did:privy:cs-owner-1', 'cs-owner-1@example.invalid', 'active'),
  ('c5000000-0000-4000-8000-000000000002', 'did:privy:cs-owner-2', 'cs-owner-2@example.invalid', 'active'),
  ('c5000000-0000-4000-8000-000000000003', 'did:privy:cs-admin', 'cs-admin@example.invalid', 'active'),
  ('c5000000-0000-4000-8000-000000000004', 'did:privy:cs-viewer', 'cs-viewer@example.invalid', 'active'),
  ('c5000000-0000-4000-8000-000000000005', 'did:privy:cs-inactive-fan', 'cs-inactive-fan@example.invalid', 'disabled'),
  ('c5000000-0000-4000-8000-000000000006', 'did:privy:cs-inactive-admin-user', 'cs-inactive-admin@example.invalid', 'disabled'),
  ('c5000000-0000-4000-8000-000000000007', 'did:privy:cs-disabled-admin', 'cs-disabled-admin@example.invalid', 'active'),
  ('c5000000-0000-4000-8000-000000000008', 'did:privy:cs-create-rate', 'cs-create-rate@example.invalid', 'active'),
  ('c5000000-0000-4000-8000-000000000009', 'did:privy:cs-message-rate', 'cs-message-rate@example.invalid', 'active'),
  ('c5000000-0000-4000-8000-000000000010', 'did:privy:cs-page-owner', 'cs-page-owner@example.invalid', 'active');

insert into public.user_profiles(app_user_id, nickname, nickname_normalized) values
  ('c5000000-0000-4000-8000-000000000001', '문의팬', '문의팬');

insert into public.admin_allowlist(id, email, role, active) values
  ('c5100000-0000-4000-8000-000000000001', 'cs-admin@example.invalid', 'operator', true),
  ('c5100000-0000-4000-8000-000000000002', 'cs-viewer@example.invalid', 'viewer', true),
  ('c5100000-0000-4000-8000-000000000003', 'cs-inactive-admin@example.invalid', 'admin', true),
  ('c5100000-0000-4000-8000-000000000004', 'cs-disabled-admin@example.invalid', 'admin', false);

do $$
#variable_conflict use_variable
declare
  owner_one constant uuid := 'c5000000-0000-4000-8000-000000000001';
  owner_two constant uuid := 'c5000000-0000-4000-8000-000000000002';
  admin_user constant uuid := 'c5000000-0000-4000-8000-000000000003';
  viewer_user constant uuid := 'c5000000-0000-4000-8000-000000000004';
  inactive_fan constant uuid := 'c5000000-0000-4000-8000-000000000005';
  inactive_admin_user constant uuid := 'c5000000-0000-4000-8000-000000000006';
  disabled_admin_user constant uuid := 'c5000000-0000-4000-8000-000000000007';
  create_rate_user constant uuid := 'c5000000-0000-4000-8000-000000000008';
  message_rate_user constant uuid := 'c5000000-0000-4000-8000-000000000009';
  page_owner constant uuid := 'c5000000-0000-4000-8000-000000000010';
  operator_allowlist constant uuid := 'c5100000-0000-4000-8000-000000000001';
  viewer_allowlist constant uuid := 'c5100000-0000-4000-8000-000000000002';
  inactive_allowlist constant uuid := 'c5100000-0000-4000-8000-000000000003';
  disabled_allowlist constant uuid := 'c5100000-0000-4000-8000-000000000004';
  inquiry_id uuid;
  other_inquiry_id uuid;
  rate_inquiry_id uuid;
  page_inquiry_id uuid;
  message_id uuid;
  create_key uuid := extensions.gen_random_uuid();
  admin_post_key uuid := extensions.gen_random_uuid();
  fan_post_key uuid := extensions.gen_random_uuid();
  result jsonb;
  replay jsonb;
  item jsonb;
  cursor_time timestamptz;
  cursor_id uuid;
  version_before integer;
  i integer;
begin
  result := public.cs_create(owner_one, '  첫 문의  ', '  도움이 필요해요  ', 'ko', create_key);
  inquiry_id := (result->>'id')::uuid;
  if result->>'replayed' <> 'false'
    or (select i.subject from public.cs_inquiries i where i.id = inquiry_id) <> '첫 문의'
    or (select i.version from public.cs_inquiries i where i.id = inquiry_id) <> 1
    or (select i.status from public.cs_inquiries i where i.id = inquiry_id) <> 'open'
    or (select count(*) from public.cs_messages m where m.inquiry_id = inquiry_id) <> 1
    or (select m.body from public.cs_messages m where m.inquiry_id = inquiry_id) <> '도움이 필요해요' then
    raise exception 'Atomic inquiry creation contract failed';
  end if;

  replay := public.cs_create(owner_one, '첫 문의', '도움이 필요해요', 'ko', create_key);
  if replay->>'id' <> inquiry_id::text or replay->>'replayed' <> 'true'
    or (select count(*) from public.cs_messages m where m.inquiry_id = inquiry_id) <> 1 then
    raise exception 'Create replay changed state';
  end if;
  perform pg_temp.expect_error(format(
    'select public.cs_create(%L,%L,%L,%L,%L)', owner_one, '다른 제목', '도움이 필요해요', 'ko', create_key
  ), 'CS_IDEMPOTENCY_CONFLICT');
  perform pg_temp.expect_error(format(
    'select public.cs_create(%L,%L,%L,%L,%L)', owner_one, '첫 문의', '다른 본문', 'ko', create_key
  ), 'CS_IDEMPOTENCY_CONFLICT');
  perform pg_temp.expect_error(format(
    'select public.cs_create(%L,%L,%L,%L,%L)', owner_one, '첫 문의', '도움이 필요해요', 'en', create_key
  ), 'CS_IDEMPOTENCY_CONFLICT');
  perform pg_temp.expect_error(format(
    'select public.cs_post(%L,%L,%L,%L)', owner_one, inquiry_id, '도움이 필요해요', create_key
  ), 'CS_IDEMPOTENCY_CONFLICT');

  result := public.cs_read(owner_one, inquiry_id);
  perform pg_temp.assert_exact_keys(result, array['hasMore','inquiry','messages']);
  perform pg_temp.assert_exact_keys(result->'inquiry', array[
    'createdAt','id','locale','requesterName','status','subject','updatedAt','version'
  ]);
  perform pg_temp.assert_exact_keys(result->'messages'->0, array['body','createdAt','id','sender']);
  if result#>>'{inquiry,requesterName}' <> '문의팬'
    or result#>>'{messages,0,sender}' <> 'fan'
    or result->>'hasMore' <> 'false' then
    raise exception 'Owner read projection failed';
  end if;

  result := public.cs_list(owner_one);
  perform pg_temp.assert_exact_keys(result, array['hasMore','inquiries']);
  perform pg_temp.assert_exact_keys(result->'inquiries'->0, array[
    'createdAt','id','locale','requesterName','status','subject','updatedAt','version'
  ]);
  if jsonb_array_length(result->'inquiries') <> 1
    or result#>>'{inquiries,0,id}' <> inquiry_id::text then
    raise exception 'Owner list projection failed';
  end if;

  if jsonb_array_length(public.cs_list(owner_two)->'inquiries') <> 0 then
    raise exception 'Cross-owner list leaked an inquiry';
  end if;
  perform pg_temp.expect_error(format(
    'select public.cs_read(%L,%L)', owner_two, inquiry_id
  ), 'CS_NOT_FOUND');
  perform pg_temp.expect_error(format(
    'select public.cs_post(%L,%L,%L,%L)', owner_two, inquiry_id, '침입', extensions.gen_random_uuid()
  ), 'CS_NOT_FOUND');

  result := public.cs_list(viewer_user, viewer_allowlist);
  if jsonb_array_length(result->'inquiries') <> 1 then
    raise exception 'Viewer list was denied or incomplete';
  end if;
  result := public.cs_read(viewer_user, inquiry_id, viewer_allowlist);
  if result#>>'{inquiry,id}' <> inquiry_id::text then
    raise exception 'Viewer read was denied or incomplete';
  end if;
  perform pg_temp.expect_error(format(
    'select public.cs_post(%L,%L,%L,%L,%L,%L)', viewer_user, inquiry_id, 'viewer reply',
    extensions.gen_random_uuid(), viewer_allowlist, extensions.gen_random_uuid()
  ), 'CS_FORBIDDEN');
  perform pg_temp.expect_error(format(
    'select public.cs_resolve(%L,%L,%L,%s,%L)', viewer_user, viewer_allowlist,
    inquiry_id, 1, extensions.gen_random_uuid()
  ), 'CS_FORBIDDEN');

  perform pg_temp.expect_error(format(
    'select public.cs_list(%L,%L)', owner_two, operator_allowlist
  ), 'CS_FORBIDDEN');
  perform pg_temp.expect_error(format(
    'select public.cs_read(%L,%L,%L)', owner_two, inquiry_id, operator_allowlist
  ), 'CS_FORBIDDEN');
  perform pg_temp.expect_error(format(
    'select public.cs_post(%L,%L,%L,%L,%L,%L)', owner_two, inquiry_id, 'forged',
    extensions.gen_random_uuid(), operator_allowlist, extensions.gen_random_uuid()
  ), 'CS_FORBIDDEN');
  perform pg_temp.expect_error(format(
    'select public.cs_resolve(%L,%L,%L,%s,%L)', owner_two, operator_allowlist,
    inquiry_id, 1, extensions.gen_random_uuid()
  ), 'CS_FORBIDDEN');

  perform pg_temp.expect_error(format('select public.cs_list(%L)', inactive_fan), 'CS_FORBIDDEN');
  perform pg_temp.expect_error(format(
    'select public.cs_read(%L,%L)', inactive_fan, inquiry_id
  ), 'CS_FORBIDDEN');
  perform pg_temp.expect_error(format(
    'select public.cs_create(%L,%L,%L,%L,%L)', inactive_fan, '제목', '본문', 'ko', extensions.gen_random_uuid()
  ), 'CS_FORBIDDEN');
  perform pg_temp.expect_error(format(
    'select public.cs_post(%L,%L,%L,%L)', inactive_fan, inquiry_id, '본문', extensions.gen_random_uuid()
  ), 'CS_FORBIDDEN');
  perform pg_temp.expect_error(format(
    'select public.cs_list(%L,%L)', inactive_admin_user, inactive_allowlist
  ), 'CS_FORBIDDEN');
  perform pg_temp.expect_error(format(
    'select public.cs_post(%L,%L,%L,%L,%L,%L)', inactive_admin_user, inquiry_id,
    'inactive admin reply', extensions.gen_random_uuid(), inactive_allowlist, extensions.gen_random_uuid()
  ), 'CS_FORBIDDEN');
  perform pg_temp.expect_error(format(
    'select public.cs_list(%L,%L)', disabled_admin_user, disabled_allowlist
  ), 'CS_FORBIDDEN');
  perform pg_temp.expect_error(format(
    'select public.cs_resolve(%L,%L,%L,%s,%L)', disabled_admin_user, disabled_allowlist,
    inquiry_id, 1, extensions.gen_random_uuid()
  ), 'CS_FORBIDDEN');

  result := public.cs_post(
    admin_user, inquiry_id, '  관리자 답변  ', admin_post_key,
    operator_allowlist, extensions.gen_random_uuid()
  );
  message_id := (result->>'id')::uuid;
  if result->>'replayed' <> 'false'
    or (select i.status from public.cs_inquiries i where i.id = inquiry_id) <> 'answered'
    or (select i.version from public.cs_inquiries i where i.id = inquiry_id) <> 2 then
    raise exception 'Admin reply transition failed';
  end if;
  version_before := (select i.version from public.cs_inquiries i where i.id = inquiry_id);
  replay := public.cs_post(
    admin_user, inquiry_id, '관리자 답변', admin_post_key,
    operator_allowlist, extensions.gen_random_uuid()
  );
  if replay->>'id' <> message_id::text or replay->>'replayed' <> 'true'
    or (select i.version from public.cs_inquiries i where i.id = inquiry_id) <> version_before
    or (select count(*) from public.audit_logs
        where action = 'cs.inquiry.reply' and entity_id = inquiry_id::text) <> 1 then
    raise exception 'Admin reply replay changed state or audit';
  end if;
  perform pg_temp.expect_error(format(
    'select public.cs_post(%L,%L,%L,%L,%L,%L)', admin_user, inquiry_id, '다른 답변',
    admin_post_key, operator_allowlist, extensions.gen_random_uuid()
  ), 'CS_IDEMPOTENCY_CONFLICT');

  result := public.cs_create(owner_one, '두 번째 문의', '다른 문의', 'en', extensions.gen_random_uuid());
  other_inquiry_id := (result->>'id')::uuid;
  perform pg_temp.expect_error(format(
    'select public.cs_post(%L,%L,%L,%L,%L,%L)', admin_user, other_inquiry_id, '관리자 답변',
    admin_post_key, operator_allowlist, extensions.gen_random_uuid()
  ), 'CS_IDEMPOTENCY_CONFLICT');

  perform pg_temp.expect_error(format(
    'select public.cs_resolve(%L,%L,%L,%s,%L)', admin_user, operator_allowlist,
    inquiry_id, 1, extensions.gen_random_uuid()
  ), 'CS_STALE_VERSION');
  result := public.cs_resolve(
    admin_user, operator_allowlist, inquiry_id, 2, extensions.gen_random_uuid()
  );
  if result <> '{"resolved":true}'::jsonb
    or (select i.status from public.cs_inquiries i where i.id = inquiry_id) <> 'resolved'
    or (select i.version from public.cs_inquiries i where i.id = inquiry_id) <> 3 then
    raise exception 'Resolve transition failed';
  end if;

  result := public.cs_post(owner_one, inquiry_id, '  다시 문의합니다  ', fan_post_key);
  message_id := (result->>'id')::uuid;
  if result->>'replayed' <> 'false'
    or (select i.status from public.cs_inquiries i where i.id = inquiry_id) <> 'open'
    or (select i.version from public.cs_inquiries i where i.id = inquiry_id) <> 4 then
    raise exception 'Fan follow-up did not reopen the inquiry';
  end if;
  version_before := (select i.version from public.cs_inquiries i where i.id = inquiry_id);
  replay := public.cs_post(owner_one, inquiry_id, '다시 문의합니다', fan_post_key);
  if replay->>'id' <> message_id::text or replay->>'replayed' <> 'true'
    or (select i.version from public.cs_inquiries i where i.id = inquiry_id) <> version_before then
    raise exception 'Fan post replay changed inquiry state';
  end if;
  perform pg_temp.expect_error(format(
    'select public.cs_post(%L,%L,%L,%L)', owner_one, inquiry_id, '바뀐 본문', fan_post_key
  ), 'CS_IDEMPOTENCY_CONFLICT');
  perform pg_temp.expect_error(format(
    'select public.cs_post(%L,%L,%L,%L)', owner_one, other_inquiry_id, '다시 문의합니다', fan_post_key
  ), 'CS_IDEMPOTENCY_CONFLICT');
  perform pg_temp.expect_error(format(
    'select public.cs_create(%L,%L,%L,%L,%L)', owner_one, '첫 문의', '다시 문의합니다', 'ko', fan_post_key
  ), 'CS_IDEMPOTENCY_CONFLICT');

  result := public.cs_read(admin_user, inquiry_id, operator_allowlist);
  if result#>>'{inquiry,status}' <> 'open'
    or result#>>'{messages,1,sender}' <> 'admin'
    or result#>>'{messages,2,sender}' <> 'fan' then
    raise exception 'Conversation lifecycle sender ordering failed';
  end if;
  result := public.cs_list(admin_user, operator_allowlist, 'open');
  if not exists (
    select 1 from jsonb_array_elements(result->'inquiries') row
    where row->>'id' = inquiry_id::text
  ) then
    raise exception 'Admin status-filtered list omitted open inquiry';
  end if;

  if exists (
    select 1 from public.audit_logs
    where action in ('cs.inquiry.reply', 'cs.inquiry.resolve')
      and before_after_summary::text ~* '(body|subject|nickname|requester)'
  ) then
    raise exception 'CS admin audit leaked message or requester content';
  end if;
  if (select count(*) from public.audit_logs
      where action = 'cs.inquiry.reply' and entity_id = inquiry_id::text) <> 1
    or (select count(*) from public.audit_logs
      where action = 'cs.inquiry.resolve' and entity_id = inquiry_id::text) <> 1 then
    raise exception 'CS admin audit lifecycle count failed';
  end if;

  result := public.cs_create(create_rate_user, '문의 1', '본문', 'ko', extensions.gen_random_uuid());
  rate_inquiry_id := (result->>'id')::uuid;
  create_key := (select m.idempotency_key from public.cs_messages m where m.inquiry_id = rate_inquiry_id);
  for i in 2..5 loop
    perform public.cs_create(create_rate_user, '문의 ' || i, '본문', 'ko', extensions.gen_random_uuid());
  end loop;
  perform pg_temp.expect_error(format(
    'select public.cs_create(%L,%L,%L,%L,%L)', create_rate_user, '문의 6', '본문', 'ko', extensions.gen_random_uuid()
  ), 'CS_RATE_LIMITED');
  replay := public.cs_create(create_rate_user, '문의 1', '본문', 'ko', create_key);
  if replay->>'id' <> rate_inquiry_id::text or replay->>'replayed' <> 'true' then
    raise exception 'Create replay was rate-limited';
  end if;

  result := public.cs_create(message_rate_user, '메시지 제한', '첫 메시지', 'ko', extensions.gen_random_uuid());
  rate_inquiry_id := (result->>'id')::uuid;
  for i in 2..20 loop
    result := public.cs_post(message_rate_user, rate_inquiry_id, '메시지 ' || i, extensions.gen_random_uuid());
  end loop;
  fan_post_key := (select idempotency_key from public.cs_messages
    where id = (result->>'id')::uuid);
  perform pg_temp.expect_error(format(
    'select public.cs_post(%L,%L,%L,%L)', message_rate_user, rate_inquiry_id,
    '메시지 21', extensions.gen_random_uuid()
  ), 'CS_RATE_LIMITED');
  replay := public.cs_post(message_rate_user, rate_inquiry_id, '메시지 20', fan_post_key);
  if replay->>'id' <> result->>'id' or replay->>'replayed' <> 'true' then
    raise exception 'Message replay was rate-limited';
  end if;

  perform pg_temp.expect_error(format(
    'select public.cs_list(%L,null,%L)', owner_one, 'invalid'
  ), 'CS_INVALID_REQUEST');
  perform pg_temp.expect_error(format(
    'select public.cs_list(%L,null,null,%L,null)', owner_one, now()
  ), 'CS_INVALID_REQUEST');
  perform pg_temp.expect_error(format(
    'select public.cs_read(%L,%L,null,null,%L)', owner_one, inquiry_id, inquiry_id
  ), 'CS_INVALID_REQUEST');
  perform pg_temp.expect_error(format(
    'select public.cs_create(%L,%L,%L,%L,%L)', owner_one, '   ', '본문', 'ko', extensions.gen_random_uuid()
  ), 'CS_INVALID_REQUEST');
  perform pg_temp.expect_error(format(
    'select public.cs_post(%L,%L,%L,%L,null,%L)', owner_one, inquiry_id, '본문',
    extensions.gen_random_uuid(), extensions.gen_random_uuid()
  ), 'CS_INVALID_REQUEST');

  for i in 1..21 loop
    insert into public.cs_inquiries(
      id, app_user_id, subject, locale, status, version, created_at, updated_at
    ) values (
      ('c5200000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid,
      page_owner, '페이지 문의 ' || i, 'ko', 'open', 1,
      pg_catalog.clock_timestamp() - make_interval(secs => i),
      pg_catalog.clock_timestamp() - make_interval(secs => i)
    );
  end loop;
  result := public.cs_list(page_owner);
  if jsonb_array_length(result->'inquiries') <> 20 or result->>'hasMore' <> 'true' then
    raise exception 'Inquiry first page contract failed';
  end if;
  item := result->'inquiries'->19;
  cursor_time := (item->>'updatedAt')::timestamptz;
  cursor_id := (item->>'id')::uuid;
  replay := public.cs_list(page_owner, null, null, cursor_time, cursor_id);
  if jsonb_array_length(replay->'inquiries') <> 1 or replay->>'hasMore' <> 'false' then
    raise exception 'Inquiry second page contract failed';
  end if;

  page_inquiry_id := 'c5200000-0000-4000-8000-000000000001';
  for i in 1..51 loop
    insert into public.cs_messages(
      id, inquiry_id, actor_app_user_id, operation, body, idempotency_key, created_at
    ) values (
      ('c5300000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid,
      page_inquiry_id, page_owner, 'post', '페이지 메시지 ' || i,
      ('c5400000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid,
      pg_catalog.clock_timestamp() - make_interval(secs => i)
    );
  end loop;
  result := public.cs_read(page_owner, page_inquiry_id);
  if jsonb_array_length(result->'messages') <> 50 or result->>'hasMore' <> 'true'
    or result#>>'{messages,0,body}' <> '페이지 메시지 50'
    or result#>>'{messages,49,body}' <> '페이지 메시지 1' then
    raise exception 'Message first page ordering contract failed';
  end if;
  item := result->'messages'->0;
  replay := public.cs_read(
    page_owner, page_inquiry_id, null,
    (item->>'createdAt')::timestamptz, (item->>'id')::uuid
  );
  if jsonb_array_length(replay->'messages') <> 1 or replay->>'hasMore' <> 'false'
    or replay#>>'{messages,0,body}' <> '페이지 메시지 51' then
    raise exception 'Message second page contract failed';
  end if;

  raise notice 'PASS CS lifecycle, DTOs, ownership, admin roles, replay/conflict, version, rate limits, audit and pagination';
end $$;

do $$
declare
  role_name text;
  denied boolean;
begin
  foreach role_name in array array['anon', 'authenticated', 'service_role'] loop
    execute format('set local role %I', role_name);
    denied := false;
    begin
      perform 1 from public.cs_inquiries limit 1;
    exception when insufficient_privilege then
      denied := true;
    end;
    if not denied then
      raise exception '% retained direct cs_inquiries SELECT', role_name;
    end if;
    denied := false;
    begin
      insert into public.cs_messages(
        inquiry_id, actor_app_user_id, operation, body, idempotency_key
      ) values (
        'c5200000-0000-4000-8000-000000000001',
        'c5000000-0000-4000-8000-000000000010',
        'post', '직접 쓰기', extensions.gen_random_uuid()
      );
    exception when insufficient_privilege then
      denied := true;
    end;
    if not denied then
      raise exception '% retained direct cs_messages INSERT', role_name;
    end if;
    reset role;
  end loop;

  if not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'cs_inquiries'
      and c.relrowsecurity and c.relforcerowsecurity
  ) or not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'cs_messages'
      and c.relrowsecurity and c.relforcerowsecurity
  ) then
    raise exception 'CS table RLS is not enabled and forced';
  end if;

  if has_function_privilege('public', 'public.cs_list(uuid,uuid,text,timestamptz,uuid)', 'EXECUTE')
    or has_function_privilege('anon', 'public.cs_read(uuid,uuid,uuid,timestamptz,uuid)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.cs_create(uuid,text,text,text,uuid)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.cs_post(uuid,uuid,text,uuid,uuid,uuid)', 'EXECUTE')
    or has_function_privilege('anon', 'public.cs_resolve(uuid,uuid,uuid,integer,uuid)', 'EXECUTE') then
    raise exception 'Browser/public role can execute a CS RPC';
  end if;
  if not has_function_privilege('service_role', 'public.cs_list(uuid,uuid,text,timestamptz,uuid)', 'EXECUTE')
    or not has_function_privilege('service_role', 'public.cs_read(uuid,uuid,uuid,timestamptz,uuid)', 'EXECUTE')
    or not has_function_privilege('service_role', 'public.cs_create(uuid,text,text,text,uuid)', 'EXECUTE')
    or not has_function_privilege('service_role', 'public.cs_post(uuid,uuid,text,uuid,uuid,uuid)', 'EXECUTE')
    or not has_function_privilege('service_role', 'public.cs_resolve(uuid,uuid,uuid,integer,uuid)', 'EXECUTE') then
    raise exception 'service_role is missing a CS RPC grant';
  end if;
  if has_function_privilege('anon', 'public.assert_active_admin(uuid,uuid,boolean)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.assert_active_admin(uuid,uuid,boolean)', 'EXECUTE')
    or not has_function_privilege('service_role', 'public.assert_active_admin(uuid,uuid,boolean)', 'EXECUTE') then
    raise exception 'Admin assertion helper grant changed';
  end if;

  -- The independent anonymous business inquiry boundary remains unchanged.
  if has_function_privilege('anon', 'public.submit_business_inquiry(uuid,text,text,text,text,text,boolean,text,text)', 'EXECUTE')
    or not has_function_privilege('service_role', 'public.submit_business_inquiry(uuid,text,text,text,text,text,boolean,text,text)', 'EXECUTE') then
    raise exception 'Anonymous business inquiry RPC ACL changed';
  end if;

  raise notice 'PASS CS table/RLS/RPC/helper ACL and unchanged business inquiry boundary';
end $$;

select jsonb_build_object(
  'status', 'PASS',
  'suite', 'cs_inquiries',
  'syntheticOnly', true
) as cs_inquiries_result;

rollback;
