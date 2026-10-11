begin;

alter table public.fan_product_events
  drop constraint fan_product_events_event_name_check,
  add constraint fan_product_events_event_name_check check (event_name in (
    'creator_page_view','live_page_view','live_cta_click','benefit_page_view',
    'reaction_completed','passport_issued','reservation_completed',
    'attendance_completed','mission_completed','ticket_credited','ticket_debited',
    'journey_completed','collectible_claimed','benefit_entered','benefit_won',
    'fulfillment_completed','signup_guide_view','signup_guide_cta','login_started',
    'login_result','account_created','profile_completed','outbound_link_click'
  ));

alter table public.fan_product_events
  add constraint fan_product_events_outbound_link_contract check (
    event_name <> 'outbound_link_click' or (
      app_user_id is null
      and anonymous_session_hash is not null
      and celebrity_id is null
      and live_event_id is null
      and mission_id is null
      and benefit_id is null
      and source = 'web.outbound'
      and jsonb_typeof(properties) = 'object'
      and properties ?& array['destinationHost','campaign','placement','linkKind']
      and (properties - array['destinationHost','campaign','placement','linkKind']::text[]) = '{}'::jsonb
      and jsonb_typeof(properties->'destinationHost') = 'string'
      and char_length(properties->>'destinationHost') between 1 and 253
      and properties->>'destinationHost' ~ '^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z0-9]([a-z0-9-]*[a-z0-9])?$'
      and jsonb_typeof(properties->'campaign') = 'string'
      and char_length(properties->>'campaign') between 1 and 80
      and properties->>'campaign' ~ '^[a-z0-9]+([-_][a-z0-9]+)*$'
      and jsonb_typeof(properties->'placement') = 'string'
      and properties->>'placement' in ('fanpage_hero','header','footer','content')
      and jsonb_typeof(properties->'linkKind') = 'string'
      and properties->>'linkKind' in ('ticket','website','social','external')
    )
  );

do $$
declare
  v_signature regprocedure;
  v_definition text;
  v_old text;
  v_new text;
begin
  v_signature := 'public.record_product_event_v1(smallint,text,uuid,text,uuid,uuid,uuid,uuid,text,text,timestamptz,jsonb)'::regprocedure;
  v_definition := pg_catalog.pg_get_functiondef(v_signature);

  v_old := $patch$       'login_result','account_created','profile_completed'
     )$patch$;
  v_new := $patch$       'login_result','account_created','profile_completed','outbound_link_click'
     )$patch$;
  if (pg_catalog.length(v_definition) - pg_catalog.length(pg_catalog.replace(v_definition,v_old,'')))
      / pg_catalog.length(v_old) <> 1 then
    raise exception 'PRODUCT_EVENT_OUTBOUND_ALLOWLIST_SHAPE_CHANGED';
  end if;
  v_definition := pg_catalog.replace(v_definition,v_old,v_new);

  v_old := $patch$  if p_properties ? 'entryAction' and ($patch$;
  v_new := $patch$  if p_event_name = 'outbound_link_click' and (
    p_app_user_id is not null
    or p_anonymous_session_hash is null
    or p_celebrity_id is not null
    or p_live_event_id is not null
    or p_mission_id is not null
    or p_benefit_id is not null
    or p_source <> 'web.outbound'
    or not (p_properties ?& array['destinationHost','campaign','placement','linkKind'])
    or (p_properties - array['destinationHost','campaign','placement','linkKind']::text[]) <> '{}'::jsonb
    or jsonb_typeof(p_properties->'destinationHost') <> 'string'
    or char_length(p_properties->>'destinationHost') not between 1 and 253
    or p_properties->>'destinationHost' !~ '^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z0-9]([a-z0-9-]*[a-z0-9])?$'
    or jsonb_typeof(p_properties->'campaign') <> 'string'
    or char_length(p_properties->>'campaign') not between 1 and 80
    or p_properties->>'campaign' !~ '^[a-z0-9]+([-_][a-z0-9]+)*$'
    or jsonb_typeof(p_properties->'placement') <> 'string'
    or p_properties->>'placement' not in ('fanpage_hero','header','footer','content')
    or jsonb_typeof(p_properties->'linkKind') <> 'string'
    or p_properties->>'linkKind' not in ('ticket','website','social','external')
  ) then
    raise exception 'PRODUCT_EVENT_INVALID' using errcode = '22023';
  end if;

  if p_properties ? 'entryAction' and ($patch$;
  if (pg_catalog.length(v_definition) - pg_catalog.length(pg_catalog.replace(v_definition,v_old,'')))
      / pg_catalog.length(v_old) <> 1 then
    raise exception 'PRODUCT_EVENT_OUTBOUND_VALIDATION_SHAPE_CHANGED';
  end if;
  execute pg_catalog.replace(v_definition,v_old,v_new);
end $$;

create index fan_product_events_outbound_occurred_idx
  on public.fan_product_events(occurred_at desc)
  where event_name = 'outbound_link_click';

create function public.read_admin_outbound_analytics(
  p_actor_app_user_id uuid,
  p_actor_admin_allowlist_id uuid,
  p_days integer
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_to timestamptz := statement_timestamp();
  v_from timestamptz;
  v_clicks bigint;
  v_sessions bigint;
  v_group_count bigint;
  v_rows jsonb;
begin
  perform public.assert_active_admin(p_actor_app_user_id,p_actor_admin_allowlist_id,false);
  if p_days is null or p_days not in (7,30,90) then
    raise exception 'OUTBOUND_ANALYTICS_INVALID_DAYS' using errcode = '22023';
  end if;

  v_from := (pg_catalog.date_trunc('day', v_to at time zone 'UTC') at time zone 'UTC')
    - pg_catalog.make_interval(days => p_days - 1);

  select count(*), count(distinct event.anonymous_session_hash)
  into v_clicks, v_sessions
  from public.fan_product_events event
  where event.event_name = 'outbound_link_click'
    and event.occurred_at >= v_from
    and event.occurred_at <= v_to;

  with grouped as (
    select
      event.properties->>'campaign' as campaign,
      event.properties->>'destinationHost' as destination_host,
      event.properties->>'placement' as placement,
      event.properties->>'linkKind' as link_kind,
      count(*) as clicks,
      count(distinct event.anonymous_session_hash) as sessions
    from public.fan_product_events event
    where event.event_name = 'outbound_link_click'
      and event.occurred_at >= v_from
      and event.occurred_at <= v_to
    group by 1,2,3,4
  ), ranked as (
    select *
    from grouped
    order by clicks desc, campaign, destination_host, placement, link_kind
    limit 100
  )
  select
    (select count(*) from grouped),
    coalesce(jsonb_agg(jsonb_build_object(
      'campaign', ranked.campaign,
      'destinationHost', ranked.destination_host,
      'placement', ranked.placement,
      'linkKind', ranked.link_kind,
      'clicks', ranked.clicks,
      'sessions', ranked.sessions
    ) order by ranked.clicks desc, ranked.campaign, ranked.destination_host, ranked.placement, ranked.link_kind), '[]'::jsonb)
  into v_group_count, v_rows
  from ranked;

  return jsonb_build_object(
    'days', p_days,
    'from', v_from,
    'to', v_to,
    'totals', jsonb_build_object('clicks', v_clicks, 'sessions', v_sessions),
    'rows', v_rows,
    'truncated', v_group_count > 100
  );
end;
$$;

revoke all on function public.read_admin_outbound_analytics(uuid,uuid,integer)
  from public,anon,authenticated;
grant execute on function public.read_admin_outbound_analytics(uuid,uuid,integer)
  to service_role;

commit;
