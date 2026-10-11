\set ON_ERROR_STOP on
begin;

create function pg_temp.expect_error(statement text, expected text) returns void
language plpgsql as $$
declare caught boolean := false;
begin
  begin execute statement;
  exception when others then
    if position(expected in sqlerrm) = 0 then
      raise exception 'Unexpected error %, wanted %', sqlerrm, expected;
    end if;
    caught := true;
  end;
  if not caught then raise exception 'Expected error was not raised: %', expected; end if;
end $$;

create function pg_temp.brand_questions() returns jsonb language sql immutable as $$
  select jsonb_agg(jsonb_build_object(
    'position', q, 'promptKo', '질문 '||q, 'promptEn', 'Question '||q, 'active', true,
    'options', (select jsonb_agg(jsonb_build_object(
      'position', o, 'labelKo', '보기 '||o, 'labelEn', 'Option '||o,
      'isCorrect', o=1, 'active', true
    ) order by o) from generate_series(1,4) o)
  ) order by q) from generate_series(1,3) q
$$;

create function pg_temp.complete_brand_quiz(
  p_app_user_id uuid,p_celebrity_id uuid,p_source_type text,p_source_id uuid,p_stamp_id uuid
) returns jsonb language plpgsql as $$
declare
  v_attempt_id uuid;
  answer record;
  result jsonb;
begin
  perform public.start_owned_quiz_attempt_v2(
    p_app_user_id,'runmusic',extensions.gen_random_uuid(),p_source_type,p_source_id
  );
  select id into strict v_attempt_id from public.quiz_attempts
  where app_user_id=p_app_user_id and celebrity_id=p_celebrity_id and status='open';
  for answer in
    select question.id question_id,option.id option_id
    from public.quiz_attempt_questions question
    join public.quiz_attempt_options option
      on option.attempt_question_id=question.id and option.is_correct
    where question.attempt_id=v_attempt_id
  loop
    perform public.save_owned_quiz_answer(
      p_app_user_id,v_attempt_id,answer.question_id,answer.option_id
    );
  end loop;
  result:=public.submit_owned_quiz_attempt(
    p_app_user_id,v_attempt_id,p_stamp_id,
    'byus:passport:v1:'||p_app_user_id::text||':runmusic',
    '0x'||encode(extensions.digest('passport:'||p_app_user_id::text,'sha256'),'hex'),
    'byus:stamp:v1:'||p_stamp_id::text,
    '0x'||encode(extensions.digest('stamp:'||p_stamp_id::text,'sha256'),'hex')
  );
  if result is distinct from public.submit_owned_quiz_attempt(
    p_app_user_id,v_attempt_id,p_stamp_id,
    'byus:passport:v1:'||p_app_user_id::text||':runmusic',
    '0x'||encode(extensions.digest('passport:'||p_app_user_id::text,'sha256'),'hex'),
    'byus:stamp:v1:'||p_stamp_id::text,
    '0x'||encode(extensions.digest('stamp:'||p_stamp_id::text,'sha256'),'hex')
  ) then
    raise exception 'brand quiz submit replay changed its result';
  end if;
  return result;
end $$;

