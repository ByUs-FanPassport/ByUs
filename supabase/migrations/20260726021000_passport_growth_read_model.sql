-- Enrich the owner-only Passport read models with the fan nickname, canonical
-- source context for every append-only activity, and the closest actionable
-- benefit. The benefit is selected inside the same owner-scoped SQL statement
-- so Passport growth facts cannot be assembled from mixed database snapshots.

create or replace function public.get_owned_passport_detail(
  p_passport_id uuid,
  p_app_user_id uuid,
  p_locale public.content_locale
)
returns setof jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with activity_context as materialized (
    select
      activity.id as activity_id,
      jsonb_build_object(
        'sourceType', activity.source_type,
        'sourceId', activity.source_id,
        'live', case
          when activity.source_type = 'quiz_pass' then null
          when live.id is null or live_l10n.live_event_id is null then null
          else jsonb_build_object(
            'slug', live.slug,
            'title', live_l10n.title,
            'linkable', live.publication_status = 'published' and live.archived_at is null
          )
        end
      ) as value
    from public.fan_activities activity
    left join public.live_reservations reservation
      on activity.source_type = 'live_reservation'
     and reservation.id = activity.source_id
     and reservation.app_user_id = activity.app_user_id
    left join public.live_attendances attendance
      on activity.source_type = 'live_attendance'
     and attendance.id = activity.source_id
     and attendance.app_user_id = activity.app_user_id
    left join public.live_survey_responses response
      on activity.source_type = 'live_survey_response'
     and response.id = activity.source_id
     and response.app_user_id = activity.app_user_id
    left join public.live_events live
      on live.id = coalesce(
        reservation.live_event_id,
        attendance.live_event_id,
        response.live_event_id
      )
    left join public.live_event_localizations live_l10n
      on live_l10n.live_event_id = live.id
     and live_l10n.locale = p_locale
    where activity.app_user_id = p_app_user_id
  )
  select jsonb_build_object(
    'id', passport.id,
    'owner', jsonb_build_object('nickname', profile.nickname),
    'celebrity', jsonb_build_object(
      'slug', celebrity.slug,
      'name', localization.name,
      'image', jsonb_build_object(
        'url', celebrity.image_url,
        'alt', localization.image_alt,
        'position', celebrity.image_position
      )
    ),
    'businessStatus', passport.business_status,
    'mint', jsonb_build_object(
      'status', passport.mint_status,
      'txHash', passport.tx_hash,
      'tokenId', passport.token_id::text
    ),
    'issuedAt', passport.issued_at,
    'score', jsonb_build_object(
      'points', score.total_points,
      'level', case
        when score.total_points >= 35 then 'Diamond'
        when score.total_points >= 20 then 'Platinum'
        when score.total_points >= 10 then 'Gold'
        when score.total_points >= 5 then 'Silver'
        else 'Bronze'
      end
    ),
    'stampSummary', jsonb_build_object(
      'knowledge', stamp_counts.knowledge_count,
      'reservation', stamp_counts.reservation_count,
      'attendance', stamp_counts.attendance_count,
      'survey', stamp_counts.survey_count,
      'total', stamp_counts.total_count
    ),
    'stamps', stamps.items,
    'activities', activities.items,
    'nextBenefit', next_benefit.value
  )
  from public.fan_passports passport
  left join public.user_profiles profile
    on profile.app_user_id = passport.app_user_id
  join public.celebrities celebrity on celebrity.id = passport.celebrity_id
  join public.celebrity_localizations localization
    on localization.celebrity_id = celebrity.id
   and localization.locale = p_locale
  cross join lateral (
    select coalesce(sum(ledger.points), 0)::integer as total_points
    from public.fan_score_ledger ledger
    where ledger.app_user_id = passport.app_user_id
      and ledger.celebrity_id = passport.celebrity_id
  ) score
  cross join lateral (
    select
      count(*) filter (where stamp.stamp_type = 'knowledge')::integer as knowledge_count,
      count(*) filter (where stamp.stamp_type = 'reservation')::integer as reservation_count,
      count(*) filter (where stamp.stamp_type = 'attendance')::integer as attendance_count,
      count(*) filter (where stamp.stamp_type = 'survey')::integer as survey_count,
      count(*)::integer as total_count
    from public.stamps stamp
    where stamp.passport_id = passport.id
      and stamp.app_user_id = passport.app_user_id
      and stamp.celebrity_id = passport.celebrity_id
  ) stamp_counts
  cross join lateral (
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'id', stamp.id,
        'type', stamp.stamp_type,
        'businessStatus', stamp.business_status,
        'mint', jsonb_build_object(
          'status', stamp.mint_status,
          'txHash', stamp.tx_hash,
          'tokenId', stamp.token_id::text
        ),
        'issuedAt', stamp.issued_at,
        'activityId', stamp.activity_id,
        'context', projected_context.value
      ) order by stamp.issued_at desc, stamp.id desc
    ), '[]'::jsonb) as items
    from public.stamps stamp
    join public.fan_activities activity
      on activity.id = stamp.activity_id
     and activity.app_user_id = stamp.app_user_id
     and activity.celebrity_id = stamp.celebrity_id
    join activity_context projected_context
      on projected_context.activity_id = activity.id
    where stamp.passport_id = passport.id
      and stamp.app_user_id = passport.app_user_id
      and stamp.celebrity_id = passport.celebrity_id
  ) stamps
  cross join lateral (
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'id', activity.id,
        'type', activity.activity_type,
        'occurredAt', activity.occurred_at,
        'points', coalesce(ledger.points, 0),
        'stampId', stamp.id,
        'context', projected_context.value
      ) order by activity.occurred_at desc, activity.id desc
    ), '[]'::jsonb) as items
    from public.fan_activities activity
    left join public.fan_score_ledger ledger
      on ledger.activity_id = activity.id
     and ledger.app_user_id = activity.app_user_id
     and ledger.celebrity_id = activity.celebrity_id
    left join public.stamps stamp
      on stamp.activity_id = activity.id
     and stamp.passport_id = passport.id
     and stamp.app_user_id = activity.app_user_id
     and stamp.celebrity_id = activity.celebrity_id
    join activity_context projected_context
      on projected_context.activity_id = activity.id
    where activity.app_user_id = passport.app_user_id
      and activity.celebrity_id = passport.celebrity_id
  ) activities
  left join lateral (
    select jsonb_build_object(
      'id', candidate.id,
      'slug', candidate.slug,
      'title', candidate.title,
      'state', case when candidate.eligible then 'eligible' else 'locked' end,
      'allocationMode', candidate.allocation_mode,
      'applicationStatus', candidate.application_status,
      'eligibilityLabel', candidate.eligibility_label,
      'minimumScore', candidate.minimum_score,
      'minimumLevel', candidate.minimum_level,
      'requiredStampType', candidate.required_stamp_type,
      'requiredActivityType', candidate.required_activity_type,
      'missingConditions', candidate.missing_conditions
    ) as value
    from (
      select
        benefit.id,
        benefit.slug,
        benefit.allocation_mode,
        benefit.claim_opens_at,
        benefit.minimum_score,
        benefit.minimum_level,
        benefit.required_stamp_type,
        benefit.required_activity_type,
        benefit_l10n.title,
        benefit_l10n.eligibility_label,
        application.status as application_status,
        (
          statement_timestamp() >= benefit.claim_opens_at
          and score.total_points >= benefit.minimum_score
          and score.total_points >= case benefit.minimum_level
            when 'Diamond' then 35
            when 'Platinum' then 20
            when 'Gold' then 10
            when 'Silver' then 5
            else 0
          end
          and (
            benefit.required_stamp_type is null
            or exists (
              select 1 from public.stamps owned_stamp
              where owned_stamp.app_user_id = passport.app_user_id
                and owned_stamp.celebrity_id = passport.celebrity_id
                and owned_stamp.stamp_type = benefit.required_stamp_type
            )
          )
          and (
            benefit.required_activity_type is null
            or exists (
              select 1 from public.fan_activities owned_activity
              where owned_activity.app_user_id = passport.app_user_id
                and owned_activity.celebrity_id = passport.celebrity_id
                and owned_activity.activity_type = benefit.required_activity_type
            )
          )
        ) as eligible,
        (
          case when score.total_points < benefit.minimum_score
            then jsonb_build_array(jsonb_build_object(
              'type', 'score',
              'current', score.total_points,
              'required', benefit.minimum_score
            ))
            else '[]'::jsonb
          end
          ||
          case when score.total_points < case benefit.minimum_level
              when 'Diamond' then 35
              when 'Platinum' then 20
              when 'Gold' then 10
              when 'Silver' then 5
              else 0
            end
            then jsonb_build_array(jsonb_build_object(
              'type', 'level',
              'current', case
                when score.total_points >= 35 then 'Diamond'
                when score.total_points >= 20 then 'Platinum'
                when score.total_points >= 10 then 'Gold'
                when score.total_points >= 5 then 'Silver'
                else 'Bronze'
              end,
              'required', benefit.minimum_level
            ))
            else '[]'::jsonb
          end
          ||
          case when benefit.required_stamp_type is not null and not exists (
              select 1 from public.stamps owned_stamp
              where owned_stamp.app_user_id = passport.app_user_id
                and owned_stamp.celebrity_id = passport.celebrity_id
                and owned_stamp.stamp_type = benefit.required_stamp_type
            )
            then jsonb_build_array(jsonb_build_object(
              'type', 'stamp',
              'required', benefit.required_stamp_type
            ))
            else '[]'::jsonb
          end
          ||
          case when benefit.required_activity_type is not null and not exists (
              select 1 from public.fan_activities owned_activity
              where owned_activity.app_user_id = passport.app_user_id
                and owned_activity.celebrity_id = passport.celebrity_id
                and owned_activity.activity_type = benefit.required_activity_type
            )
            then jsonb_build_array(jsonb_build_object(
              'type', 'activity',
              'required', benefit.required_activity_type
            ))
            else '[]'::jsonb
          end
          ||
          case when statement_timestamp() < benefit.claim_opens_at
            then jsonb_build_array(jsonb_build_object(
              'type', 'opens_at',
              'at', benefit.claim_opens_at
            ))
            else '[]'::jsonb
          end
        ) as missing_conditions
      from public.benefits benefit
      join public.benefit_localizations benefit_l10n
        on benefit_l10n.benefit_id = benefit.id
       and benefit_l10n.locale = p_locale
      left join public.benefit_applications application
        on application.benefit_id = benefit.id
       and application.app_user_id = passport.app_user_id
       and application.status <> 'cancelled'
      where benefit.celebrity_id = passport.celebrity_id
        and benefit.publication_status = 'published'
        and benefit.archived_at is null
        and statement_timestamp() < benefit.claim_closes_at
        and not exists (
          select 1 from public.benefit_claims owned_claim
          where owned_claim.benefit_id = benefit.id
            and owned_claim.app_user_id = passport.app_user_id
        )
        and (
          benefit.stock_limit is null
          or (
            select count(*) from public.benefit_claims claim_count
            where claim_count.benefit_id = benefit.id
          ) < benefit.stock_limit
        )
        and (
          benefit.delivery_type <> 'unique_code'
          or exists (
            select 1 from public.benefit_unique_codes code
            where code.benefit_id = benefit.id
              and code.claimed_by_claim_id is null
          )
        )
    ) candidate
    order by
      candidate.eligible desc,
      jsonb_array_length(candidate.missing_conditions),
      candidate.minimum_score,
      candidate.claim_opens_at,
      candidate.id
    limit 1
  ) next_benefit on true
  where passport.id = p_passport_id
    and passport.app_user_id = p_app_user_id;
