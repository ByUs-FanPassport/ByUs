-- Clarify ByUs's Korean introduction without changing other localized content.
begin;

do $$
declare
  affected integer;
begin
  update public.brand_localizations as localization
  set description = '팬과 셀럽의 LIVE 순간을 연결하는 ByUs입니다.'
  from public.brands as brand
  where brand.id = localization.brand_id
    and brand.id = '42595553-0000-4000-8000-000000000001'
    and brand.slug = 'byus'
    and localization.locale = 'ko';

  get diagnostics affected = row_count;
  if affected <> 1 then
    raise exception 'Expected exactly one ByUs Korean description, updated %', affected;
  end if;
end $$;

commit;
