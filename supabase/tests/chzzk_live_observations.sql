\set ON_ERROR_STOP on
begin;

do $$
declare
  p_channel_id text := 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
begin
  insert into public.chzzk_live_observations (channel_id, state, observed_at, title)
  values (p_channel_id, 'live', '2026-09-18T00:00:00Z', '공식 LIVE');

  if (select observation.title from public.chzzk_live_observations observation where observation.channel_id = p_channel_id) <> '공식 LIVE' then
    raise exception 'live observation was not stored';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.chzzk_live_observations'::regclass) then
    raise exception 'RLS must stay enabled';
  end if;
  if has_table_privilege('anon', 'public.chzzk_live_observations', 'select')
    or has_table_privilege('authenticated', 'public.chzzk_live_observations', 'select') then
    raise exception 'public roles must not read CHZZK observations';
  end if;
  if not has_table_privilege('service_role', 'public.chzzk_live_observations', 'select,insert,update') then
    raise exception 'service role needs private sync access';
  end if;
end $$;

rollback;
