begin;

-- Patch the deployed definition so the later brand-profile exclusion remains
-- intact instead of restoring the function from an older migration.
do $branding$
declare
  v_signature regprocedure := 'public.ensure_celebrity_welcome_notice(uuid)'::regprocedure;
  v_definition text := pg_catalog.pg_get_functiondef(v_signature);
  v_old_ko constant text := '''ByUs 운영팀''';
  v_new_ko constant text := '''Kyaa 운영팀''';
  v_old_en constant text := '''The ByUs Team''';
  v_new_en constant text := '''The Kyaa Team''';
begin
  if (pg_catalog.length(v_definition) - pg_catalog.length(pg_catalog.replace(v_definition, v_old_ko, '')))
       / pg_catalog.length(v_old_ko) <> 1
     or (pg_catalog.length(v_definition) - pg_catalog.length(pg_catalog.replace(v_definition, v_old_en, '')))
       / pg_catalog.length(v_old_en) <> 1 then
    raise exception 'WELCOME_NOTICE_SIGNATURE_COPY_SHAPE_CHANGED';
  end if;

  v_definition := pg_catalog.replace(v_definition, v_old_ko, v_new_ko);
  v_definition := pg_catalog.replace(v_definition, v_old_en, v_new_en);
  execute v_definition;

  if pg_catalog.strpos(pg_catalog.pg_get_functiondef(v_signature), 'v_celebrity.primary_role = ''brand''') = 0 then
    raise exception 'WELCOME_NOTICE_BRAND_EXCLUSION_LOST';
  end if;
end
$branding$;

comment on function public.ensure_celebrity_welcome_notice(uuid) is
  'Internal idempotent bootstrap for Kyaa-signed KO/EN person welcome notices; brand profiles are excluded.';

-- Production has all four KO notices and the NCHIVE EN notice. A clean local
-- chain has none; a partial production-shaped set indicates drift and aborts.
do $published_notices$
declare
  v_ko_targets integer;
  v_ko_matches integer;
  v_en_targets integer;
  v_en_matches integer;
  v_updated integer;
