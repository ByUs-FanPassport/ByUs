-- Phase 2 generalizes the existing Survey lineage into Quiz/Survey/Vote Missions.
-- Legacy Survey rows and RPCs keep their original contract.

alter table public.live_surveys
  add column mission_type text not null default 'survey'
    check (mission_type in ('quiz','survey','vote')),
  add column legacy_contract boolean not null default true,
  add column attendance_requirement text not null default 'required'
    check (attendance_requirement in ('required','not_required'));

drop index public.live_surveys_one_published_per_live_idx;
create unique index live_surveys_one_published_legacy_per_live_idx
  on public.live_surveys(live_event_id)
  where publication_status='published' and legacy_contract;

create table public.live_survey_localizations (
  survey_id uuid not null references public.live_surveys(id) on delete restrict,
  locale public.content_locale not null,
  title text not null check (length(btrim(title)) between 1 and 160),
  description text not null default '' check (length(description) <= 1200),
  primary key (survey_id,locale)
);

alter table public.live_survey_questions
  add column media_type text check (media_type is null or media_type in ('image','video')),
  add column media_url text,
  add constraint live_survey_question_media_complete check ((media_type is null)=(media_url is null));
alter table public.live_survey_options
  add column media_type text check (media_type is null or media_type in ('image','video')),
  add column media_url text,
  add constraint live_survey_option_media_complete check ((media_type is null)=(media_url is null));
alter table public.live_survey_questions add column correct_option_id uuid;
alter table public.live_survey_questions add constraint live_survey_questions_correct_option_fk
  foreign key (correct_option_id, id) references public.live_survey_options(id, question_id)
  deferrable initially deferred;

alter table public.live_survey_responses
  alter column attendance_id drop not null,
  add column legacy_contract boolean not null default true,
  add column correctness boolean;

alter table public.live_survey_responses
  drop constraint live_survey_responses_app_user_id_live_event_id_key;
create unique index live_survey_responses_one_legacy_per_live
  on public.live_survey_responses(app_user_id,live_event_id) where legacy_contract;
create unique index live_survey_responses_one_per_mission
  on public.live_survey_responses(app_user_id,survey_id);

create function public.validate_phase2_mission_contract(p_survey_id uuid)
returns void language plpgsql stable security definer set search_path='' as $$
declare mission public.live_surveys%rowtype;
begin
  select * into strict mission from public.live_surveys where id=p_survey_id;
  if mission.legacy_contract then return; end if;
  if not exists(select 1 from public.live_survey_localizations where survey_id=p_survey_id and locale='ko')
     or not exists(select 1 from public.live_survey_localizations where survey_id=p_survey_id and locale='en')
     or not exists(select 1 from public.live_survey_questions where survey_id=p_survey_id)
     or exists(select 1 from public.live_survey_questions where survey_id=p_survey_id and question_type<>'single_choice')
     or exists(select 1 from public.live_survey_questions q where q.survey_id=p_survey_id and
       (select count(*) from public.live_survey_options o where o.question_id=q.id)<2)
     or (mission.mission_type='quiz' and exists(select 1 from public.live_survey_questions q
       where q.survey_id=p_survey_id and q.correct_option_id is null))
     or (mission.mission_type<>'quiz' and exists(select 1 from public.live_survey_questions q
       where q.survey_id=p_survey_id and q.correct_option_id is not null)) then
    raise exception 'PHASE2_MISSION_INVALID_CONTRACT' using errcode='23514';
  end if;
end $$;

alter function public.assert_live_survey_publishable(uuid)
  rename to assert_legacy_live_survey_publishable;
