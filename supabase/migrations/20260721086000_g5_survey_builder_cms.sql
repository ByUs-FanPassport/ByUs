-- G5 / ADM-006: administrator survey builder lifecycle and safe CMS projections.
-- Published question graphs remain immutable. CMS reads never join fan responses or answers.

alter table public.live_surveys
  add column if not exists lifecycle_status text not null default 'draft'
    check (lifecycle_status in ('draft','published','closed','archived')),
  add column if not exists closed_at timestamptz,
  add column if not exists archived_at timestamptz,
  add column if not exists ever_published_at timestamptz,
  add column if not exists revision integer not null default 0 check (revision >= 0),
  add column if not exists source_survey_id uuid references public.live_surveys(id) on delete restrict;

update public.live_surveys set
  lifecycle_status = case when publication_status='published' then 'published' else 'draft' end,
  ever_published_at = case when publication_status='published' then published_at else ever_published_at end;

alter table public.live_surveys drop constraint if exists live_surveys_publication_timestamp;
alter table public.live_surveys add constraint live_surveys_publication_timestamp check (
  (lifecycle_status = 'draft' and publication_status = 'draft' and published_at is null and closed_at is null and archived_at is null)
  or (lifecycle_status = 'published' and publication_status = 'published' and published_at is not null and closed_at is null and archived_at is null)
  or (lifecycle_status = 'closed' and publication_status = 'draft' and published_at is null and closed_at is not null and archived_at is null)
  or (lifecycle_status = 'archived' and publication_status = 'draft' and published_at is null and archived_at is not null)
);

drop index if exists live_surveys_one_published_per_live_idx;
create unique index live_surveys_one_published_per_live_idx
  on public.live_surveys (live_event_id) where publication_status = 'published';

create or replace function public.reject_live_survey_snapshot_mutation()
returns trigger language plpgsql set search_path = '' as $$
declare target_survey_id uuid; target_status text;
begin
  if tg_table_name = 'live_surveys' then
    target_survey_id := coalesce(new.id, old.id);
    if tg_op = 'UPDATE' and old.lifecycle_status in ('published', 'closed', 'archived')
       and new.id = old.id and new.live_event_id = old.live_event_id and new.version = old.version
       and new.created_at = old.created_at
       and new.source_survey_id is not distinct from old.source_survey_id
       and new.lifecycle_status in ('published', 'closed', 'archived') then return new;
    end if;
    target_status := old.lifecycle_status;
  elsif tg_table_name = 'live_survey_questions' then target_survey_id := coalesce(new.survey_id, old.survey_id);
  elsif tg_table_name = 'live_survey_question_localizations' then
    select survey_id into strict target_survey_id from public.live_survey_questions where id = coalesce(new.question_id, old.question_id);
  elsif tg_table_name = 'live_survey_options' then
    select survey_id into strict target_survey_id from public.live_survey_questions where id = coalesce(new.question_id, old.question_id);
  else
    select question.survey_id into strict target_survey_id from public.live_survey_options option
    join public.live_survey_questions question on question.id = option.question_id
    where option.id = coalesce(new.option_id, old.option_id);
  end if;
  if target_status is null then select lifecycle_status into target_status from public.live_surveys where id = target_survey_id; end if;
  if target_status in ('published', 'closed', 'archived') then raise exception 'published survey snapshots are immutable'; end if;
  if exists (select 1 from public.live_survey_responses where survey_id = target_survey_id) then raise exception 'survey snapshots with responses are immutable'; end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create or replace function public.admin_assert_active_survey_actor(
  p_app_user_id uuid, p_allowlist_id uuid, p_mutation boolean
) returns text language plpgsql security definer set search_path = '' as $$
declare actor_role text;
begin
  select admin.role::text into actor_role from public.admin_allowlist admin
  where admin.id = p_allowlist_id and admin.active
    and exists(select 1 from public.app_users app_user where app_user.id=p_app_user_id
      and app_user.status='active' and app_user.verified_email=admin.email);
  if actor_role is null then raise exception 'active administrator is required'; end if;
  if p_mutation and actor_role = 'viewer' then raise exception 'viewer role is read only'; end if;
  return actor_role;
end;
$$;

