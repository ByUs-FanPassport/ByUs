select current_database()='byus_clean' as is_disposable_clean_db \gset
\if :is_disposable_clean_db
create extension dblink with schema extensions;
create or replace function public.byus_day_rsvp_now() returns timestamptz
language sql volatile security definer set search_path='' as $$select '2026-10-02 12:00:00+09'::timestamptz$$;

-- Two real sessions prove that new-key submissions serialize on the shared
-- budget lock instead of racing the contact/idempotency checks.
do $$
declare connection_string text:=format('host=%s port=%s dbname=%s user=%s',current_setting('unix_socket_directories'),current_setting('port'),current_database(),current_user);
  accepted boolean;
begin
  perform extensions.dblink_connect('rsvp_submit_a',connection_string);
  perform extensions.dblink_connect('rsvp_submit_b',connection_string);
  perform extensions.dblink_exec('rsvp_submit_a','begin');
  perform extensions.dblink_exec('rsvp_submit_b','begin');
  select result into accepted from extensions.dblink('rsvp_submit_a',$q$
    select public.submit_byus_day_rsvp('ba000000-0000-4000-8000-000000000061','ko','경합','Race A','+821000000061','A','A','race61@example.com','KR',true,repeat('6',64),repeat('1',64))
  $q$) as t(result boolean);
  perform extensions.dblink_send_query('rsvp_submit_b',$q$
    select public.submit_byus_day_rsvp('ba000000-0000-4000-8000-000000000062','ko','경합','Race B','+821000000062','A','A','race62@example.com','KR',true,repeat('6',64),repeat('2',64))
  $q$);
  perform pg_sleep(0.2);
  if not accepted or extensions.dblink_is_busy('rsvp_submit_b')<>1 then raise exception 'concurrent submit did not wait on durable budget lock'; end if;
  perform extensions.dblink_exec('rsvp_submit_a','rollback');
  select result into accepted from extensions.dblink_get_result('rsvp_submit_b') as t(result boolean);
  if not accepted then raise exception 'serialized concurrent submit failed'; end if;
  perform extensions.dblink_disconnect('rsvp_submit_a');
  -- Disconnect rolls back the still-open test transaction after its result was checked.
  perform extensions.dblink_disconnect('rsvp_submit_b');
end$$;

-- A claimed privacy-free alert and exact-deadline purge share settings→outbox
-- lock order. Purge waits, then removes the RSVP and alert after claim rollback.
select public.configure_telegram_alerts('-1001234567890',true);
select public.submit_byus_day_rsvp('ba000000-0000-4000-8000-000000000071','ko','폐기','Purge Race','+821000000071','A','A','purge71@example.com','KR',true,repeat('7',64),repeat('1',64));
create or replace function public.byus_day_rsvp_now() returns timestamptz
language sql volatile security definer set search_path='' as $$select '2026-11-22 00:00:00+09'::timestamptz$$;
do $$
declare connection_string text:=format('host=%s port=%s dbname=%s user=%s',current_setting('unix_socket_directories'),current_setting('port'),current_database(),current_user);
  claimed jsonb; purged text;
begin
  perform extensions.dblink_connect('rsvp_claim',connection_string);
  perform extensions.dblink_connect('rsvp_purge',connection_string);
  perform extensions.dblink_exec('rsvp_claim','begin');
  select result into claimed from extensions.dblink('rsvp_claim',$q$select public.claim_telegram_alert_batch_with_cs_content('-1001234567890')$q$) as t(result jsonb);
  if claimed is null then raise exception 'RSVP alert was not claimable before purge race'; end if;
  perform extensions.dblink_send_query('rsvp_purge','select public.purge_byus_day_rsvps()::text');
  perform pg_sleep(0.2);
  if extensions.dblink_is_busy('rsvp_purge')<>1 then raise exception 'purge did not wait behind claim settings lock'; end if;
  perform extensions.dblink_exec('rsvp_claim','rollback');
  select result into purged from extensions.dblink_get_result('rsvp_purge') as t(result text);
  perform extensions.dblink_disconnect('rsvp_claim');
  perform extensions.dblink_disconnect('rsvp_purge');
  if exists(select 1 from public.byus_day_rsvps) or exists(select 1 from public.telegram_alert_outbox where kind='byus_day_rsvp_received') then raise exception 'purge race left RSVP data'; end if;
