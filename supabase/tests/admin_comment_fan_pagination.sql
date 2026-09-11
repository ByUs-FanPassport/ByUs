-- Admin comment and member pagination regression.
-- Run with psql -v ON_ERROR_STOP=1 against a disposable clean-replay database.
-- All fixtures are rolled back.
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
end;
$$;

do $$
declare
  actor uuid := 'ac000000-0000-4000-8000-000000000001';
  fan uuid := 'ac000000-0000-4000-8000-000000000002';
  allowlist uuid := 'ac000000-0000-4000-8000-000000000003';
  creator uuid := 'ac000000-0000-4000-8000-000000000004';
  notice uuid := 'ac000000-0000-4000-8000-000000000005';
  first_page jsonb;
  second_page jsonb;
  cursor_at timestamptz;
  cursor_id uuid;
begin
  insert into public.app_users(id, privy_user_id, verified_email, status, created_at) values
    (actor, 'did:privy:admin-comment-page-actor', 'admin-comment-page@byus.test', 'active', '2099-02-01 00:00:00+00'),
    (fan, 'did:privy:admin-comment-page-fan', 'admin-comment-fan@byus.test', 'active', '2099-02-01 00:00:00+00');
  insert into public.admin_allowlist(id, email, role, active)
    values(allowlist, 'admin-comment-page@byus.test', 'viewer', true);
  insert into public.celebrities(id, slug, status, image_url, published_at, roles, primary_role)
    values(creator, 'admin-comment-page', 'published', '/admin-comment-page.webp', now(), '{artist}', 'idol');
  insert into public.celebrity_notices(id, celebrity_id, slug, publication_status, published_at, ever_published_at)
    values(notice, creator, 'tied-comments', 'published', now(), now());
  insert into public.celebrity_notice_comments(
    id, notice_id, app_user_id, body, idempotency_key, created_at
  ) values
    ('ac100000-0000-4000-8000-000000000001', notice, fan, 'tie 1', 'ac200000-0000-4000-8000-000000000001', '2099-02-02 00:00:00+00'),
    ('ac100000-0000-4000-8000-000000000002', notice, fan, 'tie 2', 'ac200000-0000-4000-8000-000000000002', '2099-02-02 00:00:00+00'),
    ('ac100000-0000-4000-8000-000000000003', notice, fan, 'tie 3', 'ac200000-0000-4000-8000-000000000003', '2099-02-02 00:00:00+00');

  first_page := public.read_admin_notice_comments(
    actor, allowlist, 'admin-comment-page', null, null, 2
  );
  if jsonb_array_length(first_page->'comments') <> 2
     or first_page#>>'{comments,0,id}' <> 'ac100000-0000-4000-8000-000000000003'
     or first_page#>>'{comments,1,id}' <> 'ac100000-0000-4000-8000-000000000002' then
    raise exception 'admin comment first tuple page changed';
  end if;
  cursor_at := (first_page#>>'{comments,1,createdAt}')::timestamptz;
  cursor_id := (first_page#>>'{comments,1,id}')::uuid;
  second_page := public.read_admin_notice_comments(
    actor, allowlist, 'admin-comment-page', cursor_at, cursor_id, 2
  );
  if jsonb_array_length(second_page->'comments') <> 1
     or second_page#>>'{comments,0,id}' <> 'ac100000-0000-4000-8000-000000000001' then
    raise exception 'admin comment tuple cursor skipped or repeated a timestamp tie';
  end if;

  perform pg_temp.expect_error(
    format(
      'select public.read_admin_notice_comments(%L,%L,%L,null,null,2)',
      fan, allowlist, 'admin-comment-page'
    ),
    'active admin required'
  );
  perform pg_temp.expect_error(
    format(
      'select public.read_admin_notice_comments(%L,%L,%L,%L,null,2)',
      actor, allowlist, 'admin-comment-page', cursor_at
    ),
    'FANPAGE_INVALID_REQUEST'
  );

  -- 101 is the internal lookahead size for an HTTP page of 100.
  perform public.get_admin_fans(
    actor, allowlist, 'ac300000-0000-4000-8000-000000000001',
    'ko', null, null, null, null, null, 101
  );
  perform pg_temp.expect_error(
    format(
      'select public.get_admin_fans(%L,%L,%L,''ko'',null,null,null,null,null,102)',
      actor, allowlist, 'ac300000-0000-4000-8000-000000000002'
    ),
    'invalid fan operations request'
  );

  if has_function_privilege(
       'anon',
       'public.read_admin_notice_comments(uuid,uuid,text,timestamptz,uuid,integer)',
       'EXECUTE'
     )
     or has_function_privilege(
       'authenticated',
       'public.read_admin_notice_comments(uuid,uuid,text,timestamptz,uuid,integer)',
       'EXECUTE'
     )
     or not has_function_privilege(
       'service_role',
       'public.read_admin_notice_comments(uuid,uuid,text,timestamptz,uuid,integer)',
       'EXECUTE'
     ) then
    raise exception 'admin comment pagination RPC privilege boundary changed';
  end if;
end;
$$;

select 'admin comment and fan pagination verification passed' as result;
rollback;
