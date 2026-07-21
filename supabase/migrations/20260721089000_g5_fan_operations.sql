-- G5 / ADM-010: privacy-minimal Fan Operations and immutable score correction.

create table public.fan_score_adjustments (
  id uuid primary key default extensions.gen_random_uuid(),
  app_user_id uuid not null references public.app_users(id) on delete restrict,
  celebrity_id uuid not null references public.celebrities(id) on delete restrict,
  points smallint not null check (points between -100 and 100 and points <> 0),
  reason text not null check (reason = btrim(reason) and length(reason) between 10 and 500),
  idempotency_key uuid not null unique,
  actor_app_user_id uuid not null references public.app_users(id) on delete restrict,
  actor_admin_allowlist_id uuid not null references public.admin_allowlist(id) on delete restrict,
  correlation_id uuid not null,
  resulting_score integer not null check (resulting_score between 0 and 1000000),
  created_at timestamptz not null default now(),
  unique (id, app_user_id, celebrity_id)
);

alter table public.fan_score_ledger alter column activity_id drop not null;
alter table public.fan_score_ledger
  add column adjustment_id uuid unique references public.fan_score_adjustments(id) on delete restrict,
  add constraint fan_score_ledger_exactly_one_source
    check (num_nonnulls(activity_id, adjustment_id) = 1);

do $$
begin
  if exists (
    select 1
    from public.fan_score_ledger ledger
    group by ledger.app_user_id, ledger.celebrity_id
    having sum(ledger.points::bigint) < 0 or sum(ledger.points::bigint) > 1000000
  ) then
    raise exception 'existing fan score total must remain between 0 and 1000000';
  end if;
end;
$$;

create index fan_score_adjustments_owner_created_idx
  on public.fan_score_adjustments(app_user_id, celebrity_id, created_at desc, id desc);

create function public.reject_fan_score_adjustment_mutation()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'score adjustment is append-only';
end;
$$;

create trigger fan_score_adjustments_append_only
before update or delete on public.fan_score_adjustments
for each row execute function public.reject_fan_score_adjustment_mutation();
create trigger fan_score_adjustments_reject_truncate
before truncate on public.fan_score_adjustments
for each statement execute function public.reject_fan_score_adjustment_mutation();

create or replace function public.validate_fan_score_weight()
returns trigger language plpgsql set search_path = '' as $$
declare
  source_activity_type public.fan_activity_type;
  expected_points smallint;
  adjustment_record public.fan_score_adjustments%rowtype;
  current_score bigint;
  next_score bigint;
begin
  if num_nonnulls(new.activity_id, new.adjustment_id) <> 1 then
    raise exception 'fan score entry requires exactly one source';
  end if;
  if new.activity_id is not null then
    select activity_type into strict source_activity_type
    from public.fan_activities
    where id = new.activity_id
      and app_user_id = new.app_user_id
      and celebrity_id = new.celebrity_id;
    expected_points := case source_activity_type
      when 'knowledge' then 1 when 'reservation' then 1
      when 'attendance' then 3 when 'survey' then 2
    end;
  else
    select * into strict adjustment_record
    from public.fan_score_adjustments
    where id = new.adjustment_id
      and app_user_id = new.app_user_id
      and celebrity_id = new.celebrity_id;
    expected_points := adjustment_record.points;
  end if;
  if new.points <> expected_points then
    raise exception 'fan score points do not match source';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('g5:fan-score:' || new.app_user_id::text || ':' || new.celebrity_id::text, 0)
  );
  select coalesce(sum(ledger.points::bigint), 0) into current_score
  from public.fan_score_ledger ledger
  where ledger.app_user_id = new.app_user_id and ledger.celebrity_id = new.celebrity_id;
  next_score := current_score + new.points::bigint;
  if next_score < 0 or next_score > 1000000 then
    raise exception 'fan score total must remain between 0 and 1000000';
  end if;
  return new;
end;
$$;

create function public.mask_admin_wallet_address(p_address text)
returns text language sql immutable strict set search_path = '' as $$
  select case
    when length(p_address) <= 12 then '[MASKED]'
    else left(p_address, 6) || '…' || right(p_address, 4)
  end;
$$;

