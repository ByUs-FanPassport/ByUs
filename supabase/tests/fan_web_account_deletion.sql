begin;
create function pg_temp.deletion_expect_error(statement text,expected text) returns void language plpgsql as $$
begin execute statement; raise exception 'expected:%',expected;
exception when others then if sqlerrm='expected:'||expected or position(expected in sqlerrm)=0 then raise; end if; end $$;
do $$
declare
  active_recipient uuid:=extensions.gen_random_uuid(); allowlist uuid:=extensions.gen_random_uuid(); requirement uuid:=extensions.gen_random_uuid(); reward public.live_reward_setting_revisions%rowtype;
  fan uuid:=extensions.gen_random_uuid(); artist uuid:=extensions.gen_random_uuid(); quiz uuid:=extensions.gen_random_uuid(); attempt uuid:=extensions.gen_random_uuid();
  passed uuid:=extensions.gen_random_uuid(); passport uuid:=extensions.gen_random_uuid(); chain_job uuid:=extensions.gen_random_uuid();
  brand uuid:=extensions.gen_random_uuid(); live_id uuid:=extensions.gen_random_uuid(); survey uuid; question uuid; response uuid; response_submitted uuid; object_id uuid;
  result jsonb; job jsonb; second_job jsonb; asset_job jsonb; private_path text; token text:=repeat('d',32); asset uuid:=extensions.gen_random_uuid();
