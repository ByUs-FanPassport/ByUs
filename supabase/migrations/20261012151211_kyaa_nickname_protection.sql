-- Reserve the current brand name for new nicknames without rewriting existing
-- profiles that predate this catalog entry.
begin;

insert into public.prohibited_nickname_catalog
  (catalog_version, value_normalized, match_mode, reason_code)
values
  ('fan-nickname-v1', 'kyaa', 'contains', 'impersonation')
on conflict (catalog_version, value_normalized, match_mode)
do update set
  reason_code = excluded.reason_code,
  active = true;

commit;
