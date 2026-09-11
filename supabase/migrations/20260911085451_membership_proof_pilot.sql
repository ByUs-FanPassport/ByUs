-- Paid membership proof extends the existing private manual-certification flow.
-- Apply the preceding enum migration in its own committed transaction first.
alter table public.certification_missions
  add column membership_platform public.social_platform,
  add constraint certification_membership_platform_supported check
    (membership_platform is null or membership_platform::text in ('instagram','tiktok','youtube')),
  add constraint certification_membership_platform_once unique (celebrity_id,membership_platform);
alter table public.certification_submissions
  add column membership_platform public.social_platform,
  add constraint certification_membership_reward_check check
    (membership_platform is null or (reward_score_points>0 and reward_ticket_amount=0));
create unique index certification_membership_approved_once
  on public.certification_submissions(app_user_id,celebrity_id,membership_platform)
  where status='approved' and membership_platform is not null;
alter table public.stamps drop constraint stamps_stamp_type_check;
alter table public.stamps add constraint stamps_stamp_type_check
  check (stamp_type in ('knowledge','reservation','attendance','survey','membership'));

create function public.guard_membership_mission_platform() returns trigger
language plpgsql set search_path='' as $$
begin
  if new.membership_platform is distinct from old.membership_platform then
    raise exception 'CERTIFICATION_MEMBERSHIP_PLATFORM_IMMUTABLE';
  end if;
  return new;
end $$;
create trigger certification_membership_platform_immutable before update on public.certification_missions
  for each row execute function public.guard_membership_mission_platform();

create function public.snapshot_membership_submission() returns trigger
language plpgsql set search_path='' as $$
begin
  if tg_op='INSERT' then
    select membership_platform into strict new.membership_platform
      from public.certification_missions where id=new.mission_id and celebrity_id=new.celebrity_id;
  elsif new.membership_platform is distinct from old.membership_platform then
    raise exception 'CERTIFICATION_MEMBERSHIP_SNAPSHOT_IMMUTABLE';
  end if;
  return new;
end $$;
create trigger certification_membership_snapshot before insert or update on public.certification_submissions
  for each row execute function public.snapshot_membership_submission();

-- Applies to both the new configuration RPC and the existing generic draft editor.
create function public.validate_membership_reward() returns trigger
language plpgsql set search_path='' as $$
begin
  if exists(select 1 from public.certification_missions where id=new.mission_id and membership_platform is not null)
    and (new.score_points<=0 or new.ticket_amount<>0) then
    raise exception 'CERTIFICATION_MEMBERSHIP_REWARD_INVALID';
  end if;
  return new;
end $$;
create trigger certification_membership_reward before insert on public.certification_reward_revisions
  for each row execute function public.validate_membership_reward();