end$$;
create or replace function public.byus_day_rsvp_now() returns timestamptz
language sql volatile security definer set search_path='' as $$select clock_timestamp()$$;
drop extension dblink;
\endif

begin;

-- Keep this suite deterministic after the public event closes. The replacement
-- is transaction-local and rolls back to the production clock implementation.
create or replace function public.byus_day_rsvp_now() returns timestamptz
language sql volatile security definer set search_path='' as $$
  select coalesce(nullif(current_setting('byus_day.test_now',true), '')::timestamptz,'2026-10-02 12:00:00+09'::timestamptz)
$$;
set local byus_day.test_now='2026-10-02 12:00:00+09';

do $$
declare
  fn text:=pg_get_functiondef('public.submit_byus_day_rsvp(uuid,text,text,text,text,text,text,text,text,boolean,text,text)'::regprocedure);
begin
  if has_table_privilege('anon','public.byus_day_rsvps','select') or has_table_privilege('authenticated','public.byus_day_rsvps','select')
    or has_table_privilege('service_role','public.byus_day_rsvps','select') then raise exception 'RSVP table is readable'; end if;
  if has_function_privilege('anon','public.submit_byus_day_rsvp(uuid,text,text,text,text,text,text,text,text,boolean,text,text)','execute')
    or has_function_privilege('authenticated','public.submit_byus_day_rsvp(uuid,text,text,text,text,text,text,text,text,boolean,text,text)','execute')
    or not has_function_privilege('service_role','public.submit_byus_day_rsvp(uuid,text,text,text,text,text,text,text,text,boolean,text,text)','execute') then raise exception 'RSVP RPC grants mismatch'; end if;
  if position('2026-10-23 00:00:00+09' in fn)=0 or position('pg_advisory_xact_lock' in fn)=0 then raise exception 'close or concurrency guard missing'; end if;
  if has_function_privilege('service_role','public.byus_day_rsvp_now()','execute') then raise exception 'testable clock helper is externally executable'; end if;
  if not exists(select 1 from cron.job where jobname='byus-day-rsvp-retention' and schedule='0 * * * *' and command='select public.purge_byus_day_rsvps()') then raise exception 'retention cron registration mismatch'; end if;
end $$;

set local byus_day.test_now='2026-10-22 23:59:59.999999+09';
select public.submit_byus_day_rsvp('ba000000-0000-4000-8000-000000000000','ko','직전','Before Close','+821000000000','A','A','before-close@example.com','KR',true,repeat('0',64),repeat('0',64));
set local byus_day.test_now='2026-10-23 00:00:00+09';
do $$begin
  begin
    perform public.submit_byus_day_rsvp('ba000000-0000-4000-8000-000000000099','ko','마감','At Close','+821000000099','A','A','at-close@example.com','KR',true,repeat('0',64),repeat('9',64));
    raise exception 'cutoff accepted exact-boundary RSVP';
  exception when others then if sqlerrm<>'RSVP_CLOSED' then raise; end if; end;
end$$;
set local byus_day.test_now='2026-10-02 12:00:00+09';

select public.configure_telegram_alerts('-1001234567890',true);