$$;

create or replace function public.get_owned_stamp_detail(
  p_stamp_id uuid,
  p_app_user_id uuid,
  p_locale public.content_locale
)
returns setof jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with activity_context as materialized (
    select
      activity.id as activity_id,
      jsonb_build_object(
        'sourceType', activity.source_type,
        'sourceId', activity.source_id,
        'live', case
          when activity.source_type = 'quiz_pass' then null
          when live.id is null or live_l10n.live_event_id is null then null
          else jsonb_build_object(
            'slug', live.slug,
            'title', live_l10n.title,
            'linkable', live.publication_status = 'published' and live.archived_at is null
          )
        end
      ) as value
    from public.fan_activities activity
    left join public.live_reservations reservation
      on activity.source_type = 'live_reservation'
     and reservation.id = activity.source_id
     and reservation.app_user_id = activity.app_user_id
    left join public.live_attendances attendance
      on activity.source_type = 'live_attendance'
     and attendance.id = activity.source_id
     and attendance.app_user_id = activity.app_user_id
    left join public.live_survey_responses response
      on activity.source_type = 'live_survey_response'
     and response.id = activity.source_id
     and response.app_user_id = activity.app_user_id
    left join public.live_events live
      on live.id = coalesce(
        reservation.live_event_id,
        attendance.live_event_id,
        response.live_event_id
      )
    left join public.live_event_localizations live_l10n
      on live_l10n.live_event_id = live.id
     and live_l10n.locale = p_locale
    where activity.app_user_id = p_app_user_id
  )
  select jsonb_build_object(
    'id', stamp.id,
    'type', stamp.stamp_type,
    'businessStatus', stamp.business_status,
    'mint', jsonb_build_object(
      'status', stamp.mint_status,
      'txHash', stamp.tx_hash,
      'tokenId', stamp.token_id::text
    ),
    'issuedAt', stamp.issued_at,
    'passport', jsonb_build_object('id', passport.id),
    'owner', jsonb_build_object('nickname', profile.nickname),
    'celebrity', jsonb_build_object(
      'slug', celebrity.slug,
      'name', localization.name,
      'image', jsonb_build_object(
        'url', celebrity.image_url,
        'alt', localization.image_alt,
        'position', celebrity.image_position
      )
    ),
    'activity', jsonb_build_object(
      'id', activity.id,
      'type', activity.activity_type,
      'occurredAt', activity.occurred_at,
      'points', coalesce(ledger.points, 0),
      'context', projected_context.value
    )
  )
  from public.stamps stamp
  join public.fan_passports passport
    on passport.id = stamp.passport_id
   and passport.app_user_id = stamp.app_user_id
   and passport.celebrity_id = stamp.celebrity_id
  left join public.user_profiles profile
    on profile.app_user_id = stamp.app_user_id
  join public.fan_activities activity
    on activity.id = stamp.activity_id
   and activity.app_user_id = stamp.app_user_id
   and activity.celebrity_id = stamp.celebrity_id
  join activity_context projected_context
    on projected_context.activity_id = activity.id
  left join public.fan_score_ledger ledger
    on ledger.activity_id = activity.id
   and ledger.app_user_id = activity.app_user_id
   and ledger.celebrity_id = activity.celebrity_id
  join public.celebrities celebrity on celebrity.id = stamp.celebrity_id
  join public.celebrity_localizations localization
    on localization.celebrity_id = celebrity.id
   and localization.locale = p_locale
  where stamp.id = p_stamp_id
    and stamp.app_user_id = p_app_user_id;
$$;

revoke all on function public.get_owned_passport_detail(uuid, uuid, public.content_locale)
  from public, anon, authenticated;
revoke all on function public.get_owned_stamp_detail(uuid, uuid, public.content_locale)
  from public, anon, authenticated;
grant execute on function public.get_owned_passport_detail(uuid, uuid, public.content_locale)
  to service_role;
grant execute on function public.get_owned_stamp_detail(uuid, uuid, public.content_locale)
  to service_role;

comment on function public.get_owned_passport_detail(uuid, uuid, public.content_locale) is
  'Single-snapshot owner Passport growth projection with nickname, canonical activity context, and closest benefit.';
comment on function public.get_owned_stamp_detail(uuid, uuid, public.content_locale) is
  'Owner-scoped Stamp projection with nickname and canonical source context.';
