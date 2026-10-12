-- Local disposable-database contract test. Production-only target rows may be absent.
\set ON_ERROR_STOP on

begin;

do $$
declare
  v_definition text := pg_catalog.pg_get_functiondef('public.ensure_celebrity_welcome_notice(uuid)'::regprocedure);
  v_notice_count integer;
  v_target_count integer;
  v_updated_count integer;
begin
  if pg_catalog.strpos(v_definition, '''Kyaa 운영팀''') = 0
     or pg_catalog.strpos(v_definition, '''The Kyaa Team''') = 0
     or pg_catalog.strpos(v_definition, 'v_celebrity.primary_role = ''brand''') = 0
     or pg_catalog.strpos(v_definition, '''ByUs 운영팀''') > 0
     or pg_catalog.strpos(v_definition, '''The ByUs Team''') > 0 then
    raise exception 'Welcome notice function contract mismatch';
  end if;

  select count(*) into v_notice_count
  from public.celebrity_notices
  where id in (
    '4669a839-e3ce-4818-8d91-163b656c6476',
    'c1ab8b5f-637f-4e31-905f-3d9e4c9bcae8',
    '2e42e158-8d30-49ab-81f7-0f67787210ac',
    '1b2d5fc3-1989-4f2d-a4d4-28894694d52b',
    'f292d12c-2697-42c4-be66-4515f048ef4c',
    '49677a0f-159f-400d-b434-0744d4a21474',
    '98ebd6e4-ec0e-4cbe-aa0d-12e8b99df4f2',
    '879a5814-2521-433a-9d77-126faf4c04a7'
  );

  if v_notice_count not in (0, 8) then
    raise exception 'Remaining welcome notice mismatch: %', v_notice_count;
  end if;

  with targets(notice_id, celebrity_slug, locale, new_signature) as (values
    ('4669a839-e3ce-4818-8d91-163b656c6476'::uuid, 'elina',            'en'::public.content_locale, 'The Kyaa Team'),
    ('c1ab8b5f-637f-4e31-905f-3d9e4c9bcae8'::uuid, 'changha',          'ko'::public.content_locale, 'Kyaa 운영팀'),
    ('c1ab8b5f-637f-4e31-905f-3d9e4c9bcae8'::uuid, 'changha',          'en'::public.content_locale, 'The Kyaa Team'),
    ('2e42e158-8d30-49ab-81f7-0f67787210ac'::uuid, 'jenny-jeong',      'en'::public.content_locale, 'The Kyaa Team'),
    ('1b2d5fc3-1989-4f2d-a4d4-28894694d52b'::uuid, 'aryeom',           'ko'::public.content_locale, 'Kyaa 운영팀'),
    ('1b2d5fc3-1989-4f2d-a4d4-28894694d52b'::uuid, 'aryeom',           'en'::public.content_locale, 'The Kyaa Team'),
    ('f292d12c-2697-42c4-be66-4515f048ef4c'::uuid, 'ifewknow',         'en'::public.content_locale, 'The Kyaa Team'),
    ('49677a0f-159f-400d-b434-0744d4a21474'::uuid, 'park-myungho',     'ko'::public.content_locale, 'Kyaa 운영팀'),
    ('49677a0f-159f-400d-b434-0744d4a21474'::uuid, 'park-myungho',     'en'::public.content_locale, 'The Kyaa Team'),
    ('98ebd6e4-ec0e-4cbe-aa0d-12e8b99df4f2'::uuid, 'thisisj-official', 'ko'::public.content_locale, 'Kyaa 운영팀'),
    ('98ebd6e4-ec0e-4cbe-aa0d-12e8b99df4f2'::uuid, 'thisisj-official', 'en'::public.content_locale, 'The Kyaa Team'),
    ('879a5814-2521-433a-9d77-126faf4c04a7'::uuid, 'yuna',             'ko'::public.content_locale, 'Kyaa 운영팀'),
    ('879a5814-2521-433a-9d77-126faf4c04a7'::uuid, 'yuna',             'en'::public.content_locale, 'The Kyaa Team')
  ), present as (
    select localization.body_json, target.new_signature
    from targets target
    join public.celebrity_notices notice on notice.id = target.notice_id
    join public.celebrities celebrity
      on celebrity.id = notice.celebrity_id and celebrity.slug = target.celebrity_slug
    join public.celebrity_notice_localizations localization
      on localization.notice_id = target.notice_id and localization.locale = target.locale
    where celebrity.status = 'published'
      and celebrity.archived_at is null
      and notice.notice_kind = 'welcome'
      and notice.publication_status = 'published'
      and notice.archived_at is null
  )
  select count(*), count(*) filter (
    where body_json #>> '{content,4,content,0,text}' = new_signature
  ) into v_target_count, v_updated_count
  from present;

  if (v_notice_count = 0 and v_target_count <> 0)
     or (v_notice_count = 8 and v_target_count <> 13)
     or v_updated_count <> v_target_count then
    raise exception 'Remaining welcome signature mismatch: target %, updated %', v_target_count, v_updated_count;
  end if;

  -- Historical seed rows have different IDs and are outside this migration.
  if v_notice_count = 8 and exists (
    select 1
    from public.celebrity_notice_localizations localization
    join public.celebrity_notices notice on notice.id = localization.notice_id
    join public.celebrities celebrity on celebrity.id = notice.celebrity_id
    where celebrity.status = 'published'
      and celebrity.archived_at is null
      and notice.notice_kind = 'welcome'
      and notice.publication_status = 'published'
      and notice.archived_at is null
      and localization.body_json #>> '{content,4,content,0,text}' in ('ByUs 운영팀', 'The ByUs Team')
  ) then
    raise exception 'Published welcome notice retains a legacy operating signature';
  end if;
end;
$$;

rollback;
