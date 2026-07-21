-- G5 / ADM-008 and ADM-009: real aggregate Attendance and Survey analytics.
-- Rates use event-participation rows as both numerator and denominator units.
-- Survey answer aggregates are suppressed below five submitted responses.

create index if not exists live_attendances_analytics_scope_idx
  on public.live_attendances (celebrity_id, live_event_id, attended_at, app_user_id);
create index if not exists live_survey_responses_analytics_scope_idx
  on public.live_survey_responses (celebrity_id, live_event_id, status, submitted_at, app_user_id);

alter table public.live_survey_options
  add column semantic_value text check (semantic_value is null or semantic_value in ('yes','no'));

do $$
begin
  if exists (
    select 1 from public.live_survey_options option
    join public.live_survey_questions question on question.id=option.question_id and question.common_key in ('purchase_intent','future_interest')
    left join public.live_survey_option_localizations ko on ko.option_id=option.id and ko.locale='ko'
    left join public.live_survey_option_localizations en on en.option_id=option.id and en.locale='en'
    where not coalesce((ko.label='예' and en.label='Yes') or (ko.label='아니요' and en.label='No'),false)
  ) then raise exception 'existing common survey options do not have canonical Yes/No semantics'; end if;
  update public.live_survey_options option
  set semantic_value=case (select label from public.live_survey_option_localizations where option_id=option.id and locale='ko') when '예' then 'yes' else 'no' end
  where exists(select 1 from public.live_survey_questions question where question.id=option.question_id and question.common_key in ('purchase_intent','future_interest'));
end;
$$;

create function public.protect_common_survey_option_semantic()
returns trigger language plpgsql set search_path='' as $$
begin
  if old.semantic_value is not null and new.semantic_value is distinct from old.semantic_value then
    raise exception 'common survey option semantic value is immutable';
  end if;
  return new;
end;
$$;
create trigger live_survey_options_protect_semantic before update on public.live_survey_options
for each row execute function public.protect_common_survey_option_semantic();

create function public.sync_common_survey_option_semantic()
returns trigger language plpgsql set search_path='' as $$
declare common_key public.live_survey_common_question_key; expected text;
begin
  select question.common_key into common_key from public.live_survey_options option
  join public.live_survey_questions question on question.id=option.question_id where option.id=new.option_id;
  if common_key is null or common_key not in ('purchase_intent','future_interest') then return new; end if;
  expected := case when new.locale='ko' and new.label='예' then 'yes' when new.locale='ko' and new.label='아니요' then 'no'
    when new.locale='en' and new.label='Yes' then 'yes' when new.locale='en' and new.label='No' then 'no' else null end;
  if expected is null then raise exception 'common survey options require canonical Yes/No labels'; end if;
  update public.live_survey_options set semantic_value=expected
  where id=new.option_id and (semantic_value is null or semantic_value=expected);
  if not found then raise exception 'common survey option label conflicts with its immutable semantic value'; end if;
  return new;
end;
$$;
create trigger live_survey_option_localizations_sync_semantic
after insert or update on public.live_survey_option_localizations
for each row execute function public.sync_common_survey_option_semantic();

create or replace function public.assert_canonical_live_survey_schema(p_survey_id uuid)
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if (select count(*) not between 4 and 6 or min(position)<>1 or max(position)<>count(*)
      from public.live_survey_questions where survey_id=p_survey_id)
    or not exists (select 1 from public.live_survey_questions where survey_id=p_survey_id and common_key='overall_satisfaction' and question_type='rating_1_5' and is_required)
    or not exists (select 1 from public.live_survey_questions where survey_id=p_survey_id and common_key='purchase_intent' and question_type='single_choice' and is_required)
    or not exists (select 1 from public.live_survey_questions where survey_id=p_survey_id and common_key='future_interest' and question_type='single_choice' and is_required)
    or not exists (select 1 from public.live_survey_questions where survey_id=p_survey_id and common_key='free_comment' and question_type='free_text' and not is_required)
    or exists (select 1 from public.live_survey_questions q where q.survey_id=p_survey_id and q.question_type in ('single_choice','multiple_choice') and
      (select count(*)=0 or min(o.position)<>1 or max(o.position)<>count(*) from public.live_survey_options o where o.question_id=q.id))
    or exists (
      select 1 from public.live_survey_questions question
      where question.survey_id=p_survey_id and question.common_key in ('purchase_intent','future_interest')
        and ((select count(*) from public.live_survey_options option where option.question_id=question.id)<>2
          or (select count(*) from public.live_survey_options option
              join public.live_survey_option_localizations ko on ko.option_id=option.id and ko.locale='ko' and ko.label='예'
              join public.live_survey_option_localizations en on en.option_id=option.id and en.locale='en' and en.label='Yes'
              where option.question_id=question.id and option.semantic_value='yes')<>1
          or (select count(*) from public.live_survey_options option
              join public.live_survey_option_localizations ko on ko.option_id=option.id and ko.locale='ko' and ko.label='아니요'
              join public.live_survey_option_localizations en on en.option_id=option.id and en.locale='en' and en.label='No'
              where option.question_id=question.id and option.semantic_value='no')<>1)
    )
  then raise exception 'canonical common question, option order, or Yes/No semantics are invalid'; end if;