create or replace function public.save_admin_certification_mission_v2(
  p_actor uuid,p_allowlist uuid,p_correlation uuid,p_mission_id uuid,p_celebrity_id uuid,p_immutable_key text,
  p_expected_revision bigint,p_category text,p_title_ko text,p_title_en text,p_description_ko text,p_description_en text,
  p_instructions_ko text,p_instructions_en text,p_opens_at timestamptz,p_closes_at timestamptz,p_score_points smallint,p_ticket_amount bigint,p_membership_platform public.social_platform default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare mission public.certification_missions%rowtype; reward public.certification_reward_revisions%rowtype; policy integer;
begin
  perform public.assert_certification_admin(p_actor,p_allowlist);
  select policy_version into strict policy from public.reward_policy_activation where singleton;
  if p_score_points is null or p_ticket_amount is null then raise exception 'CERTIFICATION_REWARD_REQUIRED'; end if;
  if (p_mission_id is null)<>(p_expected_revision is null) then raise exception 'CERTIFICATION_MISSION_REVISION_PAIR_REQUIRED'; end if;
  if p_membership_platform is not null and p_membership_platform::text not in ('instagram','tiktok','youtube') then raise exception 'CERTIFICATION_MEMBERSHIP_PLATFORM_INVALID'; end if;
  if p_mission_id is null then
    insert into public.certification_missions(id,celebrity_id,immutable_key,category,title_ko,title_en,description_ko,description_en,instructions_ko,instructions_en,opens_at,closes_at,membership_platform)
    values(extensions.gen_random_uuid(),p_celebrity_id,lower(btrim(p_immutable_key)),btrim(p_category),btrim(p_title_ko),btrim(p_title_en),btrim(p_description_ko),btrim(p_description_en),btrim(p_instructions_ko),btrim(p_instructions_en),p_opens_at,p_closes_at,p_membership_platform) returning * into mission;
  else
    select * into strict mission from public.certification_missions where id=p_mission_id for update;
    if mission.membership_platform is distinct from p_membership_platform then raise exception 'CERTIFICATION_MEMBERSHIP_PLATFORM_IMMUTABLE'; end if;
    if mission.status<>'draft' then raise exception 'CERTIFICATION_MISSION_IMMUTABLE'; end if;
    if mission.revision<>p_expected_revision or mission.celebrity_id<>p_celebrity_id or mission.immutable_key<>lower(btrim(p_immutable_key)) then raise exception 'CERTIFICATION_STALE_REVISION'; end if;
    update public.certification_missions set revision=revision+1,category=btrim(p_category),title_ko=btrim(p_title_ko),title_en=btrim(p_title_en),description_ko=btrim(p_description_ko),description_en=btrim(p_description_en),instructions_ko=btrim(p_instructions_ko),instructions_en=btrim(p_instructions_en),opens_at=p_opens_at,closes_at=p_closes_at,updated_at=now() where id=mission.id returning * into mission;
  end if;
  insert into public.certification_reward_revisions(mission_id,revision,policy_version,score_points,ticket_amount,actor_app_user_id,actor_admin_allowlist_id,correlation_id)
  values(mission.id,mission.revision,policy,p_score_points,p_ticket_amount,p_actor,p_allowlist,p_correlation) returning * into reward;
  insert into public.audit_logs(actor_app_user_id,actor_admin_allowlist_id,action,entity_type,entity_id,correlation_id,before_after_summary)
  values(p_actor,p_allowlist,'certification.mission.saved','certification_mission',mission.id::text,p_correlation,jsonb_build_object('revision',mission.revision,'rewardRevisionId',reward.id));
  return jsonb_build_object('id',mission.id,'revision',mission.revision,'status',mission.status,'reward',jsonb_build_object('revisionId',reward.id,'scorePoints',reward.score_points,'ticketAmount',reward.ticket_amount));
end $$;
create or replace function public.validate_fan_activity_source()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.activity_type = 'knowledge' and (new.source_type <> 'quiz_pass' or not exists (
    select 1 from public.quiz_passes where id = new.source_id and app_user_id = new.app_user_id and celebrity_id = new.celebrity_id
  )) then raise exception 'knowledge activity must reference an owned quiz pass';
  elsif new.activity_type = 'reservation' and (new.source_type <> 'live_reservation' or not exists (
    select 1 from public.live_reservations where id = new.source_id and app_user_id = new.app_user_id and celebrity_id = new.celebrity_id
  )) then raise exception 'reservation activity must reference an owned live reservation for the same celebrity';
  elsif new.activity_type = 'attendance' and (new.source_type <> 'live_attendance' or not exists (
    select 1 from public.live_attendances where id = new.source_id and app_user_id = new.app_user_id and celebrity_id = new.celebrity_id
  )) then raise exception 'attendance activity must reference an owned live attendance for the same celebrity';
  elsif new.activity_type = 'survey' and (new.source_type <> 'live_survey_response' or not exists (
    select 1 from public.live_survey_responses where id = new.source_id and app_user_id = new.app_user_id
      and celebrity_id = new.celebrity_id and status = 'submitted'
  )) then raise exception 'survey activity must reference an owned submitted response for the same celebrity';
  elsif new.activity_type = 'membership' and (new.source_type <> 'certification_submission' or not exists (
    select 1 from public.certification_submissions where id=new.source_id and app_user_id=new.app_user_id
      and celebrity_id=new.celebrity_id and status='approved' and membership_platform is not null
  )) then raise exception 'membership activity must reference an owned approved membership submission';
  end if;
  return new;
end;
$$;
create or replace function public.validate_fan_score_weight() returns trigger
language plpgsql set search_path='' as $$
declare source_activity_type public.fan_activity_type; expected_points smallint;
  adjustment_record public.fan_score_adjustments%rowtype; manual_record public.certification_submissions%rowtype;
  current_score bigint; next_score bigint;
begin
  if num_nonnulls(new.activity_id,new.adjustment_id,new.manual_submission_id)<>1 then raise exception 'fan score entry requires exactly one source'; end if;
  if new.activity_id is not null then
    select activity_type into strict source_activity_type from public.fan_activities
      where id=new.activity_id and app_user_id=new.app_user_id and celebrity_id=new.celebrity_id;
    if source_activity_type='membership' then raise exception 'membership score requires manual submission source'; end if;
    expected_points:=case source_activity_type when 'knowledge' then 1 when 'reservation' then 1 when 'attendance' then 3 when 'survey' then 2 end;
  elsif new.adjustment_id is not null then
    select * into strict adjustment_record from public.fan_score_adjustments
      where id=new.adjustment_id and app_user_id=new.app_user_id and celebrity_id=new.celebrity_id;
    expected_points:=adjustment_record.points;
  else
    select * into strict manual_record from public.certification_submissions
      where id=new.manual_submission_id and app_user_id=new.app_user_id and celebrity_id=new.celebrity_id and status='approved';
    expected_points:=manual_record.reward_score_points;
    if expected_points<=0 then raise exception 'zero-point certification cannot create a score row'; end if;
  end if;
  if expected_points is null or new.points<>expected_points then raise exception 'fan score points do not match source'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('g5:fan-score:'||new.app_user_id::text||':'||new.celebrity_id::text,0));
  select coalesce(sum(points::bigint),0) into current_score from public.fan_score_ledger where app_user_id=new.app_user_id and celebrity_id=new.celebrity_id;
  next_score:=current_score+new.points::bigint;
  if next_score<0 or next_score>1000000 then raise exception 'fan score total must remain between 0 and 1000000'; end if;
  return new;
