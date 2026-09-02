-- Bind each immutable Survey version to the immutable LIVE reward revision that
-- governs its issuance. Existing public or response-bearing versions retain
-- legacy v1 +2 behavior; newly published versions use the Admin-published v2
-- settings (whose default Mission score is +1).

-- Backfill and activation integrity checks look up response-bearing Survey
-- versions by survey_id. Establish the supporting index before either scan.
create index if not exists live_survey_responses_survey_idx
  on public.live_survey_responses(survey_id);

with legacy_lives as (
  select distinct s.live_event_id
  from public.live_surveys s
  where s.publication_status = 'published'
     or exists (select 1 from public.live_survey_responses r where r.survey_id = s.id)
), next_revisions as (
  select l.live_event_id, coalesce(max(r.revision), 0) + 1 as revision
  from legacy_lives l
  left join public.live_reward_setting_revisions r on r.live_event_id = l.live_event_id
  group by l.live_event_id
)
insert into public.live_reward_setting_revisions(
  live_event_id, revision, policy_version, lifecycle_status, mission_score,
  mission_ticket, journey_bonus_ticket, correlation_id, published_at
)
select live_event_id, revision, 1, 'published', 2, 0, 0,
  extensions.gen_random_uuid(), now()
from next_revisions;

insert into public.live_survey_reward_setting_bindings(survey_id, reward_setting_revision_id)
select s.id, legacy.id
from public.live_surveys s
join lateral (
  select r.id
  from public.live_reward_setting_revisions r
  where r.live_event_id = s.live_event_id
    and r.policy_version = 1
    and r.lifecycle_status = 'published'
    and r.mission_score = 2
  order by r.revision desc limit 1
) legacy on true
where (s.publication_status = 'published'
    or exists (select 1 from public.live_survey_responses response where response.survey_id = s.id))
  and not exists (
    select 1 from public.live_survey_reward_setting_bindings binding where binding.survey_id = s.id
  );

create function public.bind_published_live_survey_reward_settings()
returns trigger language plpgsql security definer set search_path = '' as $$
declare selected_revision_id uuid;
begin
  if new.publication_status = 'published'
     and (tg_op = 'INSERT' or old.publication_status is distinct from 'published') then
    select revision.id into selected_revision_id
    from public.live_reward_setting_revisions revision
    where revision.live_event_id = new.live_event_id
      and revision.lifecycle_status = 'published'
    order by revision.revision desc limit 1;
    if selected_revision_id is null then
      raise exception 'published LIVE reward settings are required before Survey publication';
    end if;
    perform public.bind_live_survey_reward_settings(new.id, selected_revision_id);
  end if;
  return new;
end;
$$;

create trigger live_surveys_bind_published_reward_settings
after insert or update of publication_status on public.live_surveys
for each row execute function public.bind_published_live_survey_reward_settings();