begin
  insert into public.app_users(id,privy_user_id,verified_email) values(fan,'did:privy:deletion-qa','deletion-qa@example.test');
  insert into public.user_wallets(app_user_id,chain_id,address,provider,wallet_type) values(fan,91342,'0x'||replace(fan::text,'-','')||'00000000','privy','embedded');
  insert into public.user_profiles(app_user_id,nickname,nickname_normalized) values(fan,'Private name','private name');
  insert into public.celebrities(id,slug,status,image_url,published_at,roles,primary_role) values(artist,'deletion-qa','published','/test.webp',now(),'{creator}','creator');
  insert into public.celebrity_quizzes(id,celebrity_id,version,status) values(quiz,artist,1,'draft');
  insert into public.quiz_attempts(id,app_user_id,celebrity_id,quiz_id,quiz_version,idempotency_key,status,score,submitted_at) values(attempt,fan,artist,quiz,1,attempt,'passed',3,now());
  insert into public.quiz_passes(id,app_user_id,celebrity_id,winning_attempt_id) values(passed,fan,artist,attempt);
  insert into public.blockchain_jobs(id,entity_type,entity_id,operation_key,payload_version,payload) values(chain_job,'passport',passport,'byus:passport:v1:'||fan||':deletion-qa',1,jsonb_build_object('recipient','0x'||replace(fan::text,'-','')||'00000000','celebritySlug','deletion-qa','passportId','0x'||repeat('c',64)));
  insert into public.fan_passports(id,app_user_id,celebrity_id,quiz_pass_id,blockchain_job_id) values(passport,fan,artist,passed,chain_job);
  insert into public.community_stamp_share_links(token,owner_app_user_id,celebrity_id,fan_passport_id) values(token,fan,artist,passport);
  insert into public.brands(id,slug,status,logo_url,logo_alt,published_at) values(brand,'deletion-brand','published','/test.webp','Brand',now());
  insert into public.brand_localizations(brand_id,locale,name,description) values(brand,'ko','삭제 검증','소개'),(brand,'en','Deletion QA','Description');
  insert into public.celebrity_localizations(celebrity_id,locale,name,summary,image_alt) values(artist,'ko','삭제 검증','소개','사진'),(artist,'en','Deletion QA','Summary','Photo');
  insert into public.live_events(id,slug,celebrity_id,brand_id,publication_status,starts_at,ends_at,reservation_opens_at,reservation_closes_at,youtube_url,approved_hero_url,fan_code_hash,published_at,attendance_valid_from,attendance_valid_until)
    values(live_id,'deletion-live',artist,brand,'published',now()+interval '2 days',now()+interval '3 days',now(),now()+interval '1 day','https://www.youtube.com/watch?v=abcdefghijk','/test.webp',extensions.crypt('QA1234',extensions.gen_salt('bf',10)),now(),now()+interval '2 days',now()+interval '3 days');
  insert into public.live_event_localizations(live_event_id,locale,title,summary,hero_alt) values(live_id,'ko','삭제 방송','소개','사진'),(live_id,'en','Deletion LIVE','Summary','Photo');
  insert into public.app_users(id,privy_user_id,verified_email) values(active_recipient,'did:privy:deletion-active-recipient','deletion-active-recipient@example.test');
  insert into public.admin_allowlist(id,email,role,active) values(allowlist,'deletion-active-recipient@example.test','operator',true);
  insert into public.live_reward_setting_revisions(live_event_id,revision,policy_version,lifecycle_status,mission_score,mission_ticket,journey_bonus_ticket,correlation_id,published_at)
    select live_id,coalesce((select max(revision) from public.live_reward_setting_revisions where live_event_id=live_id),0)+1,policy_version,'published',1,1,0,extensions.gen_random_uuid(),now()
    from public.reward_policy_activation where singleton;
  select * into strict reward from public.live_reward_setting_revisions where live_event_id=live_id order by revision desc limit 1;
  insert into public.live_journey_requirement_revisions(id,live_event_id,revision,lifecycle_status,require_passport,require_reservation,require_attendance,bonus_ticket_amount,reward_setting_revision_id,reward_setting_revision,policy_version,actor_app_user_id,actor_admin_allowlist_id,correlation_id,published_at)
    values(requirement,live_id,1,'published',false,false,false,0,reward.id,reward.revision,reward.policy_version,active_recipient,allowlist,extensions.gen_random_uuid(),now());
  insert into public.live_journey_completions(app_user_id,live_event_id,requirement_revision_id,requirement_snapshot,bonus_ticket_amount,policy_version,reward_setting_revision,reward_setting_revision_id)
    values(fan,live_id,requirement,'{}',0,reward.policy_version,reward.revision,reward.id),(active_recipient,live_id,requirement,'{}',0,reward.policy_version,reward.revision,reward.id);
  for i in 1..2 loop
    survey:=extensions.gen_random_uuid(); question:=extensions.gen_random_uuid(); response:=extensions.gen_random_uuid();
    insert into public.live_surveys(id,live_event_id,version) values(survey,live_id,i);
    insert into public.live_survey_questions(id,survey_id,question_type,position) values(question,survey,'free_text',1);
    insert into public.live_survey_responses(id,app_user_id,live_event_id,celebrity_id,survey_id,passport_id,legacy_contract) values(response,fan,live_id,artist,survey,passport,false);
    insert into public.live_survey_answers(response_id,question_id,free_text) values(response,question,'Private phone 010-1234-5678');
    if i=1 then
      update public.live_survey_responses set status='submitted',submitted_at=now() where id=response;
      response_submitted:=response;
    end if;
  end loop;
  perform pg_temp.deletion_expect_error(format('update public.live_survey_answers set free_text=%L where response_id=%L','tamper',response_submitted),'submitted survey answers are immutable');
  insert into public.audit_logs(actor_app_user_id,action,entity_type,entity_id,before_after_summary) values(fan,'deletion.test','app_user',fan::text,'{"reason":"Private phone 010-1234-5678"}'::jsonb);
  perform pg_temp.deletion_expect_error(format('update public.audit_logs set before_after_summary=%L::jsonb where entity_id=%L','{}',fan::text),'audit logs are append-only');
  private_path:=fan::text||'/pending.webp';
  perform public.fan_web_begin_private_upload(fan,'fan-avatars',private_path);
  insert into public.content_assets(id,app_user_id,celebrity_id,storage_path,byte_size,width,height,sha256)
    values(asset,fan,artist,fan::text||'/'||asset::text||'.webp',3,1,1,repeat('a',64));
  result:=public.begin_owned_account_deletion('did:privy:deletion-qa');
  -- A single deleted recipient must not abort the publisher's active recipients.
  insert into public.live_collectible_claim_windows(live_event_id,schedule_revision,opens_at) values(live_id,1,now());
  if exists(select 1 from public.fan_notifications where app_user_id=fan and kind='collectible_claim_available' and live_event_id=live_id)
    or not exists(select 1 from public.fan_notifications where app_user_id=active_recipient and kind='collectible_claim_available' and live_event_id=live_id)
    then raise exception 'system notification publisher lost active recipients or emitted to a disabled owner'; end if;
  if result->>'status'<>'pending' or not public.has_approved_account_deletion('did:privy:deletion-qa') then raise exception 'request not durably accepted'; end if;
  if public.read_shared_passport_activity(token) is not null then raise exception 'delete did not revoke share'; end if;
  perform pg_temp.deletion_expect_error(format('select public.fan_web_patch_notification_preferences(%L,%L::jsonb)',fan,'{"reply_notifications":true}'),'FAN_WEB_ACTIVE_ACCOUNT_REQUIRED');
  job:=public.claim_account_deletion(fan);
  if exists(select 1 from public.user_profiles where app_user_id=fan)
    or exists(select 1 from public.live_survey_answers a join public.live_survey_responses r on r.id=a.response_id where r.app_user_id=fan and a.free_text<>'[deleted]') then raise exception 'personal data survived scrub'; end if;
  if not exists(select 1 from public.audit_logs where entity_id=fan::text and before_after_summary='{}'::jsonb and action='deletion.test') then raise exception 'private audit summary retained or audit fact lost'; end if;
  if not exists(select 1 from public.live_survey_responses where id=response_submitted and status='submitted') then raise exception 'submitted ledger lost'; end if;
  object_id:=(job#>>'{objects,0,id}')::uuid;
  perform public.finish_account_deletion_object(fan,(job->>'leaseToken')::uuid,object_id,(job#>>'{objects,0,generation}')::bigint);
  if public.account_deletion_storage_ready(fan,(job->>'leaseToken')::uuid) then raise exception 'unsettled private upload allowed completion'; end if;
  -- Late upload settles, advances generation, and invalidates an old remover.
  perform public.fan_web_finish_private_upload(fan,'fan-avatars',private_path);
  perform public.finish_account_deletion_object(fan,(job->>'leaseToken')::uuid,object_id,(job#>>'{objects,0,generation}')::bigint);
  if public.account_deletion_storage_ready(fan,(job->>'leaseToken')::uuid) then raise exception 'stale delete generation allowed completion'; end if;
  perform public.finish_account_deletion_object(fan,(job->>'leaseToken')::uuid,object_id,(job#>>'{objects,0,generation}')::bigint+1);
  if public.account_deletion_storage_ready(fan,(job->>'leaseToken')::uuid) then raise exception 'unsettled content upload allowed completion'; end if;
  if exists(select 1 from jsonb_array_elements(public.claim_content_asset_cleanup(50)->'items') i where i->>'id'=asset::text) then raise exception 'cleanup claimed unsettled content upload'; end if;
  perform public.abandon_content_asset_upload(fan,asset);
  select i into asset_job from jsonb_array_elements(public.claim_content_asset_cleanup(50)->'items') i where i->>'id'=asset::text;
  if asset_job is null then raise exception 'settled upload was not queued'; end if;
  perform public.finish_content_asset_cleanup(asset,(asset_job->>'generation')::bigint,true);
  if not public.complete_account_deletion(fan,(job->>'leaseToken')::uuid) then raise exception 'ready cleanup could not complete'; end if;
  if (public.begin_owned_account_deletion('did:privy:deletion-qa')->>'status')<>'completed' then raise exception 'completed receipt not idempotent'; end if;
  if exists(select 1 from public.app_users where id=fan and (status<>'disabled' or verified_email='deletion-qa@example.test' or privy_user_id='did:privy:deletion-qa')) then raise exception 'identity not anonymized'; end if;
  if not exists(select 1 from public.fan_passports where id=passport) then raise exception 'onchain ledger lost'; end if;
  perform pg_temp.deletion_expect_error(format('select * from public.sync_privy_identity(%L,%L,91342,%L)','did:privy:deletion-qa','deletion-qa@example.test','0x'||replace(fan::text,'-','')||'00000000'),'ACCOUNT_DELETED');
  -- Defensive recovery if an upload completion/abandon arrives after completion.
  perform public.abandon_content_asset_upload(fan,asset);
  if (public.begin_owned_account_deletion('did:privy:deletion-qa')->>'status')<>'pending' then raise exception 'late asset cleanup did not reopen receipt'; end if;
  if has_function_privilege('authenticated','public.begin_owned_account_deletion(text)','EXECUTE') or has_table_privilege('service_role','public.account_subject_tombstones','SELECT') then raise exception 'deletion private state leaked'; end if;
end $$;
do $$
declare owner_id uuid:=extensions.gen_random_uuid(); challenge uuid:=extensions.gen_random_uuid(); channel uuid:=extensions.gen_random_uuid(); state_id uuid:=extensions.gen_random_uuid();
begin
  insert into public.app_users(id,privy_user_id,verified_email) values(owner_id,'did:privy:disabled-cleanup-qa','disabled-cleanup-qa@example.test');
  insert into public.phone_sms_verification_challenges(id,app_user_id,request_id,phone,phone_rate_key,otp_digest,expires_at,resend_at)
    values(challenge,owner_id,extensions.gen_random_uuid(),'01012345678',repeat('e',64),repeat('f',64),now()+interval '5 minutes',now()+interval '1 minute');
  insert into public.kakao_connection_states(id,app_user_id,state_hash,code_verifier,return_path,expires_at,purpose)
    values(state_id,owner_id,repeat('c',64),repeat('v',43),'/settings',now()+interval '5 minutes','alimtalk');
  insert into public.fan_notification_channels(id,app_user_id,kind,status,consent_version,consented_at,destination_fingerprint,destination_label,verified_at,verification_method,enrollment_generation)
    values(channel,owner_id,'kakao','eligible','kakao-alimtalk-v1',now(),repeat('b',64),'010-****-5678',now(),'sms_otp',challenge);
  -- Existing admin/lifecycle disable does not create an account deletion job.
  update public.app_users set status='disabled' where id=owner_id;
  if not exists(select 1 from public.phone_sms_verification_challenges where id=challenge and phone is null and otp_digest is null and cancelled_at is not null)
    or not exists(select 1 from public.kakao_connection_states where id=state_id and consumed_at is not null and expires_at<=now())
    or not exists(select 1 from public.fan_notification_channels where id=channel and status='disabled' and verification_method is null and enrollment_generation is null)
    then raise exception 'disabled owner lifecycle scrub was blocked'; end if;
  perform pg_temp.deletion_expect_error(format('update public.phone_sms_verification_challenges set phone=%L,otp_digest=%L where id=%L','01012345678',repeat('f',64),challenge),'FAN_WEB_ACTIVE_ACCOUNT_REQUIRED');
  perform pg_temp.deletion_expect_error(format('update public.fan_notification_channels set status=%L where id=%L','eligible',channel),'FAN_WEB_ACTIVE_ACCOUNT_REQUIRED');
end $$;
rollback;
select 'Account deletion scrub, private upload CAS, durable completion and tombstone PASS' as result;