end $$;
create or replace function public.review_admin_certification_submission(p_actor uuid,p_allowlist uuid,p_correlation uuid,p_submission_id uuid,p_idempotency_key uuid,p_expected_revision bigint,p_decision text,p_rejection_reason text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare submission public.certification_submissions%rowtype; operation public.certification_review_operations%rowtype; result jsonb; decision public.certification_submission_status; reason text;
  passport_id uuid; recipient text; celebrity_slug text; activity_id uuid; stamp_id uuid; job_id uuid; operation_key text; issuance_id text;
begin
  perform public.assert_certification_admin(p_actor,p_allowlist);
  if p_decision not in ('approve','reject') then raise exception 'CERTIFICATION_DECISION_INVALID'; end if;
  decision:=case p_decision when 'approve' then 'approved'::public.certification_submission_status else 'rejected'::public.certification_submission_status end;
  reason:=nullif(btrim(coalesce(p_rejection_reason,'')),'');
  if (decision='rejected')<>(reason is not null) then raise exception 'CERTIFICATION_REJECTION_REASON_INVALID'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('certification:review:key:'||p_idempotency_key::text,0));
  select * into operation from public.certification_review_operations where idempotency_key=p_idempotency_key;
  if found then
    if operation.submission_id<>p_submission_id or operation.expected_revision<>p_expected_revision or operation.decision<>decision or operation.rejection_reason is distinct from reason then raise exception 'CERTIFICATION_REVIEW_IDEMPOTENCY_CONFLICT'; end if;
    return operation.result || jsonb_build_object('replayed',true);
  end if;
  select * into strict submission from public.certification_submissions where id=p_submission_id for update;
  if submission.status<>'pending' or submission.review_revision<>p_expected_revision then raise exception 'CERTIFICATION_STALE_REVISION'; end if;
  if decision='approved' and exists(select 1 from public.certification_submissions where app_user_id=submission.app_user_id and mission_id=submission.mission_id and status='approved' and id<>submission.id) then raise exception 'CERTIFICATION_ALREADY_APPROVED'; end if;
  if decision='approved' and submission.membership_platform is not null then
    select id into passport_id from public.fan_passports
      where app_user_id=submission.app_user_id and celebrity_id=submission.celebrity_id and business_status='issued'
      for key share;
    if passport_id is null then raise exception 'CERTIFICATION_PASSPORT_REQUIRED'; end if;
    select address into recipient from public.user_wallets
      where app_user_id=submission.app_user_id and chain_id=91342 and provider='privy' and wallet_type='embedded'
      for key share;
    if recipient is null then raise exception 'CERTIFICATION_MEMBERSHIP_WALLET_NOT_READY'; end if;
    select slug into strict celebrity_slug from public.celebrities where id=submission.celebrity_id;
  end if;
  update public.certification_submissions set status=decision,rejection_reason=reason,reviewed_by_app_user_id=p_actor,reviewed_by_admin_allowlist_id=p_allowlist,reviewed_at=now(),review_revision=review_revision+1,updated_at=now() where id=submission.id returning * into submission;
  if decision='approved' then
    if submission.membership_platform is not null then
      activity_id:=extensions.gen_random_uuid(); stamp_id:=extensions.gen_random_uuid(); job_id:=extensions.gen_random_uuid();
      operation_key:='byus:stamp:v1:'||stamp_id::text;
      issuance_id:='0x'||encode(extensions.digest(operation_key,'sha256'),'hex');
      insert into public.fan_activities(id,app_user_id,celebrity_id,activity_type,source_type,source_id)
        values(activity_id,submission.app_user_id,submission.celebrity_id,'membership','certification_submission',submission.id);
    end if;
    if submission.reward_score_points>0 then insert into public.fan_score_ledger(app_user_id,celebrity_id,points,manual_submission_id) values(submission.app_user_id,submission.celebrity_id,submission.reward_score_points,submission.id); end if;
    if submission.reward_ticket_amount>0 then perform public.post_fan_ticket_entry(submission.app_user_id,submission.celebrity_id,'credit',submission.reward_ticket_amount,'manual_certification',submission.id,submission.id,submission.reward_policy_version,null,null); end if;
  end if;
  if decision='approved' and submission.membership_platform is not null then
    insert into public.blockchain_jobs(id,entity_type,entity_id,operation_key,payload_version,payload)
      values(job_id,'stamp',stamp_id,operation_key,1,jsonb_build_object('recipient',recipient,'celebritySlug',celebrity_slug,'issuanceId',issuance_id,'stampType','Membership'));
    insert into public.stamps(id,app_user_id,celebrity_id,passport_id,activity_id,stamp_type,blockchain_job_id)
      values(stamp_id,submission.app_user_id,submission.celebrity_id,passport_id,activity_id,'membership',job_id);
  end if;
  result:=jsonb_build_object('id',submission.id,'status',submission.status,'revision',submission.review_revision,'replayed',false);
  insert into public.certification_review_operations values(p_idempotency_key,submission.id,p_expected_revision,decision,reason,p_actor,p_allowlist,result,now());
  insert into public.audit_logs(actor_app_user_id,actor_admin_allowlist_id,action,entity_type,entity_id,correlation_id,before_after_summary)
  values(p_actor,p_allowlist,'certification.submission.'||submission.status,'certification_submission',submission.id::text,p_correlation,jsonb_build_object('revision',submission.review_revision,'reason',reason,'reward',jsonb_build_object('scorePoints',submission.reward_score_points,'ticketAmount',submission.reward_ticket_amount)));
  return result;
end $$;
-- Additive JSON fields are emitted only for membership rows so old clients keep
-- working during the deployment window before the pilot missions are activated.
create function public.certification_membership_payload(p_base jsonb,p_platform public.social_platform) returns jsonb
language sql immutable set search_path='' as $$
  select case when p_platform is null or p_base is null then p_base
    else p_base||jsonb_build_object('membershipPlatform',p_platform)
      ||case when p_base ? 'reward' then jsonb_build_object('reward',(p_base->'reward')||jsonb_build_object('stampCount',1)) else '{}'::jsonb end
    end;
$$;

