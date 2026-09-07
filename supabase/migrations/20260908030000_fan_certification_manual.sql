-- Manual fan certification: immutable mission/reward revisions, private proof
-- ownership, replay-safe submission/review, and dedicated ledger provenance.

create type public.certification_mission_status as enum ('draft','active','closed');
create type public.certification_submission_status as enum ('pending','approved','rejected');

create table public.certification_missions (
  id uuid primary key default extensions.gen_random_uuid(),
  celebrity_id uuid not null references public.celebrities(id) on delete restrict,
  immutable_key text not null unique check (immutable_key = lower(btrim(immutable_key)) and immutable_key ~ '^[a-z0-9][a-z0-9_-]{2,79}$'),
  revision bigint not null default 1 check (revision > 0),
  status public.certification_mission_status not null default 'draft',
  category text not null check (category = btrim(category) and length(category) between 1 and 60),
  title_ko text not null check (title_ko = btrim(title_ko) and length(title_ko) between 1 and 160),
  title_en text not null check (title_en = btrim(title_en) and length(title_en) between 1 and 160),
  description_ko text not null check (description_ko = btrim(description_ko) and length(description_ko) between 1 and 1200),
  description_en text not null check (description_en = btrim(description_en) and length(description_en) between 1 and 1200),
  instructions_ko text not null check (instructions_ko = btrim(instructions_ko) and length(instructions_ko) between 1 and 3000),
  instructions_en text not null check (instructions_en = btrim(instructions_en) and length(instructions_en) between 1 and 3000),
  opens_at timestamptz,
  closes_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  activated_at timestamptz,
  closed_at timestamptz,
  constraint certification_mission_window check (closes_at is null or opens_at is null or opens_at < closes_at),
  constraint certification_mission_status_times check (
    (status='draft' and activated_at is null and closed_at is null) or
    (status='active' and activated_at is not null and closed_at is null) or
    (status='closed' and activated_at is not null and closed_at is not null)
  ),
  unique (id, celebrity_id)
);

create table public.certification_reward_revisions (
  id uuid primary key default extensions.gen_random_uuid(),
  mission_id uuid not null references public.certification_missions(id) on delete restrict,
  revision bigint not null check (revision > 0),
  policy_version integer not null references public.reward_policy_versions(version) on delete restrict,
  score_points smallint not null check (score_points between 0 and 100),
  ticket_amount bigint not null check (ticket_amount between 0 and 1000000),
  actor_app_user_id uuid not null references public.app_users(id) on delete restrict,
  actor_admin_allowlist_id uuid not null references public.admin_allowlist(id) on delete restrict,
  correlation_id uuid not null,
  created_at timestamptz not null default now(),
  unique (mission_id, revision),
  unique (id, mission_id)
);

create table public.certification_uploads (
  id uuid primary key,
  app_user_id uuid not null references public.app_users(id) on delete restrict,
  celebrity_id uuid not null references public.celebrities(id) on delete restrict,
  mission_id uuid not null,
  object_path text not null unique check (object_path = btrim(object_path) and length(object_path) between 10 and 500),
  content_type text not null check (content_type in ('image/webp')),
  byte_size integer not null check (byte_size between 1 and 3145728),
  width integer not null check (width between 1 and 12000),
  height integer not null check (height between 1 and 12000),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  consumed_submission_id uuid,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '24 hours'),
  constraint certification_upload_mission_fk foreign key (mission_id, celebrity_id)
    references public.certification_missions(id, celebrity_id) on delete restrict,
  unique (id, app_user_id, mission_id)
);