do $$
declare outbox_before bigint; outbox_after bigint;
begin
  select count(*) into outbox_before from public.telegram_alert_outbox;
  perform public.submit_byus_day_rsvp('ba000000-0000-4000-8000-000000000001','ko','김별','Byeol Kim','+821012345678','ByUs','기획','byeol@example.com','KR',true,repeat('a',64),repeat('1',64));
  perform public.submit_byus_day_rsvp('ba000000-0000-4000-8000-000000000001','ko','김별','Byeol Kim','+821012345678','ByUs','기획','byeol@example.com','KR',true,repeat('a',64),repeat('1',64));
  if (select count(*) from public.byus_day_rsvps where id='ba000000-0000-4000-8000-000000000001')<>1 then raise exception 'idempotent retry duplicated RSVP'; end if;
  select count(*) into outbox_after from public.telegram_alert_outbox;
  if outbox_after<>outbox_before+1 then raise exception 'idempotent retry duplicated alert'; end if;
  if exists(select 1 from public.telegram_alert_outbox where kind='byus_day_rsvp_received' and (source_id is not null or activity_context ~ '김별|010|@')) then raise exception 'RSVP alert leaked identity'; end if;

  begin
    perform public.submit_byus_day_rsvp('ba000000-0000-4000-8000-000000000001','ko','다른 이름','Other Name','+821012345678','ByUs','기획','byeol@example.com','KR',true,repeat('a',64),repeat('2',64));
    raise exception 'idempotency conflict accepted';
  exception when others then if sqlerrm<>'RSVP_IDEMPOTENCY_CONFLICT' then raise; end if; end;

  perform public.submit_byus_day_rsvp('ba000000-0000-4000-8000-000000000002','en','김별','Byeol Kim','+821012345678','Other','Other','byeol@example.com','US',true,repeat('b',64),repeat('3',64));
  if (select count(*) from public.byus_day_rsvps where email_normalized='byeol@example.com' and phone_e164='+821012345678')<>1 then raise exception 'contact duplicate was not generically acknowledged'; end if;
  begin
    perform public.submit_byus_day_rsvp('ba000000-0000-4000-8000-000000000002','en','김별','Changed Name','+821012345678','Other','Other','byeol@example.com','US',true,repeat('b',64),repeat('4',64));
    raise exception 'generic contact duplicate failed to reserve its idempotency key';
  exception when others then if sqlerrm<>'RSVP_IDEMPOTENCY_CONFLICT' then raise; end if; end;
end $$;

do $$
begin
  perform public.submit_byus_day_rsvp('ba000000-0000-4000-8000-000000000011','ko','가','A','+821000000011','A','A','a11@example.com','KR',true,repeat('c',64),repeat('1',64));
  perform public.submit_byus_day_rsvp('ba000000-0000-4000-8000-000000000012','ko','나','B','+821000000012','A','A','a12@example.com','KR',true,repeat('c',64),repeat('2',64));
  perform public.submit_byus_day_rsvp('ba000000-0000-4000-8000-000000000013','ko','다','C','+821000000013','A','A','a13@example.com','KR',true,repeat('c',64),repeat('3',64));
  begin
    perform public.submit_byus_day_rsvp('ba000000-0000-4000-8000-000000000014','ko','라','D','+821000000014','A','A','a14@example.com','KR',true,repeat('c',64),repeat('4',64));
    raise exception 'rate limit accepted fourth request';
  exception when others then if sqlerrm<>'RSVP_RATE_LIMITED' then raise; end if; end;
end $$;

-- New UUIDs spend the same budget before any contact lookup. Once exhausted,
-- both an existing contact and a new contact produce the identical error.
do $$
declare existing_error text; new_error text;
begin
  perform public.submit_byus_day_rsvp('ba000000-0000-4000-8000-000000000041','ko','김별','Byeol Kim','+821012345678','A','A','byeol@example.com','KR',true,repeat('9',64),repeat('1',64));
  perform public.submit_byus_day_rsvp('ba000000-0000-4000-8000-000000000042','ko','김별','Byeol Kim','+821012345678','A','A','byeol@example.com','KR',true,repeat('9',64),repeat('2',64));
  perform public.submit_byus_day_rsvp('ba000000-0000-4000-8000-000000000043','ko','김별','Byeol Kim','+821012345678','A','A','byeol@example.com','KR',true,repeat('9',64),repeat('3',64));
  -- Exact replay is still allowed after the budget is exhausted.
  perform public.submit_byus_day_rsvp('ba000000-0000-4000-8000-000000000043','ko','김별','Byeol Kim','+821012345678','A','A','byeol@example.com','KR',true,repeat('9',64),repeat('3',64));
  begin
    perform public.submit_byus_day_rsvp('ba000000-0000-4000-8000-000000000044','ko','김별','Byeol Kim','+821012345678','A','A','byeol@example.com','KR',true,repeat('9',64),repeat('4',64));
  exception when others then existing_error:=sqlerrm; end;
  begin
    perform public.submit_byus_day_rsvp('ba000000-0000-4000-8000-000000000045','ko','새 이름','New Person','+821000000045','B','B','new45@example.com','KR',true,repeat('9',64),repeat('5',64));
  exception when others then new_error:=sqlerrm; end;
  if existing_error is distinct from 'RSVP_RATE_LIMITED' or new_error is distinct from existing_error then
    raise exception 'contact existence changed exhausted-budget response existing=% new=%',existing_error,new_error;
  end if;
  if (select submission_count from public.byus_day_rsvp_rate_limits where ip_hash=repeat('9',64))<>3
    or (select count(*) from public.byus_day_rsvp_idempotency where id in (
      'ba000000-0000-4000-8000-000000000041','ba000000-0000-4000-8000-000000000042','ba000000-0000-4000-8000-000000000043',
      'ba000000-0000-4000-8000-000000000044','ba000000-0000-4000-8000-000000000045'))<>3 then
    raise exception 'request budget and idempotency rows diverged';
  end if;
