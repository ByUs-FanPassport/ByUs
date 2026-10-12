-- Local disposable-database contract test. No production data is required.
\set ON_ERROR_STOP on

begin;

do $$
declare
  v_definition text := pg_catalog.pg_get_functiondef('public.ensure_celebrity_welcome_notice(uuid)'::regprocedure);
begin
  if pg_catalog.strpos(v_definition, '''Kyaa 운영팀''') = 0
     or pg_catalog.strpos(v_definition, '''The Kyaa Team''') = 0
     or pg_catalog.strpos(v_definition, 'v_celebrity.primary_role = ''brand''') = 0
     or pg_catalog.strpos(v_definition, '''ByUs 운영팀''') > 0
     or pg_catalog.strpos(v_definition, '''The ByUs Team''') > 0 then
    raise exception 'Welcome notice branding or brand exclusion mismatch';
  end if;

  if not exists (
    select 1
    from public.brand_localizations localization
    join public.brands brand on brand.id = localization.brand_id
    where brand.id = '42595553-0000-4000-8000-000000000001'
      and brand.slug = 'byus'
      and localization.locale = 'ko'
      and localization.description = '팬과 셀럽의 LIVE 순간을 연결하는 Kyaa입니다.'
  ) or not exists (
    select 1
    from public.brand_localizations localization
    join public.brands brand on brand.id = localization.brand_id
    where brand.id = '42595553-0000-4000-8000-000000000001'
      and brand.slug = 'byus'
      and localization.locale = 'en'
      and localization.description = 'The official Kyaa brand connecting fans with celebrity LIVE moments.'
  ) then
    raise exception 'LIVE brand description mismatch';
  end if;
end;
$$;

rollback;