create table public.certification_submissions (
  id uuid primary key default extensions.gen_random_uuid(),
  app_user_id uuid not null references public.app_users(id) on delete restrict,
  celebrity_id uuid not null references public.celebrities(id) on delete restrict,
  mission_id uuid not null,
  mission_revision bigint not null check (mission_revision > 0),
  reward_revision_id uuid not null,
  reward_revision bigint not null check (reward_revision > 0),
  reward_policy_version integer not null references public.reward_policy_versions(version) on delete restrict,
  reward_score_points smallint not null check (reward_score_points between 0 and 100),
  reward_ticket_amount bigint not null check (reward_ticket_amount between 0 and 1000000),
  attempt_number integer not null check (attempt_number between 1 and 1000),
  previous_submission_id uuid references public.certification_submissions(id) on delete restrict,
  idempotency_key uuid not null,
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  note text check (note is null or note = btrim(note) and length(note) between 1 and 1000),
  status public.certification_submission_status not null default 'pending',
  review_revision bigint not null default 1 check (review_revision > 0),
  rejection_reason text check (rejection_reason is null or rejection_reason = btrim(rejection_reason) and length(rejection_reason) between 3 and 1000),
  reviewed_by_app_user_id uuid references public.app_users(id) on delete restrict,
  reviewed_by_admin_allowlist_id uuid references public.admin_allowlist(id) on delete restrict,
  reviewed_at timestamptz,
  submitted_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint certification_submission_mission_fk foreign key (mission_id, celebrity_id)
    references public.certification_missions(id, celebrity_id) on delete restrict,
  constraint certification_submission_reward_fk foreign key (reward_revision_id, mission_id)
    references public.certification_reward_revisions(id, mission_id) on delete restrict,
  constraint certification_submission_previous_owner_fk foreign key (previous_submission_id, app_user_id, mission_id)
    references public.certification_submissions(id, app_user_id, mission_id) on delete restrict,
  constraint certification_submission_review_shape check (
    (status='pending' and rejection_reason is null and reviewed_by_app_user_id is null and reviewed_by_admin_allowlist_id is null and reviewed_at is null) or
    (status='approved' and rejection_reason is null and reviewed_by_app_user_id is not null and reviewed_by_admin_allowlist_id is not null and reviewed_at is not null) or
    (status='rejected' and rejection_reason is not null and reviewed_by_app_user_id is not null and reviewed_by_admin_allowlist_id is not null and reviewed_at is not null)
  ),
  unique (app_user_id, idempotency_key),
  unique (id, app_user_id, mission_id),
  unique (app_user_id, mission_id, attempt_number)
);

alter table public.certification_uploads
  add constraint certification_upload_consumed_fk foreign key (consumed_submission_id, app_user_id, mission_id)
  references public.certification_submissions(id, app_user_id, mission_id) on delete restrict;

create unique index certification_one_open_or_approved_per_owner_mission
  on public.certification_submissions(app_user_id,mission_id) where status in ('pending','approved');
create unique index certification_one_approved_per_owner_mission
  on public.certification_submissions(app_user_id,mission_id) where status='approved';
create index certification_queue_idx on public.certification_submissions(status,submitted_at,id);
create index certification_history_idx on public.certification_submissions(app_user_id,celebrity_id,submitted_at desc,id desc);

create table public.certification_review_operations (
  idempotency_key uuid primary key,
  submission_id uuid not null references public.certification_submissions(id) on delete restrict,
  expected_revision bigint not null,
  decision public.certification_submission_status not null check (decision in ('approved','rejected')),
  rejection_reason text,
  actor_app_user_id uuid not null references public.app_users(id) on delete restrict,
  actor_admin_allowlist_id uuid not null references public.admin_allowlist(id) on delete restrict,
  result jsonb not null,
  created_at timestamptz not null default now()
);

create function public.reject_certification_immutable_mutation() returns trigger
language plpgsql set search_path='' as $$ begin raise exception 'certification record is immutable'; end $$;
create trigger certification_rewards_immutable before update or delete on public.certification_reward_revisions for each row execute function public.reject_certification_immutable_mutation();
create trigger certification_reviews_immutable before update or delete on public.certification_review_operations for each row execute function public.reject_certification_immutable_mutation();
create trigger certification_rewards_reject_truncate before truncate on public.certification_reward_revisions for each statement execute function public.reject_certification_immutable_mutation();
create trigger certification_reviews_reject_truncate before truncate on public.certification_review_operations for each statement execute function public.reject_certification_immutable_mutation();
create trigger certification_upload_identity_immutable before update of id,app_user_id,celebrity_id,mission_id,object_path,content_type,byte_size,width,height,sha256,created_at,expires_at on public.certification_uploads for each row execute function public.reject_certification_immutable_mutation();

alter table public.fan_score_ledger drop constraint fan_score_ledger_exactly_one_source;
alter table public.fan_score_ledger add column manual_submission_id uuid unique references public.certification_submissions(id) on delete restrict;
alter table public.fan_score_ledger add constraint fan_score_ledger_exactly_one_source check (num_nonnulls(activity_id,adjustment_id,manual_submission_id)=1);

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
  if new.points<>expected_points then raise exception 'fan score points do not match source'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('g5:fan-score:'||new.app_user_id::text||':'||new.celebrity_id::text,0));
  select coalesce(sum(points::bigint),0) into current_score from public.fan_score_ledger where app_user_id=new.app_user_id and celebrity_id=new.celebrity_id;
  next_score:=current_score+new.points::bigint;
  if next_score<0 or next_score>1000000 then raise exception 'fan score total must remain between 0 and 1000000'; end if;
  return new;