create function public.assert_live_survey_publishable(p_survey_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare mission public.live_surveys%rowtype;
begin
  select * into mission from public.live_surveys where id=p_survey_id;
  if not found or mission.publication_status<>'published' then return; end if;
  if not exists(select 1 from public.live_events where id=mission.live_event_id and publication_status='published') then
    raise exception 'published mission requires a published live';
  end if;
  if mission.legacy_contract then perform public.assert_legacy_live_survey_publishable(p_survey_id);
  else perform public.validate_phase2_mission_contract(p_survey_id); end if;
end $$;

create function public.get_owned_live_missions(p_app_user_id uuid,p_live_slug text,p_locale public.content_locale)
returns jsonb language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',m.id,'type',m.mission_type,'version',m.version,
    'title',ml.title,'description',ml.description,
    'attendanceRequired',m.attendance_requirement='required',
    'completed',exists(select 1 from public.live_survey_responses r where r.survey_id=m.id and r.app_user_id=p_app_user_id and r.status='submitted'),
    'questions',(select coalesce(jsonb_agg(jsonb_build_object(
      'id',q.id,'text',ql.question_text,'media',case when q.media_type is null then null else jsonb_build_object('type',q.media_type,'url',q.media_url) end,
      'options',(select coalesce(jsonb_agg(jsonb_build_object('id',o.id,'label',ol.label,
        'media',case when o.media_type is null then null else jsonb_build_object('type',o.media_type,'url',o.media_url) end) order by o.position),'[]'::jsonb)
        from public.live_survey_options o join public.live_survey_option_localizations ol on ol.option_id=o.id and ol.locale=p_locale where o.question_id=q.id)
    ) order by q.position),'[]'::jsonb) from public.live_survey_questions q
      join public.live_survey_question_localizations ql on ql.question_id=q.id and ql.locale=p_locale where q.survey_id=m.id)
  ) order by m.version), '[]'::jsonb)
  from public.live_surveys m join public.live_events l on l.id=m.live_event_id
  join public.live_survey_localizations ml on ml.survey_id=m.id and ml.locale=p_locale
  where l.slug=p_live_slug and m.publication_status='published' and not m.legacy_contract;
$$;

