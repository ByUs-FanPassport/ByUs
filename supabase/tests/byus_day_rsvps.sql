select current_database()='byus_clean' as is_disposable_clean_db \gset
\if :is_disposable_clean_db
create extension dblink with schema extensions;
create or replace function public.byus_day_rsvp_now() returns timestamptz
language sql volatile security definer set search_path='' as $$select '2026-10-02 12:00:00+09'::timestamptz$$;

do $$
declare connection_string text:=format('host=%s port=%s dbname=%s user=%s',current_setting('unix_socket_directories'),current_setting('port'),current_database(),current_user);
  accepted boolean;
begin
  perform extensions.dblink_connect('rsvp_submit_a',connection_string);
  perform extensions.dblink_connect('rsvp_submit_b',connection_string);
  perform extensions.dblink_exec('rsvp_submit_a','begin');
  perform extensions.dblink_exec('rsvp_submit_b','begin');
  select result into accepted from extensions.dblink('rsvp_submit_a',$q$
    select public.submit_byus_day_rsvp('ba000000-0000-4000-8000-000000000061','ko','경합','Race A','+821000000061','A','A','race61@example.com','KR','v1.'||repeat('a',16)||'.'||repeat('b',22)||'.'||repeat('c',18),true,repeat('6',64),repeat('1',64))
  $q$) as t(result boolean);
  perform extensions.dblink_send_query('rsvp_submit_b',$q$
    select public.submit_byus_day_rsvp('ba000000-0000-4000-8000-000000000062','ko','경합','Race B','+821000000062','A','A','race62@example.com','KR','v1.'||repeat('d',16)||'.'||repeat('e',22)||'.'||repeat('f',18),true,repeat('6',64),repeat('2',64))
  $q$);
  perform pg_sleep(0.2);
  if not accepted or extensions.dblink_is_busy('rsvp_submit_b')<>1 then raise exception 'concurrent submit did not wait on durable budget lock'; end if;
  perform extensions.dblink_exec('rsvp_submit_a','rollback');
  select result into accepted from extensions.dblink_get_result('rsvp_submit_b') as t(result boolean);
  if not accepted then raise exception 'serialized concurrent submit failed'; end if;
  perform extensions.dblink_disconnect('rsvp_submit_a');
  perform extensions.dblink_disconnect('rsvp_submit_b');
end$$;
create or replace function public.byus_day_rsvp_now() returns timestamptz
language sql volatile security definer set search_path='' as $$select clock_timestamp()$$;
drop extension dblink;
\endif

begin;
create or replace function public.byus_day_rsvp_now() returns timestamptz
language sql volatile security definer set search_path='' as $$
  select coalesce(nullif(current_setting('byus_day.test_now',true), '')::timestamptz,'2026-10-02 12:00:00+09'::timestamptz)
$$;
set local byus_day.test_now='2026-10-02 12:00:00+09';

do $$
declare signature text:='public.submit_byus_day_rsvp(uuid,text,text,text,text,text,text,text,text,text,boolean,text,text)';
begin
  if has_table_privilege('anon','public.byus_day_rsvps','select') or has_table_privilege('authenticated','public.byus_day_rsvps','select')
    or has_table_privilege('service_role','public.byus_day_rsvps','select') then raise exception 'RSVP table is readable'; end if;
  if has_function_privilege('anon',signature,'execute') or has_function_privilege('authenticated',signature,'execute')
    or not has_function_privilege('service_role',signature,'execute') then raise exception 'RSVP RPC grants mismatch'; end if;
  if has_function_privilege('service_role','public.byus_day_rsvp_now()','execute') then raise exception 'clock helper is externally executable'; end if;
  if exists(select 1 from information_schema.columns where table_schema='public' and table_name like 'byus_day_rsvp%' and column_name='delete_after')
    or to_regprocedure('public.purge_byus_day_rsvps()') is not null
    or exists(select 1 from cron.job where jobname='byus-day-rsvp-retention') then raise exception 'automatic RSVP deletion still exists'; end if;
  if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='byus_day_rsvps' and column_name='resident_registration_number_encrypted')
    or exists(select 1 from information_schema.columns where table_schema='public' and table_name='byus_day_rsvps' and column_name in ('resident_registration_number','rrn')) then raise exception 'RRN storage boundary mismatch'; end if;
end$$;

