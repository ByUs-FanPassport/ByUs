-- Project one immutable activity-completion snapshot from the append-only
-- activity, score-ledger, and Stamp records. The cumulative score is bounded by
-- the target ledger row so idempotent replays remain stable after later fan
-- activities.

create function public.build_fan_activity_completion(
  p_app_user_id uuid,
  p_activity_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with completion as (
    select
      stamp.passport_id,
      stamp.id as stamp_id,
      stamp.stamp_type,
      stamp.issued_at,
      stamp.business_status,
      stamp.mint_status,
      score.points as score_delta,
      (
        select coalesce(sum(history.points), 0)::integer
        from public.fan_score_ledger history
        where history.app_user_id = score.app_user_id
          and history.celebrity_id = score.celebrity_id
          and (
            history.created_at < score.created_at
            or (
              history.created_at = score.created_at
              and history.id <= score.id
            )
          )
      ) as updated_score
    from public.fan_activities activity
    join public.fan_score_ledger score
      on score.activity_id = activity.id
     and score.app_user_id = activity.app_user_id
     and score.celebrity_id = activity.celebrity_id
    join public.stamps stamp
      on stamp.activity_id = activity.id
     and stamp.app_user_id = activity.app_user_id
     and stamp.celebrity_id = activity.celebrity_id
    where activity.id = p_activity_id
      and activity.app_user_id = p_app_user_id
  )
  select jsonb_build_object(
    'passportId', completion.passport_id,
    'earnedStamp', jsonb_build_object(
      'id', completion.stamp_id,
      'type', completion.stamp_type,
      'issuedAt', completion.issued_at,
      'businessStatus', completion.business_status,
      'mintStatus', completion.mint_status
    ),
    'scoreDelta', completion.score_delta,
    'updatedScore', completion.updated_score,
    'updatedLevel', case
      when completion.updated_score >= 35 then 'Diamond'
      when completion.updated_score >= 20 then 'Platinum'
      when completion.updated_score >= 10 then 'Gold'
      when completion.updated_score >= 5 then 'Silver'
      else 'Bronze'
    end,
    'leveledUp', (
      case
        when completion.updated_score >= 35 then 'Diamond'
        when completion.updated_score >= 20 then 'Platinum'
        when completion.updated_score >= 10 then 'Gold'
        when completion.updated_score >= 5 then 'Silver'
        else 'Bronze'
      end
      <>
      case
        when completion.updated_score - completion.score_delta >= 35 then 'Diamond'
        when completion.updated_score - completion.score_delta >= 20 then 'Platinum'
        when completion.updated_score - completion.score_delta >= 10 then 'Gold'
        when completion.updated_score - completion.score_delta >= 5 then 'Silver'
        else 'Bronze'
      end
    )
  )
  from completion;
$$;

create or replace function public.build_owned_live_reservation_result(
  p_app_user_id uuid,
  p_reservation_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'reservationId', reservation.id,
    'liveEventId', reservation.live_event_id,
    'passportId', reservation.passport_id,
    'activityId', activity.id,
    'stampId', stamp.id,
    'reservedAt', reservation.reserved_at,
    'scorePoints', score.points,
    'stampMintStatus', stamp.mint_status,
    'completion', public.build_fan_activity_completion(
      reservation.app_user_id,
      activity.id
    )
  )
  from public.live_reservations reservation
  join public.fan_activities activity
    on activity.app_user_id = reservation.app_user_id
   and activity.celebrity_id = reservation.celebrity_id
   and activity.activity_type = 'reservation'
   and activity.source_type = 'live_reservation'
   and activity.source_id = reservation.id
  join public.fan_score_ledger score
    on score.activity_id = activity.id
   and score.app_user_id = reservation.app_user_id
   and score.celebrity_id = reservation.celebrity_id
  join public.stamps stamp
    on stamp.passport_id = reservation.passport_id
   and stamp.activity_id = activity.id
   and stamp.app_user_id = reservation.app_user_id
   and stamp.celebrity_id = reservation.celebrity_id
   and stamp.stamp_type = 'reservation'
  where reservation.id = p_reservation_id
    and reservation.app_user_id = p_app_user_id;
$$;

create or replace function public.build_owned_live_attendance_result(
  p_app_user_id uuid,
  p_attendance_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'attendanceId', attendance.id,
    'liveEventId', attendance.live_event_id,
    'passportId', attendance.passport_id,
    'activityId', activity.id,
    'stampId', stamp.id,
    'attendedAt', attendance.attended_at,
    'scorePoints', score.points,
    'stampMintStatus', stamp.mint_status,
    'completion', public.build_fan_activity_completion(
      attendance.app_user_id,
      activity.id
    )
  )
  from public.live_attendances attendance
  join public.fan_activities activity
    on activity.app_user_id = attendance.app_user_id
   and activity.celebrity_id = attendance.celebrity_id
   and activity.activity_type = 'attendance'
   and activity.source_type = 'live_attendance'
   and activity.source_id = attendance.id
  join public.fan_score_ledger score
    on score.activity_id = activity.id
   and score.app_user_id = attendance.app_user_id
   and score.celebrity_id = attendance.celebrity_id
  join public.stamps stamp
    on stamp.passport_id = attendance.passport_id
   and stamp.activity_id = activity.id
   and stamp.app_user_id = attendance.app_user_id
   and stamp.celebrity_id = attendance.celebrity_id
   and stamp.stamp_type = 'attendance'
  where attendance.id = p_attendance_id
    and attendance.app_user_id = p_app_user_id;
$$;

create or replace function public.build_owned_live_survey_submission_result(
  p_app_user_id uuid,
  p_response_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'response', jsonb_build_object(
      'status', 'submitted',
      'submittedAt', response.submitted_at,
      'activityId', activity.id,
      'scorePoints', score.points,
      'stamp', jsonb_build_object(
        'id', stamp.id,
        'businessStatus', stamp.business_status,
        'mintStatus', stamp.mint_status
      )
    ),
    'completion', public.build_fan_activity_completion(
      response.app_user_id,
      activity.id
    )
  )
  from public.live_survey_responses response
  join public.fan_activities activity
    on activity.app_user_id = response.app_user_id
   and activity.celebrity_id = response.celebrity_id
   and activity.activity_type = 'survey'
   and activity.source_type = 'live_survey_response'
   and activity.source_id = response.id
  join public.fan_score_ledger score
    on score.activity_id = activity.id
   and score.app_user_id = response.app_user_id
   and score.celebrity_id = response.celebrity_id
  join public.stamps stamp
    on stamp.activity_id = activity.id
   and stamp.passport_id = response.passport_id
   and stamp.app_user_id = response.app_user_id
   and stamp.celebrity_id = response.celebrity_id
   and stamp.stamp_type = 'survey'
  where response.id = p_response_id
    and response.app_user_id = p_app_user_id
    and response.status = 'submitted';
$$;

create or replace function public.get_owned_live_survey(
  p_app_user_id uuid,
  p_live_slug text,
  p_locale public.content_locale
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'survey', jsonb_build_object(
      'id', survey.id,
      'version', survey.version,
      'questions', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', question.id,
          'type', question.question_type,
          'question', localization.question_text,
          'required', question.is_required,
          'order', question.position,
          'options', coalesce((
            select jsonb_agg(jsonb_build_object(
              'id', option.id,
              'label', option_localization.label,
              'order', option.position
            ) order by option.position)
            from public.live_survey_options option
            join public.live_survey_option_localizations option_localization
              on option_localization.option_id = option.id
             and option_localization.locale = p_locale
            where option.question_id = question.id
          ), '[]'::jsonb)
        ) order by question.position)
        from public.live_survey_questions question
        join public.live_survey_question_localizations localization
          on localization.question_id = question.id
         and localization.locale = p_locale
        where question.survey_id = survey.id
      ), '[]'::jsonb)
    ),
    'eligibility', jsonb_build_object(
      'completedAttendance',
      attendance.id is not null
    ),
    'response', case
      when response.id is null then null
      else jsonb_build_object(
        'status', response.status,
        'revision', response.revision,
        'answers', coalesce((
          select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
            'questionId', answer.question_id,
            'selectedOptionIds', answer.selected_option_ids,
            'rating', answer.rating,
            'freeText', answer.free_text
          )) order by question.position)
          from public.live_survey_answers answer
          join public.live_survey_questions question
            on question.id = answer.question_id
          where answer.response_id = response.id
        ), '[]'::jsonb),
        'submittedAt', response.submitted_at
      )
    end,
    'completion', case
      when response.status = 'submitted'
      then public.build_owned_live_survey_submission_result(
        p_app_user_id,
        response.id
      ) -> 'completion'
      else null
    end
  )
  from public.live_events live
  join public.live_surveys survey
    on survey.live_event_id = live.id
   and survey.publication_status = 'published'
  left join public.live_attendances attendance
    on attendance.app_user_id = p_app_user_id
   and attendance.live_event_id = live.id
  left join public.live_survey_responses response
    on response.app_user_id = p_app_user_id
   and response.live_event_id = live.id
  where live.slug = p_live_slug
    and live.publication_status = 'published';
$$;

revoke all on function public.build_fan_activity_completion(uuid, uuid)
  from public, anon, authenticated, service_role;

comment on function public.build_fan_activity_completion(uuid, uuid) is
  'Internal immutable completion projection for one owner-scoped score-bearing fan activity.';
