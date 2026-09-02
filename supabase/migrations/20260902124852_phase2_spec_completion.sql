-- Close the original Phase 2 specification gaps: Mission visibility,
-- response statistics, and immediate (optionally unbound) First Reaction Stamp.

alter table public.live_surveys
  add column visible_from timestamptz,
  add column visible_until timestamptz;

update public.live_surveys mission
set visible_from=live.starts_at, visible_until=live.ends_at
from public.live_events live
where mission.live_event_id=live.id and not mission.legacy_contract;

alter table public.live_surveys add constraint live_surveys_mission_visibility_window check (
  legacy_contract or (visible_from is not null and visible_until is not null and visible_from < visible_until)
);

create or replace function public.reject_live_survey_snapshot_mutation()
returns trigger language plpgsql set search_path='' as $$
declare target_survey_id uuid; target_status text;
begin
  if tg_table_name='live_surveys' then
    target_survey_id:=coalesce(new.id,old.id);
    if tg_op='UPDATE' and old.lifecycle_status in ('published','closed','archived')
       and new.id=old.id and new.live_event_id=old.live_event_id and new.version=old.version and new.created_at=old.created_at
       and new.source_survey_id is not distinct from old.source_survey_id and new.mission_type=old.mission_type
       and new.legacy_contract=old.legacy_contract and new.attendance_requirement=old.attendance_requirement
       and new.visible_from is not distinct from old.visible_from and new.visible_until is not distinct from old.visible_until
       and new.lifecycle_status in ('published','closed','archived') then return new;
    end if;
    target_status:=old.lifecycle_status;
  elsif tg_table_name='live_survey_questions' then target_survey_id:=coalesce(new.survey_id,old.survey_id);
  elsif tg_table_name='live_survey_question_localizations' then select survey_id into strict target_survey_id from public.live_survey_questions where id=coalesce(new.question_id,old.question_id);
  elsif tg_table_name='live_survey_options' then select survey_id into strict target_survey_id from public.live_survey_questions where id=coalesce(new.question_id,old.question_id);
  else
    select q.survey_id into strict target_survey_id from public.live_survey_options o join public.live_survey_questions q on q.id=o.question_id where o.id=coalesce(new.option_id,old.option_id);
  end if;
  if target_status is null then select lifecycle_status into target_status from public.live_surveys where id=target_survey_id; end if;
  if target_status in ('published','closed','archived') then raise exception 'published survey snapshots are immutable'; end if;
  if exists(select 1 from public.live_survey_responses where survey_id=target_survey_id) then raise exception 'survey snapshots with responses are immutable'; end if;
  return case when tg_op='DELETE' then old else new end;
end $$;

create or replace function public.get_owned_live_missions(p_app_user_id uuid,p_live_slug text,p_locale public.content_locale)
returns jsonb language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',m.id,'type',m.mission_type,'version',m.version,
    'title',ml.title,'description',ml.description,
    'visibleFrom',m.visible_from,'visibleUntil',m.visible_until,
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
  where l.slug=p_live_slug and m.publication_status='published' and not m.legacy_contract
    and statement_timestamp() >= m.visible_from and statement_timestamp() < m.visible_until;
$$;

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
  recipient text; celebrity_slug text; result jsonb; policy_version integer;
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
  values(p_app_user_id,mission.live_event_id,live_record.celebrity_id,mission.id,attendance_record.id,passport_record.id,'submitted',now(),false) returning * into response_record;
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
  insert into public.fan_activities(id,app_user_id,celebrity_id,activity_type,source_type,source_id) values(activity_id,p_app_user_id,live_record.celebrity_id,'survey','live_survey_response',response_record.id);
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