create function public.submit_owned_live_mission(
  p_app_user_id uuid,p_mission_id uuid,p_idempotency_key uuid,p_answers jsonb,
  p_stamp_id uuid,p_stamp_operation_key text,p_stamp_issuance_id text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare mission public.live_surveys%rowtype; live_record public.live_events%rowtype;
  passport_record public.fan_passports%rowtype; attendance_record public.live_attendances%rowtype;
  response_record public.live_survey_responses%rowtype; existing public.live_survey_idempotency%rowtype;
  reward_setting public.live_reward_setting_revisions%rowtype; item jsonb; question_record public.live_survey_questions%rowtype;
  selected_id uuid; all_correct boolean:=true; request_hash text; activity_id uuid:=extensions.gen_random_uuid();
  job_id uuid:=extensions.gen_random_uuid(); expected_payload jsonb; job_record public.blockchain_jobs%rowtype;
  recipient text; celebrity_slug text; result jsonb; policy_version integer;
begin
  select * into mission from public.live_surveys where id=p_mission_id and publication_status='published' and not legacy_contract;
  if not found then raise exception 'PHASE2_MISSION_NOT_FOUND' using errcode='P0002'; end if;
  perform public.validate_phase2_mission_contract(mission.id);
  select * into strict live_record from public.live_events where id=mission.live_event_id;
  request_hash:=encode(extensions.digest((jsonb_build_object('missionId',p_mission_id,'answers',p_answers))::text,'sha256'),'hex');
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('phase2:mission:key:'||p_idempotency_key::text,0));
  select * into existing from public.live_survey_idempotency where idempotency_key=p_idempotency_key for update;
  if found then
    if existing.app_user_id<>p_app_user_id or existing.live_event_id<>mission.live_event_id or existing.request_hash<>request_hash then
      raise exception 'PHASE2_MISSION_IDEMPOTENCY_CONFLICT' using errcode='23514'; end if;
    return existing.result;
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('phase2:mission:target:'||p_app_user_id::text||':'||p_mission_id::text,0));
  select * into response_record from public.live_survey_responses where app_user_id=p_app_user_id and survey_id=p_mission_id for update;
  if found then raise exception 'PHASE2_MISSION_ALREADY_COMPLETED' using errcode='23505'; end if;
  select * into passport_record from public.fan_passports where app_user_id=p_app_user_id and celebrity_id=live_record.celebrity_id and status='active' for key share;
  if not found then raise exception 'PHASE2_MISSION_PASSPORT_REQUIRED' using errcode='42501'; end if;
  select address into recipient from public.user_wallets where app_user_id=p_app_user_id and chain_id=91342 and provider='privy' and wallet_type='embedded' for key share;
  if recipient is null then raise exception 'PHASE2_MISSION_WALLET_NOT_READY' using errcode='55000'; end if;
  if mission.attendance_requirement='required' then
    select * into attendance_record from public.live_attendances where app_user_id=p_app_user_id and live_event_id=mission.live_event_id;
    if not found then raise exception 'PHASE2_MISSION_ATTENDANCE_REQUIRED' using errcode='42501'; end if;
  end if;
  if jsonb_typeof(p_answers)<>'array' or jsonb_array_length(p_answers)<>(select count(*) from public.live_survey_questions where survey_id=p_mission_id) then
    raise exception 'PHASE2_MISSION_INVALID_ANSWERS' using errcode='22023'; end if;
  insert into public.live_survey_responses(app_user_id,live_event_id,celebrity_id,survey_id,attendance_id,passport_id,status,submitted_at,legacy_contract)
  values(p_app_user_id,mission.live_event_id,live_record.celebrity_id,mission.id,attendance_record.id,passport_record.id,'submitted',now(),false)
  returning * into response_record;
  for item in select value from jsonb_array_elements(p_answers) loop
    select * into question_record from public.live_survey_questions where id=(item->>'questionId')::uuid and survey_id=mission.id;
    if not found or jsonb_array_length(item->'selectedOptionIds')<>1 then raise exception 'PHASE2_MISSION_INVALID_ANSWERS' using errcode='22023'; end if;
    selected_id:=(item->'selectedOptionIds'->>0)::uuid;
    if not exists(select 1 from public.live_survey_options where id=selected_id and question_id=question_record.id) then raise exception 'PHASE2_MISSION_INVALID_ANSWERS' using errcode='22023'; end if;
    insert into public.live_survey_answers(response_id,question_id,selected_option_ids) values(response_record.id,question_record.id,array[selected_id]);
    if mission.mission_type='quiz' and selected_id<>question_record.correct_option_id then all_correct:=false; end if;
  end loop;
  update public.live_survey_responses set correctness=case when mission.mission_type='quiz' then all_correct else null end where id=response_record.id;
  select r.* into reward_setting from public.live_survey_reward_setting_bindings b join public.live_reward_setting_revisions r on r.id=b.reward_setting_revision_id where b.survey_id=mission.id and r.lifecycle_status='published';
  if not found then raise exception 'PHASE2_MISSION_REWARD_SETTINGS_REQUIRED' using errcode='23514'; end if;
  insert into public.fan_activities(id,app_user_id,celebrity_id,activity_type,source_type,source_id)
  values(activity_id,p_app_user_id,live_record.celebrity_id,'survey','live_survey_response',response_record.id);
  if reward_setting.mission_score>0 then insert into public.fan_score_ledger(activity_id,app_user_id,celebrity_id,points) values(activity_id,p_app_user_id,live_record.celebrity_id,reward_setting.mission_score); end if;
  select policy_version into strict policy_version from public.reward_policy_activation where singleton=true;
  if reward_setting.mission_ticket>0 then perform public.post_fan_ticket_entry(p_app_user_id,live_record.celebrity_id,'credit',reward_setting.mission_ticket,'mission_completion',response_record.id,response_record.id,policy_version,reward_setting.revision,reward_setting.id); end if;
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