set local byus_day.test_now='2026-10-12 23:59:59.999999+09';
select public.submit_byus_day_rsvp('ba000000-0000-4000-8000-000000000000','ko','직전','Before Close','+821000000000','A','A','before-close@example.com','KR','v1.'||repeat('a',16)||'.'||repeat('b',22)||'.'||repeat('c',18),true,repeat('0',64),repeat('0',64));
set local byus_day.test_now='2026-10-13 00:00:00+09';
do $$begin
  begin
    perform public.submit_byus_day_rsvp('ba000000-0000-4000-8000-000000000099','ko','마감','At Close','+821000000099','A','A','at-close@example.com','KR','v1.'||repeat('a',16)||'.'||repeat('b',22)||'.'||repeat('c',18),true,repeat('0',64),repeat('9',64));
    raise exception 'cutoff accepted exact-boundary RSVP';
  exception when others then if sqlerrm<>'RSVP_CLOSED' then raise; end if; end;
end$$;
set local byus_day.test_now='2026-10-02 12:00:00+09';

select public.configure_telegram_alerts('-1001234567890',true);
do $$
declare envelope text:='v1.'||repeat('a',16)||'.'||repeat('b',22)||'.'||repeat('c',18); before_alerts bigint; before_alert_ids uuid[]; alert public.telegram_alert_outbox%rowtype; rsvp_total integer;
begin
  select count(*),coalesce(array_agg(id),'{}'::uuid[]) into before_alerts,before_alert_ids from public.telegram_alert_outbox;
  perform public.submit_byus_day_rsvp('ba000000-0000-4000-8000-000000000001','ko','김별','Byeol Kim','+821012345678','ByUs','기획','byeol@example.com','KR',envelope,true,repeat('a',64),repeat('1',64));
  perform public.submit_byus_day_rsvp('ba000000-0000-4000-8000-000000000001','ko','김별','Byeol Kim','+821012345678','ByUs','기획','byeol@example.com','KR',envelope,true,repeat('a',64),repeat('1',64));
  if (select count(*) from public.byus_day_rsvps where id='ba000000-0000-4000-8000-000000000001')<>1
    or (select count(*) from public.telegram_alert_outbox)<>before_alerts+1 then raise exception 'idempotent retry duplicated RSVP or alert'; end if;
  select * into strict alert from public.telegram_alert_outbox where kind='byus_day_rsvp_received' and not(id=any(before_alert_ids));
  select count(*)::integer into rsvp_total from public.byus_day_rsvps;
  if (select resident_registration_number_encrypted from public.byus_day_rsvps where id='ba000000-0000-4000-8000-000000000001')<>envelope
    or alert.activity_context<>'김별 · Byeol Kim' or alert.activity_quantity<>rsvp_total
    or alert.source_id is distinct from 'ba000000-0000-4000-8000-000000000001'::uuid or alert.activity_source_id is not null or alert.activity_actor_id is not null
    or alert.activity_context like '%byeol@example.com%' or alert.activity_context like '%+821012345678%'
    or alert.activity_context like '%900101%' or alert.activity_context like '%'||envelope||'%'
  then raise exception 'RRN storage or alert boundary failed'; end if;
  begin
    perform public.submit_byus_day_rsvp('ba000000-0000-4000-8000-000000000001','ko','김별','Changed','+821012345678','ByUs','기획','byeol@example.com','KR',envelope,true,repeat('a',64),repeat('2',64));
    raise exception 'idempotency conflict accepted';
  exception when others then if sqlerrm<>'RSVP_IDEMPOTENCY_CONFLICT' then raise; end if; end;
  begin
    perform public.submit_byus_day_rsvp('ba000000-0000-4000-8000-000000000002','ko','형식','Bad Envelope','+821000000002','A','A','bad2@example.com','KR','900101-1234567',true,repeat('b',64),repeat('2',64));
    raise exception 'plaintext RRN reached storage';
  exception when others then if sqlerrm<>'RSVP_INVALID' then raise; end if; end;
end$$;