do $$
declare
  actor uuid := '95500000-0000-4000-8000-000000000001';
  viewer uuid := '95500000-0000-4000-8000-000000000002';
  fan uuid := '95500000-0000-4000-8000-000000000003';
  correlation uuid := '95500000-0000-4000-8000-000000000004';
  native_fan uuid := '95500000-0000-4000-8000-000000000005';
  legacy_null uuid := '95500000-0000-4000-8000-000000000006';
  binding_id uuid := '95500000-0000-4000-8000-000000000007';
  legacy_reaction uuid := '95500000-0000-4000-8000-000000000008';
  legacy_job uuid := '95500000-0000-4000-8000-000000000009';
  native_reaction uuid := '95500000-0000-4000-8000-000000000010';
  native_job uuid := '95500000-0000-4000-8000-000000000011';
  no_reaction_fan uuid := '95500000-0000-4000-8000-000000000012';
  after_reaction_fan uuid := '95500000-0000-4000-8000-000000000013';
  after_reaction uuid := '95500000-0000-4000-8000-000000000014';
  after_job uuid := '95500000-0000-4000-8000-000000000015';
  brand_id uuid;
  draft_id uuid;
  person_id uuid;
  quiz_id uuid;
  post_id uuid;
  result jsonb;
  brand_payload jsonb := '{
    "slug":"runmusic",
    "imageUrl":"/images/brand-fanpages/runmusic/official-profile.jpg",
    "imagePosition":"center",
    "displayOrder":501,
    "fanCount":0,
    "roles":["artist"],
    "primaryRole":"brand",
    "websiteUrl":"https://runmusicfestival.localvibehub.com/run-music",
    "localizations":{
      "ko":{"name":"RUN&MUSIC FESTIVAL","summary":"러닝과 걷기, 음악을 함께 즐기는 페스티벌입니다. 2026년 10월 24일 경북 안동에서 만나요.","imageAlt":"RUN&MUSIC FESTIVAL 공식 프로필 이미지"},
      "en":{"name":"RUN&MUSIC FESTIVAL","summary":"A festival of running, walking and music. Join us in Andong, Gyeongsangbuk-do, on October 24, 2026.","imageAlt":"Official RUN&MUSIC FESTIVAL profile image"}
    },
    "themes":[],
    "socialLinks":[
      {"platform":"instagram","url":"https://www.instagram.com/runmusicfestival/","position":0,"active":true},
      {"platform":"youtube","url":"https://www.youtube.com/@RUNMUSICFESTIVAL","position":1,"active":true}
    ]
  }'::jsonb;
  person_payload jsonb := '{
    "slug":"person-fanpage-proof",
    "imageUrl":"/person-proof.jpg",
    "imagePosition":"center",
    "displayOrder":502,
    "fanCount":1,
    "primaryRole":"actor",
    "localizations":{
      "ko":{"name":"인물 검증","summary":"인물 팬페이지","imageAlt":"인물 사진"},
      "en":{"name":"Person proof","summary":"Person fan page","imageAlt":"Person photo"}
    },
    "themes":[],
    "socialLinks":[]
  }'::jsonb;