create or replace function public.admin_write_live_mission(
  p_actor_app_user_id uuid,p_actor_allowlist_id uuid,p_live_event_id uuid,p_command text,p_payload jsonb,p_correlation_id uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
declare mission_id uuid; next_version integer; question_item jsonb; option_item jsonb; question_id uuid; option_id uuid; correct_position integer;
  v_visible_from timestamptz; v_visible_until timestamptz;
begin
  perform public.admin_assert_active_survey_actor(p_actor_app_user_id,p_actor_allowlist_id,true);
  if p_correlation_id is null then raise exception 'correlation id is required'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('phase2:mission:admin:'||p_live_event_id::text,0));
  if p_command in ('create','update') then
    if p_payload->>'type' not in ('quiz','survey','vote') or p_payload->>'attendanceRequirement' not in ('required','not_required') then raise exception 'invalid mission contract'; end if;
    v_visible_from:=(p_payload->>'visibleFrom')::timestamptz; v_visible_until:=(p_payload->>'visibleUntil')::timestamptz;
    if v_visible_from is null or v_visible_until is null or v_visible_from>=v_visible_until then raise exception 'invalid mission visibility window'; end if;
    if p_command='create' then
      select coalesce(max(version),0)+1 into next_version from public.live_surveys where live_event_id=p_live_event_id;
      insert into public.live_surveys(live_event_id,version,mission_type,legacy_contract,attendance_requirement,visible_from,visible_until)
      values(p_live_event_id,next_version,p_payload->>'type',false,p_payload->>'attendanceRequirement',v_visible_from,v_visible_until) returning id into mission_id;
    else
      mission_id:=(p_payload->>'missionId')::uuid;
      perform 1 from public.live_surveys where id=mission_id and live_event_id=p_live_event_id and not legacy_contract and lifecycle_status='draft' for update;
      if not found then raise exception 'draft mission not found'; end if;
      update public.live_survey_questions set correct_option_id=null where survey_id=mission_id;
      delete from public.live_survey_option_localizations where option_id in (select o.id from public.live_survey_options o join public.live_survey_questions q on q.id=o.question_id where q.survey_id=mission_id);
      delete from public.live_survey_options where question_id in (select id from public.live_survey_questions where survey_id=mission_id);
      delete from public.live_survey_question_localizations where question_id in (select id from public.live_survey_questions where survey_id=mission_id);
      delete from public.live_survey_questions where survey_id=mission_id;
      delete from public.live_survey_localizations where survey_id=mission_id;
      update public.live_surveys set mission_type=p_payload->>'type',attendance_requirement=p_payload->>'attendanceRequirement',visible_from=v_visible_from,visible_until=v_visible_until,revision=revision+1 where id=mission_id;
    end if;
    insert into public.live_survey_localizations(survey_id,locale,title,description) values
      (mission_id,'ko',p_payload->'title'->>'ko',coalesce(p_payload->'description'->>'ko','')),(mission_id,'en',p_payload->'title'->>'en',coalesce(p_payload->'description'->>'en',''));
    for question_item in select value from jsonb_array_elements(p_payload->'questions') loop
      insert into public.live_survey_questions(survey_id,question_type,is_required,position,media_type,media_url)
      values(mission_id,'single_choice',true,(question_item->>'position')::smallint,question_item->'media'->>'type',question_item->'media'->>'url') returning id into question_id;
      insert into public.live_survey_question_localizations(question_id,locale,question_text) values (question_id,'ko',question_item->'text'->>'ko'),(question_id,'en',question_item->'text'->>'en');
      correct_position:=nullif(question_item->>'correctPosition','')::integer;
      for option_item in select value from jsonb_array_elements(question_item->'options') loop
        insert into public.live_survey_options(question_id,position,media_type,media_url) values(question_id,(option_item->>'position')::smallint,option_item->'media'->>'type',option_item->'media'->>'url') returning id into option_id;
        insert into public.live_survey_option_localizations(option_id,locale,label) values (option_id,'ko',option_item->'label'->>'ko'),(option_id,'en',option_item->'label'->>'en');
        if (option_item->>'position')::integer=correct_position then update public.live_survey_questions set correct_option_id=option_id where id=question_id; end if;
      end loop;
    end loop;
    perform public.validate_phase2_mission_contract(mission_id);
  elsif p_command='publish' then
    mission_id:=(p_payload->>'missionId')::uuid; perform public.validate_phase2_mission_contract(mission_id);
    update public.live_surveys set publication_status='published',lifecycle_status='published',published_at=now(),ever_published_at=coalesce(ever_published_at,now()),revision=revision+1
    where id=mission_id and live_event_id=p_live_event_id and not legacy_contract and lifecycle_status='draft';
    if not found then raise exception 'publishable mission not found'; end if;
  else raise exception 'unsupported mission command'; end if;
  insert into public.audit_logs(actor_app_user_id,actor_admin_allowlist_id,action,entity_type,entity_id,before_after_summary,correlation_id)
  values(p_actor_app_user_id,p_actor_allowlist_id,'admin.mission.'||p_command,'live_survey',mission_id::text,jsonb_build_object('missionId',mission_id,'command',p_command),p_correlation_id);
  return jsonb_build_object('missionId',mission_id);