create function public.get_admin_fans(
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
      'score', jsonb_build_object('points', scores.points, 'level', case when scores.points >= 35 then 'Diamond' when scores.points >= 20 then 'Platinum' when scores.points >= 10 then 'Gold' when scores.points >= 5 then 'Silver' else 'Bronze' end),
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
        'attendance', count(*) filter(where activity_type='attendance'), 'survey', count(*) filter(where activity_type='survey')
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

create function public.get_admin_fan_detail(
  p_actor_app_user_id uuid,
  p_actor_admin_allowlist_id uuid,
  p_correlation_id uuid,
  p_fan_id uuid,
  p_locale public.content_locale
)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  verified_role public.admin_role;
  target_user public.app_users%rowtype;
  result jsonb;
begin
  select allowlist.role into verified_role
  from public.admin_allowlist allowlist
  join public.app_users actor on actor.id=p_actor_app_user_id and actor.status='active' and actor.verified_email=allowlist.email
  where allowlist.id=p_actor_admin_allowlist_id and allowlist.active for share;
  if verified_role is null then raise exception 'active administrator is required'; end if;
  if p_correlation_id is null or p_fan_id is null then raise exception 'invalid fan detail request'; end if;
  select * into target_user from public.app_users where id=p_fan_id;
  if not found then raise exception 'fan not found'; end if;

  select jsonb_build_object(
    'fanId', target_user.id,
    'nickname', (select nickname from public.user_profiles where app_user_id=target_user.id),
    'accountStatus', target_user.status,
    'createdAt', target_user.created_at,
    'wallets', coalesce((select jsonb_agg(jsonb_build_object('chainId',wallet.chain_id,'maskedAddress',public.mask_admin_wallet_address(wallet.address)) order by wallet.chain_id) from public.user_wallets wallet where wallet.app_user_id=target_user.id),'[]'::jsonb),
    'passports', coalesce((select jsonb_agg(jsonb_build_object(
      'id',passport.id,
      'celebrity',jsonb_build_object('id',celebrity.id,'slug',celebrity.slug,'name',localization.name,'archived',celebrity.archived_at is not null),
      'businessStatus',passport.business_status,'mintStatus',passport.mint_status,'issuedAt',passport.issued_at,
      'score',jsonb_build_object('points',(select coalesce(sum(ledger.points),0)::integer from public.fan_score_ledger ledger where ledger.app_user_id=target_user.id and ledger.celebrity_id=celebrity.id)),
      'activities',coalesce((select jsonb_agg(jsonb_build_object('id',activity.id,'type',activity.activity_type,'occurredAt',activity.occurred_at,'points',ledger.points) order by activity.occurred_at desc,activity.id desc) from public.fan_activities activity left join public.fan_score_ledger ledger on ledger.activity_id=activity.id where activity.app_user_id=target_user.id and activity.celebrity_id=celebrity.id),'[]'::jsonb),
      'scoreLedger',coalesce((select jsonb_agg(jsonb_build_object('id',ledger.id,'source',case when ledger.adjustment_id is null then 'activity' else 'adjustment' end,'points',ledger.points,'reason',adjustment.reason,'correlationId',adjustment.correlation_id,'createdAt',ledger.created_at) order by ledger.created_at desc,ledger.id desc) from public.fan_score_ledger ledger left join public.fan_score_adjustments adjustment on adjustment.id=ledger.adjustment_id where ledger.app_user_id=target_user.id and ledger.celebrity_id=celebrity.id),'[]'::jsonb),
      'stamps',coalesce((select jsonb_agg(jsonb_build_object('id',stamp.id,'type',stamp.stamp_type,'businessStatus',stamp.business_status,'mintStatus',stamp.mint_status,'issuedAt',stamp.issued_at) order by stamp.issued_at desc,stamp.id desc) from public.stamps stamp where stamp.passport_id=passport.id),'[]'::jsonb),
      'benefitClaims',coalesce((select jsonb_agg(jsonb_build_object('id',claim.id,'benefitId',benefit.id,'title',benefit_l10n.title,'deliveryType',claim.delivery_type,'claimedAt',claim.claimed_at) order by claim.claimed_at desc,claim.id desc) from public.benefit_claims claim join public.benefits benefit on benefit.id=claim.benefit_id join public.benefit_localizations benefit_l10n on benefit_l10n.benefit_id=benefit.id and benefit_l10n.locale=p_locale where claim.passport_id=passport.id),'[]'::jsonb),
      'benefitApplications',coalesce((select jsonb_agg(jsonb_build_object('id',application.id,'benefitId',benefit.id,'title',benefit_l10n.title,'status',application.status,'submittedAt',application.submitted_at,'decidedAt',application.decided_at) order by application.submitted_at desc,application.id desc) from public.benefit_applications application join public.benefits benefit on benefit.id=application.benefit_id join public.benefit_localizations benefit_l10n on benefit_l10n.benefit_id=benefit.id and benefit_l10n.locale=p_locale where application.passport_id=passport.id),'[]'::jsonb),
      'correctionAllowed',target_user.status='active' and celebrity.archived_at is null and verified_role in ('admin','operator')
    ) order by passport.issued_at desc,passport.id desc)
    from public.fan_passports passport join public.celebrities celebrity on celebrity.id=passport.celebrity_id join public.celebrity_localizations localization on localization.celebrity_id=celebrity.id and localization.locale=p_locale where passport.app_user_id=target_user.id),'[]'::jsonb)
  ) into result;

  insert into public.audit_logs(actor_app_user_id,actor_admin_allowlist_id,action,entity_type,entity_id,correlation_id,before_after_summary)
  values(p_actor_app_user_id,p_actor_admin_allowlist_id,'admin.fan_detail.read','app_user',p_fan_id,p_correlation_id,jsonb_build_object('result','authorized'));
  return result;
end;
$$;

create function public.admin_adjust_fan_score(
  p_actor_app_user_id uuid,
  p_actor_admin_allowlist_id uuid,
  p_correlation_id uuid,
  p_fan_id uuid,
  p_celebrity_id uuid,
  p_points smallint,
  p_reason text,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  verified_role public.admin_role;
  target_user public.app_users%rowtype;
  existing public.fan_score_adjustments%rowtype;
  normalized_reason text;
  adjustment_id uuid := extensions.gen_random_uuid();
  resulting_score bigint;
  adjustment_created_at timestamptz;
begin
  if p_correlation_id is null or p_idempotency_key is null or p_fan_id is null or p_celebrity_id is null
     or p_points is null or p_points=0 or p_points not between -100 and 100 or p_reason is null then
    raise exception 'G5_FAN_ADJUSTMENT_INVALID';
  end if;
  normalized_reason := btrim(p_reason);
  if length(normalized_reason) not between 10 and 500 then raise exception 'G5_FAN_ADJUSTMENT_INVALID'; end if;
  if normalized_reason ~* '[[:alnum:]._%+-]+@[[:alnum:].-]+\.[[:alpha:]]{2,}'
     or normalized_reason ~* '0x[[:xdigit:]]{40}' then
    raise exception 'G5_FAN_ADJUSTMENT_INVALID_PII';
  end if;

  select allowlist.role into verified_role
  from public.admin_allowlist allowlist
  join public.app_users actor on actor.id=p_actor_app_user_id
    and actor.status='active' and actor.verified_email=allowlist.email
  where allowlist.id=p_actor_admin_allowlist_id and allowlist.active for share;
  if verified_role is null or verified_role not in ('admin', 'operator') then
    raise exception 'G5_FAN_ADJUSTMENT_FORBIDDEN';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('g5:fan-adjustment:key:'||p_idempotency_key::text,0));
  select * into existing from public.fan_score_adjustments adjustment where adjustment.idempotency_key = p_idempotency_key;
  if found then
    if existing.app_user_id<>p_fan_id or existing.celebrity_id<>p_celebrity_id or existing.points<>p_points or existing.reason<>normalized_reason
       or existing.actor_app_user_id<>p_actor_app_user_id or existing.actor_admin_allowlist_id<>p_actor_admin_allowlist_id then
      raise exception 'G5_FAN_ADJUSTMENT_IDEMPOTENCY_CONFLICT';
    end if;
    insert into public.audit_logs(actor_app_user_id,actor_admin_allowlist_id,action,entity_type,entity_id,correlation_id,before_after_summary)
    values(p_actor_app_user_id,p_actor_admin_allowlist_id,'fan.score_adjustment_replayed','fan_score_adjustment',existing.id,p_correlation_id,jsonb_build_object('fanId',p_fan_id,'celebrityId',p_celebrity_id,'points',p_points,'resultingScore',existing.resulting_score,'result','replayed'));
    return jsonb_build_object('adjustmentId',existing.id,'points',existing.points,'resultingScore',existing.resulting_score,'createdAt',existing.created_at);
  end if;

  select * into target_user from public.app_users where id=p_fan_id for update;
  if not found or target_user.status <> 'active' then raise exception 'G5_FAN_ADJUSTMENT_TARGET_UNAVAILABLE'; end if;
  perform 1 from public.celebrities celebrity where celebrity.id=p_celebrity_id and celebrity.archived_at is null for share;
  if not found then raise exception 'G5_FAN_ADJUSTMENT_TARGET_UNAVAILABLE'; end if;
  perform 1 from public.fan_passports where app_user_id=p_fan_id and celebrity_id=p_celebrity_id for share;
  if not found then raise exception 'G5_FAN_ADJUSTMENT_TARGET_UNAVAILABLE'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('g5:fan-score:'||p_fan_id::text||':'||p_celebrity_id::text,0));
  select coalesce(sum(points::bigint),0)+p_points into resulting_score from public.fan_score_ledger where app_user_id=p_fan_id and celebrity_id=p_celebrity_id;
  if resulting_score < 0 then raise exception 'G5_FAN_ADJUSTMENT_NEGATIVE_SCORE'; end if;
  if resulting_score > 1000000 then raise exception 'G5_FAN_ADJUSTMENT_SCORE_LIMIT'; end if;

  insert into public.fan_score_adjustments(id,app_user_id,celebrity_id,points,reason,idempotency_key,actor_app_user_id,actor_admin_allowlist_id,correlation_id,resulting_score)
  values(adjustment_id,p_fan_id,p_celebrity_id,p_points,normalized_reason,p_idempotency_key,p_actor_app_user_id,p_actor_admin_allowlist_id,p_correlation_id,resulting_score)
  returning created_at into adjustment_created_at;
  insert into public.fan_score_ledger(activity_id,adjustment_id,app_user_id,celebrity_id,points)
  values(null,adjustment_id,p_fan_id,p_celebrity_id,p_points);
  insert into public.audit_logs(actor_app_user_id,actor_admin_allowlist_id,action,entity_type,entity_id,correlation_id,before_after_summary)
  values(p_actor_app_user_id,p_actor_admin_allowlist_id,'fan.score_adjusted','fan_score_adjustment',adjustment_id,p_correlation_id,jsonb_build_object('fanId',p_fan_id,'celebrityId',p_celebrity_id,'points',p_points,'resultingScore',resulting_score,'reasonLength',length(normalized_reason),'result','completed'));
  return jsonb_build_object('adjustmentId',adjustment_id,'points',p_points,'resultingScore',resulting_score,'createdAt',adjustment_created_at);
