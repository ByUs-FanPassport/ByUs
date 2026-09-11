-- Local disposable-database contract test. All test-created changes roll back.
-- Migration-time backfill is also asserted when the optional fixed upgrade
-- fixture is present (the clean-chain harness supplies it before migration).
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
  if not caught then raise exception 'Expected error was not raised: %', expected; end if;
end;
$$;

do $$
declare
  v_notice public.celebrity_notices%rowtype;
begin
  if not exists (
    select 1 from public.celebrities
    where id = 'a9132406-0000-4000-8000-000000000001'
  ) then
    return;
  end if;

  select * into strict v_notice
  from public.celebrity_notices
  where celebrity_id = 'a9132406-0000-4000-8000-000000000001'
    and notice_kind = 'welcome';

  if v_notice.publication_status <> 'published'
     or not v_notice.pinned
     or v_notice.archived_at is not null then
    raise exception 'Existing published creator was not backfilled with a visible pinned welcome';
  end if;
  if (select count(*) from public.celebrity_notice_localizations where notice_id = v_notice.id) <> 2 then
    raise exception 'Backfilled welcome is missing a locale';
  end if;
end;
$$;

do $$
declare
  v_future uuid := 'a9132406-0000-4000-8000-000000000010';
  v_delayed uuid := 'a9132406-0000-4000-8000-000000000015';
  v_draft uuid := 'a9132406-0000-4000-8000-000000000020';
  v_archived_creator uuid := 'a9132406-0000-4000-8000-000000000030';
  v_admin uuid := 'a9132406-0000-4000-8000-000000000040';
  v_notice uuid;
  v_archived_notice uuid;
  v_standard uuid := 'a9132406-0000-4000-8000-000000000011';
  v_body jsonb;
  v_role text;
  v_denied boolean;