end $$;

create function public.get_admin_live_mission_statistics(p_actor_app_user_id uuid,p_actor_allowlist_id uuid,p_live_event_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  perform public.admin_assert_active_survey_actor(p_actor_app_user_id,p_actor_allowlist_id,false);
  if not exists(select 1 from public.live_events where id=p_live_event_id) then raise exception 'live event not found'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'missionId',m.id,'type',m.mission_type,'title',coalesce(ml.title,''),
    'visibleFrom',m.visible_from,'visibleUntil',m.visible_until,
    'totalParticipants',(select count(distinct r.id) from public.live_survey_responses r where r.survey_id=m.id and r.status='submitted'),
    'correctCount',(select count(*) from public.live_survey_responses r where r.survey_id=m.id and r.status='submitted' and r.correctness=true),
    'incorrectCount',(select count(*) from public.live_survey_responses r where r.survey_id=m.id and r.status='submitted' and r.correctness=false),
    'questions',(select coalesce(jsonb_agg(jsonb_build_object(
      'questionId',q.id,'text',coalesce(ql.question_text,''),
      'options',(select coalesce(jsonb_agg(jsonb_build_object(
        'optionId',o.id,'label',coalesce(ol.label,''),
        'optionCount',(select count(*) from public.live_survey_answers a join public.live_survey_responses r on r.id=a.response_id
          where a.question_id=q.id and r.survey_id=m.id and r.status='submitted' and a.selected_option_ids @> array[o.id])
      ) order by o.position),'[]'::jsonb) from public.live_survey_options o left join public.live_survey_option_localizations ol on ol.option_id=o.id and ol.locale='ko' where o.question_id=q.id)
    ) order by q.position),'[]'::jsonb) from public.live_survey_questions q left join public.live_survey_question_localizations ql on ql.question_id=q.id and ql.locale='ko' where q.survey_id=m.id)
  ) order by m.version desc),'[]'::jsonb) into result
  from public.live_surveys m left join public.live_survey_localizations ml on ml.survey_id=m.id and ml.locale='ko'
  where m.live_event_id=p_live_event_id and not m.legacy_contract;
  return result;
end $$;

alter table public.first_reaction_stamps alter column passport_id drop not null;

create or replace function public.reject_first_reaction_stamp_mutation()
returns trigger language plpgsql set search_path='' as $$
begin
  if tg_op='DELETE' then raise exception 'first reaction stamp is immutable'; end if;
  if new.id<>old.id or new.reaction_id<>old.reaction_id or new.app_user_id<>old.app_user_id or new.celebrity_id<>old.celebrity_id
    or new.activity_id<>old.activity_id or new.business_status<>old.business_status or new.blockchain_source_type<>old.blockchain_source_type
    or new.blockchain_source_id<>old.blockchain_source_id or new.issued_at<>old.issued_at then raise exception 'first reaction stamp is immutable'; end if;
  if new.passport_id is distinct from old.passport_id and not (old.passport_id is null and new.passport_id is not null) then raise exception 'first reaction stamp passport binding is immutable'; end if;
  if old.mint_status='minted' and (new.mint_status is distinct from old.mint_status or new.tx_hash is distinct from old.tx_hash or new.token_id is distinct from old.token_id) then raise exception 'minted first reaction stamp is immutable'; end if;
  return new;
