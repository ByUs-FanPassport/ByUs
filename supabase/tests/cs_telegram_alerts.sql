-- Local only. All fixture accounts, messages and queue state roll back.
\set ON_ERROR_STOP on
begin;
do $$
declare
 fan uuid:='c6000000-0000-4000-8000-000000000001';
 adm uuid:='c6000000-0000-4000-8000-000000000002';
 allow_id uuid:='c6000000-0000-4000-8000-000000000003';
 inquiry uuid; disabled_inquiry uuid; message_id uuid; batch jsonb; item jsonb; n integer;
 key_create uuid:='c6000000-0000-4000-8000-000000000004';
 key_post uuid:='c6000000-0000-4000-8000-000000000005';
begin
 insert into public.app_users(id,privy_user_id,verified_email,status) values
 (fan,'did:privy:cs-tg-fan','cs-tg-fan@example.invalid','active'),
 (adm,'did:privy:cs-tg-admin','cs-tg-admin@example.invalid','active');
 insert into public.admin_allowlist(id,email,role,active) values(allow_id,'cs-tg-admin@example.invalid','operator',true);
 disabled_inquiry:=(public.cs_create(fan,'PRIVATE SUBJECT','PRIVATE BODY','ko',gen_random_uuid())->>'id')::uuid;
 if exists(select 1 from public.telegram_alert_outbox where kind like 'cs_%') then raise exception 'captured while disabled'; end if;
 perform public.configure_telegram_alerts('-1001234567890',true);
 update public.telegram_alert_settings set activated_at=now()-interval '1 second';
 if exists(select 1 from public.telegram_alert_outbox where kind like 'cs_%') then raise exception 'backfilled'; end if;
 inquiry:=(public.cs_create(fan,'PRIVATE SUBJECT','PRIVATE BODY','ko',key_create)->>'id')::uuid;
 perform public.cs_create(fan,'PRIVATE SUBJECT','PRIVATE BODY','ko',key_create);
 message_id:=(public.cs_post(fan,inquiry,'PRIVATE FOLLOWUP',key_post)->>'id')::uuid;
 perform public.cs_post(fan,inquiry,'PRIVATE FOLLOWUP',key_post);
 perform public.cs_post(adm,inquiry,'PRIVATE ADMIN',gen_random_uuid(),allow_id,gen_random_uuid());
 perform public.cs_resolve(adm,allow_id,inquiry,3,gen_random_uuid());
 select count(*) into n from public.telegram_alert_outbox where kind like 'cs_%';
 if n<>2 then raise exception 'expected exactly create+fanpost, got %',n; end if;
 if (select count(*) from public.telegram_alert_outbox where kind='cs_inquiry_created')<>1 then raise exception 'create kind missing'; end if;
 if (select count(*) from public.telegram_alert_outbox where kind='cs_user_replied')<>1 then raise exception 'reply kind missing'; end if;
 if public.claim_telegram_alert_batch('-1001234567890') is not null then raise exception 'old worker claimed CS'; end if;
 if public.claim_telegram_alert_batch_with_identity('-1001234567890') is not null then raise exception 'identity worker claimed CS'; end if;
 if public.claim_telegram_alert_batch_with_cs('-1009999999999') is not null then raise exception 'wrong room claimed'; end if;
 batch:=public.claim_telegram_alert_batch_with_cs('-1001234567890');
 if jsonb_array_length(batch->'alerts')<>2 then raise exception 'missing CS batch'; end if;
 for item in select value from jsonb_array_elements(batch->'alerts') loop
  if item->>'inquiry_id' is distinct from inquiry::text then raise exception 'wrong deep link'; end if;
  if item->>'actor_name' is not null or item->>'actor_email' is not null or item::text like '%PRIVATE%' then raise exception 'private CS data leaked'; end if;
 end loop;
 if public.claim_telegram_alert_batch_with_cs_content('-1001234567890') is not null then raise exception 'content worker bypassed room lock'; end if;
 -- Simulate an old worker stopping before send; the new claim recovers its lease.
 update public.telegram_alert_outbox set lease_expires_at=now()-interval '1 second' where batch_id=(batch->>'batch_id')::uuid;
 update public.telegram_alert_settings set lease_expires_at=now()-interval '1 second';
 batch:=public.claim_telegram_alert_batch_with_cs_content('-1001234567890');
 if jsonb_array_length(batch->'alerts')<>2 then raise exception 'content batch missing'; end if;
 for item in select value from jsonb_array_elements(batch->'alerts') loop
  if item->>'message_body' is distinct from (case when item->>'kind'='cs_inquiry_created' then 'PRIVATE BODY' else 'PRIVATE FOLLOWUP' end) then raise exception 'wrong approved message body'; end if;
  if item->>'inquiry_id' is distinct from inquiry::text or item->>'actor_email' is not null or item ? 'subject' then raise exception 'content DTO exposed extra data'; end if;
 end loop;
 if has_function_privilege('anon','public.claim_telegram_alert_batch_with_cs_content(text)','execute') or has_function_privilege('authenticated','public.claim_telegram_alert_batch_with_cs_content(text)','execute') then raise exception 'public content claim access'; end if;
 if not public.begin_telegram_alert_send((batch->>'batch_id')::uuid,'-1001234567890') then raise exception 'begin rejected'; end if;
 perform public.finish_telegram_alert_batch((batch->>'batch_id')::uuid,'sent',1,null);
 if public.claim_telegram_alert_batch_with_cs('-1001234567890') is not null then raise exception 'resent acknowledged messages'; end if;
 -- Reply after resolution captures exactly one fresh event and reopens the inquiry.
 perform public.cs_post(fan,inquiry,'REOPEN',gen_random_uuid());
 if (select status from public.cs_inquiries where id=inquiry)<>'open' then raise exception 'not reopened'; end if;
 if (select count(*) from public.telegram_alert_outbox where kind like 'cs_%')<>3 then raise exception 'reopen missing'; end if;
 -- Failed business transactions cannot leave behind an alert.
 begin
  perform public.cs_post(fan,inquiry,'ROLLBACK',gen_random_uuid());
  raise exception 'synthetic rollback';
 exception when raise_exception then null;
 end;
 if (select count(*) from public.telegram_alert_outbox where kind like 'cs_%')<>3 then raise exception 'rollback leaked alert'; end if;
 perform public.configure_telegram_alerts('-1001234567890',false);
 perform public.cs_post(fan,inquiry,'DISABLED',gen_random_uuid());
 if (select count(*) from public.telegram_alert_outbox where kind like 'cs_%')<>3 then raise exception 'disabled capture'; end if;
 if has_function_privilege('anon','public.claim_telegram_alert_batch_with_cs(text)','execute') or has_function_privilege('authenticated','public.claim_telegram_alert_batch_with_cs(text)','execute') then raise exception 'public claim access'; end if;
 if not has_function_privilege('service_role','public.claim_telegram_alert_batch_with_cs(text)','execute') then raise exception 'service claim denied'; end if;
end $$;
-- Queue capture errors are secondary and must not reject user messages.
create function pg_temp.fail_cs_capture() returns trigger language plpgsql as $$ begin raise exception 'synthetic queue failure'; end $$;
create trigger cs_test_queue_failure before insert on public.telegram_alert_outbox for each row execute function pg_temp.fail_cs_capture();
select public.configure_telegram_alerts('-1001234567890',true);
update public.telegram_alert_settings set activated_at=now()-interval '1 second';
select public.cs_create('c6000000-0000-4000-8000-000000000001','still accepted','private body','ko',gen_random_uuid());
rollback;