do $$
declare batch jsonb; entry jsonb; payload jsonb;
begin
  -- Isolate this batch from permission probes and earlier fixtures in the full suite.
  update public.telegram_alert_settings set next_send_at='-infinity',lease_expires_at=null,batch_id=null;
  update public.telegram_alert_outbox set available_at='infinity'
    where source_id is distinct from 'ba000000-0000-4000-8000-000000000001'::uuid;
  insert into public.telegram_alert_outbox(kind,source_id,activation_id,chat_id,occurred_at,activity_context,activity_quantity)
    select 'byus_day_rsvp_received',v.source_id,c.activation_id,c.chat_id,clock_timestamp(),v.context,1
    from public.telegram_alert_settings c cross join (values
      (null::uuid,'누적 1명'),(null::uuid,'이전 · Legacy Guest'),
      ('ba000000-0000-4000-8000-000000000088'::uuid,'삭제됨 · Removed Guest')
    ) v(source_id,context);
  batch:=public.claim_telegram_alert_batch_with_cs_content('-1001234567890');
  if batch is null or jsonb_array_length(batch->'alerts')<>4 then raise exception 'RSVP claim compatibility failed'; end if;
  select value into strict payload from jsonb_array_elements(batch->'alerts') where value->>'activity_context'='김별 · Byeol Kim';
  if payload->'rsvp' is distinct from '{"affiliation":"ByUs","occupation":"기획"}'::jsonb
    or payload->>'actor_email' is not null or payload::text like '%byeol@example.com%'
    or payload::text like '%+821012345678%' or payload::text like '%resident_registration%' or payload::text like '%v1.%'
  then raise exception 'RSVP affiliation/occupation claim boundary failed'; end if;
  for entry in select value from jsonb_array_elements(batch->'alerts') where value->>'activity_context'<>'김별 · Byeol Kim' loop
    if entry ? 'rsvp' then raise exception 'legacy or missing RSVP acquired details'; end if;
  end loop;
end$$;

do $$
declare envelope text:='v1.'||repeat('d',16)||'.'||repeat('e',22)||'.'||repeat('f',18); existing_error text; new_error text;
begin
  for i in 1..3 loop
    perform public.submit_byus_day_rsvp(('ba000000-0000-4000-8000-00000000004'||i)::uuid,'ko','중복','Duplicate','+821012345678','A','A','byeol@example.com','KR',envelope,true,repeat('9',64),repeat(i::text,64));
  end loop;
  begin perform public.submit_byus_day_rsvp('ba000000-0000-4000-8000-000000000044','ko','중복','Duplicate','+821012345678','A','A','byeol@example.com','KR',envelope,true,repeat('9',64),repeat('4',64)); exception when others then existing_error:=sqlerrm; end;
  begin perform public.submit_byus_day_rsvp('ba000000-0000-4000-8000-000000000045','ko','신규','New','+821000000045','B','B','new45@example.com','KR',envelope,true,repeat('9',64),repeat('5',64)); exception when others then new_error:=sqlerrm; end;
  if existing_error is distinct from 'RSVP_RATE_LIMITED' or new_error is distinct from existing_error then raise exception 'contact enumeration guard failed'; end if;
end$$;

select public.configure_telegram_alerts(null,false);
do $$begin
  perform public.submit_byus_day_rsvp('ba000000-0000-4000-8000-000000000021','ko','비활성','Disabled','+821000000021','A','A','a21@example.com','KR','v1.'||repeat('a',16)||'.'||repeat('b',22)||'.'||repeat('c',18),true,repeat('d',64),repeat('1',64));
  if not exists(select 1 from public.byus_day_rsvps where id='ba000000-0000-4000-8000-000000000021') then raise exception 'disabled Telegram lost RSVP'; end if;
end$$;

delete from public.telegram_alert_settings;
do $$begin
  perform public.submit_byus_day_rsvp('ba000000-0000-4000-8000-000000000022','ko','설정없음','Missing Settings','+821000000022','A','A','a22@example.com','KR','v1.'||repeat('a',16)||'.'||repeat('b',22)||'.'||repeat('c',18),true,repeat('e',64),repeat('1',64));
  if not exists(select 1 from public.byus_day_rsvps where id='ba000000-0000-4000-8000-000000000022') then raise exception 'missing Telegram settings lost RSVP'; end if;
end$$;
insert into public.telegram_alert_settings(singleton,enabled,chat_id) values(true,true,'-1001234567890');

create function pg_temp.reject_rsvp_alert() returns trigger language plpgsql as $$begin if new.kind='byus_day_rsvp_received' then raise exception 'forced outbox failure'; end if; return new; end$$;
create trigger reject_rsvp_alert before insert on public.telegram_alert_outbox for each row execute function pg_temp.reject_rsvp_alert();
do $$begin
  begin
    perform public.submit_byus_day_rsvp('ba000000-0000-4000-8000-000000000031','ko','원자성','Atomic','+821000000031','A','A','a31@example.com','KR','v1.'||repeat('a',16)||'.'||repeat('b',22)||'.'||repeat('c',18),true,repeat('f',64),repeat('1',64));
    raise exception 'forced outbox failure was ignored';
  exception when others then if sqlerrm<>'forced outbox failure' then raise; end if; end;
  if exists(select 1 from public.byus_day_rsvps where id='ba000000-0000-4000-8000-000000000031') or exists(select 1 from public.byus_day_rsvp_idempotency where id='ba000000-0000-4000-8000-000000000031') then raise exception 'submit/outbox was not atomic'; end if;
end$$;

rollback;
