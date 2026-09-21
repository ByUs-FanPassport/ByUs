-- Local-only fixtures and queue transitions; everything rolls back.
\set ON_ERROR_STOP on
begin;
do $$
declare
 link_id uuid:='fa4be7ed-782e-48f2-8537-628e5cd4e920';
 visit_id uuid; batch jsonb; item jsonb;
begin
 perform public.record_banksy_visit(repeat('1',64),link_id,link_id,0);
 if exists(select 1 from public.telegram_alert_outbox where kind='campaign_visited') then raise exception 'disabled capture'; end if;
 perform public.configure_telegram_alerts('-1001234567890',true);
 update public.telegram_alert_settings set activated_at=now()-interval '1 second';
 if exists(select 1 from public.telegram_alert_outbox where kind='campaign_visited') then raise exception 'backfill'; end if;
 visit_id:=public.record_banksy_visit(repeat('2',64),link_id,link_id,0);
 perform public.record_banksy_visit(repeat('2',64),link_id,link_id,0);
 perform public.record_banksy_visit(repeat('2',64),link_id,link_id,1);
 perform public.record_banksy_visit(repeat('3',64),null,null,0);
 -- A first direct visit remains direct even if a campaign link is opened later.
 perform public.record_banksy_visit(repeat('3',64),null,link_id,1);
 if (select count(*) from public.telegram_alert_outbox where kind='campaign_visited')<>1 then raise exception 'retry or direct visit captured'; end if;
 if not exists(select 1 from public.telegram_alert_outbox where kind='campaign_visited' and source_id=visit_id) then raise exception 'wrong source'; end if;
 if public.claim_telegram_alert_batch_with_cs_content('-1009999999999') is not null then raise exception 'wrong room claimed'; end if;
 batch:=public.claim_telegram_alert_batch_with_cs_content('-1001234567890');
 if jsonb_array_length(batch->'alerts')<>1 then raise exception 'wrong batch count'; end if;
 item:=batch->'alerts'->0;
 if item->>'campaign_name'<>'Mirrorworld · 뱅크시 이벤트' or item->>'campaign_channel'<>'mirrorworld' then raise exception 'missing attribution'; end if;
 if item->>'actor_name' is not null or item->>'actor_email' is not null or item ? 'session_hash' or item ? 'source_id' then raise exception 'unexpected identity'; end if;
 if not public.begin_telegram_alert_send((batch->>'batch_id')::uuid,'-1001234567890') then raise exception 'begin failed'; end if;
 perform public.finish_telegram_alert_batch((batch->>'batch_id')::uuid,'sent',123,null);
 if public.claim_telegram_alert_batch_with_cs_content('-1001234567890') is not null then raise exception 'duplicate send'; end if;
 update public.campaign_tracking_links set active=false where id=link_id;
 perform public.record_banksy_visit(repeat('4',64),link_id,link_id,0);
 if (select count(*) from public.telegram_alert_outbox where kind='campaign_visited')<>1 then raise exception 'stopped capture'; end if;
 if has_function_privilege('anon','public.capture_telegram_campaign_visit()','execute') or has_function_privilege('authenticated','public.capture_telegram_campaign_visit()','execute') then raise exception 'public trigger access'; end if;
 update public.campaign_tracking_links set active=true where id=link_id;
 begin
  perform public.record_banksy_visit(repeat('5',64),link_id,link_id,0);
  raise exception 'rollback fixture';
 exception when raise_exception then null;
 end;
 if (select count(*) from public.telegram_alert_outbox where kind='campaign_visited')<>1 then raise exception 'rolled-back visit alerted'; end if;
end $$;
create function pg_temp.fail_campaign_capture() returns trigger language plpgsql as $$ begin raise exception 'queue unavailable'; end $$;
create trigger test_campaign_queue_failure before insert on public.telegram_alert_outbox for each row execute function pg_temp.fail_campaign_capture();
select public.record_banksy_visit(repeat('6',64),'fa4be7ed-782e-48f2-8537-628e5cd4e920','fa4be7ed-782e-48f2-8537-628e5cd4e920',0);
do $$ begin
 if not exists(select 1 from public.campaign_visits where session_hash=repeat('6',64)) then raise exception 'alert failure blocked visit'; end if;
end $$;
rollback;