alter function public.get_public_certifications(text,public.content_locale) rename to get_public_certifications_before_membership;
create function public.get_public_certifications(p_slug text,p_locale public.content_locale) returns jsonb language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(public.certification_membership_payload(item,m.membership_platform) order by ord),'[]'::jsonb) from jsonb_array_elements(public.get_public_certifications_before_membership(p_slug,p_locale)) with ordinality rows(item,ord) left join public.certification_missions m on item->>'kind'='manual' and m.id=(item->>'id')::uuid;
$$;
revoke all on function public.get_public_certifications_before_membership(text,public.content_locale) from public,anon,authenticated,service_role;
revoke all on function public.get_public_certifications(text,public.content_locale) from public,anon,authenticated;
grant execute on function public.get_public_certifications(text,public.content_locale) to service_role;

alter function public.get_public_certification(uuid,public.content_locale) rename to get_public_certification_before_membership;
create function public.get_public_certification(p_id uuid,p_locale public.content_locale) returns jsonb language sql stable security definer set search_path='' as $$
  select public.certification_membership_payload(base,m.membership_platform)||case when m.membership_platform is not null and social.url is not null then jsonb_build_object('creatorAccountUrl',social.url) else '{}'::jsonb end from public.get_public_certification_before_membership(p_id,p_locale) base left join public.certification_missions m on m.id=p_id left join public.celebrity_social_links social on social.celebrity_id=m.celebrity_id and social.platform=m.membership_platform;
$$;
revoke all on function public.get_public_certification_before_membership(uuid,public.content_locale) from public,anon,authenticated,service_role;
revoke all on function public.get_public_certification(uuid,public.content_locale) from public,anon,authenticated;
grant execute on function public.get_public_certification(uuid,public.content_locale) to service_role;

alter function public.get_owned_certification_submission(uuid,uuid,public.content_locale) rename to get_owned_certification_submission_before_membership;
create function public.get_owned_certification_submission(p_app_user_id uuid,p_submission_id uuid,p_locale public.content_locale) returns jsonb language sql stable security definer set search_path='' as $$
  select public.certification_membership_payload(base,s.membership_platform) from public.get_owned_certification_submission_before_membership(p_app_user_id,p_submission_id,p_locale) base left join public.certification_submissions s on s.id=p_submission_id and s.app_user_id=p_app_user_id;
$$;
revoke all on function public.get_owned_certification_submission_before_membership(uuid,uuid,public.content_locale) from public,anon,authenticated,service_role;
revoke all on function public.get_owned_certification_submission(uuid,uuid,public.content_locale) from public,anon,authenticated;
grant execute on function public.get_owned_certification_submission(uuid,uuid,public.content_locale) to service_role;

alter function public.get_owned_celebrity_certification_history(uuid,text,public.content_locale) rename to get_owned_celebrity_certification_history_before_membership;
create function public.get_owned_celebrity_certification_history(p_app_user_id uuid,p_slug text,p_locale public.content_locale) returns jsonb language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(public.certification_membership_payload(item,s.membership_platform) order by ord),'[]'::jsonb) from jsonb_array_elements(public.get_owned_celebrity_certification_history_before_membership(p_app_user_id,p_slug,p_locale)) with ordinality rows(item,ord) left join public.certification_submissions s on item->>'kind'='manual' and s.id=(item->>'id')::uuid and s.app_user_id=p_app_user_id;
$$;
revoke all on function public.get_owned_celebrity_certification_history_before_membership(uuid,text,public.content_locale) from public,anon,authenticated,service_role;
revoke all on function public.get_owned_celebrity_certification_history(uuid,text,public.content_locale) from public,anon,authenticated;
grant execute on function public.get_owned_celebrity_certification_history(uuid,text,public.content_locale) to service_role;

alter function public.get_admin_certification_missions(uuid,uuid) rename to get_admin_certification_missions_before_membership;
create function public.get_admin_certification_missions(p_actor uuid,p_allowlist uuid) returns jsonb language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(public.certification_membership_payload(item,m.membership_platform) order by ord),'[]'::jsonb) from jsonb_array_elements(public.get_admin_certification_missions_before_membership(p_actor,p_allowlist)) with ordinality rows(item,ord) left join public.certification_missions m on m.id=(item->>'id')::uuid;
$$;
revoke all on function public.get_admin_certification_missions_before_membership(uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.get_admin_certification_missions(uuid,uuid) from public,anon,authenticated;
grant execute on function public.get_admin_certification_missions(uuid,uuid) to service_role;

alter function public.get_admin_certification_queue(uuid,uuid,public.certification_submission_status) rename to get_admin_certification_queue_before_membership;
create function public.get_admin_certification_queue(p_actor uuid,p_allowlist uuid,p_status public.certification_submission_status default 'pending') returns jsonb language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(public.certification_membership_payload(item,s.membership_platform) order by ord),'[]'::jsonb) from jsonb_array_elements(public.get_admin_certification_queue_before_membership(p_actor,p_allowlist,p_status)) with ordinality rows(item,ord) left join public.certification_submissions s on s.id=(item->>'id')::uuid;
$$;
revoke all on function public.get_admin_certification_queue_before_membership(uuid,uuid,public.certification_submission_status) from public,anon,authenticated,service_role;
revoke all on function public.get_admin_certification_queue(uuid,uuid,public.certification_submission_status) from public,anon,authenticated;
grant execute on function public.get_admin_certification_queue(uuid,uuid,public.certification_submission_status) to service_role;