end $$;

create function public.issue_first_reaction_stamp()
returns trigger language plpgsql security definer set search_path='' as $$
declare activity_id uuid:=extensions.gen_random_uuid(); passport_id uuid;
begin
  insert into public.fan_activities(id,app_user_id,celebrity_id,activity_type,source_type,source_id,occurred_at)
  values(activity_id,new.app_user_id,new.celebrity_id,'first_reaction','fan_reaction',new.id,new.completed_at)
  on conflict(activity_type,source_type,source_id) do nothing;
  select id into strict activity_id from public.fan_activities where activity_type='first_reaction' and source_type='fan_reaction' and source_id=new.id;
  select id into passport_id from public.fan_passports where app_user_id=new.app_user_id and celebrity_id=new.celebrity_id and business_status='issued';
  insert into public.first_reaction_stamps(reaction_id,app_user_id,celebrity_id,passport_id,activity_id,blockchain_source_id,mint_status,tx_hash,token_id)
  values(new.id,new.app_user_id,new.celebrity_id,passport_id,activity_id,new.id,new.mint_status,new.tx_hash,new.token_id)
  on conflict(reaction_id) do nothing;
  return new;
end $$;

insert into public.fan_activities(id,app_user_id,celebrity_id,activity_type,source_type,source_id,occurred_at)
select extensions.gen_random_uuid(),r.app_user_id,r.celebrity_id,'first_reaction','fan_reaction',r.id,r.completed_at
from public.fan_reactions r
where not exists(select 1 from public.fan_activities a where a.activity_type='first_reaction' and a.source_type='fan_reaction' and a.source_id=r.id)
on conflict(activity_type,source_type,source_id) do nothing;

insert into public.first_reaction_stamps(reaction_id,app_user_id,celebrity_id,passport_id,activity_id,blockchain_source_id,mint_status,tx_hash,token_id,issued_at)
select r.id,r.app_user_id,r.celebrity_id,p.id,a.id,r.id,r.mint_status,r.tx_hash,r.token_id,r.completed_at
from public.fan_reactions r
join public.fan_activities a on a.activity_type='first_reaction' and a.source_type='fan_reaction' and a.source_id=r.id
left join public.fan_passports p on p.app_user_id=r.app_user_id and p.celebrity_id=r.celebrity_id and p.business_status='issued'
where not exists(select 1 from public.first_reaction_stamps s where s.reaction_id=r.id)
on conflict(reaction_id) do nothing;

create trigger fan_reactions_issue_first_reaction_stamp after insert on public.fan_reactions
for each row execute function public.issue_first_reaction_stamp();

create or replace function public.attach_reaction_to_new_passport()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_reaction_id uuid;
begin
  select r.id into v_reaction_id from public.fan_reactions r where r.app_user_id=new.app_user_id and r.celebrity_id=new.celebrity_id for update;
  if not found then return new; end if;
  update public.first_reaction_stamps set passport_id=new.id where reaction_id=v_reaction_id and passport_id is null;
  if not exists(select 1 from public.first_reaction_stamps s where s.reaction_id=v_reaction_id and s.passport_id=new.id) then raise exception 'reaction passport attachment conflict'; end if;
  return new;
end $$;

revoke all on function public.get_admin_live_mission_statistics(uuid,uuid,uuid),public.issue_first_reaction_stamp() from public,anon,authenticated,service_role;
grant execute on function public.get_admin_live_mission_statistics(uuid,uuid,uuid) to service_role;