create function public.admin_write_live_mission(
  p_actor_app_user_id uuid,p_actor_allowlist_id uuid,p_live_event_id uuid,
  p_command text,p_payload jsonb,p_correlation_id uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
declare mission_id uuid; next_version integer; question_item jsonb; option_item jsonb;
  question_id uuid; option_id uuid; correct_position integer;
begin
  perform public.admin_assert_active_survey_actor(p_actor_app_user_id,p_actor_allowlist_id,true);
  if p_correlation_id is null then raise exception 'correlation id is required'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('phase2:mission:admin:'||p_live_event_id::text,0));
  if p_command='create' then
    if p_payload->>'type' not in ('quiz','survey','vote') or p_payload->>'attendanceRequirement' not in ('required','not_required') then raise exception 'invalid mission contract'; end if;
    select coalesce(max(version),0)+1 into next_version from public.live_surveys where live_event_id=p_live_event_id;
    insert into public.live_surveys(live_event_id,version,mission_type,legacy_contract,attendance_requirement)
    values(p_live_event_id,next_version,p_payload->>'type',false,p_payload->>'attendanceRequirement') returning id into mission_id;
    insert into public.live_survey_localizations(survey_id,locale,title,description) values
      (mission_id,'ko',p_payload->'title'->>'ko',coalesce(p_payload->'description'->>'ko','')),
      (mission_id,'en',p_payload->'title'->>'en',coalesce(p_payload->'description'->>'en',''));
    for question_item in select value from jsonb_array_elements(p_payload->'questions') loop
      insert into public.live_survey_questions(survey_id,question_type,is_required,position,media_type,media_url)
      values(mission_id,'single_choice',true,(question_item->>'position')::smallint,question_item->'media'->>'type',question_item->'media'->>'url') returning id into question_id;
      insert into public.live_survey_question_localizations(question_id,locale,question_text) values
        (question_id,'ko',question_item->'text'->>'ko'),(question_id,'en',question_item->'text'->>'en');
      correct_position:=nullif(question_item->>'correctPosition','')::integer;
      for option_item in select value from jsonb_array_elements(question_item->'options') loop
        insert into public.live_survey_options(question_id,position,media_type,media_url)
        values(question_id,(option_item->>'position')::smallint,option_item->'media'->>'type',option_item->'media'->>'url') returning id into option_id;
        insert into public.live_survey_option_localizations(option_id,locale,label) values
          (option_id,'ko',option_item->'label'->>'ko'),(option_id,'en',option_item->'label'->>'en');
        if (option_item->>'position')::integer=correct_position then update public.live_survey_questions set correct_option_id=option_id where id=question_id; end if;
      end loop;
    end loop;
    perform public.validate_phase2_mission_contract(mission_id);
  elsif p_command='publish' then
    mission_id:=(p_payload->>'missionId')::uuid;
    perform public.validate_phase2_mission_contract(mission_id);
    update public.live_surveys set publication_status='published',lifecycle_status='published',published_at=now(),ever_published_at=coalesce(ever_published_at,now()),revision=revision+1
    where id=mission_id and live_event_id=p_live_event_id and not legacy_contract and lifecycle_status='draft';
    if not found then raise exception 'publishable mission not found'; end if;
  else raise exception 'unsupported mission command'; end if;
  insert into public.audit_logs(actor_app_user_id,actor_admin_allowlist_id,action,entity_type,entity_id,before_after_summary,correlation_id)
  values(p_actor_app_user_id,p_actor_allowlist_id,'admin.mission.'||p_command,'live_survey',mission_id::text,
    jsonb_build_object('missionId',mission_id,'command',p_command),p_correlation_id);
  return jsonb_build_object('missionId',mission_id);
end $$;

revoke all on public.live_survey_localizations from public,anon,authenticated;
alter table public.live_survey_localizations enable row level security;
alter table public.live_survey_localizations force row level security;
revoke all on function public.validate_phase2_mission_contract(uuid) from public,anon,authenticated,service_role;
revoke all on function public.get_owned_live_missions(uuid,text,public.content_locale) from public,anon,authenticated;
revoke all on function public.submit_owned_live_mission(uuid,uuid,uuid,jsonb,uuid,text,text) from public,anon,authenticated;
revoke all on function public.admin_write_live_mission(uuid,uuid,uuid,text,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.get_owned_live_missions(uuid,text,public.content_locale) to service_role;
grant execute on function public.submit_owned_live_mission(uuid,uuid,uuid,jsonb,uuid,text,text) to service_role;
grant execute on function public.admin_write_live_mission(uuid,uuid,uuid,text,jsonb,uuid) to service_role;
