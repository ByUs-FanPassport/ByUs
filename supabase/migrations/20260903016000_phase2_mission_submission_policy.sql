-- Qualify reward policy lookup inside the Mission submit function.

create or replace function public.submit_owned_live_mission(
  p_app_user_id uuid,p_mission_id uuid,p_idempotency_key uuid,p_answers jsonb,
  p_stamp_id uuid,p_stamp_operation_key text,p_stamp_issuance_id text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare mission public.live_surveys%rowtype; live_record public.live_events%rowtype;
  passport_record public.fan_passports%rowtype; attendance_record public.live_attendances%rowtype;
  response_record public.live_survey_responses%rowtype; existing public.live_survey_idempotency%rowtype;
  reward_setting public.live_reward_setting_revisions%rowtype; item jsonb; question_record public.live_survey_questions%rowtype;
  selected_id uuid; all_correct boolean:=true; request_hash text; activity_id uuid:=extensions.gen_random_uuid();
  job_id uuid:=extensions.gen_random_uuid(); expected_payload jsonb; job_record public.blockchain_jobs%rowtype;
  recipient text; celebrity_slug text; result jsonb; v_policy_version integer;
begin
  select * into mission from public.live_surveys where id=p_mission_id and publication_status='published' and not legacy_contract;
  if not found then raise exception 'PHASE2_MISSION_NOT_FOUND' using errcode='P0002'; end if;
  if statement_timestamp() < mission.visible_from or statement_timestamp() >= mission.visible_until then
    raise exception 'PHASE2_MISSION_NOT_VISIBLE' using errcode='55000';
  end if;
  perform public.validate_phase2_mission_contract(mission.id);
  select * into strict live_record from public.live_events where id=mission.live_event_id;
  request_hash:=encode(extensions.digest((jsonb_build_object('missionId',p_mission_id,'answers',p_answers))::text,'sha256'),'hex');
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('phase2:mission:key:'||p_idempotency_key::text,0));
  select * into existing from public.live_survey_idempotency where idempotency_key=p_idempotency_key for update;
  if found then
    if existing.app_user_id<>p_app_user_id or existing.live_event_id<>mission.live_event_id or existing.request_hash<>request_hash then raise exception 'PHASE2_MISSION_IDEMPOTENCY_CONFLICT' using errcode='23514'; end if;
    return existing.result;
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('phase2:mission:target:'||p_app_user_id::text||':'||p_mission_id::text,0));
  select * into response_record from public.live_survey_responses where app_user_id=p_app_user_id and survey_id=p_mission_id for update;
  if found then raise exception 'PHASE2_MISSION_ALREADY_COMPLETED' using errcode='23505'; end if;
  select * into passport_record from public.fan_passports where app_user_id=p_app_user_id and celebrity_id=live_record.celebrity_id and business_status='issued' for key share;
  if not found then raise exception 'PHASE2_MISSION_PASSPORT_REQUIRED' using errcode='42501'; end if;
  select address into recipient from public.user_wallets where app_user_id=p_app_user_id and chain_id=91342 and provider='privy' and wallet_type='embedded' for key share;
  if recipient is null then raise exception 'PHASE2_MISSION_WALLET_NOT_READY' using errcode='55000'; end if;
  if mission.attendance_requirement='required' then
    select * into attendance_record from public.live_attendances where app_user_id=p_app_user_id and live_event_id=mission.live_event_id;
    if not found then raise exception 'PHASE2_MISSION_ATTENDANCE_REQUIRED' using errcode='42501'; end if;
  end if;
  if jsonb_typeof(p_answers)<>'array' or jsonb_array_length(p_answers)<>(select count(*) from public.live_survey_questions where survey_id=p_mission_id) then raise exception 'PHASE2_MISSION_INVALID_ANSWERS' using errcode='22023'; end if;
  insert into public.live_survey_responses(app_user_id,live_event_id,celebrity_id,survey_id,attendance_id,passport_id,status,submitted_at,legacy_contract)
  values(p_app_user_id,mission.live_event_id,live_record.celebrity_id,mission.id,attendance_record.id,passport_record.id,'draft',null,false) returning * into response_record;
  for item in select value from jsonb_array_elements(p_answers) loop
    select * into question_record from public.live_survey_questions where id=(item->>'questionId')::uuid and survey_id=mission.id;
    if not found or jsonb_array_length(item->'selectedOptionIds')<>1 then raise exception 'PHASE2_MISSION_INVALID_ANSWERS' using errcode='22023'; end if;
    selected_id:=(item->'selectedOptionIds'->>0)::uuid;
    if not exists(select 1 from public.live_survey_options where id=selected_id and question_id=question_record.id) then raise exception 'PHASE2_MISSION_INVALID_ANSWERS' using errcode='22023'; end if;
    insert into public.live_survey_answers(response_id,question_id,selected_option_ids) values(response_record.id,question_record.id,array[selected_id]);
    if mission.mission_type='quiz' and selected_id<>question_record.correct_option_id then all_correct:=false; end if;
  end loop;
  update public.live_survey_responses set status='submitted',submitted_at=now(),correctness=case when mission.mission_type='quiz' then all_correct else null end where id=response_record.id returning * into response_record;
  select r.* into reward_setting from public.live_survey_reward_setting_bindings b join public.live_reward_setting_revisions r on r.id=b.reward_setting_revision_id where b.survey_id=mission.id and r.lifecycle_status='published';
  if not found then raise exception 'PHASE2_MISSION_REWARD_SETTINGS_REQUIRED' using errcode='23514'; end if;
  insert into public.fan_activities(id,app_user_id,celebrity_id,activity_type,source_type,source_id) values(activity_id,p_app_user_id,live_record.celebrity_id,'survey','live_survey_response',response_record.id);
  if reward_setting.mission_score>0 then insert into public.fan_score_ledger(activity_id,app_user_id,celebrity_id,points) values(activity_id,p_app_user_id,live_record.celebrity_id,reward_setting.mission_score); end if;
  select activation.policy_version into strict v_policy_version from public.reward_policy_activation activation where activation.singleton=true;
  if reward_setting.mission_ticket>0 then perform public.post_fan_ticket_entry(p_app_user_id,live_record.celebrity_id,'credit',reward_setting.mission_ticket,'mission_completion',response_record.id,response_record.id,v_policy_version,reward_setting.revision,reward_setting.id); end if;
  select slug into strict celebrity_slug from public.celebrities where id=live_record.celebrity_id;
  if p_stamp_operation_key is distinct from 'byus:stamp:v1:'||p_stamp_id::text or p_stamp_issuance_id!~'^0x[0-9a-f]{64}$' then raise exception 'PHASE2_MISSION_ISSUANCE_CONFLICT' using errcode='22023'; end if;
  expected_payload:=jsonb_build_object('recipient',recipient,'celebritySlug',celebrity_slug,'issuanceId',p_stamp_issuance_id,'stampType','Survey');
  insert into public.blockchain_jobs(id,entity_type,entity_id,operation_key,payload_version,payload) values(job_id,'stamp',p_stamp_id,p_stamp_operation_key,1,expected_payload) on conflict(operation_key) do nothing;
  select * into job_record from public.blockchain_jobs where operation_key=p_stamp_operation_key for update;
  if not found or job_record.id<>job_id or job_record.entity_id<>p_stamp_id or job_record.payload<>expected_payload then raise exception 'PHASE2_MISSION_ISSUANCE_CONFLICT' using errcode='23514'; end if;
  insert into public.stamps(id,app_user_id,celebrity_id,passport_id,activity_id,stamp_type,blockchain_job_id) values(p_stamp_id,p_app_user_id,live_record.celebrity_id,passport_record.id,activity_id,'survey',job_id);
  perform public.freeze_live_reward_settings_on_issuance(reward_setting.id,now(),'live_survey_response',response_record.id);
  result:=jsonb_build_object('mission',jsonb_build_object('id',mission.id,'type',mission.mission_type,'completed',true,'correctness',case when mission.mission_type='quiz' then all_correct else null end,'scorePoints',reward_setting.mission_score,'ticketAmount',reward_setting.mission_ticket,'stamp',jsonb_build_object('id',p_stamp_id,'businessStatus','completed','mintStatus','queued')));
  insert into public.live_survey_idempotency(idempotency_key,app_user_id,live_event_id,operation,request_hash,response_id,result) values(p_idempotency_key,p_app_user_id,mission.live_event_id,'submit',request_hash,response_record.id,result);
  return result;
end $$;