end;
$$;

do $$ declare survey_id uuid; begin
  for survey_id in select id from public.live_surveys loop
    perform public.assert_canonical_live_survey_schema(survey_id);
  end loop;
end $$;

create function public.build_admin_engagement_metrics(
  p_celebrity_id uuid,
  p_brand_id uuid,
  p_live_event_id uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_as_of timestamptz
)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  with scoped_lives as (
    select live.id
    from public.live_events live
    where (p_celebrity_id is null or live.celebrity_id = p_celebrity_id)
      and (p_brand_id is null or live.brand_id = p_brand_id)
      and (p_live_event_id is null or live.id = p_live_event_id)
      and live.starts_at >= p_from and live.starts_at < p_to
  ), counts as (
    select
      (select count(*)::integer from public.live_reservations reservation
       where reservation.live_event_id in (select id from scoped_lives)
         and reservation.reserved_at <= p_as_of) as reservations,
      (select count(*)::integer from public.live_attendances attendance
       where attendance.live_event_id in (select id from scoped_lives)
         and attendance.attended_at <= p_as_of) as attendances,
      (select count(*)::integer from public.live_survey_responses response
       where response.live_event_id in (select id from scoped_lives)
         and response.status = 'submitted'
         and response.submitted_at <= p_as_of) as surveys
  ), survey_answers as (
    select
      count(*) filter (where question.common_key = 'overall_satisfaction' and answer.rating is not null)::integer as rating_count,
      round(avg(answer.rating) filter (where question.common_key = 'overall_satisfaction'), 2) as average_rating,
      count(distinct response.id) filter (where question.common_key = 'purchase_intent')::integer as purchase_answered,
      count(distinct response.id) filter (where question.common_key = 'purchase_intent' and option.semantic_value='yes')::integer as purchase_yes,
      count(distinct response.id) filter (where question.common_key = 'future_interest')::integer as future_answered,
      count(distinct response.id) filter (where question.common_key = 'future_interest' and option.semantic_value='yes')::integer as future_yes
    from public.live_survey_responses response
    join public.live_survey_answers answer on answer.response_id = response.id
    join public.live_survey_questions question on question.id = answer.question_id
    left join public.live_survey_options option
      on question.question_type = 'single_choice' and option.id = any(answer.selected_option_ids)
    where response.live_event_id in (select id from scoped_lives)
      and response.status = 'submitted'
      and response.submitted_at <= p_as_of
  )
  select jsonb_build_object(
    'reservationCount', jsonb_build_object('state','available','value',counts.reservations,'reason',null,'source','live_reservations'),
    'attendanceCount', jsonb_build_object('state','available','value',counts.attendances,'reason',null,'source','live_attendances'),
    'attendanceRate', case when counts.reservations = 0 then
      jsonb_build_object('state','not_applicable','value',null,'reason','NO_RESERVATIONS_IN_WINDOW','source','live_attendances/live_reservations')
      else jsonb_build_object('state','available','value',jsonb_build_object('numerator',counts.attendances,'denominator',counts.reservations,'rate',round(counts.attendances::numeric/counts.reservations,4)),'reason',null,'source','live_attendances/live_reservations') end,
    'surveyResponseCount', case when counts.surveys between 1 and 4 then
      jsonb_build_object('state','suppressed','value',null,'reason','SMALL_COHORT_LT_5','source','live_survey_responses(submitted)')
      else jsonb_build_object('state','available','value',counts.surveys,'reason',null,'source','live_survey_responses(submitted)') end,
    'surveyCompletionRate', case when counts.surveys between 1 and 4 then
      jsonb_build_object('state','suppressed','value',null,'reason','SMALL_COHORT_LT_5','source','live_survey_responses/live_attendances')
      when counts.attendances = 0 then
      jsonb_build_object('state','not_applicable','value',null,'reason','NO_ATTENDANCES_IN_WINDOW','source','live_survey_responses/live_attendances')
      else jsonb_build_object('state','available','value',jsonb_build_object('numerator',counts.surveys,'denominator',counts.attendances,'rate',round(counts.surveys::numeric/counts.attendances,4)),'reason',null,'source','live_survey_responses/live_attendances') end,
    'surveyAggregates', case
      when counts.surveys = 0 then jsonb_build_object('state','not_applicable','value',null,'reason','NO_SUBMITTED_SURVEYS','source','live_survey_answers(common questions only)')
      when counts.surveys < 5 then jsonb_build_object('state','suppressed','value',null,'reason','SMALL_COHORT_LT_5','source','live_survey_answers(common questions only)')
      else jsonb_build_object('state','available','value',jsonb_build_object(
        'responseCount',counts.surveys,
        'averageRating',survey_answers.average_rating,
        'ratingCount',survey_answers.rating_count,
        'purchaseIntentYes',survey_answers.purchase_yes,
        'purchaseIntentAnswered',survey_answers.purchase_answered,
        'purchaseIntentRate',case when survey_answers.purchase_answered=0 then null else round(survey_answers.purchase_yes::numeric/survey_answers.purchase_answered,4) end,
        'futureInterestYes',survey_answers.future_yes,
        'futureInterestAnswered',survey_answers.future_answered,
        'futureInterestRate',case when survey_answers.future_answered=0 then null else round(survey_answers.future_yes::numeric/survey_answers.future_answered,4) end
      ),'reason',null,'source','live_survey_answers(common questions only)') end
  )
  from counts cross join survey_answers;
