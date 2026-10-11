\set ON_ERROR_STOP on
begin;

create function pg_temp.expect_error(statement text, expected text) returns void
language plpgsql as $$
declare caught boolean := false;
begin
  begin execute statement;
  exception when others then
    if position(expected in sqlerrm) = 0 then
      raise exception 'Unexpected error %, wanted %', sqlerrm, expected;
    end if;
    caught := true;
  end;
  if not caught then raise exception 'Expected error was not raised: %', expected; end if;
end $$;

do $$
declare
  admin_user uuid := '95600000-0000-4000-8000-000000000001';
  admin_allowlist uuid := '95600000-0000-4000-8000-000000000002';
  inactive_allowlist uuid := '95600000-0000-4000-8000-000000000003';
  correlation uuid := '95600000-0000-4000-8000-000000000004';
  profile_id uuid;
  payload jsonb := '{
    "slug":"ticket-link-proof",
    "imageUrl":"/ticket-link-proof.jpg",
    "imagePosition":"center",
    "displayOrder":700,
    "fanCount":0,
    "primaryRole":"brand",
    "ticketUrl":"https://tickets.example.com/events/byus?campaign=fall",
    "localizations":{
      "ko":{"name":"티켓 링크 검증","summary":"티켓 링크 검증용 브랜드","imageAlt":"티켓 링크 검증 이미지"},
      "en":{"name":"Ticket link proof","summary":"Brand used to verify ticket links","imageAlt":"Ticket link proof image"}
    },
    "themes":[],
    "socialLinks":[]
  }'::jsonb;
  event_properties jsonb := '{
    "destinationHost":"tickets.example.com",
    "campaign":"fall_launch-2026",
    "placement":"fanpage_hero",
    "linkKind":"ticket"
  }'::jsonb;
  first_result jsonb;
  replay_result jsonb;
  analytics_7 jsonb;
  analytics_30 jsonb;
begin
  insert into public.app_users(id,privy_user_id,verified_email) values
    (admin_user,'did:privy:outbound-admin','outbound-admin@byus.test');
  insert into public.admin_allowlist(id,email,role,active) values
    (admin_allowlist,'outbound-admin@byus.test','admin',true),
    (inactive_allowlist,'inactive-outbound-admin@byus.test','admin',false);

  first_result := public.save_admin_celebrity(admin_allowlist,correlation,null,payload);
  profile_id := (first_result->>'id')::uuid;
  if first_result->>'ticketUrl' <> 'https://tickets.example.com/events/byus?campaign=fall' then
    raise exception 'ticketUrl was not returned after create: %', first_result;
  end if;

  first_result := public.save_admin_celebrity(
    admin_allowlist,correlation,profile_id,payload-'ticketUrl'
  );
  if first_result->>'ticketUrl' <> 'https://tickets.example.com/events/byus?campaign=fall' then
    raise exception 'omitted ticketUrl did not preserve the stored value';
  end if;

  perform public.set_admin_celebrity_publication(admin_allowlist,correlation,profile_id,true);
  set constraints all immediate;
  if (select count(*) from public.published_celebrities
      where slug='ticket-link-proof'
        and ticket_url='https://tickets.example.com/events/byus?campaign=fall') <> 2 then
    raise exception 'published ticketUrl projection failed';
  end if;
  set constraints all deferred;

  perform pg_temp.expect_error(format(
    'select public.save_admin_celebrity(%L,%L,%L,%L::jsonb)',
    admin_allowlist,correlation,profile_id,
    jsonb_set(payload,'{ticketUrl}','"http://tickets.example.com"')::text
  ), 'celebrities_ticket_url_https');
  perform pg_temp.expect_error(format(
    'select public.save_admin_celebrity(%L,%L,%L,%L::jsonb)',
    admin_allowlist,correlation,profile_id,
    jsonb_set(payload,'{ticketUrl}','"https://user@tickets.example.com"')::text
  ), 'celebrities_ticket_url_https');
  perform pg_temp.expect_error(format(
    'select public.save_admin_celebrity(%L,%L,%L,%L::jsonb)',
    admin_allowlist,correlation,profile_id,
    jsonb_set(payload,'{ticketUrl}','"https://tickets.example.com/a b"')::text
  ), 'celebrities_ticket_url_https');

  first_result := public.save_admin_celebrity(
    admin_allowlist,correlation,profile_id,jsonb_set(payload,'{ticketUrl}','null'::jsonb)
  );
  if first_result->'ticketUrl' <> 'null'::jsonb
    or (select ticket_url from public.celebrities where id=profile_id) is not null then
    raise exception 'explicit null ticketUrl did not clear the stored value';
  end if;

  first_result := public.record_product_event_v1(
    1::smallint,'outbound_link_click',null,repeat('a',64),null,null,null,null,
    'web.outbound','outbound:95600000-0000-4000-8000-000000000101',
    statement_timestamp()-interval '1 minute',event_properties
  );
  replay_result := public.record_product_event_v1(
    1::smallint,'outbound_link_click',null,repeat('a',64),null,null,null,null,
    'web.outbound','outbound:95600000-0000-4000-8000-000000000101',
    statement_timestamp()-interval '1 minute',event_properties
  );
  if (first_result->>'replayed')::boolean
    or not (replay_result->>'replayed')::boolean
    or first_result->>'id' is distinct from replay_result->>'id' then
    raise exception 'outbound event replay contract failed';
  end if;

  perform public.record_product_event_v1(
    1::smallint,'outbound_link_click',null,repeat('b',64),null,null,null,null,
    'web.outbound','outbound:95600000-0000-4000-8000-000000000102',
    statement_timestamp()-interval '30 seconds',event_properties
  );

  insert into public.fan_product_events(
    schema_version,event_name,anonymous_session_hash,source,idempotency_key,occurred_at,properties
  ) values (
    1,'outbound_link_click',repeat('c',64),'web.outbound',
    'outbound:95600000-0000-4000-8000-000000000103',
    statement_timestamp()-interval '8 days',event_properties
  );

  analytics_7 := public.read_admin_outbound_analytics(admin_user,admin_allowlist,7);
  analytics_30 := public.read_admin_outbound_analytics(admin_user,admin_allowlist,30);
  if analytics_7->'totals' <> '{"clicks":2,"sessions":2}'::jsonb
    or jsonb_array_length(analytics_7->'rows') <> 1
    or analytics_7->'rows'->0->>'campaign' <> 'fall_launch-2026'
    or (analytics_7->>'truncated')::boolean then
    raise exception '7-day outbound aggregate failed: %', analytics_7;
  end if;
  if analytics_30->'totals' <> '{"clicks":3,"sessions":3}'::jsonb then
    raise exception '30-day outbound aggregate or distinct sessions failed: %', analytics_30;
  end if;

  perform pg_temp.expect_error(format(
    'select public.read_admin_outbound_analytics(%L,%L,7)',admin_user,inactive_allowlist
  ), 'active admin required');
  perform pg_temp.expect_error(format(
    'select public.read_admin_outbound_analytics(%L,%L,14)',admin_user,admin_allowlist
  ), 'OUTBOUND_ANALYTICS_INVALID_DAYS');

  raise notice 'PROFILE_TICKET_LINKS and OUTBOUND_LINK_ANALYTICS preserve/clear/validation/replay/window/session/admin contracts: PASS';