end;
$$;

alter table public.fan_score_adjustments enable row level security;
alter table public.fan_score_adjustments force row level security;
revoke all on public.fan_score_adjustments from public, anon, authenticated, service_role;
revoke all on function public.reject_fan_score_adjustment_mutation() from public,anon,authenticated,service_role;
revoke all on function public.mask_admin_wallet_address(text) from public,anon,authenticated;
revoke all on function public.get_admin_fans(uuid,uuid,uuid,public.content_locale,text,uuid,public.app_user_status,timestamptz,uuid,integer) from public,anon,authenticated;
revoke all on function public.get_admin_fan_detail(uuid,uuid,uuid,uuid,public.content_locale) from public,anon,authenticated;
revoke all on function public.admin_adjust_fan_score(uuid,uuid,uuid,uuid,uuid,smallint,text,uuid) from public,anon,authenticated;
grant execute on function public.mask_admin_wallet_address(text) to service_role;
grant execute on function public.get_admin_fans(uuid,uuid,uuid,public.content_locale,text,uuid,public.app_user_status,timestamptz,uuid,integer) to service_role;
grant execute on function public.get_admin_fan_detail(uuid,uuid,uuid,uuid,public.content_locale) to service_role;
grant execute on function public.admin_adjust_fan_score(uuid,uuid,uuid,uuid,uuid,smallint,text,uuid) to service_role;

comment on table public.fan_score_adjustments is 'Immutable explicit Admin/Operator score correction evidence; canonical score remains the append-only ledger sum.';
