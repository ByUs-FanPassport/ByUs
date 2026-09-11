-- Local replay only. No business fixtures or external delivery; all changes roll back.
begin;
create function pg_temp.expect(ok boolean,label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'FAIL %',label; end if; end $$;
create function pg_temp.enqueue(n integer default 1) returns void language sql as $$
  insert into public.telegram_alert_outbox(kind,source_id,activation_id,chat_id,occurred_at)
  select 'member_joined',gen_random_uuid(),s.activation_id,s.chat_id,clock_timestamp()
  from public.telegram_alert_settings s cross join generate_series(1,n);
$$;
do $$
declare b jsonb; token uuid; i integer; role_name text; signature text;
begin
  perform pg_temp.expect((public.telegram_alert_health()->>'enabled')::boolean=false,'default disabled');
  foreach role_name in array array['anon','authenticated','service_role'] loop
    perform pg_temp.expect(not has_table_privilege(role_name,'public.telegram_alert_outbox','SELECT,INSERT,UPDATE,DELETE'),'private queue '||role_name);
    perform pg_temp.expect(not has_table_privilege(role_name,'public.telegram_alert_settings','SELECT,INSERT,UPDATE,DELETE'),'private settings '||role_name);
  end loop;
  foreach signature in array array['configure_telegram_alerts(text,boolean)','maintain_telegram_alerts()',
    'claim_telegram_alert_batch(text)','begin_telegram_alert_send(uuid,text)',
    'finish_telegram_alert_batch(uuid,text,bigint,integer)','telegram_alert_health()'] loop
    perform pg_temp.expect(not has_function_privilege('anon','public.'||signature,'EXECUTE'),'anon denied '||signature);
    perform pg_temp.expect(not has_function_privilege('authenticated','public.'||signature,'EXECUTE'),'authenticated denied '||signature);
    perform pg_temp.expect(has_function_privilege('service_role','public.'||signature,'EXECUTE'),'service allowed '||signature);
  end loop;
  perform pg_temp.expect((select bool_and(relrowsecurity and relforcerowsecurity) from pg_class where oid in ('public.telegram_alert_settings'::regclass,'public.telegram_alert_outbox'::regclass)),'forced RLS');
  perform public.configure_telegram_alerts('-100123',true);
  perform pg_temp.enqueue(21);
  perform pg_temp.expect(public.claim_telegram_alert_batch('-999') is null,'wrong destination denied');
  b:=public.claim_telegram_alert_batch('-100123');token:=(b->>'batch_id')::uuid;
  perform pg_temp.expect(jsonb_array_length(b->'alerts')=20,'batch bounded at 20');
  perform pg_temp.expect(b::text !~ '(source_id|app_user|email|nickname|wallet|activation_id)','payload private fields excluded');
  perform pg_temp.expect(public.claim_telegram_alert_batch('-100123') is null,'parallel claim fenced');
  perform pg_temp.expect(not public.begin_telegram_alert_send(token,'-999'),'begin checks room');
  perform pg_temp.expect(public.begin_telegram_alert_send(token,'-100123'),'begin succeeds');
  perform pg_temp.expect(not public.begin_telegram_alert_send(token,'-100123'),'duplicate begin rejected');
  perform pg_temp.expect(public.finish_telegram_alert_batch(token,'sent',123),'ack succeeds');
  perform pg_temp.expect(not public.finish_telegram_alert_batch(token,'sent',123),'duplicate ack no mutation');
  perform pg_temp.expect((select count(*)=20 from public.telegram_alert_outbox where status='sent'),'sent terminal');
  perform pg_temp.expect(public.claim_telegram_alert_batch('-100123') is null,'room minute throttle');
  update public.telegram_alert_settings set next_send_at='-infinity';
  b:=public.claim_telegram_alert_batch('-100123');token:=(b->>'batch_id')::uuid;
  update public.telegram_alert_settings set lease_expires_at=clock_timestamp()-interval '1 second';
  update public.telegram_alert_outbox set lease_expires_at=clock_timestamp()-interval '1 second' where batch_id=token;
  perform public.maintain_telegram_alerts();
  perform pg_temp.expect(not public.begin_telegram_alert_send(token,'-100123'),'expired claimant cannot send');
  b:=public.claim_telegram_alert_batch('-100123');token:=(b->>'batch_id')::uuid;
  perform pg_temp.expect(public.begin_telegram_alert_send(token,'-100123'),'reclaimed before send');
  update public.telegram_alert_settings set lease_expires_at=clock_timestamp()-interval '1 second';
  update public.telegram_alert_outbox set lease_expires_at=clock_timestamp()-interval '1 second' where batch_id=token;
  perform public.maintain_telegram_alerts();
  perform pg_temp.expect((select count(*)=1 from public.telegram_alert_outbox where status='delivery_unknown'),'sending timeout terminal unknown');
  perform pg_temp.expect(not public.finish_telegram_alert_batch(token,'sent',124),'late ack cannot alter unknown');
  update public.telegram_alert_settings set next_send_at='-infinity';
  perform pg_temp.expect(public.claim_telegram_alert_batch('-100123') is null,'unknown never resent');
  perform pg_temp.enqueue();
  for i in 1..3 loop
    update public.telegram_alert_settings set next_send_at='-infinity';
    update public.telegram_alert_outbox set available_at=clock_timestamp() where status='pending';
    b:=public.claim_telegram_alert_batch('-100123');token:=(b->>'batch_id')::uuid;
    perform pg_temp.expect(public.begin_telegram_alert_send(token,'-100123'),'429 retry begin '||i);
    perform pg_temp.expect(public.finish_telegram_alert_batch(token,'throttled',null,125),'429 ack '||i);
    perform pg_temp.expect((select next_send_at>clock_timestamp()+interval '120 seconds' from public.telegram_alert_settings),'429 room retry-after respected');
    perform pg_temp.expect(public.claim_telegram_alert_batch('-100123') is null,'429 blocks entire room');
  end loop;
  perform pg_temp.expect((select count(*)=1 from public.telegram_alert_outbox where status='failed' and attempt_count=3),'429 exhausted after three attempts');
  update public.telegram_alert_settings set next_send_at='-infinity';
  perform pg_temp.enqueue();b:=public.claim_telegram_alert_batch('-100123');token:=(b->>'batch_id')::uuid;
  perform public.configure_telegram_alerts('-100456',true);
  perform pg_temp.expect(not public.begin_telegram_alert_send(token,'-100123'),'destination switch fences claimed');
  perform pg_temp.expect(public.claim_telegram_alert_batch('-100456') is null,'old pending never reassigned');
  perform pg_temp.enqueue();perform public.configure_telegram_alerts('-100456',false);
  perform pg_temp.expect(public.claim_telegram_alert_batch('-100456') is null,'disabled claim');
  perform public.configure_telegram_alerts('-100456',true);
  perform pg_temp.expect(public.claim_telegram_alert_batch('-100456') is null,'reactivation no backfill');
  perform pg_temp.enqueue();update public.telegram_alert_outbox set created_at=clock_timestamp()-interval '2 days' where status='pending';
  perform public.maintain_telegram_alerts();
  perform pg_temp.expect(public.claim_telegram_alert_batch('-100456') is null,'stale pending expiry');
  update public.telegram_alert_outbox set finished_at=clock_timestamp()-interval '31 days' where status='sent';
  perform public.maintain_telegram_alerts();
  perform pg_temp.expect(not exists(select 1 from public.telegram_alert_outbox where status='sent'),'terminal retention');
  raise notice 'PASS Telegram role isolation, payload, claim fencing, throttling, lease recovery, ambiguous send, bounded 429 retry, room switch, disable, expiry, retention';
end $$;
set local role service_role;
select public.telegram_alert_health();
reset role;
rollback;
