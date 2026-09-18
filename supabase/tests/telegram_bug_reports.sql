begin;

do $$
begin
  if has_table_privilege('anon', 'public.telegram_bug_reports', 'SELECT,INSERT,UPDATE,DELETE')
     or has_table_privilege('authenticated', 'public.telegram_bug_reports', 'SELECT,INSERT,UPDATE,DELETE') then
    raise exception 'telegram bug reports are exposed to app roles';
  end if;
  if not has_table_privilege('service_role', 'public.telegram_bug_reports', 'SELECT,INSERT,UPDATE') then
    raise exception 'service role cannot operate telegram bug reports';
  end if;
  if has_function_privilege('anon', 'public.ingest_telegram_bug_report(bigint,bigint,bigint,text,timestamptz,timestamptz,jsonb,text,jsonb,bigint)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.ingest_telegram_bug_report(bigint,bigint,bigint,text,timestamptz,timestamptz,jsonb,text,jsonb,bigint)', 'EXECUTE') then
    raise exception 'telegram ingest is exposed to app roles';
  end if;

end;
$$;

set local role service_role;

do $$
declare
  v_id uuid;
  v_id_after_edit uuid;
  v_report jsonb;
  v_wrong_room_rejected boolean := false;
begin
  v_id := public.ingest_telegram_bug_report(
    7001,
    41,
    -5187701508,
    'message',
    '2026-09-18T07:00:00Z',
    null,
    '{"id":123,"username":"reporter"}'::jsonb,
    'first report',
    '[{"kind":"photo","fileId":"file-1"}]'::jsonb,
    null
  );

  v_id_after_edit := public.ingest_telegram_bug_report(
    7002,
    41,
    -5187701508,
    'edited_message',
    '2026-09-18T07:00:00Z',
    '2026-09-18T07:01:00Z',
    '{"id":123,"username":"reporter"}'::jsonb,
    'edited report',
    '[{"kind":"photo","fileId":"file-2"}]'::jsonb,
    null
  );

  if v_id_after_edit <> v_id or (select count(*) from public.telegram_bug_reports) <> 1 then
    raise exception 'telegram message ingest is not idempotent';
  end if;

  v_report := public.get_telegram_bug_report(-5187701508, 41);
  if v_report->>'report_text' <> 'edited report' or (v_report->>'telegram_update_id')::bigint <> 7002 or v_report->>'status' <> 'pending' then
    raise exception 'telegram edit was not persisted';
  end if;

  if not public.complete_telegram_bug_report(-5187701508, 41, 'abcdef1', 'https://byus.kr', '👌') then
    raise exception 'telegram completion was not recorded';
  end if;
  if not public.complete_telegram_bug_report(-5187701508, 41, 'abcdef1', 'https://byus.kr', '👌') then
    raise exception 'telegram completion is not idempotent';
  end if;

  v_report := public.get_telegram_bug_report(-5187701508, 41);
  if v_report->>'status' <> 'completed' or v_report->>'completion_reaction' <> '👌' or v_report->>'completed_at' is null then
    raise exception 'telegram completion metadata is incomplete';
  end if;

  begin
    perform public.ingest_telegram_bug_report(7003, 42, -1, 'message', now(), null, '{}'::jsonb, 'wrong room', '[]'::jsonb, null);
  exception when others then
    v_wrong_room_rejected := true;
  end;
  if not v_wrong_room_rejected then raise exception 'wrong room was accepted'; end if;

  raise notice 'PASS Telegram bug report isolation, allowlist, idempotent ingest and completion';
end;
$$;

reset role;

rollback;