begin
  insert into public.admin_allowlist(id,email,role,active) values
    (actor,'brand-fanpage-admin@byus.test','admin',true),
    (viewer,'brand-fanpage-viewer@byus.test','viewer',true);
  insert into public.app_users(id,privy_user_id,verified_email) values
    (fan,'did:privy:brand-fanpage-proof','brand-fanpage-fan@byus.test'),
    (native_fan,'did:privy:brand-fanpage-native','brand-fanpage-native@byus.test'),
    (no_reaction_fan,'did:privy:brand-fanpage-no-reaction','brand-fanpage-no-reaction@byus.test'),
    (after_reaction_fan,'did:privy:brand-fanpage-after-reaction','brand-fanpage-after-reaction@byus.test');
  insert into public.user_wallets(app_user_id,chain_id,address) values
    (fan,91342,'0x9550000000000000000000000000000000000003'),
    (native_fan,91342,'0x9550000000000000000000000000000000000005'),
    (no_reaction_fan,91342,'0x9550000000000000000000000000000000000012'),
    (after_reaction_fan,91342,'0x9550000000000000000000000000000000000013');

  insert into public.celebrities(id,slug,image_url,roles)
  values(legacy_null,'brand-null-role-proof','/null-role.jpg','{artist}');
  perform pg_temp.expect_error(format(
    'update public.celebrities set primary_role=''brand'',roles=''{brand}'' where id=%L',legacy_null
  ), 'existing person and brand profiles cannot be converted');

  if exists(select 1 from public.celebrities where slug='runmusic') then
    raise exception 'runmusic handle is unavailable in the clean registration fixture';
  end if;

  result := public.save_admin_celebrity(actor,correlation,null,brand_payload);
  brand_id := (result->>'id')::uuid;
  if result->>'primaryRole' <> 'brand'
    or result->'roles' <> '["brand"]'::jsonb
    or result->>'websiteUrl' <> 'https://runmusicfestival.localvibehub.com/run-music' then
    raise exception 'brand create mapping or website projection failed: %', result;
  end if;

  result := public.save_admin_celebrity(actor,correlation,brand_id,brand_payload-'websiteUrl');
  if result->>'websiteUrl' <> 'https://runmusicfestival.localvibehub.com/run-music' then
    raise exception 'omitted websiteUrl did not preserve the stored value';
  end if;
  if (public.read_admin_celebrity_cms(actor,brand_id)->0)->>'websiteUrl'
    <> 'https://runmusicfestival.localvibehub.com/run-music' then
    raise exception 'admin CMS read lost websiteUrl';
  end if;

  perform pg_temp.expect_error(format(
    'select public.save_admin_celebrity(%L,%L,%L,%L::jsonb)',
    actor,correlation,brand_id,jsonb_set(brand_payload,'{websiteUrl}','"http://brand.example"')::text
  ), 'celebrities_website_url_https');
  perform pg_temp.expect_error(format(
    'select public.save_admin_celebrity(%L,%L,%L,%L::jsonb)',
    actor,correlation,brand_id,jsonb_set(brand_payload,'{websiteUrl}','"https://user@brand.example"')::text
  ), 'celebrities_website_url_https');
  perform pg_temp.expect_error(format(
    'select public.save_admin_celebrity(%L,%L,%L,%L::jsonb)',
    actor,correlation,brand_id,jsonb_set(brand_payload,'{websiteUrl}','"https://brand.example/a b"')::text
  ), 'celebrities_website_url_https');

  perform pg_temp.expect_error(format(
    'select public.save_admin_celebrity(%L,%L,null,%L::jsonb)',
    actor,correlation,brand_payload::text
  ), 'duplicate key');
  perform pg_temp.expect_error(format(
    'select public.save_admin_celebrity(%L,%L,%L,%L::jsonb)',
    viewer,correlation,brand_id,brand_payload::text
  ), 'active authorized content administrator required');

  perform public.set_admin_celebrity_publication(actor,correlation,brand_id,true);
  set constraints all immediate;
  if exists(select 1 from public.celebrity_quizzes where celebrity_id=brand_id)
    or (select count(*) from public.published_celebrities
      where slug='runmusic' and primary_role='brand'
        and website_url='https://runmusicfestival.localvibehub.com/run-music') <> 2 then
    raise exception 'brand did not publish without a quiz or public projection is incomplete';
  end if;
  perform public.ensure_celebrity_welcome_notice(brand_id);
  perform public.ensure_celebrity_welcome_notice(brand_id);
  if exists(select 1 from public.celebrity_notices
    where celebrity_id=brand_id and notice_kind='welcome') then
    raise exception 'brand publication or direct ensure created a passport welcome notice';
  end if;
  set constraints all deferred;

  perform public.save_admin_quiz_version(actor,correlation,brand_id,null,pg_temp.brand_questions());
  select id into quiz_id from public.celebrity_quizzes where celebrity_id=brand_id and version=1;
  perform public.publish_admin_quiz_version(actor,correlation,brand_id,quiz_id);
  perform pg_temp.expect_error(format(
    'update public.celebrities set primary_role=''actor'',roles=''{artist}'' where id=%L',brand_id
  ), 'existing person and brand profiles cannot be converted');
  perform pg_temp.expect_error(format(
    'update public.celebrities set roles=''{artist}'' where id=%L',brand_id
  ), 'celebrities_brand_role_consistency');

  insert into public.fan_ticket_activity_policy(celebrity_id) values(brand_id);
  result := public.react_to_creator(fan,brand_id,legacy_reaction,legacy_job,'0x'||repeat('a',64));
  if result->>'created' <> 'true' or result->>'blockchainJobId' <> legacy_job::text then
    raise exception 'brand legacy reaction was not created: %',result;
  end if;
  result := public.react_to_creator(fan,brand_id,legacy_reaction,legacy_job,'0x'||repeat('a',64));
  if result->>'created' <> 'false' or result->>'reactionId' <> legacy_reaction::text then
    raise exception 'brand legacy reaction replay failed: %',result;
  end if;

  insert into public.fan_action_bindings(
    id,chain_id,environment_id,hub_proxy,relayer,schema_uid,schema_version,
    binding_version,asset_base_uri,assets
  ) values (
    binding_id,91342,'0x'||repeat('1',64),'0x'||repeat('2',40),
    '0x'||repeat('3',40),'0x'||repeat('4',64),1,1,'ipfs://bafybeibrandfanpage',
    jsonb_build_object(
      '0','0x9550000000000000000000000000000000000010',
      '1','0x9550000000000000000000000000000000000011',
      '2','0x9550000000000000000000000000000000000012'
    )
  );
  insert into public.fan_action_producer_routes(action_code,binding_id,enabled,policy_version,enabled_at)
  values(6,binding_id,true,1,now());
  insert into public.fan_action_verified_creators(
    binding_id,creator_id,verified_block_number,verified_block_hash,verified_at
  ) values(binding_id,brand_id,1,'0x'||repeat('5',64),now());
  result := public.react_to_creator(native_fan,brand_id,native_reaction,native_job,'0x'||repeat('b',64));
  if result->>'created' <> 'true' or result->>'fanActionOutboxId' is null
    or result->'blockchainJobId' <> 'null'::jsonb then
    raise exception 'brand native reaction was not created: %',result;
  end if;
  result := public.react_to_creator(native_fan,brand_id,native_reaction,native_job,'0x'||repeat('b',64));
  if result->>'created' <> 'false' or result->>'reactionId' <> native_reaction::text then
    raise exception 'brand native reaction replay failed: %',result;
  end if;
  if (select count(*) from public.fan_reactions where celebrity_id=brand_id
    and app_user_id in (fan,native_fan)) <> 2 then
    raise exception 'brand reaction rows were not persisted once per fan';
  end if;

  result := public.save_fan_post(fan,'runmusic',null,'브랜드 게시물','public','{}',null,extensions.gen_random_uuid());
  post_id := (result->>'id')::uuid;
  perform public.post_fan_post_comment(fan,post_id,null,'브랜드 댓글',extensions.gen_random_uuid());
  perform public.set_fan_post_like(fan,post_id,true);
  if public.recover_first_comment_community_stamp(fan,brand_id) then
    raise exception 'brand first comment stamp recovery succeeded';
  end if;
  if exists(select 1 from public.community_stamps where app_user_id in (fan,native_fan) and celebrity_id=brand_id)
    or exists(select 1 from public.fan_ticket_activity_awards where app_user_id in (fan,native_fan) and celebrity_id=brand_id)
    or exists(select 1 from public.fan_score_ledger where app_user_id in (fan,native_fan) and celebrity_id=brand_id)
    or exists(select 1 from public.fan_passports where app_user_id in (fan,native_fan) and celebrity_id=brand_id)
    or (select count(*) from public.first_reaction_stamps
      where app_user_id in (fan,native_fan) and celebrity_id=brand_id) <> 2
    or (select count(*) from public.fan_activities
      where app_user_id in (fan,native_fan) and celebrity_id=brand_id
        and activity_type='first_reaction') <> 2 then
    raise exception 'brand reaction stamp or unrelated reward boundary failed';
  end if;

  result:=pg_temp.complete_brand_quiz(
    fan,brand_id,'reaction',legacy_reaction,'95500000-0000-4000-8000-000000000016'
  );
  if result->'attempt'->>'status'<>'passed'
    or not exists(select 1 from public.fan_passports passport
      join public.first_reaction_stamps stamp on stamp.passport_id=passport.id
      where passport.app_user_id=fan and passport.celebrity_id=brand_id
        and stamp.reaction_id=legacy_reaction)
    or not exists(select 1 from public.fan_passports
      where app_user_id=fan and celebrity_id=brand_id
        and blockchain_job_id is not null and fan_action_outbox_id is null) then
    raise exception 'brand legacy quiz or reaction-before-passport flow failed: %',result;
  end if;

  insert into public.fan_action_producer_routes(action_code,binding_id,enabled,policy_version,enabled_at)
  values(1,binding_id,true,1,now());
  result:=pg_temp.complete_brand_quiz(
    native_fan,brand_id,'reaction',native_reaction,'95500000-0000-4000-8000-000000000017'
  );
  if result->'attempt'->>'status'<>'passed'
    or not exists(select 1 from public.fan_passports passport
      join public.first_reaction_stamps stamp on stamp.passport_id=passport.id
      where passport.app_user_id=native_fan and passport.celebrity_id=brand_id
        and passport.blockchain_job_id is null and passport.fan_action_outbox_id is not null
        and stamp.reaction_id=native_reaction) then
    raise exception 'brand native quiz or reaction-before-passport flow failed: %',result;
  end if;

  perform pg_temp.complete_brand_quiz(
    no_reaction_fan,brand_id,'creator_page',brand_id,'95500000-0000-4000-8000-000000000018'
  );
  if exists(select 1 from public.first_reaction_stamps
    where app_user_id=no_reaction_fan and celebrity_id=brand_id) then
    raise exception 'brand no-reaction quiz created a reaction stamp';
  end if;

  perform pg_temp.complete_brand_quiz(
    after_reaction_fan,brand_id,'creator_page',brand_id,'95500000-0000-4000-8000-000000000019'
  );
  perform public.react_to_creator(
    after_reaction_fan,brand_id,after_reaction,after_job,'0x'||repeat('c',64)
  );
  if not exists(select 1 from public.fan_passports passport
    join public.first_reaction_stamps stamp on stamp.passport_id=passport.id
    where passport.app_user_id=after_reaction_fan and passport.celebrity_id=brand_id
      and stamp.reaction_id=after_reaction) then
    raise exception 'brand reaction-after-passport flow failed';
  end if;
  if exists(
    select app_user_id from public.fan_ticket_ledger
    where app_user_id in (fan,native_fan,no_reaction_fan,after_reaction_fan)
      and celebrity_id=brand_id and source_type='passport_verification'
    group by app_user_id having count(*)<>1
  ) or (select count(*) from public.fan_ticket_ledger
    where app_user_id in (fan,native_fan,no_reaction_fan,after_reaction_fan)
      and celebrity_id=brand_id and source_type='passport_verification')<>4 then
    raise exception 'brand quiz verification reward policy changed or replay duplicated credit';
  end if;

  result := public.save_admin_celebrity(actor,correlation,null,
    jsonb_set(brand_payload,'{slug}','"brand-draft-proof"'));
  draft_id := (result->>'id')::uuid;
  if exists(select 1 from public.published_celebrities where slug='brand-draft-proof') then
    raise exception 'draft brand leaked to public projection';
  end if;

  result := public.save_admin_celebrity(actor,correlation,null,person_payload);
  person_id := (result->>'id')::uuid;
  perform pg_temp.expect_error(format(
    'select public.set_admin_celebrity_publication(%L,%L,%L,true)',actor,correlation,person_id
  ), 'requires exactly one published quiz');
  result := public.save_admin_celebrity(actor,correlation,person_id,
    jsonb_set(person_payload,'{primaryRole}','"singer"'));
  if result->>'primaryRole' <> 'singer' then raise exception 'person role edit regressed'; end if;
  perform pg_temp.expect_error(format(
    'select public.save_admin_celebrity(%L,%L,%L,%L::jsonb)',
    actor,correlation,person_id,jsonb_set(person_payload,'{primaryRole}','"brand"')::text
  ), 'existing person and brand profiles cannot be converted');
  perform public.save_admin_quiz_version(actor,correlation,person_id,null,pg_temp.brand_questions());
  select id into quiz_id from public.celebrity_quizzes where celebrity_id=person_id and version=1;
  perform public.publish_admin_quiz_version(actor,correlation,person_id,quiz_id);
  perform public.set_admin_celebrity_publication(actor,correlation,person_id,true);
  set constraints celebrities_ensure_welcome_notice immediate;
  if (select count(*) from public.celebrity_notices
      where celebrity_id=person_id and notice_kind='welcome' and publication_status='published') <> 1
    or (select count(*) from public.celebrity_notice_localizations l
      join public.celebrity_notices n on n.id=l.notice_id
      where n.celebrity_id=person_id and n.notice_kind='welcome') <> 2 then
    raise exception 'person welcome notice regression';
  end if;
  perform public.ensure_celebrity_welcome_notice(person_id);
  perform public.ensure_celebrity_welcome_notice(person_id);
  if (select count(*) from public.celebrity_notices
    where celebrity_id=person_id and notice_kind='welcome') <> 1 then
    raise exception 'person welcome notice replay duplicated';
  end if;
  set constraints all deferred;
  insert into public.fan_ticket_activity_policy(celebrity_id) values(person_id);
  perform public.save_fan_post(fan,'person-fanpage-proof',null,'인물 게시물','public','{}',null,extensions.gen_random_uuid());
  if not exists(select 1 from public.fan_ticket_activity_awards
    where app_user_id=fan and celebrity_id=person_id and action_key='comment') then
    raise exception 'person activity reward regressed';
  end if;

  -- The clean harness superuser is not named postgres, while the legacy lifecycle
  -- trigger hard-codes that role name for its archive command.
  set constraints all immediate;
  alter table public.celebrities disable trigger celebrities_enforce_lifecycle;
  update public.celebrities set status='draft',archived_at=now(),
    archived_by_admin_allowlist_id=actor,archive_reason='Brand fanpage archive proof'
  where id=brand_id;
  alter table public.celebrities enable trigger celebrities_enforce_lifecycle;
  if exists(select 1 from public.published_celebrities where slug='runmusic') then
    raise exception 'archived brand leaked to public projection';
  end if;

  raise notice 'BRAND_FANPAGES runmusic registration, HTTPS website, role boundaries, quiz/passport issuance, welcome exclusion, reaction timing/replay, legacy/native lanes, reward boundaries, draft/archive projection and person regression: PASS';
end $$;

rollback;