end $$;

select pg_temp.expect_error($sql$
  select public.record_product_event_v1(
    1::smallint,'outbound_link_click',null,repeat('d',64),null,null,null,null,
    'web.outbound','outbound:95600000-0000-4000-8000-000000000201',now(),
    '{"destinationHost":"tickets.example.com","campaign":"fall","placement":"header","linkKind":"ticket","email":"fan@example.com"}'::jsonb)
$sql$,'PRODUCT_EVENT_INVALID');
select pg_temp.expect_error($sql$
  select public.record_product_event_v1(
    1::smallint,'outbound_link_click',null,repeat('d',64),null,null,null,null,
    'web.page','outbound:95600000-0000-4000-8000-000000000202',now(),
    '{"destinationHost":"tickets.example.com","campaign":"fall","placement":"header","linkKind":"ticket"}'::jsonb)
$sql$,'PRODUCT_EVENT_INVALID');
select pg_temp.expect_error($sql$
  select public.record_product_event_v1(
    1::smallint,'outbound_link_click','95600000-0000-4000-8000-000000000001',null,null,null,null,null,
    'web.outbound','outbound:95600000-0000-4000-8000-000000000203',now(),
    '{"destinationHost":"tickets.example.com","campaign":"fall","placement":"header","linkKind":"ticket"}'::jsonb)
$sql$,'PRODUCT_EVENT_INVALID');
select pg_temp.expect_error($sql$
  select public.record_product_event_v1(
    1::smallint,'outbound_link_click',null,repeat('d',64),null,null,null,null,
    'web.outbound','outbound:95600000-0000-4000-8000-000000000204',now(),
    '{"destinationHost":"https://tickets.example.com:443/path","campaign":"Fall Sale","placement":"sidebar","linkKind":"ticket"}'::jsonb)
$sql$,'PRODUCT_EVENT_INVALID');
select pg_temp.expect_error($sql$
  select public.record_product_event_v1(
    1::smallint,'outbound_link_click',null,repeat('d',64),null,null,null,null,
    'web.outbound','outbound:95600000-0000-4000-8000-000000000205',now(),
    '{"destinationHost":"LOCALHOST","campaign":"fall","placement":"header","linkKind":"ticket"}'::jsonb)
$sql$,'PRODUCT_EVENT_INVALID');

do $$
begin
  if has_function_privilege('anon','public.read_admin_outbound_analytics(uuid,uuid,integer)','execute')
    or has_function_privilege('authenticated','public.read_admin_outbound_analytics(uuid,uuid,integer)','execute')
    or not has_function_privilege('service_role','public.read_admin_outbound_analytics(uuid,uuid,integer)','execute') then
    raise exception 'outbound analytics RPC privileges are invalid';
  end if;
  if pg_get_function_arguments('public.read_admin_outbound_analytics(uuid,uuid,integer)'::regprocedure)
      <> 'p_actor_app_user_id uuid, p_actor_admin_allowlist_id uuid, p_days integer' then
    raise exception 'outbound analytics RPC argument names are invalid';
  end if;
end $$;

rollback;