create or replace function public.get_admin_live_survey(
  p_actor_app_user_id uuid, p_actor_allowlist_id uuid, p_live_event_id uuid
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
  perform public.admin_assert_active_survey_actor(p_actor_app_user_id, p_actor_allowlist_id, false);
  if not exists (select 1 from public.live_events where id = p_live_event_id) then raise exception 'live event not found'; end if;
  select jsonb_build_object(
    'liveEvent', jsonb_build_object('id', live.id, 'slug', live.slug, 'status', live.publication_status),
    'versions', coalesce(jsonb_agg(jsonb_build_object(
      'id', survey.id, 'version', survey.version, 'revision', survey.revision, 'status', survey.lifecycle_status,
      'publishedAt', survey.published_at, 'closedAt', survey.closed_at, 'archivedAt', survey.archived_at,
      'sourceSurveyId', survey.source_survey_id,
      'questions', coalesce((select jsonb_agg(jsonb_build_object(
        'id', question.id, 'type', question.question_type, 'commonKey', question.common_key,
        'required', question.is_required, 'position', question.position,
        'text', jsonb_build_object(
          'ko', (select ql.question_text from public.live_survey_question_localizations ql where ql.question_id=question.id and ql.locale='ko'),
          'en', (select ql.question_text from public.live_survey_question_localizations ql where ql.question_id=question.id and ql.locale='en')
        ), 'options', coalesce((select jsonb_agg(jsonb_build_object(
          'id', option.id, 'position', option.position,
          'label', jsonb_build_object(
            'ko', (select ol.label from public.live_survey_option_localizations ol where ol.option_id=option.id and ol.locale='ko'),
            'en', (select ol.label from public.live_survey_option_localizations ol where ol.option_id=option.id and ol.locale='en')
          )) order by option.position) from public.live_survey_options option where option.question_id=question.id), '[]'::jsonb)
      ) order by question.position) from public.live_survey_questions question where question.survey_id=survey.id), '[]'::jsonb)
    ) order by survey.version desc) filter (where survey.id is not null), '[]'::jsonb)
  ) into result from public.live_events live left join public.live_surveys survey on survey.live_event_id=live.id
  where live.id=p_live_event_id group by live.id;
  return result;
end;
$$;

create or replace function public.assert_canonical_live_survey_schema(p_survey_id uuid)
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if (select count(*) not between 4 and 6 or min(position)<>1 or max(position)<>count(*)
      from public.live_survey_questions where survey_id=p_survey_id)
    or not exists (select 1 from public.live_survey_questions where survey_id=p_survey_id and common_key='overall_satisfaction' and question_type='rating_1_5' and is_required)
    or not exists (select 1 from public.live_survey_questions where survey_id=p_survey_id and common_key='purchase_intent' and question_type='single_choice' and is_required)
    or not exists (select 1 from public.live_survey_questions where survey_id=p_survey_id and common_key='future_interest' and question_type='single_choice' and is_required)
    or not exists (select 1 from public.live_survey_questions where survey_id=p_survey_id and common_key='free_comment' and question_type='free_text' and not is_required)
    or exists (
      select 1 from public.live_survey_questions q where q.survey_id=p_survey_id
        and q.question_type in ('single_choice','multiple_choice') and (
          select count(*)=0 or min(o.position)<>1 or max(o.position)<>count(*)
          from public.live_survey_options o where o.question_id=q.id
        )
    )
  then raise exception 'canonical common question or option order schema is invalid'; end if;
end;
$$;

create or replace function public.admin_write_live_survey(
  p_actor_app_user_id uuid, p_actor_allowlist_id uuid, p_live_event_id uuid,
  p_command text, p_payload jsonb, p_correlation_id uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare survey_record public.live_surveys%rowtype; source_record public.live_surveys%rowtype;
  target_survey_id uuid; next_version integer; item jsonb; option_item jsonb; question_id uuid; option_id uuid;
  question_count integer; common_count integer; expected_revision integer; before_summary jsonb := '{}'::jsonb; after_summary jsonb; result jsonb;
begin
  if p_correlation_id is null then raise exception 'correlation id is required'; end if;
  perform public.admin_assert_active_survey_actor(p_actor_app_user_id, p_actor_allowlist_id, true);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('g5:survey:'||p_live_event_id::text,0));
  perform 1 from public.live_events where id=p_live_event_id and archived_at is null for update;
  if not found then raise exception 'live event not found or archived'; end if;

  if p_command in ('create','clone') then
    select coalesce(max(version),0)+1 into next_version from public.live_surveys where live_event_id=p_live_event_id;
    if p_command='clone' then
      select * into source_record from public.live_surveys where id=(p_payload->>'sourceSurveyId')::uuid and live_event_id=p_live_event_id;
      if not found then raise exception 'source survey not found'; end if;
    end if;
    insert into public.live_surveys(live_event_id,version,source_survey_id) values(p_live_event_id,next_version,source_record.id) returning * into survey_record;
    target_survey_id := survey_record.id;
    if p_command='create' then
      insert into public.live_survey_questions(survey_id,question_type,common_key,is_required,position) values
        (target_survey_id,'rating_1_5','overall_satisfaction',true,1),
        (target_survey_id,'single_choice','purchase_intent',true,2),
        (target_survey_id,'single_choice','future_interest',true,3),
        (target_survey_id,'free_text','free_comment',false,4);
      insert into public.live_survey_question_localizations(question_id,locale,question_text)
      select q.id,l.locale,l.text from public.live_survey_questions q cross join lateral (values
        ('ko'::public.content_locale,case q.common_key when 'overall_satisfaction' then '이번 라이브는 전반적으로 만족스러웠나요?' when 'purchase_intent' then '소개된 상품을 구매할 의향이 있나요?' when 'future_interest' then '다음 라이브에도 참여하고 싶나요?' else '라이브에 대한 의견을 남겨주세요.' end),
        ('en'::public.content_locale,case q.common_key when 'overall_satisfaction' then 'How satisfied were you with this live?' when 'purchase_intent' then 'Would you consider purchasing the featured product?' when 'future_interest' then 'Would you join a future live?' else 'Share any feedback about the live.' end)
      ) l(locale,text) where q.survey_id=target_survey_id;
      insert into public.live_survey_options(question_id,position)
      select q.id,p from public.live_survey_questions q cross join generate_series(1,2) p
      where q.survey_id=target_survey_id and q.question_type='single_choice';
      insert into public.live_survey_option_localizations(option_id,locale,label)
      select o.id,l.locale,case when o.position=1 then l.yes_label else l.no_label end
      from public.live_survey_options o join public.live_survey_questions q on q.id=o.question_id
      cross join lateral (values ('ko'::public.content_locale,'예','아니요'),('en'::public.content_locale,'Yes','No')) l(locale,yes_label,no_label)
      where q.survey_id=target_survey_id;
    elsif p_command='clone' then
      insert into public.live_survey_questions(id,survey_id,question_type,common_key,is_required,position)
      select extensions.gen_random_uuid(),target_survey_id,question_type,common_key,is_required,position from public.live_survey_questions where survey_id=source_record.id;
      insert into public.live_survey_question_localizations(question_id,locale,question_text)
      select nq.id,ql.locale,ql.question_text from public.live_survey_questions oq join public.live_survey_questions nq
        on nq.survey_id=target_survey_id and nq.position=oq.position join public.live_survey_question_localizations ql on ql.question_id=oq.id where oq.survey_id=source_record.id;
      insert into public.live_survey_options(id,question_id,position)
      select extensions.gen_random_uuid(),nq.id,oo.position from public.live_survey_questions oq join public.live_survey_questions nq
        on nq.survey_id=target_survey_id and nq.position=oq.position join public.live_survey_options oo on oo.question_id=oq.id where oq.survey_id=source_record.id;
      insert into public.live_survey_option_localizations(option_id,locale,label)
      select no.id,ol.locale,ol.label from public.live_survey_questions oq join public.live_survey_questions nq
        on nq.survey_id=target_survey_id and nq.position=oq.position join public.live_survey_options oo on oo.question_id=oq.id
        join public.live_survey_options no on no.question_id=nq.id and no.position=oo.position join public.live_survey_option_localizations ol on ol.option_id=oo.id
        where oq.survey_id=source_record.id;
    end if;
    perform public.assert_canonical_live_survey_schema(target_survey_id);
  else
    target_survey_id := (p_payload->>'surveyId')::uuid;
    select * into survey_record from public.live_surveys where id=target_survey_id and live_event_id=p_live_event_id for update;
    if not found then raise exception 'survey not found'; end if;
    before_summary := jsonb_build_object('surveyId',target_survey_id,'version',survey_record.version,'status',survey_record.lifecycle_status);
  end if;

  if p_command in ('publish','archive') then
    begin expected_revision := (p_payload->>'expectedRevision')::integer;
    exception when others then raise exception 'expected revision is required'; end;
    if expected_revision is null then raise exception 'expected revision is required'; end if;
    if expected_revision <> survey_record.revision then raise exception 'stale survey revision'; end if;
  end if;

  if p_command in ('edit','order') then
    if survey_record.lifecycle_status <> 'draft' then raise exception 'only draft surveys are editable'; end if;
    begin expected_revision := (p_payload->>'expectedRevision')::integer;
    exception when others then raise exception 'expected revision is required'; end;
    if expected_revision is null then raise exception 'expected revision is required'; end if;
    if expected_revision <> survey_record.revision then raise exception 'stale survey revision'; end if;
    if jsonb_typeof(p_payload->'questions') <> 'array' then raise exception 'questions are required'; end if;
    delete from public.live_survey_option_localizations where option_id in (select o.id from public.live_survey_options o join public.live_survey_questions q on q.id=o.question_id where q.survey_id=target_survey_id);
    delete from public.live_survey_options where question_id in (select id from public.live_survey_questions q where q.survey_id=target_survey_id);
    delete from public.live_survey_question_localizations where question_id in (select id from public.live_survey_questions q where q.survey_id=target_survey_id);
    delete from public.live_survey_questions q where q.survey_id=target_survey_id;
    for item in select value from jsonb_array_elements(p_payload->'questions') value loop
      if item->>'type' not in ('single_choice','multiple_choice','rating_1_5','free_text') then raise exception 'invalid question type'; end if;
      insert into public.live_survey_questions(survey_id,question_type,common_key,is_required,position)
      values(target_survey_id,(item->>'type')::public.live_survey_question_type,nullif(item->>'commonKey','')::public.live_survey_common_question_key,
        coalesce((item->>'required')::boolean,false),(item->>'position')::smallint) returning id into question_id;
      insert into public.live_survey_question_localizations(question_id,locale,question_text) values
        (question_id,'ko',item->'text'->>'ko'),(question_id,'en',item->'text'->>'en');
      if item->>'type' in ('single_choice','multiple_choice') then
        for option_item in select value from jsonb_array_elements(coalesce(item->'options','[]'::jsonb)) value loop
          insert into public.live_survey_options(question_id,position) values(question_id,(option_item->>'position')::smallint) returning id into option_id;
          insert into public.live_survey_option_localizations(option_id,locale,label) values
            (option_id,'ko',option_item->'label'->>'ko'),(option_id,'en',option_item->'label'->>'en');
        end loop;
      end if;
    end loop;
    perform public.assert_canonical_live_survey_schema(target_survey_id);
    update public.live_surveys set revision=revision+1 where id=target_survey_id;
  elsif p_command='publish' then
    if survey_record.lifecycle_status <> 'draft' then raise exception 'only draft surveys can be published'; end if;
    perform public.assert_canonical_live_survey_schema(target_survey_id);
    select count(*),count(*) filter(where common_key is not null) into question_count,common_count from public.live_survey_questions q where q.survey_id=target_survey_id;
    if question_count not between 4 and 6 or common_count<>4 then raise exception 'survey requires exact four common and zero to two custom questions'; end if;
    update public.live_surveys set publication_status='published',lifecycle_status='published',published_at=now(),ever_published_at=now(),revision=revision+1 where id=target_survey_id;
  elsif p_command='close' then
    if survey_record.lifecycle_status <> 'published' then raise exception 'only published surveys can be closed'; end if;
    update public.live_surveys set publication_status='draft',lifecycle_status='closed',published_at=null,closed_at=now(),revision=revision+1 where id=target_survey_id;
  elsif p_command='archive' then
    if survey_record.lifecycle_status not in ('draft','closed') then raise exception 'only draft or closed surveys can be archived'; end if;
    update public.live_surveys set publication_status='draft',lifecycle_status='archived',published_at=null,archived_at=now(),revision=revision+1 where id=target_survey_id;
  elsif p_command not in ('create','clone') then raise exception 'unsupported survey command'; end if;

  select jsonb_build_object('surveyId',id,'version',version,'revision',revision,'status',lifecycle_status) into after_summary from public.live_surveys where id=target_survey_id;
  insert into public.audit_logs(actor_app_user_id,actor_admin_allowlist_id,action,entity_type,entity_id,before_after_summary,correlation_id)
  values(p_actor_app_user_id,p_actor_allowlist_id,'admin.survey.'||p_command,'live_survey',target_survey_id,
    jsonb_build_object('before',before_summary,'after',after_summary),p_correlation_id);
  result := public.get_admin_live_survey(p_actor_app_user_id,p_actor_allowlist_id,p_live_event_id);
  return result || jsonb_build_object('selectedSurveyId',target_survey_id);
end;
$$;

revoke all on function public.admin_assert_active_survey_actor(uuid,uuid,boolean) from public,anon,authenticated;
revoke all on function public.assert_canonical_live_survey_schema(uuid) from public,anon,authenticated;
revoke all on function public.get_admin_live_survey(uuid,uuid,uuid) from public,anon,authenticated;
revoke all on function public.admin_write_live_survey(uuid,uuid,uuid,text,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.get_admin_live_survey(uuid,uuid,uuid) to service_role;
grant execute on function public.admin_write_live_survey(uuid,uuid,uuid,text,jsonb,uuid) to service_role;
revoke insert,update,delete,truncate on public.live_surveys,public.live_survey_questions,public.live_survey_question_localizations,public.live_survey_options,public.live_survey_option_localizations from service_role;

comment on function public.get_admin_live_survey(uuid,uuid,uuid) is 'ADM-006 safe CMS graph. Never returns response or free-text answer data.';
