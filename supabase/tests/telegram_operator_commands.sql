begin;
create function pg_temp.command_expect(ok boolean,label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'FAIL %',label; end if; end $$;
do $$
declare before_users jsonb; stats jsonb; stamp bigint; signature text; role_name text;
begin
  before_users:=public.telegram_command_stats('users','2040-01-02T03:00:00Z');
  insert into public.app_users(id,privy_user_id,verified_email,status,created_at) values
    ('e1000000-0000-4000-8000-000000000001','did:privy:command-before','command-before@example.test','active','2040-01-01T14:59:59Z'),
    ('e1000000-0000-4000-8000-000000000002','did:privy:command-start','command-start@example.test','active','2040-01-01T15:00:00Z'),
    ('e1000000-0000-4000-8000-000000000003','did:privy:command-last','command-last@example.test','disabled','2040-01-02T14:59:59Z'),
    ('e1000000-0000-4000-8000-000000000004','did:privy:command-after','command-after@example.test','active','2040-01-02T15:00:00Z');
  stats:=public.telegram_command_stats('users','2040-01-02T03:00:00Z');
  perform pg_temp.command_expect((stats->>'total_users')::integer=(before_users->>'total_users')::integer+4,'all members including passportless');
  perform pg_temp.command_expect((stats->>'active_users')::integer=(before_users->>'active_users')::integer+3,'active is account status');
  perform pg_temp.command_expect((stats->>'disabled_users')::integer=(before_users->>'disabled_users')::integer+1,'disabled members explicit');
  perform pg_temp.command_expect(stats->'passport_users'=before_users->'passport_users','passportless users distinct');
  stats:=public.telegram_command_stats('today','2040-01-02T03:00:00Z');
  perform pg_temp.command_expect(stats->>'date'='2040-01-02' and stats->>'signups'='2','KST midnight half-open interval including disabled signup facts');
  perform pg_temp.command_expect(not (stats ?| array['email','nickname','app_user_id']),'aggregate-only projection');

  foreach role_name in array array['anon','authenticated','service_role'] loop
    perform pg_temp.command_expect(not has_table_privilege(role_name,'public.telegram_command_settings','SELECT,INSERT,UPDATE,DELETE'),'private command state '||role_name);
    perform pg_temp.command_expect(not has_table_privilege(role_name,'public.telegram_command_receipts','SELECT,INSERT,UPDATE,DELETE'),'private receipts '||role_name);
    perform pg_temp.command_expect(not has_function_privilege(role_name,'public.telegram_command_stats(text,timestamptz)','execute'),'internal stats inaccessible '||role_name);
  end loop;
  foreach signature in array array['configure_telegram_commands(boolean)','read_telegram_command_state(text)',
    'begin_telegram_command_reply(text,bigint,text,bigint)','finish_telegram_command_reply(text,bigint,text,bigint)',
    'acknowledge_telegram_command_updates(text,bigint)','maintain_telegram_command_receipts()'] loop
    perform pg_temp.command_expect(not has_function_privilege('anon','public.'||signature,'execute') and
      not has_function_privilege('authenticated','public.'||signature,'execute') and
      has_function_privilege('service_role','public.'||signature,'execute'),'RPC ACL '||signature);
  end loop;
  perform pg_temp.command_expect((select bool_and(relrowsecurity and relforcerowsecurity) from pg_class where oid in
    ('public.telegram_command_settings'::regclass,'public.telegram_command_receipts'::regclass)),'forced RLS');
  perform public.configure_telegram_alerts('-100123',true);
  perform pg_temp.command_expect(public.read_telegram_command_state('-100123') is null,'commands disabled by default');
  perform public.configure_telegram_commands(true);
  stamp:=floor(extract(epoch from clock_timestamp()));
  perform pg_temp.command_expect(public.read_telegram_command_state('-999') is null,'wrong room cannot read state');
  perform pg_temp.command_expect(public.begin_telegram_command_reply('-999',101,'users',stamp) is null,'wrong room cannot read stats');
  perform pg_temp.command_expect(public.begin_telegram_command_reply('-100123',101,'arbitrary',stamp) is null,'unknown command blocked');
  perform pg_temp.command_expect(public.begin_telegram_command_reply('-100123',101,'users',stamp-1) is null,'preactivation command skipped');
  perform pg_temp.command_expect(public.begin_telegram_command_reply('-100123',101,'users',stamp+60) is null,'future command skipped');
  perform pg_temp.command_expect(public.begin_telegram_command_reply('-100123',101,'users',stamp-601) is null,'stale command skipped');
  stats:=public.begin_telegram_command_reply('-100123',101,'users',stamp);
  perform pg_temp.command_expect(stats->>'command'='users','command accepted');
  perform pg_temp.command_expect(public.begin_telegram_command_reply('-100123',101,'users',stamp) is null,'duplicate update blocked before send');
  perform pg_temp.command_expect(public.finish_telegram_command_reply('-100123',101,'sent',451),'send recorded');
  perform pg_temp.command_expect(not public.finish_telegram_command_reply('-100123',101,'sent',451),'duplicate finish blocked');
  perform pg_temp.command_expect(public.acknowledge_telegram_command_updates('-100123',102),'processed cursor advanced');
  perform public.acknowledge_telegram_command_updates('-100123',100);
  perform pg_temp.command_expect(public.read_telegram_command_state('-100123')->>'last_update_id'='102','cursor never moves backwards');
  perform pg_temp.command_expect(public.begin_telegram_command_reply('-100123',102,'today',stamp) is null,'acknowledged update never processed');
  perform pg_temp.command_expect(public.begin_telegram_command_reply('-100123',103,'help',stamp)->>'command'='help','help accepted');
  update public.telegram_command_receipts set created_at=clock_timestamp()-interval '3 minutes' where update_id=103;
  perform public.maintain_telegram_command_receipts();
  perform pg_temp.command_expect((select status='delivery_unknown' from public.telegram_command_receipts where update_id=103),'abandoned reply is unknown');
  perform pg_temp.command_expect(public.begin_telegram_command_reply('-100123',103,'help',stamp) is null,'ambiguous reply never resent');
  perform public.configure_telegram_commands(false);
  perform pg_temp.command_expect(public.read_telegram_command_state('-100123') is null and
    public.begin_telegram_command_reply('-100123',104,'help',stamp) is null,'disable stops new commands');
  update public.telegram_command_receipts set finished_at=clock_timestamp()-interval '31 days';
  perform public.maintain_telegram_command_receipts();
  perform pg_temp.command_expect(not exists(select 1 from public.telegram_command_receipts),'receipt retention');
  raise notice 'PASS Telegram command KST counts, status semantics, private ACL, room/TTL gates, receipt dedupe, cursor, unknown and retention';
end $$;
rollback;