-- Preserve the entire First Reaction and tier-stage wrapper chain. Only the new
-- type counter and the membership activity's canonical manual score are enriched.
create function public.membership_passport_payload(p_base jsonb,p_app_user_id uuid) returns jsonb
language plpgsql stable set search_path='' as $$
declare member_count integer; activities jsonb; result jsonb:=p_base;
begin
  select count(*)::integer into member_count from public.stamps
    where passport_id=(p_base->>'id')::uuid and app_user_id=p_app_user_id and stamp_type='membership';
  if member_count>0 then
    result:=jsonb_set(result,'{stampSummary}',(result->'stampSummary')||jsonb_build_object('membership',member_count));
  end if;
  if p_base ? 'activities' then
    select coalesce(jsonb_agg(case when item->>'type'='membership' then
      item||jsonb_build_object('points',coalesce((select ledger.points from public.fan_activities activity
        join public.fan_score_ledger ledger on ledger.manual_submission_id=activity.source_id
          and ledger.app_user_id=activity.app_user_id and ledger.celebrity_id=activity.celebrity_id
        where activity.id=(item->>'id')::uuid and activity.app_user_id=p_app_user_id
          and activity.activity_type='membership' and activity.source_type='certification_submission'),0))
      else item end order by ord),'[]'::jsonb) into activities
      from jsonb_array_elements(p_base->'activities') with ordinality rows(item,ord);
    result:=jsonb_set(result,'{activities}',activities);
  end if;
  return result;
end $$;

alter function public.get_owned_passport_collection(uuid,public.content_locale) rename to get_owned_passport_collection_before_membership;
create function public.get_owned_passport_collection(p_app_user_id uuid,p_locale public.content_locale) returns setof jsonb
language sql stable security definer set search_path='' as $$
  select public.membership_passport_payload(base,p_app_user_id) from public.get_owned_passport_collection_before_membership(p_app_user_id,p_locale) base;
$$;
revoke all on function public.get_owned_passport_collection_before_membership(uuid,public.content_locale) from public,anon,authenticated,service_role;
revoke all on function public.get_owned_passport_collection(uuid,public.content_locale) from public,anon,authenticated;
grant execute on function public.get_owned_passport_collection(uuid,public.content_locale) to service_role;

alter function public.get_owned_passport_detail(uuid,uuid,public.content_locale) rename to get_owned_passport_detail_before_membership;
create function public.get_owned_passport_detail(p_passport_id uuid,p_app_user_id uuid,p_locale public.content_locale) returns setof jsonb
language sql stable security definer set search_path='' as $$
  select public.membership_passport_payload(base,p_app_user_id) from public.get_owned_passport_detail_before_membership(p_passport_id,p_app_user_id,p_locale) base;
$$;
revoke all on function public.get_owned_passport_detail_before_membership(uuid,uuid,public.content_locale) from public,anon,authenticated,service_role;
revoke all on function public.get_owned_passport_detail(uuid,uuid,public.content_locale) from public,anon,authenticated;
grant execute on function public.get_owned_passport_detail(uuid,uuid,public.content_locale) to service_role;

alter function public.get_owned_stamp_detail(uuid,uuid,public.content_locale) rename to get_owned_stamp_detail_before_membership;
create function public.get_owned_stamp_detail(p_stamp_id uuid,p_app_user_id uuid,p_locale public.content_locale) returns setof jsonb
language sql stable security definer set search_path='' as $$
  select case when base->>'type'='membership' then jsonb_set(base,'{activity,points}',to_jsonb(coalesce((
    select ledger.points from public.fan_activities activity
      join public.fan_score_ledger ledger on ledger.manual_submission_id=activity.source_id
        and ledger.app_user_id=activity.app_user_id and ledger.celebrity_id=activity.celebrity_id
      where activity.id=(base->'activity'->>'id')::uuid and activity.app_user_id=p_app_user_id
        and activity.activity_type='membership' and activity.source_type='certification_submission'),0)))
    else base end
  from public.get_owned_stamp_detail_before_membership(p_stamp_id,p_app_user_id,p_locale) base;
$$;
revoke all on function public.get_owned_stamp_detail_before_membership(uuid,uuid,public.content_locale) from public,anon,authenticated,service_role;
revoke all on function public.get_owned_stamp_detail(uuid,uuid,public.content_locale) from public,anon,authenticated;
grant execute on function public.get_owned_stamp_detail(uuid,uuid,public.content_locale) to service_role;

revoke all on function public.guard_membership_mission_platform(),public.snapshot_membership_submission(),public.validate_membership_reward(),
  public.certification_membership_payload(jsonb,public.social_platform),public.membership_passport_payload(jsonb,uuid)
  from public,anon,authenticated,service_role;
revoke all on function public.save_admin_certification_mission_v2(uuid,uuid,uuid,uuid,uuid,text,bigint,text,text,text,text,text,text,text,timestamptz,timestamptz,smallint,bigint,public.social_platform)
  from public,anon,authenticated;
grant execute on function public.save_admin_certification_mission_v2(uuid,uuid,uuid,uuid,uuid,text,bigint,text,text,text,text,text,text,text,timestamptz,timestamptz,smallint,bigint,public.social_platform)
  to service_role;

