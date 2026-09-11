-- The unfiltered member directory represents every app account. A creator
-- filter remains a Passport-holder filter for that creator.
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
  where (p_celebrity_id is null or journeys.items is not null)
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

revoke all on function public.get_admin_fans(
  uuid,uuid,uuid,public.content_locale,text,uuid,public.app_user_status,timestamptz,uuid,integer
) from public, anon, authenticated;
grant execute on function public.get_admin_fans(
  uuid,uuid,uuid,public.content_locale,text,uuid,public.app_user_status,timestamptz,uuid,integer
) to service_role;