end $$;

create function public.validate_certification_ticket_source() returns trigger
language plpgsql set search_path='' as $$
declare source public.certification_submissions%rowtype;
begin
  if new.source_type<>'manual_certification' then return new; end if;
  select * into strict source from public.certification_submissions
    where id=new.source_id and app_user_id=new.app_user_id and celebrity_id=new.celebrity_id and status='approved';
  if new.entry_kind<>'credit' or new.amount<>source.reward_ticket_amount or new.amount<=0
     or new.policy_version<>source.reward_policy_version
     or new.setting_revision is not null
     or new.reward_setting_revision_id is not null then
    raise exception 'manual certification ticket does not match approved reward snapshot';
  end if;
  return new;
end $$;
create trigger fan_ticket_ledger_validate_certification_source before insert on public.fan_ticket_ledger
for each row execute function public.validate_certification_ticket_source();

create function public.assert_certification_admin(p_actor uuid,p_allowlist uuid) returns public.admin_role
language plpgsql stable security definer set search_path='' as $$
declare result public.admin_role;
begin
  select a.role into result from public.admin_allowlist a join public.app_users u on u.id=p_actor and u.status='active' and u.verified_email=a.email
  where a.id=p_allowlist and a.active;
  if result is null or result='viewer' then raise exception 'CERTIFICATION_ADMIN_REQUIRED'; end if;
  return result;
end $$;

create function public.save_admin_certification_mission(
  p_actor uuid,p_allowlist uuid,p_correlation uuid,p_mission_id uuid,p_celebrity_id uuid,p_immutable_key text,
  p_expected_revision bigint,p_category text,p_title_ko text,p_title_en text,p_description_ko text,p_description_en text,
  p_instructions_ko text,p_instructions_en text,p_opens_at timestamptz,p_closes_at timestamptz,p_score_points smallint,p_ticket_amount bigint
) returns jsonb language plpgsql security definer set search_path='' as $$
declare mission public.certification_missions%rowtype; reward public.certification_reward_revisions%rowtype; policy integer;
begin
  perform public.assert_certification_admin(p_actor,p_allowlist);
  select policy_version into strict policy from public.reward_policy_activation where singleton;
  if p_score_points is null or p_ticket_amount is null then raise exception 'CERTIFICATION_REWARD_REQUIRED'; end if;
  if (p_mission_id is null)<>(p_expected_revision is null) then raise exception 'CERTIFICATION_MISSION_REVISION_PAIR_REQUIRED'; end if;
  if p_mission_id is null then
    insert into public.certification_missions(id,celebrity_id,immutable_key,category,title_ko,title_en,description_ko,description_en,instructions_ko,instructions_en,opens_at,closes_at)
    values(extensions.gen_random_uuid(),p_celebrity_id,lower(btrim(p_immutable_key)),btrim(p_category),btrim(p_title_ko),btrim(p_title_en),btrim(p_description_ko),btrim(p_description_en),btrim(p_instructions_ko),btrim(p_instructions_en),p_opens_at,p_closes_at) returning * into mission;
  else
    select * into strict mission from public.certification_missions where id=p_mission_id for update;
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

create function public.set_admin_certification_mission_status(p_actor uuid,p_allowlist uuid,p_correlation uuid,p_mission_id uuid,p_expected_revision bigint,p_status public.certification_mission_status)
returns jsonb language plpgsql security definer set search_path='' as $$
declare mission public.certification_missions%rowtype;
begin
  perform public.assert_certification_admin(p_actor,p_allowlist);
  select * into strict mission from public.certification_missions where id=p_mission_id for update;
  if mission.revision<>p_expected_revision then raise exception 'CERTIFICATION_STALE_REVISION'; end if;
  if p_status='active' and mission.status='draft' then
    if not exists(select 1 from public.certification_reward_revisions r where r.mission_id=mission.id and r.revision=mission.revision)
       or mission.opens_at is null or mission.closes_at is null or mission.opens_at>=mission.closes_at then raise exception 'CERTIFICATION_ACTIVATION_INCOMPLETE'; end if;
    update public.certification_missions set status='active',revision=revision+1,activated_at=now(),updated_at=now() where id=mission.id returning * into mission;
  elsif p_status='closed' and mission.status='active' then
    update public.certification_missions set status='closed',revision=revision+1,closed_at=now(),updated_at=now() where id=mission.id returning * into mission;
  else raise exception 'CERTIFICATION_STATUS_TRANSITION_INVALID'; end if;
  insert into public.audit_logs(actor_app_user_id,actor_admin_allowlist_id,action,entity_type,entity_id,correlation_id,before_after_summary)
  values(p_actor,p_allowlist,'certification.mission.'||mission.status,'certification_mission',mission.id::text,p_correlation,jsonb_build_object('revision',mission.revision));
  return jsonb_build_object('id',mission.id,'revision',mission.revision,'status',mission.status);