create or replace function public.assert_stamp_blockchain_job_link_v2(
  credential_id uuid,
  credential_owner_id uuid,
  credential_celebrity_id uuid,
  credential_stamp_type text,
  credential_mint_status public.credential_mint_status,
  credential_job_id uuid,
  credential_tx_hash text,
  credential_token_id numeric
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  job_record public.blockchain_jobs%rowtype;
  celebrity_slug text;
  job_payload jsonb;
  expected_stamp_type text;
  expected_mint_status public.credential_mint_status;
  expected_payload_keys integer := 4;
  actual_payload_keys integer;
  worker_submission_key_count integer;
begin
  if credential_stamp_type not in ('knowledge', 'reservation', 'attendance', 'survey', 'membership') then
    raise exception 'unsupported stamp type';
  end if;

  if credential_job_id is null then
    if credential_mint_status <> 'queued'
       or credential_tx_hash is not null
       or credential_token_id is not null then
      raise exception 'unlinked credential must remain in canonical queued state';
    end if;
    return;
  end if;

  select * into job_record from public.blockchain_jobs where id = credential_job_id;
  if not found then raise exception 'credential blockchain job does not exist'; end if;
  if job_record.entity_type <> 'stamp' or job_record.entity_id <> credential_id then
    raise exception 'job entity does not match credential';
  end if;
  if job_record.payload_version <> 1 then
    raise exception 'job payload version must be 1';
  end if;

  select slug into strict celebrity_slug
  from public.celebrities where id = credential_celebrity_id;

  if job_record.operation_key <> 'byus:stamp:v1:' || credential_id::text then
    raise exception 'job operation key does not match credential';
  end if;

  job_payload := job_record.payload;
  if jsonb_typeof(job_payload) <> 'object' then
    raise exception 'job payload must be an object';
  end if;

  if job_payload ? 'workerSubmission' then
    expected_payload_keys := 5;
    if jsonb_typeof(job_payload -> 'workerSubmission') <> 'object' then
      raise exception 'job worker submission payload is invalid';
    end if;
    select count(*) into worker_submission_key_count
    from jsonb_object_keys(job_payload -> 'workerSubmission');
    if worker_submission_key_count <> 2
       or not ((job_payload -> 'workerSubmission') ?& array['txHash', 'signedTransaction'])
       or jsonb_typeof(job_payload -> 'workerSubmission' -> 'txHash') <> 'string'
       or jsonb_typeof(job_payload -> 'workerSubmission' -> 'signedTransaction') <> 'string'
       or coalesce(job_payload -> 'workerSubmission' ->> 'txHash', '') !~ '^0x[0-9a-fA-F]{64}$'
       or coalesce(job_payload -> 'workerSubmission' ->> 'signedTransaction', '') !~ '^0x[0-9a-fA-F]+$'
       or length(coalesce(job_payload -> 'workerSubmission' ->> 'signedTransaction', '')) > 262144 then
      raise exception 'job worker submission payload is invalid';
    end if;
  end if;

  select count(*) into actual_payload_keys from jsonb_object_keys(job_payload);
  if actual_payload_keys <> expected_payload_keys
     or not (job_payload ?& array['recipient', 'celebritySlug', 'issuanceId', 'stampType'])
     or jsonb_typeof(job_payload -> 'recipient') <> 'string'
     or jsonb_typeof(job_payload -> 'celebritySlug') <> 'string'
     or jsonb_typeof(job_payload -> 'issuanceId') <> 'string'
     or jsonb_typeof(job_payload -> 'stampType') <> 'string'
     or coalesce(job_payload ->> 'issuanceId', '') !~ '^0x[0-9a-fA-F]{64}$' then
    raise exception 'job stamp payload is invalid';
  end if;

  expected_stamp_type := upper(left(credential_stamp_type, 1)) || substr(credential_stamp_type, 2);
  if job_payload ->> 'stampType' is distinct from expected_stamp_type then
    raise exception 'job stamp type does not match credential';
  end if;
  if job_payload ->> 'celebritySlug' is distinct from celebrity_slug then
    raise exception 'job celebrity slug does not match credential';
  end if;
  if coalesce(job_payload ->> 'recipient', '') !~ '^0x[0-9a-fA-F]{40}$'
     or not exists (
       select 1 from public.user_wallets
       where app_user_id = credential_owner_id
         and chain_id = 91342
         and provider = 'privy'
         and wallet_type = 'embedded'
         and address = lower(job_payload ->> 'recipient')
     ) then
    raise exception 'job recipient is not owned by credential owner';
  end if;

  expected_mint_status := case job_record.status
    when 'PENDING' then 'queued'::public.credential_mint_status
    when 'PROCESSING' then 'processing'::public.credential_mint_status
    when 'RETRYING' then 'retryable'::public.credential_mint_status
    when 'FAILED' then 'permanent_failure'::public.credential_mint_status
    when 'COMPLETED' then 'minted'::public.credential_mint_status
  end;
  if credential_mint_status <> expected_mint_status then
    raise exception 'credential mint status does not match queue status';
  end if;
  if job_record.status = 'COMPLETED'
     and (credential_tx_hash is distinct from job_record.tx_hash
          or credential_token_id is distinct from job_record.token_id) then
    raise exception 'job completion result does not match credential';
  elsif job_record.status <> 'COMPLETED'
        and (credential_tx_hash is not null or credential_token_id is not null) then
    raise exception 'non-completed credential cannot expose a mint result';
  end if;
end;
$$;
create or replace function public.get_admin_fans(
  p_actor_app_user_id uuid,
  p_actor_admin_allowlist_id uuid,
  p_correlation_id uuid,
  p_locale public.content_locale,
  p_query text default null,
  p_celebrity_id uuid default null,
  p_account_status public.app_user_status default null,
  p_cursor_created_at timestamptz default null,
  p_cursor_id uuid default null,
  p_limit integer default 50
)
returns setof jsonb
language plpgsql security definer set search_path = '' as $$
declare
  verified_role public.admin_role;
  normalized_query text;
begin
  select allowlist.role into verified_role
  from public.admin_allowlist allowlist
  join public.app_users actor on actor.id = p_actor_app_user_id
   and actor.status = 'active' and actor.verified_email = allowlist.email
  where allowlist.id = p_actor_admin_allowlist_id and allowlist.active for share;
  if verified_role is null then raise exception 'active administrator is required'; end if;
  if p_correlation_id is null or p_limit is null or p_limit not between 1 and 100
     or ((p_cursor_created_at is null) <> (p_cursor_id is null)) then
    raise exception 'invalid fan operations request';
  end if;
  if p_query is not null then
    normalized_query := lower(normalize(btrim(p_query), NFKC));
    if length(normalized_query) not between 2 and 100 then
      raise exception 'fan search query must be between 2 and 100 characters';
    end if;
  end if;

  insert into public.audit_logs(
    actor_app_user_id, actor_admin_allowlist_id, action, entity_type,
    correlation_id, before_after_summary
  ) values (
    p_actor_app_user_id, p_actor_admin_allowlist_id, 'admin.fans.read',
    'fan_operations', p_correlation_id,
    jsonb_build_object(
      'result', 'authorized', 'queryKind', case when normalized_query is null then 'none' when strpos(normalized_query, '@') > 0 then 'email_exact' else 'nickname_contains' end,
      'celebrityFiltered', p_celebrity_id is not null, 'accountStatusFiltered', p_account_status is not null
    )
  );

  return query
  select jsonb_build_object(
    'fanId', user_record.id,
    'nickname', profile.nickname,
    'accountStatus', user_record.status,
    'maskedWallet', wallet.masked_address,
    'createdAt', user_record.created_at,
    'celebritySummaries', coalesce(journeys.items, '[]'::jsonb),
    'cursor', jsonb_build_object('createdAt', user_record.created_at, 'id', user_record.id)
  )
  from public.app_users user_record
  left join public.user_profiles profile on profile.app_user_id = user_record.id
  left join lateral (
    select public.mask_admin_wallet_address(w.address) as masked_address
    from public.user_wallets w where w.app_user_id = user_record.id
    order by (w.chain_id = 91342) desc, w.created_at limit 1
  ) wallet on true
  cross join lateral (
    select jsonb_agg(jsonb_build_object(
      'passportId', passport.id,
      'celebrity', jsonb_build_object('id', celebrity.id, 'slug', celebrity.slug, 'name', localization.name, 'archived', celebrity.archived_at is not null),
      'score', jsonb_build_object('points', scores.points, 'level', public.get_fan_effective_tier_for_score(user_record.id,celebrity.id,scores.points,(select policy_version from public.reward_policy_activation where singleton=true))),
      'activityCounts', activity_counts.value,
      'passportMintStatus', passport.mint_status,
      'stampSummary', stamp_counts.value,
      'benefitSummary', benefit_counts.value,
      'latestActivityAt', activity_counts.latest_at,
      'correctionAllowed', user_record.status = 'active' and celebrity.archived_at is null and verified_role in ('admin', 'operator')
    ) order by localization.name, passport.id) as items
    from public.fan_passports passport
    join public.celebrities celebrity on celebrity.id = passport.celebrity_id
    join public.celebrity_localizations localization on localization.celebrity_id = celebrity.id and localization.locale = p_locale
    cross join lateral (
      select coalesce(sum(ledger.points), 0)::integer as points
      from public.fan_score_ledger ledger where ledger.app_user_id = user_record.id and ledger.celebrity_id = celebrity.id
    ) scores
    cross join lateral (
      select jsonb_build_object(
        'knowledge', count(*) filter(where activity_type='knowledge'), 'reservation', count(*) filter(where activity_type='reservation'),
        'attendance', count(*) filter(where activity_type='attendance'), 'survey', count(*) filter(where activity_type='survey'), 'membership', count(*) filter(where activity_type='membership')
      ) as value, max(occurred_at) as latest_at
      from public.fan_activities activity where activity.app_user_id=user_record.id and activity.celebrity_id=celebrity.id
    ) activity_counts
    cross join lateral (
      select jsonb_build_object('total',count(*),'queued',count(*) filter(where mint_status<>'minted'),'minted',count(*) filter(where mint_status='minted')) as value
      from public.stamps stamp where stamp.app_user_id=user_record.id and stamp.celebrity_id=celebrity.id
    ) stamp_counts
    cross join lateral (
      select jsonb_build_object(
        'claims', (select count(*) from public.benefit_claims claim where claim.app_user_id=user_record.id and claim.celebrity_id=celebrity.id),
        'applications', (select count(*) from public.benefit_applications application where application.app_user_id=user_record.id and application.celebrity_id=celebrity.id)
      ) as value
    ) benefit_counts
    where passport.app_user_id = user_record.id
      and (p_celebrity_id is null or passport.celebrity_id = p_celebrity_id)
  ) journeys
  where journeys.items is not null
    and (p_account_status is null or user_record.status = p_account_status)
    and (p_cursor_created_at is null or (user_record.created_at, user_record.id) < (p_cursor_created_at, p_cursor_id))
    and (
      normalized_query is null
      or (strpos(normalized_query, '@') > 0 and user_record.verified_email = normalized_query)
      or (strpos(normalized_query, '@') = 0 and profile.nickname_normalized is not null and strpos(profile.nickname_normalized, normalized_query) > 0)
    )
  order by user_record.created_at desc, user_record.id desc
  limit p_limit;
end;
$$;
create or replace function public.read_admin_creator_analytics(
  p_actor_admin_allowlist_id uuid,
  p_celebrity_id uuid,
  p_live_event_id uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_as_of timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  verified_role public.admin_role;
  result jsonb;
begin
  select allowlist.role into verified_role
  from public.admin_allowlist allowlist
  where allowlist.id = p_actor_admin_allowlist_id and allowlist.active = true
  for share;

  if verified_role is null then raise exception 'active administrator is required'; end if;
  if p_celebrity_id is null then raise exception 'celebrity scope is required'; end if;
  if p_from is null or p_to is null or p_from >= p_to then
    raise exception 'analytics time range must be a non-empty [from,to) interval';
  end if;
  if p_as_of is null then raise exception 'analytics snapshot time is required'; end if;
  if not exists (select 1 from public.celebrities where id = p_celebrity_id) then
    raise exception 'analytics celebrity scope does not exist';
  end if;
  if p_live_event_id is not null and not exists (
    select 1 from public.live_events
    where id = p_live_event_id and celebrity_id = p_celebrity_id
  ) then
    raise exception 'analytics live scope does not belong to celebrity';
  end if;

  with target_fans as (
    select passport.app_user_id
    from public.fan_passports passport
    where passport.celebrity_id = p_celebrity_id
      and passport.issued_at <= p_as_of
      and (
        p_live_event_id is null or exists (
          select 1 from public.live_reservations reservation
          where reservation.app_user_id = passport.app_user_id
            and reservation.celebrity_id = p_celebrity_id
            and reservation.live_event_id = p_live_event_id
            and reservation.reserved_at <= p_as_of
        )
      )
  ), scores as (
    select target.app_user_id, coalesce(sum(ledger.points), 0)::integer as points
    from target_fans target
    left join public.fan_score_ledger ledger
      on ledger.app_user_id = target.app_user_id
     and ledger.celebrity_id = p_celebrity_id
     and ledger.created_at <= p_as_of
    group by target.app_user_id
  ), fan_levels as (
    select scores.*, public.get_fan_effective_tier_for_score(scores.app_user_id,p_celebrity_id,scores.points,(select policy_version from public.reward_policy_activation where singleton=true)) as level
    from scores
  ), values_ as (
    select
      (select count(distinct reservation.app_user_id)::integer
       from public.live_reservations reservation
       where reservation.celebrity_id = p_celebrity_id
         and (p_live_event_id is null or reservation.live_event_id = p_live_event_id)
         and reservation.reserved_at >= p_from and reservation.reserved_at < p_to) as reservations,
      (select count(*)::integer from public.fan_passports passport
       where passport.celebrity_id = p_celebrity_id
         and passport.issued_at >= p_from and passport.issued_at < p_to) as passports,
      (select jsonb_build_object(
        'bronze', count(*) filter (where level='Bronze')::integer,
        'silver', count(*) filter (where level='Silver')::integer,
        'gold', count(*) filter (where level='Gold')::integer,
        'platinum', count(*) filter (where level='Platinum')::integer,
        'diamond', count(*) filter (where level='Diamond')::integer,
        'total', count(*)::integer
       ) from fan_levels) as levels,
      (select jsonb_build_object(
        'knowledge', count(*) filter (where stamp.stamp_type = 'knowledge')::integer,
        'reservation', count(*) filter (where stamp.stamp_type = 'reservation')::integer,
        'attendance', count(*) filter (where stamp.stamp_type = 'attendance')::integer,
        'survey', count(*) filter (where stamp.stamp_type = 'survey')::integer,
        'membership', count(*) filter (where stamp.stamp_type = 'membership')::integer,
        'total', count(*)::integer
       )
       from public.stamps stamp
       where stamp.celebrity_id = p_celebrity_id
         and stamp.issued_at >= p_from and stamp.issued_at < p_to
         and (p_live_event_id is null or stamp.app_user_id in (select app_user_id from target_fans))) as stamp_counts
  )
  select jsonb_build_object(
    'scope', jsonb_build_object('celebrityId', p_celebrity_id, 'liveEventId', p_live_event_id),
    'window', jsonb_build_object('from', p_from, 'to', p_to, 'semantics', '[from,to)', 'asOf', p_as_of),
    'metrics', jsonb_build_object(
      'reservationUsers', jsonb_build_object('state', 'available', 'value', reservations, 'reason', null, 'source', 'live_reservations'),
      'passportsIssued', jsonb_build_object('state', 'available', 'value', passports, 'reason', null, 'source', 'fan_passports'),
      'levelDistribution', jsonb_build_object('state', 'available', 'value', levels, 'reason', null, 'source', 'fan_score_ledger', 'snapshotAt', p_as_of,
        'cohort', case when p_live_event_id is null then 'celebrity_passport_holders' else 'live_reservation_passport_holders' end),
      'stampTypeCounts', jsonb_build_object('state', 'available', 'value', stamp_counts, 'reason', null, 'source', 'stamps',
        'cohort', case when p_live_event_id is null then 'celebrity_passport_holders' else 'live_reservation_passport_holders' end),
      'attendanceUsers', jsonb_build_object('state', 'unavailable', 'value', null, 'reason', 'ATTENDANCE_SOURCE_NOT_IMPLEMENTED', 'source', null),
      'surveyResponses', jsonb_build_object('state', 'unavailable', 'value', null, 'reason', 'SURVEY_SOURCE_NOT_IMPLEMENTED', 'source', null)
    )
  ) into result from values_;
  return result;
end;
$$;