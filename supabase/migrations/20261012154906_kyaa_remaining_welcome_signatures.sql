begin;

do $remaining_welcome_signatures$
declare
  v_definition text := pg_catalog.pg_get_functiondef('public.ensure_celebrity_welcome_notice(uuid)'::regprocedure);
  v_notice_count integer;
  v_target_count integer;
  v_exact_count integer;
  v_updated integer;
begin
  if pg_catalog.strpos(v_definition, '''Kyaa 운영팀''') = 0
     or pg_catalog.strpos(v_definition, '''The Kyaa Team''') = 0
     or pg_catalog.strpos(v_definition, 'v_celebrity.primary_role = ''brand''') = 0
     or pg_catalog.strpos(v_definition, '''ByUs 운영팀''') > 0
     or pg_catalog.strpos(v_definition, '''The ByUs Team''') > 0 then
    raise exception 'KYAA_WELCOME_NOTICE_FUNCTION_CONTRACT_CHANGED';
  end if;

  create temporary table kyaa_remaining_welcome_targets (
    notice_id uuid not null,
    celebrity_slug text not null,
    locale public.content_locale not null,
    old_signature text not null,
    new_signature text not null,
    primary key (notice_id, locale)
  ) on commit drop;

  insert into kyaa_remaining_welcome_targets values
    ('4669a839-e3ce-4818-8d91-163b656c6476', 'elina',            'en', 'The ByUs Team', 'The Kyaa Team'),
    ('c1ab8b5f-637f-4e31-905f-3d9e4c9bcae8', 'changha',          'ko', 'ByUs 운영팀',    'Kyaa 운영팀'),
    ('c1ab8b5f-637f-4e31-905f-3d9e4c9bcae8', 'changha',          'en', 'The ByUs Team', 'The Kyaa Team'),
    ('2e42e158-8d30-49ab-81f7-0f67787210ac', 'jenny-jeong',      'en', 'The ByUs Team', 'The Kyaa Team'),
    ('1b2d5fc3-1989-4f2d-a4d4-28894694d52b', 'aryeom',           'ko', 'ByUs 운영팀',    'Kyaa 운영팀'),
    ('1b2d5fc3-1989-4f2d-a4d4-28894694d52b', 'aryeom',           'en', 'The ByUs Team', 'The Kyaa Team'),
    ('f292d12c-2697-42c4-be66-4515f048ef4c', 'ifewknow',         'en', 'The ByUs Team', 'The Kyaa Team'),
    ('49677a0f-159f-400d-b434-0744d4a21474', 'park-myungho',     'ko', 'ByUs 운영팀',    'Kyaa 운영팀'),
    ('49677a0f-159f-400d-b434-0744d4a21474', 'park-myungho',     'en', 'The ByUs Team', 'The Kyaa Team'),
    ('98ebd6e4-ec0e-4cbe-aa0d-12e8b99df4f2', 'thisisj-official', 'ko', 'ByUs 운영팀',    'Kyaa 운영팀'),
    ('98ebd6e4-ec0e-4cbe-aa0d-12e8b99df4f2', 'thisisj-official', 'en', 'The ByUs Team', 'The Kyaa Team'),
    ('879a5814-2521-433a-9d77-126faf4c04a7', 'yuna',             'ko', 'ByUs 운영팀',    'Kyaa 운영팀'),
    ('879a5814-2521-433a-9d77-126faf4c04a7', 'yuna',             'en', 'The ByUs Team', 'The Kyaa Team');

  select count(distinct notice.id) into v_notice_count
  from kyaa_remaining_welcome_targets target
  join public.celebrity_notices notice on notice.id = target.notice_id;

  if v_notice_count not in (0, 8) then
    raise exception 'KYAA_REMAINING_WELCOME_NOTICE_COUNT expected 0 or 8, found %', v_notice_count;
  end if;

  select count(*), count(*) filter (
    where localization.body_json #>> '{content,4,content,0,text}' = target.old_signature
  )
  into v_target_count, v_exact_count
  from kyaa_remaining_welcome_targets target
  join public.celebrity_notices notice on notice.id = target.notice_id
  join public.celebrities celebrity
    on celebrity.id = notice.celebrity_id and celebrity.slug = target.celebrity_slug
  join public.celebrity_notice_localizations localization
    on localization.notice_id = target.notice_id and localization.locale = target.locale
  where celebrity.status = 'published'
    and celebrity.archived_at is null
    and notice.notice_kind = 'welcome'
    and notice.publication_status = 'published'
    and notice.archived_at is null;

  if (v_notice_count = 0 and v_target_count <> 0)
     or (v_notice_count = 8 and v_target_count <> 13)
     or v_exact_count <> v_target_count then
    raise exception 'KYAA_REMAINING_WELCOME_MATCH_COUNT target %, exact %', v_target_count, v_exact_count;
  end if;

  create temporary table kyaa_remaining_welcome_before on commit drop as
  select
    target.notice_id,
    target.locale,
    target.new_signature,
    pg_catalog.to_jsonb(notice) as notice_row,
    localization.title,
    localization.created_at,
    localization.body_json,
    (select count(*) from public.celebrity_notice_comments fan_comment where fan_comment.notice_id = notice.id) as comment_count
  from kyaa_remaining_welcome_targets target
  join public.celebrity_notices notice on notice.id = target.notice_id
  join public.celebrities celebrity
    on celebrity.id = notice.celebrity_id and celebrity.slug = target.celebrity_slug
  join public.celebrity_notice_localizations localization
    on localization.notice_id = target.notice_id and localization.locale = target.locale
  where celebrity.status = 'published'
    and celebrity.archived_at is null
    and notice.notice_kind = 'welcome'
    and notice.publication_status = 'published'
    and notice.archived_at is null;

  update public.celebrity_notice_localizations localization
  set body_json = pg_catalog.jsonb_set(
    localization.body_json,
    '{content,4,content,0,text}',
    pg_catalog.to_jsonb(target.new_signature),
    false
  )
  from kyaa_remaining_welcome_targets target
  join public.celebrity_notices notice on notice.id = target.notice_id
  join public.celebrities celebrity
    on celebrity.id = notice.celebrity_id and celebrity.slug = target.celebrity_slug
  where localization.notice_id = target.notice_id
    and localization.locale = target.locale
    and localization.body_json #>> '{content,4,content,0,text}' = target.old_signature
    and celebrity.status = 'published'
    and celebrity.archived_at is null
    and notice.notice_kind = 'welcome'
    and notice.publication_status = 'published'
    and notice.archived_at is null;

  get diagnostics v_updated = row_count;
  if v_updated <> v_target_count then
    raise exception 'KYAA_REMAINING_WELCOME_UPDATE_COUNT expected %, updated %', v_target_count, v_updated;
  end if;

  if exists (
    select 1
    from kyaa_remaining_welcome_before before
    join public.celebrity_notices notice on notice.id = before.notice_id
    join public.celebrity_notice_localizations localization
      on localization.notice_id = before.notice_id and localization.locale = before.locale
    where pg_catalog.to_jsonb(notice) <> before.notice_row
      or localization.title is distinct from before.title
      or localization.created_at is distinct from before.created_at
      or localization.body_json <> pg_catalog.jsonb_set(
        before.body_json,
        '{content,4,content,0,text}',
        pg_catalog.to_jsonb(before.new_signature),
        false
      )
      or (select count(*) from public.celebrity_notice_comments fan_comment where fan_comment.notice_id = before.notice_id) <> before.comment_count
  ) then
    raise exception 'KYAA_REMAINING_WELCOME_PRESERVATION_FAILED';
  end if;
end
$remaining_welcome_signatures$;

commit;