end $$;

create function public.register_owned_certification_upload(p_app_user_id uuid,p_mission_id uuid,p_upload_id uuid,p_object_path text,p_byte_size integer,p_width integer,p_height integer,p_sha256 text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare mission public.certification_missions%rowtype;
begin
  select * into mission from public.certification_missions where id=p_mission_id and status='active' and statement_timestamp()>=opens_at and statement_timestamp()<closes_at;
  if not found then raise exception 'CERTIFICATION_MISSION_UNAVAILABLE'; end if;
  if p_object_path<>p_app_user_id::text||'/'||p_mission_id::text||'/'||p_upload_id::text||'.webp' then raise exception 'CERTIFICATION_UPLOAD_PATH_INVALID'; end if;
  if not exists(select 1 from public.app_users where id=p_app_user_id and status='active') or not exists(select 1 from public.fan_passports where app_user_id=p_app_user_id and celebrity_id=mission.celebrity_id and business_status='issued') then raise exception 'CERTIFICATION_PASSPORT_REQUIRED'; end if;
  insert into public.certification_uploads(id,app_user_id,celebrity_id,mission_id,object_path,content_type,byte_size,width,height,sha256)
  values(p_upload_id,p_app_user_id,mission.celebrity_id,mission.id,p_object_path,'image/webp',p_byte_size,p_width,p_height,lower(p_sha256));
  return jsonb_build_object('uploadId',p_upload_id,'expiresAt',now()+interval '24 hours');
end $$;

create function public.submit_owned_certification(p_app_user_id uuid,p_mission_id uuid,p_idempotency_key uuid,p_upload_ids jsonb,p_note text,p_previous_submission_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare mission public.certification_missions%rowtype; reward public.certification_reward_revisions%rowtype; existing public.certification_submissions%rowtype;
  previous public.certification_submissions%rowtype; new_row public.certification_submissions%rowtype; normalized_note text; request_hash text; attempt integer; ids uuid[];
begin
  if jsonb_typeof(p_upload_ids)<>'array' or jsonb_array_length(p_upload_ids) not between 1 and 3 then raise exception 'CERTIFICATION_UPLOAD_COUNT_INVALID'; end if;
  select array_agg(value::uuid order by value) into ids from jsonb_array_elements_text(p_upload_ids);
  if array_length(ids,1)<>cardinality(array(select distinct unnest(ids))) then raise exception 'CERTIFICATION_UPLOAD_DUPLICATE'; end if;
  normalized_note:=nullif(btrim(coalesce(p_note,'')),'');
  request_hash:=encode(extensions.digest((jsonb_build_object('missionId',p_mission_id,'uploadIds',to_jsonb(ids),'note',normalized_note,'previousSubmissionId',p_previous_submission_id))::text,'sha256'),'hex');
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('certification:submit:key:'||p_app_user_id::text||':'||p_idempotency_key::text,0));
  select * into existing from public.certification_submissions where app_user_id=p_app_user_id and idempotency_key=p_idempotency_key;
  if found then
    if existing.request_hash<>request_hash then raise exception 'CERTIFICATION_IDEMPOTENCY_CONFLICT'; end if;
    return jsonb_build_object('id',existing.id,'status',existing.status,'revision',existing.review_revision,'replayed',true);
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('certification:submit:'||p_app_user_id::text||':'||p_mission_id::text,0));
  select * into mission from public.certification_missions where id=p_mission_id and status='active' and statement_timestamp()>=opens_at and statement_timestamp()<closes_at for share;
  if not found then raise exception 'CERTIFICATION_MISSION_UNAVAILABLE'; end if;
  if not exists(select 1 from public.fan_passports where app_user_id=p_app_user_id and celebrity_id=mission.celebrity_id and business_status='issued') then raise exception 'CERTIFICATION_PASSPORT_REQUIRED'; end if;
  if exists(select 1 from public.certification_submissions where app_user_id=p_app_user_id and mission_id=p_mission_id and status in ('pending','approved')) then raise exception 'CERTIFICATION_ALREADY_OPEN'; end if;
  if p_previous_submission_id is null then
    if exists(select 1 from public.certification_submissions where app_user_id=p_app_user_id and mission_id=p_mission_id) then raise exception 'CERTIFICATION_PREVIOUS_REQUIRED'; end if;
  else
    select * into previous from public.certification_submissions where id=p_previous_submission_id and app_user_id=p_app_user_id and mission_id=p_mission_id and status='rejected';
    if not found then raise exception 'CERTIFICATION_PREVIOUS_INVALID'; end if;
  end if;
  if (select count(*) from public.certification_uploads where id=any(ids) and app_user_id=p_app_user_id and mission_id=p_mission_id and consumed_submission_id is null and expires_at>now())<>array_length(ids,1) then raise exception 'CERTIFICATION_UPLOAD_INVALID'; end if;
  select * into strict reward from public.certification_reward_revisions where mission_id=mission.id order by revision desc limit 1;
  select coalesce(max(attempt_number),0)+1 into attempt from public.certification_submissions where app_user_id=p_app_user_id and mission_id=p_mission_id;
  insert into public.certification_submissions(app_user_id,celebrity_id,mission_id,mission_revision,reward_revision_id,reward_revision,reward_policy_version,reward_score_points,reward_ticket_amount,attempt_number,previous_submission_id,idempotency_key,request_hash,note)
  values(p_app_user_id,mission.celebrity_id,mission.id,mission.revision,reward.id,reward.revision,reward.policy_version,reward.score_points,reward.ticket_amount,attempt,p_previous_submission_id,p_idempotency_key,request_hash,normalized_note) returning * into new_row;
  update public.certification_uploads set consumed_submission_id=new_row.id where id=any(ids);
  return jsonb_build_object('id',new_row.id,'status',new_row.status,'revision',new_row.review_revision,'replayed',false);
