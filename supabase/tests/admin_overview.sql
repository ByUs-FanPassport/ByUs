-- Execute only against ByUs Dev. All fixture writes roll back in this request.
begin;
do $$
declare
  actor uuid; allowlist uuid; member1 uuid := gen_random_uuid(); member2 uuid := gen_random_uuid();
  member3 uuid := gen_random_uuid(); member4 uuid := gen_random_uuid();
  t timestamptz := '2026-09-11T08:00:00Z'; f timestamptz := '2026-09-04T15:00:00Z';
  today timestamptz := '2026-09-10T15:00:00Z';
  before_data jsonb; after_data jsonb; detailed jsonb; rejected boolean; viewer uuid := gen_random_uuid(); viewer_allowlist uuid := gen_random_uuid();
  creator uuid := gen_random_uuid(); private_creator uuid := gen_random_uuid(); live_id uuid;
  scheduled_live uuid := gen_random_uuid(); override_live uuid := gen_random_uuid(); cancelled_live uuid := gen_random_uuid(); private_live uuid := gen_random_uuid();
  live_template jsonb; delivery uuid; notification uuid; subscription uuid := gen_random_uuid(); push_delivery uuid := gen_random_uuid();
  error_code text; channel_table text; base_failures integer;
begin
  select u.id,a.id into actor,allowlist from public.admin_allowlist a join public.app_users u
    on u.verified_email=a.email and u.status='active' where a.active limit 1;
  if actor is null then raise exception 'Dev admin fixture is required'; end if;
  before_data := public.read_admin_overview(actor,allowlist,7,t);
  if (before_data->>'from')::timestamptz <> f then raise exception 'KST start is wrong'; end if;
  if jsonb_array_length(before_data->'trend') <> 7 then raise exception 'Expected seven daily buckets'; end if;
  if (before_data->>'previousFrom')::timestamptz <> f-(t-f) then raise exception 'Equal-duration comparison is wrong'; end if;
  if (select sum((point->>'signups')::int) from jsonb_array_elements(before_data->'trend') point)
    <> (before_data#>>'{members,signups,current}')::int then raise exception 'Trend total differs from card'; end if;

  insert into public.app_users(id,privy_user_id,verified_email,status,created_at) values
    (member1,'did:privy:overview-test-'||member1,member1||'@example.invalid','active',f),
    (member2,'did:privy:overview-test-'||member2,member2||'@example.invalid','disabled',t-interval '1 microsecond'),
    (member3,'did:privy:overview-test-'||member3,member3||'@example.invalid','active',f-interval '1 microsecond'),
    (member4,'did:privy:overview-test-'||member4,member4||'@example.invalid','active',t);
  insert into public.fan_product_events(schema_version,event_name,app_user_id,source,idempotency_key,occurred_at,created_at) values
    (1,'creator_page_view',member1,'overview.test','overview-test-'||gen_random_uuid(),today,t-interval '1 second'),
    (1,'live_page_view',member1,'overview.test','overview-test-'||gen_random_uuid(),today+interval '1 second',t-interval '1 second'),
    (1,'creator_page_view',member2,'overview.test','overview-test-'||gen_random_uuid(),today-interval '1 microsecond',t-interval '1 second'),
    (1,'benefit_won',member3,'overview.test','overview-test-'||gen_random_uuid(),today,t-interval '1 second'),
    (1,'ticket_credited',member3,'overview.test','overview-test-'||gen_random_uuid(),today,t-interval '1 second'),
    (1,'live_page_view',member4,'overview.test','overview-test-'||gen_random_uuid(),t,t-interval '1 second');
  after_data := public.read_admin_overview(actor,allowlist,7,t);
  if (after_data#>>'{members,signups,current}')::int <> (before_data#>>'{members,signups,current}')::int+2 then raise exception 'Signup [from,to) or disabled account count is wrong'; end if;
  if (after_data#>>'{members,signups,previous}')::int <> (before_data#>>'{members,signups,previous}')::int+1 then raise exception 'Prior boundary is wrong'; end if;
  if (after_data#>>'{members,total}')::int <> (before_data#>>'{members,total}')::int+3 then raise exception 'Total incorrectly depends on wallets or counts future signup'; end if;
  if (after_data#>>'{activity,daily}')::int <> (before_data#>>'{activity,daily}')::int+1 then raise exception 'DAU distinct/whitelist/half-open boundary is wrong'; end if;
  if (after_data#>>'{activity,monthly}')::int <> (before_data#>>'{activity,monthly}')::int+2 then raise exception 'MAU distinct/whitelist is wrong'; end if;
  if (select sum((point->>'signups')::int) from jsonb_array_elements(after_data->'trend') point)
    <> (after_data#>>'{members,signups,current}')::int then raise exception 'New trend total differs'; end if;
  if (public.read_admin_overview(actor,allowlist,7,today)#>>'{trend,6,signups}')::int <> 0 then raise exception 'Midnight current bucket must be zero'; end if;
  detailed := public.read_admin_platform_analytics(actor,allowlist,f,t,t);
  if jsonb_array_length(detailed#>'{trend,value}')<>7 then raise exception 'Detailed chart omitted partial current day'; end if;
  if (select sum((point->>'newFans')::int) from jsonb_array_elements(detailed#>'{trend,value}') point)
    <> (after_data#>>'{members,signups,current}')::int then raise exception 'Detailed chart does not clip signup boundaries'; end if;

  -- Reuse an existing Dev record only inside this rollback transaction. No worker
  -- can observe a test delivery, and no email/push is dispatched by the test.
  select id,notification_id into delivery,notification from public.external_notification_delivery_outbox limit 1;
  if delivery is null then raise exception 'Dev external delivery fixture is required'; end if;
  insert into public.push_subscriptions(id,app_user_id,endpoint,endpoint_hash,p256dh,auth_secret,disabled_at)
    values(subscription,member1,'https://example.invalid/overview-test',replace(subscription::text,'-','')||replace(subscription::text,'-',''),repeat('x',30),repeat('x',12),t);
  insert into public.notification_delivery_outbox(id,notification_id,subscription_id,status,available_at)
    values(push_delivery,notification,subscription,'failed','infinity');
  foreach channel_table in array array['external_notification_delivery_outbox','notification_delivery_outbox'] loop
    live_id := case when channel_table='external_notification_delivery_outbox' then delivery else push_delivery end;
    execute format('update public.%I set status=''failed'',available_at=''infinity'',last_error_code=''PROVIDER_UNAVAILABLE'',sent_at=null,lease_owner=null,lease_expires_at=null where id=$1',channel_table) using live_id;
    base_failures := (public.read_admin_overview(actor,allowlist,7,t)#>>'{issues,failedNotifications}')::int;
    foreach error_code in array array['SCHEDULE_SUPERSEDED','LIVE_CANCELLED','EMAIL_KIND_SUPPRESSED','EMAIL_NOT_ELIGIBLE','CURRENT_STATE_INELIGIBLE'] loop
      execute format('update public.%I set last_error_code=$1 where id=$2',channel_table) using error_code,live_id;
      if (public.read_admin_overview(actor,allowlist,7,t)#>>'{issues,failedNotifications}')::int <> base_failures-1 then
        raise exception 'Intentional failure counted: % %',channel_table,error_code;
      end if;
    end loop;
    execute format('update public.%I set last_error_code=''PROVIDER_UNAVAILABLE'',available_at=$1 where id=$2',channel_table) using t+interval '1 hour',live_id;
    if (public.read_admin_overview(actor,allowlist,7,t)#>>'{issues,failedNotifications}')::int <> base_failures-1 then raise exception 'Retryable failure counted as final'; end if;
  end loop;

  before_data := public.read_admin_overview(actor,allowlist,7,t);
  insert into public.celebrities(id,slug,status,image_url,published_at,created_at,roles,primary_role) values
    (creator,'overview-'||creator,'published','/overview-test.png',f,f,array['creator']::public.celebrity_role[],'creator'),
    (private_creator,'overview-'||private_creator,'draft','/overview-test.png',null,f,array['creator']::public.celebrity_role[],'creator');
  select to_jsonb(e) into live_template from public.live_events e limit 1;
  if live_template is null then raise exception 'Dev LIVE fixture is required'; end if;
  foreach live_id in array array[scheduled_live,override_live,cancelled_live,private_live] loop
    insert into public.live_events select * from jsonb_populate_record(null::public.live_events,live_template||jsonb_build_object(
      'id',live_id,'slug','overview-'||live_id,'celebrity_id',case when live_id=private_live then private_creator else creator end,
      'publication_status','published','published_at',f,'created_at',f,'archived_at',null,
      'content_status','scheduled',
      'starts_at',t+interval '1 hour','ends_at',t+interval '2 hours',
      'reservation_opens_at',f,'reservation_closes_at',t+interval '30 minutes'));
  end loop;
  insert into public.live_status_overrides(live_event_id,effective_status,effective_from,effective_until,reason,actor_admin_allowlist_id)
    values(override_live,'live',t-interval '1 hour',t+interval '1 hour','Overview transaction test',allowlist),
      (cancelled_live,'cancelled',t-interval '1 hour',null,'Cancellation is terminal',allowlist);
  after_data := public.read_admin_overview(actor,allowlist,7,t);
  if (after_data#>>'{content,creators}')::int <> (before_data#>>'{content,creators}')::int+1
    or (after_data#>>'{content,scheduled}')::int <> (before_data#>>'{content,scheduled}')::int+1
    or (after_data#>>'{content,live}')::int <> (before_data#>>'{content,live}')::int+1
    or (after_data#>>'{content,cancelled}')::int <> (before_data#>>'{content,cancelled}')::int+1 then
      raise exception 'Public creator/LIVE status/override/cancellation counts are wrong';
  end if;
  if exists(select 1 from jsonb_array_elements(after_data->'upcoming') item where (item->>'id')::uuid in (private_live,cancelled_live)) then
    raise exception 'Private or cancelled LIVE leaked to upcoming';
  end if;

  if has_function_privilege('anon','public.read_admin_overview(uuid,uuid,integer,timestamptz)','execute')
     or has_function_privilege('authenticated','public.read_admin_overview(uuid,uuid,integer,timestamptz)','execute')
     or not has_function_privilege('service_role','public.read_admin_overview(uuid,uuid,integer,timestamptz)','execute') then raise exception 'RPC grant boundary is wrong'; end if;
  rejected := false;
  begin perform public.read_admin_overview(member1,allowlist,7,t); exception when raise_exception then rejected := true; end;
  if not rejected then raise exception 'Mismatched actor accepted'; end if;
  rejected := false;
  begin perform public.read_admin_overview(actor,allowlist,0,t); exception when invalid_parameter_value then rejected := true; end;
  if not rejected then raise exception 'Invalid period accepted'; end if;
  insert into public.app_users(id,privy_user_id,verified_email,created_at) values(viewer,'did:privy:overview-viewer-'||viewer,viewer||'@example.invalid',f-interval '1 day');
  insert into public.admin_allowlist(id,email,role,active) values(viewer_allowlist,viewer||'@example.invalid','viewer',true);
  perform public.read_admin_overview(viewer,viewer_allowlist,30,t);
  update public.admin_allowlist set active=false where id=viewer_allowlist;
  rejected := false;
  begin perform public.read_admin_overview(viewer,viewer_allowlist,30,t); exception when raise_exception then rejected := true; end;
  if not rejected then raise exception 'Inactive allowlist accepted'; end if;
end $$;
rollback;