end $$;

select public.configure_telegram_alerts(null,false);
do $$
declare before_count bigint;
begin
  select count(*) into before_count from public.telegram_alert_outbox where kind='byus_day_rsvp_received';
  perform public.submit_byus_day_rsvp('ba000000-0000-4000-8000-000000000021','ko','마','E','+821000000021','A','A','a21@example.com','KR',true,repeat('d',64),repeat('1',64));
  if (select count(*) from public.byus_day_rsvps where id='ba000000-0000-4000-8000-000000000021')<>1 then raise exception 'disabled Telegram lost RSVP'; end if;
  if (select count(*) from public.telegram_alert_outbox where kind='byus_day_rsvp_received')<>before_count then raise exception 'disabled Telegram enqueued alert'; end if;
end $$;

delete from public.telegram_alert_settings;
select public.submit_byus_day_rsvp('ba000000-0000-4000-8000-000000000022','ko','바','F','+821000000022','A','A','a22@example.com','KR',true,repeat('e',64),repeat('1',64));
do $$ begin if not exists(select 1 from public.byus_day_rsvps where id='ba000000-0000-4000-8000-000000000022') then raise exception 'missing Telegram settings lost RSVP'; end if; end $$;

insert into public.telegram_alert_settings(singleton,enabled,chat_id) values(true,true,'-1001234567890');
create function pg_temp.reject_rsvp_alert() returns trigger language plpgsql as $$begin if new.kind='byus_day_rsvp_received' then raise exception 'forced outbox failure'; end if; return new; end$$;
create trigger reject_rsvp_alert before insert on public.telegram_alert_outbox for each row execute function pg_temp.reject_rsvp_alert();
do $$
begin
  begin
    perform public.submit_byus_day_rsvp('ba000000-0000-4000-8000-000000000031','ko','사','G','+821000000031','A','A','a31@example.com','KR',true,repeat('f',64),repeat('1',64));
    raise exception 'forced outbox failure was ignored';
  exception when others then if sqlerrm<>'forced outbox failure' then raise; end if; end;
  if exists(select 1 from public.byus_day_rsvps where id='ba000000-0000-4000-8000-000000000031')
    or exists(select 1 from public.byus_day_rsvp_rate_limits where ip_hash=repeat('f',64))
    or exists(select 1 from public.byus_day_rsvp_idempotency where id='ba000000-0000-4000-8000-000000000031') then raise exception 'submit/outbox was not atomic'; end if;
end $$;

drop trigger reject_rsvp_alert on public.telegram_alert_outbox;
do $$
declare purge text:=pg_get_functiondef('public.purge_byus_day_rsvps()'::regprocedure);
begin
  if position('telegram_alert_settings where singleton for update' in purge)=0
    or position('2026-11-22 00:00:00+09' in purge)=0 then raise exception 'purge deadline or claim-compatible lock missing'; end if;
end $$;

set local byus_day.test_now='2026-11-21 23:59:59.999999+09';
select public.purge_byus_day_rsvps();
do $$begin
  if not exists(select 1 from public.byus_day_rsvps) or not exists(select 1 from public.byus_day_rsvp_idempotency) then raise exception 'purge ran before exact deadline'; end if;
end$$;
set local byus_day.test_now='2026-11-22 00:00:00+09';
select public.purge_byus_day_rsvps();
do $$begin
  if exists(select 1 from public.byus_day_rsvps) or exists(select 1 from public.byus_day_rsvp_idempotency)
    or exists(select 1 from public.byus_day_rsvp_rate_limits) or exists(select 1 from public.telegram_alert_outbox where kind='byus_day_rsvp_received') then
    raise exception 'exact-deadline purge left RSVP-related data';
  end if;
end$$;

rollback;
