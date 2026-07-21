-- G4 owner-only read models. Identity is supplied by the BFF as the canonical
-- app_user_id; these RPCs deliberately expose no identity or queue internals.

create function public.get_owned_passport_collection(
  p_app_user_id uuid,
  p_locale public.content_locale
)
returns setof jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', passport.id,
    'owner', jsonb_build_object('nickname', null),
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
    )
  )
  from public.fan_passports passport
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
  where passport.app_user_id = p_app_user_id
  order by passport.issued_at desc, passport.id desc;
$$;

create function public.get_owned_passport_detail(
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
  select jsonb_build_object(
    'id', passport.id,
    'owner', jsonb_build_object('nickname', null),
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
    'activities', activities.items
  )
  from public.fan_passports passport
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
        'activityId', stamp.activity_id
      ) order by stamp.issued_at desc, stamp.id desc
    ), '[]'::jsonb) as items
    from public.stamps stamp
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
        'stampId', stamp.id
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
    where activity.app_user_id = passport.app_user_id
      and activity.celebrity_id = passport.celebrity_id
  ) activities
  where passport.id = p_passport_id
    and passport.app_user_id = p_app_user_id;
$$;

create function public.get_owned_stamp_detail(
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
    'owner', jsonb_build_object('nickname', null),
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
      'points', coalesce(ledger.points, 0)
    )
  )
  from public.stamps stamp
  join public.fan_passports passport
    on passport.id = stamp.passport_id
   and passport.app_user_id = stamp.app_user_id
   and passport.celebrity_id = stamp.celebrity_id
  join public.fan_activities activity
    on activity.id = stamp.activity_id
   and activity.app_user_id = stamp.app_user_id
   and activity.celebrity_id = stamp.celebrity_id
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

revoke all on function public.get_owned_passport_collection(uuid, public.content_locale) from public, anon, authenticated;
revoke all on function public.get_owned_passport_detail(uuid, uuid, public.content_locale) from public, anon, authenticated;
revoke all on function public.get_owned_stamp_detail(uuid, uuid, public.content_locale) from public, anon, authenticated;

grant execute on function public.get_owned_passport_collection(uuid, public.content_locale) to service_role;
grant execute on function public.get_owned_passport_detail(uuid, uuid, public.content_locale) to service_role;
grant execute on function public.get_owned_stamp_detail(uuid, uuid, public.content_locale) to service_role;

comment on function public.get_owned_passport_collection(uuid, public.content_locale) is
  'Owner-scoped G4 passport collection projection; returns no rows when the owner has no passports.';
comment on function public.get_owned_passport_detail(uuid, uuid, public.content_locale) is
  'Owner-scoped G4 passport detail projection; missing and foreign IDs both return no rows.';
comment on function public.get_owned_stamp_detail(uuid, uuid, public.content_locale) is
  'Owner-scoped G4 stamp detail projection; missing and foreign IDs both return no rows.';
