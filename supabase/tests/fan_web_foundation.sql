-- Run against the disposable latest-chain database; all fixtures roll back.
begin;
do $$
declare
  owner uuid := 'fa260000-0000-4000-8000-000000000001';
  other_user uuid := 'fa260000-0000-4000-8000-000000000002';
  artist uuid := 'fa260000-0000-4000-8000-000000000003';
  quiz uuid := 'fa260000-0000-4000-8000-000000000004';
  attempt uuid := 'fa260000-0000-4000-8000-000000000005';
  passed uuid := 'fa260000-0000-4000-8000-000000000006';
  passport_id uuid := 'fa260000-0000-4000-8000-000000000007';
  job_id uuid := 'fa260000-0000-4000-8000-000000000008';
  denied boolean := false;
begin
  insert into public.app_users(id,privy_user_id,verified_email) values
    (owner,'did:privy:fan-web-foundation-a','fan-web-foundation-a@example.test'),
    (other_user,'did:privy:fan-web-foundation-b','fan-web-foundation-b@example.test');
  insert into public.user_wallets(app_user_id,chain_id,address,provider,wallet_type)
    values(owner,91342,'0x'||repeat('a',40),'privy','embedded');
  insert into public.celebrities(id,slug,status,image_url,roles)
    values(artist,'fan-web-foundation','draft','/test.webp','{artist}');
  insert into public.celebrity_quizzes(id,celebrity_id,version,status)
    values(quiz,artist,1,'draft');
  insert into public.quiz_attempts(id,app_user_id,celebrity_id,quiz_id,quiz_version,idempotency_key,status,score,submitted_at)
    values(attempt,owner,artist,quiz,1,attempt,'passed',3,now());
  insert into public.quiz_passes(id,app_user_id,celebrity_id,winning_attempt_id)
    values(passed,owner,artist,attempt);
  insert into public.blockchain_jobs(id,entity_type,entity_id,operation_key,payload_version,payload)
    values(job_id,'passport',passport_id,'byus:passport:v1:'||owner||':fan-web-foundation',1,
      jsonb_build_object('recipient','0x'||repeat('a',40),'celebritySlug','fan-web-foundation','passportId','0x'||repeat('a',64)));
  insert into public.fan_passports(id,app_user_id,celebrity_id,quiz_pass_id,blockchain_job_id)
    values(passport_id,owner,artist,passed,job_id);
  if not public.fan_web_is_member(owner,artist)
    or public.fan_web_is_member(other_user,artist)
    or public.fan_web_is_member(null,artist) then
    raise exception 'Member access must require an owned issued Passport';
  end if;
  insert into public.user_blocks(app_user_id,blocked_app_user_id) values(owner,other_user);
  if not public.fan_web_blocked(owner,other_user)
    or not public.fan_web_blocked(other_user,owner)
    or public.fan_web_blocked(null,owner)
    or public.fan_web_blocked(owner,owner) then
    raise exception 'Blocks must be symmetric without treating guests/self as blocked';
  end if;
  perform public.fan_web_lock_active_user(owner);
  update public.app_users set status='disabled' where id=owner;
  if public.fan_web_is_member(owner,artist) then
    raise exception 'Disabled Passport owner retained member access';
  end if;
  begin
    perform public.fan_web_lock_active_user(owner);
  exception when insufficient_privilege then denied := true;
  end;
  if not denied then raise exception 'Active state must be checked after obtaining lock'; end if;
  if has_table_privilege('anon','public.user_blocks','SELECT')
    or has_table_privilege('authenticated','public.user_blocks','INSERT')
    or has_function_privilege('anon','public.fan_web_is_member(uuid,uuid)','EXECUTE')
    or has_function_privilege('authenticated','public.fan_web_blocked(uuid,uuid)','EXECUTE')
    or has_function_privilege('authenticated','public.fan_web_lock_active_user(uuid)','EXECUTE') then
    raise exception 'Fan-web foundation leaked browser role privileges';
  end if;
end;
$$;
rollback;
select 'Fan web membership, symmetric blocks and active-lock checks PASS' as result;