end $$;

create function public.review_admin_certification_submission(p_actor uuid,p_allowlist uuid,p_correlation uuid,p_submission_id uuid,p_idempotency_key uuid,p_expected_revision bigint,p_decision text,p_rejection_reason text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare submission public.certification_submissions%rowtype; operation public.certification_review_operations%rowtype; result jsonb; decision public.certification_submission_status; reason text;
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
  update public.certification_submissions set status=decision,rejection_reason=reason,reviewed_by_app_user_id=p_actor,reviewed_by_admin_allowlist_id=p_allowlist,reviewed_at=now(),review_revision=review_revision+1,updated_at=now() where id=submission.id returning * into submission;
  if decision='approved' then
    if submission.reward_score_points>0 then insert into public.fan_score_ledger(app_user_id,celebrity_id,points,manual_submission_id) values(submission.app_user_id,submission.celebrity_id,submission.reward_score_points,submission.id); end if;
    if submission.reward_ticket_amount>0 then perform public.post_fan_ticket_entry(submission.app_user_id,submission.celebrity_id,'credit',submission.reward_ticket_amount,'manual_certification',submission.id,submission.id,submission.reward_policy_version,null,null); end if;
  end if;
  result:=jsonb_build_object('id',submission.id,'status',submission.status,'revision',submission.review_revision,'replayed',false);
  insert into public.certification_review_operations values(p_idempotency_key,submission.id,p_expected_revision,decision,reason,p_actor,p_allowlist,result,now());
  insert into public.audit_logs(actor_app_user_id,actor_admin_allowlist_id,action,entity_type,entity_id,correlation_id,before_after_summary)
  values(p_actor,p_allowlist,'certification.submission.'||submission.status,'certification_submission',submission.id::text,p_correlation,jsonb_build_object('revision',submission.review_revision,'reason',reason,'reward',jsonb_build_object('scorePoints',submission.reward_score_points,'ticketAmount',submission.reward_ticket_amount)));
  return result;
end $$;

create function public.get_public_certifications(p_slug text,p_locale public.content_locale) returns jsonb
language sql stable security definer set search_path='' as $$
with celebrity as (select id,slug from public.celebrities where slug=p_slug and status='published' and archived_at is null), rows as (
  select q.id,'quiz'::text kind,'팬 인증'::text category,case when p_locale='ko' then 'Official Fan 인증 퀴즈' else 'Official Fan Quiz' end title,
    case when p_locale='ko' then '퀴즈를 통과하고 Fan Passport를 시작하세요.' else 'Pass the quiz to start your Fan Passport.' end description,
    'available'::text status,jsonb_build_object('scorePoints',1,'ticketAmount',1) reward,'/c/'||c.slug||'/verify?locale='||p_locale::text action
  from celebrity c join public.celebrity_quizzes q on q.celebrity_id=c.id and q.status='published'
  union all
  select m.id,'live_mission',case when p_locale='ko' then 'LIVE 미션' else 'LIVE Mission' end,ml.title,ml.description,
    case when now()<m.visible_from then 'preparing' when now()>=m.visible_until or m.lifecycle_status<>'published' then 'closed' else 'available' end,
    jsonb_build_object('scorePoints',r.mission_score,'ticketAmount',r.mission_ticket),'/live/'||l.slug||'/missions?locale='||p_locale::text
  from celebrity c join public.live_events l on l.celebrity_id=c.id and l.publication_status='published' and l.archived_at is null
  join public.live_surveys m on m.live_event_id=l.id and not m.legacy_contract
  join public.live_survey_localizations ml on ml.survey_id=m.id and ml.locale=p_locale
  left join public.live_survey_reward_setting_bindings b on b.survey_id=m.id left join public.live_reward_setting_revisions r on r.id=b.reward_setting_revision_id
  where m.ever_published_at is not null and m.lifecycle_status in ('published','closed') and m.archived_at is null
  union all
  select m.id,'manual',m.category,case when p_locale='ko' then m.title_ko else m.title_en end,case when p_locale='ko' then m.description_ko else m.description_en end,
    case when m.status='closed' or now()>=m.closes_at then 'closed' when m.status='active' and now()>=m.opens_at then 'available' else 'preparing' end,
    jsonb_build_object('scorePoints',r.score_points,'ticketAmount',r.ticket_amount),'/c/'||c.slug||'/certifications/'||m.id::text||'?locale='||p_locale::text
  from celebrity c join public.certification_missions m on m.celebrity_id=c.id join lateral(select x.* from public.certification_reward_revisions x where x.mission_id=m.id order by x.revision desc limit 1) r on true
  where m.status<>'draft'
) select coalesce(jsonb_agg(jsonb_build_object('id',id,'kind',kind,'category',category,'title',title,'description',description,'status',status,'reward',reward,'actionHref',action) order by kind,title),'[]'::jsonb) from rows;
$$;

create function public.get_public_certification(p_id uuid,p_locale public.content_locale) returns jsonb
language sql stable security definer set search_path='' as $$
select jsonb_build_object('id',m.id,'kind','manual','celebrity',jsonb_build_object('slug',c.slug,'name',coalesce(cl.name,c.slug)),'category',m.category,'title',case when p_locale='ko' then m.title_ko else m.title_en end,'description',case when p_locale='ko' then m.description_ko else m.description_en end,'instructions',case when p_locale='ko' then m.instructions_ko else m.instructions_en end,'status',case when m.status='closed' or now()>=m.closes_at then 'closed' when m.status='active' and now()>=m.opens_at then 'available' else 'preparing' end,'opensAt',m.opens_at,'closesAt',m.closes_at,'reward',jsonb_build_object('scorePoints',r.score_points,'ticketAmount',r.ticket_amount))
from public.certification_missions m join public.celebrities c on c.id=m.celebrity_id left join public.celebrity_localizations cl on cl.celebrity_id=c.id and cl.locale=p_locale
join lateral(select x.* from public.certification_reward_revisions x where x.mission_id=m.id order by x.revision desc limit 1) r on true
where m.id=p_id and m.status<>'draft' and c.status='published' and c.archived_at is null;
$$;

create function public.get_owned_certification_submission(p_app_user_id uuid,p_submission_id uuid,p_locale public.content_locale) returns jsonb
language sql stable security definer set search_path='' as $$
select jsonb_build_object('id',s.id,'missionId',s.mission_id,'title',case when p_locale='ko' then m.title_ko else m.title_en end,'status',s.status,'attemptNumber',s.attempt_number,'note',s.note,'rejectionReason',s.rejection_reason,'revision',s.review_revision,'submittedAt',s.submitted_at,'reviewedAt',s.reviewed_at,'reward',jsonb_build_object('scorePoints',s.reward_score_points,'ticketAmount',s.reward_ticket_amount),'uploads',(select coalesce(jsonb_agg(jsonb_build_object('id',u.id,'contentType',u.content_type,'width',u.width,'height',u.height) order by u.created_at),'[]'::jsonb) from public.certification_uploads u where u.consumed_submission_id=s.id))
from public.certification_submissions s join public.certification_missions m on m.id=s.mission_id where s.id=p_submission_id and s.app_user_id=p_app_user_id;
$$;

create function public.get_owned_celebrity_certification_history(p_app_user_id uuid,p_slug text,p_locale public.content_locale) returns jsonb
language sql stable security definer set search_path='' as $$
with celebrity as (select id,slug from public.celebrities where slug=p_slug), history as (
  select s.id,'manual'::text kind,s.mission_id,case when p_locale='ko' then m.title_ko else m.title_en end title,s.status::text status,s.attempt_number,s.rejection_reason,s.submitted_at,s.reviewed_at,'/c/'||c.slug||'/certifications/'||m.id::text||'?locale='||p_locale::text action
  from celebrity c join public.certification_submissions s on s.celebrity_id=c.id and s.app_user_id=p_app_user_id join public.certification_missions m on m.id=s.mission_id
  union all
  select a.id,'quiz',a.quiz_id,case when p_locale='ko' then 'Official Fan 인증 퀴즈' else 'Official Fan Quiz' end,
    case a.status when 'passed' then 'approved' when 'failed' then 'rejected' else 'pending' end,1,null,a.created_at,a.submitted_at,'/c/'||c.slug||'/verify?locale='||p_locale::text
  from celebrity c join public.quiz_attempts a on a.celebrity_id=c.id and a.app_user_id=p_app_user_id
  union all
  select r.id,'live_mission',r.survey_id,ml.title,'approved',1,null,r.submitted_at,r.submitted_at,'/live/'||l.slug||'/missions?locale='||p_locale::text
  from celebrity c join public.live_events l on l.celebrity_id=c.id join public.live_survey_responses r on r.live_event_id=l.id and r.app_user_id=p_app_user_id and r.status='submitted'
  join public.live_surveys m on m.id=r.survey_id and not m.legacy_contract join public.live_survey_localizations ml on ml.survey_id=m.id and ml.locale=p_locale
) select coalesce(jsonb_agg(jsonb_build_object('id',id,'kind',kind,'missionId',mission_id,'title',title,'status',status,'attemptNumber',attempt_number,'rejectionReason',rejection_reason,'submittedAt',submitted_at,'reviewedAt',reviewed_at,'actionHref',action) order by submitted_at desc),'[]'::jsonb) from history;
$$;

create function public.get_owned_certification_proof_path(p_app_user_id uuid,p_submission_id uuid,p_upload_id uuid) returns text
language sql stable security definer set search_path='' as $$
select u.object_path from public.certification_uploads u where u.id=p_upload_id and u.consumed_submission_id=p_submission_id and u.app_user_id=p_app_user_id;
$$;
create function public.get_admin_certification_proof_path(p_actor uuid,p_allowlist uuid,p_submission_id uuid,p_upload_id uuid) returns text
language plpgsql stable security definer set search_path='' as $$
declare result text; begin perform public.assert_certification_admin(p_actor,p_allowlist); select u.object_path into result from public.certification_uploads u where u.id=p_upload_id and u.consumed_submission_id=p_submission_id; return result; end $$;

create function public.get_admin_certification_missions(p_actor uuid,p_allowlist uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin perform public.assert_certification_admin(p_actor,p_allowlist); return (select coalesce(jsonb_agg(jsonb_build_object('id',m.id,'celebrityId',m.celebrity_id,'celebritySlug',c.slug,'immutableKey',m.immutable_key,'revision',m.revision,'status',m.status,'category',m.category,'titleKo',m.title_ko,'titleEn',m.title_en,'descriptionKo',m.description_ko,'descriptionEn',m.description_en,'instructionsKo',m.instructions_ko,'instructionsEn',m.instructions_en,'opensAt',m.opens_at,'closesAt',m.closes_at,'reward',jsonb_build_object('scorePoints',r.score_points,'ticketAmount',r.ticket_amount)) order by m.updated_at desc),'[]'::jsonb) from public.certification_missions m join public.celebrities c on c.id=m.celebrity_id left join lateral(select * from public.certification_reward_revisions x where x.mission_id=m.id order by x.revision desc limit 1) r on true); end $$;
create function public.get_admin_certification_queue(p_actor uuid,p_allowlist uuid,p_status public.certification_submission_status default 'pending') returns jsonb language plpgsql stable security definer set search_path='' as $$
begin perform public.assert_certification_admin(p_actor,p_allowlist); return (select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'missionId',s.mission_id,'missionTitle',m.title_ko,'celebritySlug',c.slug,'appUserId',s.app_user_id,'status',s.status,'attemptNumber',s.attempt_number,'note',s.note,'revision',s.review_revision,'submittedAt',s.submitted_at,'reward',jsonb_build_object('scorePoints',s.reward_score_points,'ticketAmount',s.reward_ticket_amount),'uploads',(select coalesce(jsonb_agg(jsonb_build_object('id',u.id,'width',u.width,'height',u.height)),'[]'::jsonb) from public.certification_uploads u where u.consumed_submission_id=s.id)) order by s.submitted_at),'[]'::jsonb) from public.certification_submissions s join public.certification_missions m on m.id=s.mission_id join public.celebrities c on c.id=s.celebrity_id where s.status=p_status); end $$;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('certification-proofs','certification-proofs',false,3145728,array['image/webp']) on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

