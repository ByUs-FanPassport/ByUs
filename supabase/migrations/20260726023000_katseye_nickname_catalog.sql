-- Keep the public KATSEYE entity and its Korean name unavailable for user
-- impersonation. This is additive so existing nickname and profile history
-- remains untouched.

begin;

insert into public.prohibited_nickname_catalog
  (catalog_version, value_normalized, match_mode, reason_code)
values
  ('fan-nickname-v1', 'katseye', 'contains', 'impersonation'),
  ('fan-nickname-v1', '캣츠아이', 'contains', 'impersonation')
on conflict (catalog_version, value_normalized, match_mode)
do update set
  reason_code = excluded.reason_code,
  active = true;

commit;