create or replace function public.build_owned_live_survey_submission_result(p_app_user_id uuid, p_response_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('response', jsonb_build_object(
    'status', 'submitted', 'submittedAt', response.submitted_at, 'activityId', activity.id,
    'scorePoints', coalesce(score.points, 0), 'stamp', jsonb_build_object(
      'id', stamp.id, 'businessStatus', stamp.business_status, 'mintStatus', stamp.mint_status
    )
  ))
  from public.live_survey_responses response
  join public.fan_activities activity on activity.app_user_id = response.app_user_id
    and activity.celebrity_id = response.celebrity_id and activity.activity_type = 'survey'
    and activity.source_type = 'live_survey_response' and activity.source_id = response.id
  left join public.fan_score_ledger score on score.activity_id = activity.id and score.app_user_id = response.app_user_id
  join public.stamps stamp on stamp.activity_id = activity.id and stamp.passport_id = response.passport_id
    and stamp.app_user_id = response.app_user_id and stamp.celebrity_id = response.celebrity_id and stamp.stamp_type = 'survey'
  where response.id = p_response_id and response.app_user_id = p_app_user_id and response.status = 'submitted';
$$;

create or replace function public.submit_owned_live_survey(
  p_app_user_id uuid, p_live_slug text, p_idempotency_key uuid, p_answers jsonb,
  p_stamp_id uuid, p_stamp_operation_key text, p_stamp_issuance_id text
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare response_record public.live_survey_responses%rowtype; existing public.live_survey_idempotency%rowtype;
  live_id uuid; request_hash text; recipient text; celebrity_slug text; result jsonb;
  reward_setting public.live_reward_setting_revisions%rowtype;
  activity_id uuid := extensions.gen_random_uuid(); job_id uuid := extensions.gen_random_uuid();
  expected_payload jsonb; job_record public.blockchain_jobs%rowtype;
begin
  request_hash := encode(extensions.digest(p_answers::text, 'sha256'), 'hex');
  select id into live_id from public.live_events where slug = p_live_slug;
  if live_id is null then raise exception 'G3_SURVEY_NOT_FOUND' using errcode = 'P0002'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('g3:survey:key:' || p_idempotency_key::text, 0));
  select * into existing from public.live_survey_idempotency where idempotency_key = p_idempotency_key for update;
  if found then
    if existing.app_user_id <> p_app_user_id or existing.live_event_id <> live_id
       or existing.operation <> 'submit' or existing.request_hash <> request_hash then
      raise exception 'G3_SURVEY_IDEMPOTENCY_KEY_CONFLICT' using errcode = '23514'; end if;
    return existing.result;
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('g3:survey:target:' || p_app_user_id::text || ':' || live_id::text, 0));
  select * into response_record from public.live_survey_responses where app_user_id = p_app_user_id and live_event_id = live_id for update;
  if found and response_record.status = 'submitted' then
    result := public.build_owned_live_survey_submission_result(p_app_user_id, response_record.id);
    if result is null then raise exception 'G3_SURVEY_INTEGRITY_ERROR' using errcode = '23514'; end if;
    insert into public.live_survey_idempotency(idempotency_key, app_user_id, live_event_id, operation, request_hash, response_id, result)
    values (p_idempotency_key, p_app_user_id, live_id, 'submit', request_hash, response_record.id, result);
    return result;
  end if;
  perform 1 from public.app_users where id = p_app_user_id and status = 'active' for update;
  if not found then raise exception 'G3_SURVEY_USER_UNAVAILABLE' using errcode = '42501'; end if;
  response_record := public.get_or_create_owned_live_survey_response(p_app_user_id, p_live_slug);
  select revision.* into reward_setting
  from public.live_survey_reward_setting_bindings binding
  join public.live_reward_setting_revisions revision on revision.id = binding.reward_setting_revision_id
  where binding.survey_id = response_record.survey_id and revision.lifecycle_status = 'published';
  if not found then raise exception 'G3_SURVEY_REWARD_SETTINGS_REQUIRED' using errcode = '23514'; end if;
  perform public.validate_and_replace_live_survey_answers(response_record.id, response_record.survey_id, p_answers, true);
  select address into recipient from public.user_wallets where app_user_id = p_app_user_id and chain_id = 91342 and provider = 'privy' and wallet_type = 'embedded' for key share;
  if not found then raise exception 'G3_SURVEY_WALLET_NOT_READY' using errcode = '55000'; end if;
  select slug into strict celebrity_slug from public.celebrities where id = response_record.celebrity_id;
  if p_stamp_id is null or p_stamp_operation_key is distinct from 'byus:stamp:v1:' || p_stamp_id::text
     or p_stamp_issuance_id is null or p_stamp_issuance_id !~ '^0x[0-9a-f]{64}$' then
    raise exception 'G3_SURVEY_ISSUANCE_CONFLICT' using errcode = '22023'; end if;
  update public.live_survey_responses set status = 'submitted', submitted_at = now(), revision = revision + 1
  where id = response_record.id returning * into response_record;
  insert into public.fan_activities(id, app_user_id, celebrity_id, activity_type, source_type, source_id)
  values (activity_id, p_app_user_id, response_record.celebrity_id, 'survey', 'live_survey_response', response_record.id);
  if reward_setting.mission_score > 0 then
    insert into public.fan_score_ledger(activity_id, app_user_id, celebrity_id, points)
    values (activity_id, p_app_user_id, response_record.celebrity_id, reward_setting.mission_score);
  end if;
  expected_payload := jsonb_build_object('recipient', recipient, 'celebritySlug', celebrity_slug, 'issuanceId', p_stamp_issuance_id, 'stampType', 'Survey');
  insert into public.blockchain_jobs(id, entity_type, entity_id, operation_key, payload_version, payload)
  values (job_id, 'stamp', p_stamp_id, p_stamp_operation_key, 1, expected_payload) on conflict (operation_key) do nothing;
  select * into job_record from public.blockchain_jobs where operation_key = p_stamp_operation_key for update;
  if not found or job_record.id <> job_id or job_record.entity_type <> 'stamp' or job_record.entity_id <> p_stamp_id
     or job_record.payload_version <> 1 or job_record.payload <> expected_payload or job_record.status <> 'PENDING' then
    raise exception 'G3_SURVEY_ISSUANCE_CONFLICT' using errcode = '23514'; end if;
  insert into public.stamps(id, app_user_id, celebrity_id, passport_id, activity_id, stamp_type, blockchain_job_id)
  values (p_stamp_id, p_app_user_id, response_record.celebrity_id, response_record.passport_id, activity_id, 'survey', job_id);
  perform public.freeze_live_reward_settings_on_issuance(reward_setting.id, now(), 'live_survey_response', response_record.id);
  result := public.build_owned_live_survey_submission_result(p_app_user_id, response_record.id);
  if result is null then raise exception 'G3_SURVEY_INTEGRITY_ERROR' using errcode = '23514'; end if;
  insert into public.live_survey_idempotency(idempotency_key, app_user_id, live_event_id, operation, request_hash, response_id, result)
  values (p_idempotency_key, p_app_user_id, response_record.live_event_id, 'submit', request_hash, response_record.id, result);
  return result;
end;
$$;

revoke all on function public.bind_published_live_survey_reward_settings() from public,anon,authenticated,service_role;
revoke all on function public.build_owned_live_survey_submission_result(uuid,uuid) from public,anon,authenticated;
revoke all on function public.submit_owned_live_survey(uuid,text,uuid,jsonb,uuid,text,text) from public,anon,authenticated;
grant execute on function public.submit_owned_live_survey(uuid,text,uuid,jsonb,uuid,text,text) to service_role;

comment on function public.submit_owned_live_survey(uuid,text,uuid,jsonb,uuid,text,text) is
  'Atomically finalizes one Survey using its immutable reward snapshot; score zero still issues activity, Stamp, and outbox.';