begin
  insert into public.admin_allowlist(id,email,role,active)
  values(v_admin,'welcome-test@example.invalid','operator',true);

  insert into public.celebrities(id,slug,status,image_url,roles,primary_role) values
    (v_draft,'welcome-draft-fixture','draft','/fixture.webp','{creator}','creator'),
    (v_future,'welcome-future-fixture','draft','/fixture.webp','{creator}','creator'),
    (v_archived_creator,'welcome-archive-fixture','draft','/fixture.webp','{creator}','creator');
  insert into public.celebrity_localizations(celebrity_id,locale,name,summary,image_alt) values
    (v_draft,'ko','드래프트 셀럽','드래프트 검증','드래프트 셀럽'),
    (v_draft,'en','Draft Creator','Draft verification','Draft Creator'),
    (v_future,'ko','새 셀럽','게시 검증','새 셀럽'),
    (v_future,'en','New Creator','Publication verification','New Creator'),
    (v_archived_creator,'ko','보관 셀럽','보관 검증','보관 셀럽'),
    (v_archived_creator,'en','Archived Creator','Archive verification','Archived Creator');

  set constraints all immediate;
  if exists (select 1 from public.celebrity_notices where celebrity_id = v_draft and notice_kind = 'welcome') then
    raise exception 'Draft creator received a welcome';
  end if;

  -- A published creator row may precede its localized names in the same
  -- transaction. The deferred welcome trigger must observe the completed rowset.
  set constraints all deferred;
  insert into public.celebrities(
    id,slug,status,image_url,published_at,ever_published_at,roles,primary_role
  ) values (
    v_delayed,'welcome-delayed-locales','published','/fixture.webp',now(),now(),'{creator}','creator'
  );
  insert into public.celebrity_localizations(celebrity_id,locale,name,summary,image_alt) values
    (v_delayed,'ko','지연 현지화','지연 현지화 검증','지연 현지화'),
    (v_delayed,'en','Delayed Localization','Delayed localization verification','Delayed Localization');

  -- Occupying the preferred slug must not reclassify or overwrite editorial copy.
  insert into public.celebrity_notices(id,celebrity_id,slug,publication_status,pinned)
  values(v_standard,v_future,'welcome-byus','draft',false);
  insert into public.celebrity_notice_localizations(notice_id,locale,title,body_json) values
    (v_standard,'ko','운영자가 만든 공지','{"type":"doc","content":[]}'::jsonb),
    (v_standard,'en','Operator notice','{"type":"doc","content":[]}'::jsonb);

  -- Match the BFF's effective database role. Deferred trigger execution must
  -- not depend on direct service_role EXECUTE for the internal bootstrap RPC.
  execute 'set local role service_role';
  update public.celebrities set status = 'published' where id = v_future;
  set constraints celebrities_ensure_welcome_notice immediate;
  execute 'reset role';
  -- Flush unrelated legacy publication validators as the migration owner. The
  -- welcome constraint above is the only service_role boundary owned here.
  set constraints all immediate;
  if (select count(*) from public.celebrity_notices where celebrity_id=v_delayed and notice_kind='welcome') <> 1 then
    raise exception 'Deferred publication did not observe delayed localizations';
  end if;
  select id into strict v_notice from public.celebrity_notices
  where celebrity_id = v_future and notice_kind = 'welcome';

  if (select count(*) from public.celebrity_notices where celebrity_id = v_future and notice_kind = 'welcome') <> 1 then
    raise exception 'Future publication did not create exactly one semantic welcome';
  end if;
  if (select notice_kind from public.celebrity_notices where id = v_standard) <> 'standard'
     or (select title from public.celebrity_notice_localizations where notice_id=v_standard and locale='ko') <> '운영자가 만든 공지' then
    raise exception 'Preferred slug collision changed editorial content';
  end if;
  if (select slug from public.celebrity_notices where id=v_notice) = 'welcome-byus' then
    raise exception 'Welcome reused an occupied editorial slug';
  end if;

  if (select title from public.celebrity_notice_localizations where notice_id=v_notice and locale='ko')
       <> '새 셀럽 팬페이지에 오신 걸 환영해요'
     or (select title from public.celebrity_notice_localizations where notice_id=v_notice and locale='en')
       <> 'Welcome to New Creator''s fan page' then
    raise exception 'Welcome titles are not localized from creator names';
  end if;
  select body_json into v_body from public.celebrity_notice_localizations
  where notice_id=v_notice and locale='ko';
  if v_body #>> '{content,0,content,0,text}' <> '여기는 새 셀럽님을 좋아하는 팬들이 소식을 확인하고, 함께한 순간을 기록하는 공간이에요.'
     or v_body #>> '{content,1,content,0,text}' <> '팬 인증을 마치고 나만의 팬 패스포트를 만들어 보세요.'
     or v_body #>> '{content,2,type}' <> 'heading'
     or v_body #>> '{content,2,attrs,level}' <> '2'
     or v_body #>> '{content,2,content,0,text}' <> '어떤 순간에 팬이 되셨나요?'
     or v_body #>> '{content,3,content,0,text}' <> '처음 좋아하게 된 영상이나 기억을 댓글로 남겨주세요. 짧은 인사도 좋아요.'
     or v_body #>> '{content,4,content,0,text}' <> 'ByUs 운영팀' then
    raise exception 'KO Tiptap welcome body mismatch';
  end if;
  select body_json into v_body from public.celebrity_notice_localizations
  where notice_id=v_notice and locale='en';
  if v_body #>> '{content,0,content,0,text}' <> 'This is a place for fans of New Creator to catch up on news and keep a record of the moments they''ve shared.'
     or v_body #>> '{content,1,content,0,text}' <> 'Complete fan verification to create your fan passport.'
     or v_body #>> '{content,2,content,0,text}' <> 'What made you a fan?'
     or v_body #>> '{content,3,content,0,text}' <> 'Share the video or memory that started it all in the comments. A quick hello is welcome too.'
     or v_body #>> '{content,4,content,0,text}' <> 'The ByUs Team' then
    raise exception 'EN Tiptap welcome body mismatch';
  end if;

  if (select count(*) from public.audit_logs where action='notice.welcome.created' and entity_id=v_notice::text) <> 1 then
    raise exception 'System welcome audit missing or duplicated';
  end if;

  -- Operator-hidden content stays hidden and retains edits across creator cycles.
  update public.celebrity_notice_localizations set title='운영자 수정 제목'
  where notice_id=v_notice and locale='ko';
  update public.celebrity_notices
  set publication_status='draft', published_at=null, pinned=false
  where id=v_notice;
  update public.celebrities set status='draft' where id=v_future;
  update public.celebrities set status='published' where id=v_future;
  if (select count(*) from public.celebrity_notices where celebrity_id=v_future and notice_kind='welcome') <> 1
     or (select publication_status from public.celebrity_notices where id=v_notice) <> 'draft'
     or (select pinned from public.celebrity_notices where id=v_notice)
     or (select title from public.celebrity_notice_localizations where notice_id=v_notice and locale='ko') <> '운영자 수정 제목' then
    raise exception 'Republish replaced operator edits or hidden state';
  end if;
  perform pg_temp.expect_error(
    format('update public.celebrity_notices set celebrity_id=%L where id=%L',v_draft,v_notice),
    'welcome notice celebrity is immutable'
  );
  if (select celebrity_id from public.celebrity_notices where id=v_notice) <> v_future then
    raise exception 'Hidden welcome moved to another creator';
  end if;

  update public.celebrities set status='published' where id=v_archived_creator;
  select id into strict v_archived_notice from public.celebrity_notices
  where celebrity_id=v_archived_creator and notice_kind='welcome';
  update public.celebrity_notices
  set publication_status='draft', published_at=null, pinned=false,
      archived_at=now(), archived_by_admin_allowlist_id=v_admin,
      archive_reason='operator archived welcome intent'
  where id=v_archived_notice;
  update public.celebrities set status='draft' where id=v_archived_creator;
  update public.celebrities set status='published' where id=v_archived_creator;
  if (select count(*) from public.celebrity_notices where celebrity_id=v_archived_creator and notice_kind='welcome') <> 1
     or (select archived_at from public.celebrity_notices where id=v_archived_notice) is null then
    raise exception 'Republish replaced archived welcome intent';
  end if;

  perform pg_temp.expect_error(
    format('insert into public.celebrity_notices(celebrity_id,slug,notice_kind) values(%L,%L,%L)',v_future,'second-welcome','welcome'),
    'duplicate key value'
  );
  perform pg_temp.expect_error(
    format('update public.celebrity_notices set notice_kind=%L where id=%L','standard',v_notice),
    'notice kind is immutable'
  );

  if has_table_privilege('anon','public.celebrity_notices','SELECT')
     or has_table_privilege('authenticated','public.celebrity_notices','SELECT')
     or has_function_privilege('anon','public.ensure_celebrity_welcome_notice(uuid)','EXECUTE')
     or has_function_privilege('authenticated','public.ensure_celebrity_welcome_notice(uuid)','EXECUTE')
     or has_function_privilege('anon','public.ensure_celebrity_welcome_notice_trigger()','EXECUTE')
     or has_function_privilege('authenticated','public.enforce_celebrity_notice_kind_immutable()','EXECUTE') then
    raise exception 'Welcome storage or internal functions exposed to browser roles';
  end if;

  foreach v_role in array array['anon','authenticated'] loop
    execute format('set local role %I', v_role);
    v_denied := false;
    begin
      execute 'select notice_kind from public.celebrity_notices limit 1';
    exception when insufficient_privilege then
      v_denied := true;
    end;
    execute 'reset role';
    if not v_denied then raise exception 'Role % directly read private notices', v_role; end if;

    execute format('set local role %I', v_role);
    v_denied := false;
    begin
      execute format('select public.ensure_celebrity_welcome_notice(%L)', v_future);
    exception when insufficient_privilege then
      v_denied := true;
    end;
    execute 'reset role';
    if not v_denied then raise exception 'Role % directly called internal welcome bootstrap', v_role; end if;
  end loop;
end;
$$;

rollback;