alter table public.certification_missions enable row level security; alter table public.certification_missions force row level security;
alter table public.certification_reward_revisions enable row level security; alter table public.certification_reward_revisions force row level security;
alter table public.certification_uploads enable row level security; alter table public.certification_uploads force row level security;
alter table public.certification_submissions enable row level security; alter table public.certification_submissions force row level security;
alter table public.certification_review_operations enable row level security; alter table public.certification_review_operations force row level security;
revoke all on table public.certification_missions,public.certification_reward_revisions,public.certification_uploads,public.certification_submissions,public.certification_review_operations from public,anon,authenticated,service_role;
revoke all on function public.reject_certification_immutable_mutation(),public.validate_certification_ticket_source(),public.assert_certification_admin(uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.save_admin_certification_mission(uuid,uuid,uuid,uuid,uuid,text,bigint,text,text,text,text,text,text,text,timestamptz,timestamptz,smallint,bigint),public.set_admin_certification_mission_status(uuid,uuid,uuid,uuid,bigint,public.certification_mission_status),public.register_owned_certification_upload(uuid,uuid,uuid,text,integer,integer,integer,text),public.submit_owned_certification(uuid,uuid,uuid,jsonb,text,uuid),public.review_admin_certification_submission(uuid,uuid,uuid,uuid,uuid,bigint,text,text),public.get_public_certifications(text,public.content_locale),public.get_public_certification(uuid,public.content_locale),public.get_owned_certification_submission(uuid,uuid,public.content_locale),public.get_owned_celebrity_certification_history(uuid,text,public.content_locale),public.get_owned_certification_proof_path(uuid,uuid,uuid),public.get_admin_certification_proof_path(uuid,uuid,uuid,uuid),public.get_admin_certification_missions(uuid,uuid),public.get_admin_certification_queue(uuid,uuid,public.certification_submission_status) from public,anon,authenticated;
grant execute on function public.save_admin_certification_mission(uuid,uuid,uuid,uuid,uuid,text,bigint,text,text,text,text,text,text,text,timestamptz,timestamptz,smallint,bigint),public.set_admin_certification_mission_status(uuid,uuid,uuid,uuid,bigint,public.certification_mission_status),public.register_owned_certification_upload(uuid,uuid,uuid,text,integer,integer,integer,text),public.submit_owned_certification(uuid,uuid,uuid,jsonb,text,uuid),public.review_admin_certification_submission(uuid,uuid,uuid,uuid,uuid,bigint,text,text),public.get_public_certifications(text,public.content_locale),public.get_public_certification(uuid,public.content_locale),public.get_owned_certification_submission(uuid,uuid,public.content_locale),public.get_owned_celebrity_certification_history(uuid,text,public.content_locale),public.get_owned_certification_proof_path(uuid,uuid,uuid),public.get_admin_certification_proof_path(uuid,uuid,uuid,uuid),public.get_admin_certification_missions(uuid,uuid),public.get_admin_certification_queue(uuid,uuid,public.certification_submission_status) to service_role;