begin
  select count(*), count(*) filter (
    where localization.body_json #>> '{content,4,content,0,text}' = 'ByUs 운영팀'
  )
  into v_ko_targets, v_ko_matches
  from public.celebrity_notice_localizations localization
  join public.celebrity_notices notice on notice.id = localization.notice_id
  join public.celebrities celebrity on celebrity.id = notice.celebrity_id
  where celebrity.slug in ('nchive', 'elina', 'ifewknow', 'jenny-jeong')
    and celebrity.status = 'published'
    and celebrity.archived_at is null
    and notice.slug = 'welcome-byus'
    and notice.notice_kind = 'welcome'
    and notice.publication_status = 'published'
    and notice.archived_at is null
    and localization.locale = 'ko';

  if v_ko_targets not in (0, 4) or v_ko_matches <> v_ko_targets then
    raise exception 'KYAA_KO_WELCOME_NOTICE_MATCH_COUNT target %, exact %', v_ko_targets, v_ko_matches;
  end if;

  select count(*), count(*) filter (
    where localization.body_json #>> '{content,4,content,0,text}' = 'The ByUs Team'
  )
  into v_en_targets, v_en_matches
  from public.celebrity_notice_localizations localization
  join public.celebrity_notices notice on notice.id = localization.notice_id
  join public.celebrities celebrity on celebrity.id = notice.celebrity_id
  where celebrity.slug = 'nchive'
    and celebrity.status = 'published'
    and celebrity.archived_at is null
    and notice.slug = 'welcome-byus'
    and notice.notice_kind = 'welcome'
    and notice.publication_status = 'published'
    and notice.archived_at is null
    and localization.locale = 'en';

  if v_en_targets not in (0, 1) or v_en_matches <> v_en_targets then
    raise exception 'KYAA_EN_WELCOME_NOTICE_MATCH_COUNT target %, exact %', v_en_targets, v_en_matches;
  end if;

  create temporary table kyaa_content_branding_before on commit drop as
  select
    notice.id as notice_id,
    localization.locale,
    pg_catalog.to_jsonb(notice) as notice_row,
    localization.title,
    localization.created_at,
    localization.body_json,
    (select count(*) from public.celebrity_notice_comments fan_comment where fan_comment.notice_id = notice.id) as comment_count
  from public.celebrity_notice_localizations localization
  join public.celebrity_notices notice on notice.id = localization.notice_id
  join public.celebrities celebrity on celebrity.id = notice.celebrity_id
  where celebrity.status = 'published'
    and celebrity.archived_at is null
    and notice.slug = 'welcome-byus'
    and notice.notice_kind = 'welcome'
    and notice.publication_status = 'published'
    and notice.archived_at is null
    and (
      (celebrity.slug in ('nchive', 'elina', 'ifewknow', 'jenny-jeong') and localization.locale = 'ko')
      or (celebrity.slug = 'nchive' and localization.locale = 'en')
    );

  update public.celebrity_notice_localizations localization
  set body_json = pg_catalog.jsonb_set(
    localization.body_json,
    '{content,4,content,0,text}',
    pg_catalog.to_jsonb(case localization.locale when 'ko' then 'Kyaa 운영팀' else 'The Kyaa Team' end),
    false
  )
  from public.celebrity_notices notice
  join public.celebrities celebrity on celebrity.id = notice.celebrity_id
  where notice.id = localization.notice_id
    and celebrity.status = 'published'
    and celebrity.archived_at is null
    and notice.slug = 'welcome-byus'
    and notice.notice_kind = 'welcome'
    and notice.publication_status = 'published'
    and notice.archived_at is null
    and (
      (
        celebrity.slug in ('nchive', 'elina', 'ifewknow', 'jenny-jeong')
        and localization.locale = 'ko'
        and localization.body_json #>> '{content,4,content,0,text}' = 'ByUs 운영팀'
      )
      or (
        celebrity.slug = 'nchive'
        and localization.locale = 'en'
        and localization.body_json #>> '{content,4,content,0,text}' = 'The ByUs Team'
      )
    );

  get diagnostics v_updated = row_count;
  if v_updated <> v_ko_targets + v_en_targets then
    raise exception 'KYAA_WELCOME_NOTICE_UPDATE_COUNT expected %, updated %', v_ko_targets + v_en_targets, v_updated;
  end if;

  -- Only the exact signature text node is rebuilt. Verify that the rest of
  -- each body, the notice row (including slug/revision) and comments survived.
  if exists (
    select 1
    from pg_temp.kyaa_content_branding_before before
    join public.celebrity_notices notice on notice.id = before.notice_id
    join public.celebrity_notice_localizations localization
      on localization.notice_id = before.notice_id and localization.locale = before.locale
    where pg_catalog.to_jsonb(notice) <> before.notice_row
      or localization.title is distinct from before.title
      or localization.created_at is distinct from before.created_at
      or localization.body_json <> pg_catalog.jsonb_set(
        before.body_json,
        '{content,4,content,0,text}',
        pg_catalog.to_jsonb(case before.locale when 'ko' then 'Kyaa 운영팀' else 'The Kyaa Team' end),
        false
      )
      or (select count(*) from public.celebrity_notice_comments fan_comment where fan_comment.notice_id = before.notice_id) <> before.comment_count
  ) then
    raise exception 'KYAA_WELCOME_NOTICE_PRESERVATION_FAILED';
  end if;

  if exists (
    select 1
    from public.celebrity_notice_localizations localization
    join public.celebrity_notices notice on notice.id = localization.notice_id
    join public.celebrities celebrity on celebrity.id = notice.celebrity_id
    where celebrity.status = 'published'
      and celebrity.archived_at is null
      and notice.slug = 'welcome-byus'
      and notice.notice_kind = 'welcome'
      and notice.publication_status = 'published'
      and notice.archived_at is null
      and (
        (
          celebrity.slug in ('nchive', 'elina', 'ifewknow', 'jenny-jeong')
          and localization.locale = 'ko'
          and localization.body_json #>> '{content,4,content,0,text}' <> 'Kyaa 운영팀'
        )
        or (
          celebrity.slug = 'nchive'
          and localization.locale = 'en'
          and localization.body_json #>> '{content,4,content,0,text}' <> 'The Kyaa Team'
        )
      )
  ) then
    raise exception 'KYAA_WELCOME_NOTICE_POSTCONDITION_FAILED';
  end if;
end
$published_notices$;

do $live_copy$
declare
  v_updated integer;
begin
  update public.brand_localizations localization
  set description = case localization.locale
    when 'ko' then '팬과 셀럽의 LIVE 순간을 연결하는 Kyaa입니다.'
    when 'en' then 'The official Kyaa brand connecting fans with celebrity LIVE moments.'
  end
  from public.brands brand
  where brand.id = localization.brand_id
    and brand.id = '42595553-0000-4000-8000-000000000001'
    and brand.slug = 'byus'
    and brand.status = 'published'
    and brand.archived_at is null
    and (
      (
        localization.locale = 'ko'
        and localization.description = '팬과 셀럽의 LIVE 순간을 연결하는 ByUs입니다.'
      )
      or (
        localization.locale = 'en'
        and localization.description = 'The official ByUs brand connecting fans with celebrity LIVE moments.'
      )
    );

  get diagnostics v_updated = row_count;
  if v_updated <> 2 then
    raise exception 'KYAA_LIVE_BRAND_COPY_MATCH_COUNT expected 2, updated %', v_updated;
  end if;
end
$live_copy$;

commit;