$$;

create function public.read_admin_creator_analytics(
  p_actor_app_user_id uuid,
  p_actor_admin_allowlist_id uuid,
  p_celebrity_id uuid,
  p_live_event_id uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_as_of timestamptz
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare engagement jsonb; base jsonb;
begin
  perform 1 from public.admin_allowlist allowlist join public.app_users actor
    on actor.id=p_actor_app_user_id and actor.status='active' and actor.verified_email=allowlist.email
    where allowlist.id=p_actor_admin_allowlist_id and allowlist.active and allowlist.role in ('admin','operator','viewer') for share;
  if not found then raise exception 'active analytics administrator is required'; end if;
  if p_from is null or p_to is null or p_as_of is null or p_from>=p_to or p_to>p_as_of then raise exception 'invalid analytics window'; end if;
  if not exists(select 1 from public.celebrities where id=p_celebrity_id) then raise exception 'analytics celebrity scope does not exist'; end if;
  if p_live_event_id is not null and not exists(select 1 from public.live_events where id=p_live_event_id and celebrity_id=p_celebrity_id) then raise exception 'analytics live scope does not belong to celebrity'; end if;
  base := public.read_admin_creator_analytics(p_actor_admin_allowlist_id,p_celebrity_id,p_live_event_id,p_from,p_to,p_as_of);
  engagement := public.build_admin_engagement_metrics(p_celebrity_id,null,p_live_event_id,p_from,p_to,p_as_of);
  return jsonb_set(base,'{metrics}',(base->'metrics') - 'attendanceUsers' - 'surveyResponses' || engagement);
end;
$$;

create function public.read_admin_brand_analytics(
  p_actor_app_user_id uuid,
  p_actor_admin_allowlist_id uuid,
  p_brand_id uuid,
  p_live_event_id uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_as_of timestamptz
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare engagement jsonb; base jsonb;
begin
  perform 1 from public.admin_allowlist allowlist join public.app_users actor
    on actor.id=p_actor_app_user_id and actor.status='active' and actor.verified_email=allowlist.email
    where allowlist.id=p_actor_admin_allowlist_id and allowlist.active and allowlist.role in ('admin','operator','viewer') for share;
  if not found then raise exception 'active analytics administrator is required'; end if;
  if p_from is null or p_to is null or p_as_of is null or p_from>=p_to or p_to>p_as_of then raise exception 'invalid analytics window'; end if;
  if not exists(select 1 from public.brands where id=p_brand_id) then raise exception 'analytics brand scope does not exist'; end if;
  if p_live_event_id is not null and not exists(select 1 from public.live_events where id=p_live_event_id and brand_id=p_brand_id) then raise exception 'analytics live scope does not belong to brand'; end if;
  base := public.read_admin_brand_analytics(p_actor_admin_allowlist_id,p_brand_id,p_live_event_id,p_from,p_to,p_as_of);
  engagement := public.build_admin_engagement_metrics(null,p_brand_id,p_live_event_id,p_from,p_to,p_as_of);
  return jsonb_set(base,'{funnel}',(base->'funnel') - 'attendanceUsers' - 'surveyResponses' || engagement);
end;
$$;

revoke execute on function public.read_admin_creator_analytics(uuid,uuid,uuid,timestamptz,timestamptz,timestamptz) from service_role;
revoke execute on function public.read_admin_brand_analytics(uuid,uuid,uuid,timestamptz,timestamptz,timestamptz) from service_role;
revoke all on function public.build_admin_engagement_metrics(uuid,uuid,uuid,timestamptz,timestamptz,timestamptz) from public,anon,authenticated,service_role;
revoke all on function public.read_admin_creator_analytics(uuid,uuid,uuid,uuid,timestamptz,timestamptz,timestamptz) from public,anon,authenticated;
revoke all on function public.read_admin_brand_analytics(uuid,uuid,uuid,uuid,timestamptz,timestamptz,timestamptz) from public,anon,authenticated;
grant execute on function public.read_admin_creator_analytics(uuid,uuid,uuid,uuid,timestamptz,timestamptz,timestamptz) to service_role;
grant execute on function public.read_admin_brand_analytics(uuid,uuid,uuid,uuid,timestamptz,timestamptz,timestamptz) to service_role;
