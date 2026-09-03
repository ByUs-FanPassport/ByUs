-- Count JSON object keys through PostgreSQL's supported set-returning helper.
create or replace function public.record_product_event_v1(
  p_schema_version smallint,
  p_event_name text,
  p_app_user_id uuid,
  p_anonymous_session_hash text,
  p_celebrity_id uuid,
  p_live_event_id uuid,
  p_mission_id uuid,
  p_benefit_id uuid,
  p_source text,
  p_idempotency_key text,
  p_occurred_at timestamptz,
  p_properties jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  existing public.fan_product_events%rowtype;
  inserted public.fan_product_events%rowtype;
  property_value jsonb;
  ticket_row public.fan_ticket_ledger%rowtype;
  ledger_row_id uuid;
begin
  if p_schema_version <> 1
     or p_event_name not in (
       'creator_page_view','live_page_view','live_cta_click','benefit_page_view',
       'reaction_completed','passport_issued','reservation_completed',
       'attendance_completed','mission_completed','ticket_credited','ticket_debited',
       'journey_completed','collectible_claimed','benefit_entered','benefit_won',
       'fulfillment_completed'
     )
     or ((p_app_user_id is not null) = (p_anonymous_session_hash is not null))
     or (p_anonymous_session_hash is not null and p_anonymous_session_hash !~ '^[0-9a-f]{64}$')
     or coalesce(p_source, '') !~ '^[a-z0-9][a-z0-9_.:-]{0,99}$'
     or length(coalesce(p_idempotency_key, '')) not between 8 and 200
     or coalesce(p_idempotency_key, '') !~ '^[A-Za-z0-9][A-Za-z0-9_.:-]+$'
     or p_occurred_at is null
     or p_occurred_at > statement_timestamp() + interval '5 minutes'
     or p_occurred_at < statement_timestamp() - interval '24 hours'
     or p_properties is null
     or jsonb_typeof(p_properties) <> 'object'
     or (select count(*) from pg_catalog.jsonb_object_keys(p_properties)) > 20
     or pg_column_size(p_properties) > 2048 then
    raise exception 'PRODUCT_EVENT_INVALID' using errcode = '22023';
  end if;

  for property_value in select value from jsonb_each(p_properties) loop
    if jsonb_typeof(property_value) not in ('string','number','boolean','null') then
      raise exception 'PRODUCT_EVENT_INVALID' using errcode = '22023';
    end if;
  end loop;

  if p_event_name in ('ticket_credited', 'ticket_debited') then
    begin
      ledger_row_id := nullif(p_properties->>'ledgerRowId', '')::uuid;
    exception when others then
      raise exception 'PRODUCT_EVENT_TICKET_SOURCE_INVALID' using errcode = '22023';
    end;
    select * into ticket_row from public.fan_ticket_ledger ledger
      where ledger.id = ledger_row_id
        and ledger.app_user_id = p_app_user_id
        and ledger.celebrity_id = p_celebrity_id;
    if not found
       or (p_event_name = 'ticket_credited' and ticket_row.entry_kind <> 'credit')
       or (p_event_name = 'ticket_debited' and ticket_row.entry_kind <> 'debit') then
      raise exception 'PRODUCT_EVENT_TICKET_SOURCE_INVALID' using errcode = '23514';
    end if;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('product-event:v1:' || p_idempotency_key, 0)
  );
  select * into existing from public.fan_product_events event
    where event.schema_version = p_schema_version
      and event.idempotency_key = p_idempotency_key;
  if found then
    if existing.event_name <> p_event_name
       or existing.app_user_id is distinct from p_app_user_id
       or existing.anonymous_session_hash is distinct from p_anonymous_session_hash
       or existing.celebrity_id is distinct from p_celebrity_id
       or existing.live_event_id is distinct from p_live_event_id
       or existing.mission_id is distinct from p_mission_id
       or existing.benefit_id is distinct from p_benefit_id
       or existing.source <> p_source
       or existing.occurred_at <> p_occurred_at
       or existing.properties <> p_properties then
      raise exception 'PRODUCT_EVENT_IDEMPOTENCY_CONFLICT' using errcode = '23514';
    end if;
    return jsonb_build_object('id', existing.id, 'replayed', true);
  end if;

  insert into public.fan_product_events(
    schema_version,event_name,app_user_id,anonymous_session_hash,celebrity_id,
    live_event_id,mission_id,benefit_id,source,idempotency_key,occurred_at,properties
  ) values (
    p_schema_version,p_event_name,p_app_user_id,p_anonymous_session_hash,p_celebrity_id,
    p_live_event_id,p_mission_id,p_benefit_id,p_source,p_idempotency_key,p_occurred_at,p_properties
  ) returning * into inserted;
  return jsonb_build_object('id', inserted.id, 'replayed', false);
end;
$$;
