-- Add bounded, optional wallet timing diagnostics to login_result events while
-- preserving the RPC signature, storage behavior, and existing privileges.

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
  is_signup_client_event boolean;
  is_signup_server_event boolean;
  property_count integer;
  wallet_wait_ms numeric;
  wallet_reconciliation_ms numeric;
begin
  is_signup_client_event := p_event_name in (
    'signup_guide_view','signup_guide_cta','login_started','login_result'
  );
  is_signup_server_event := p_event_name in ('account_created','profile_completed');

  if p_schema_version <> 1
     or p_event_name not in (
       'creator_page_view','live_page_view','live_cta_click','benefit_page_view',
       'reaction_completed','passport_issued','reservation_completed',
       'attendance_completed','mission_completed','ticket_credited','ticket_debited',
       'journey_completed','collectible_claimed','benefit_entered','benefit_won',
       'fulfillment_completed','signup_guide_view','signup_guide_cta','login_started',
       'login_result','account_created','profile_completed'
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

  for property_value in select value from pg_catalog.jsonb_each(p_properties) loop
    if jsonb_typeof(property_value) not in ('string','number','boolean','null') then
      raise exception 'PRODUCT_EVENT_INVALID' using errcode = '22023';
    end if;
  end loop;

  if is_signup_client_event then
    if p_app_user_id is not null
       or p_anonymous_session_hash is null
       or p_celebrity_id is not null
       or p_live_event_id is not null
       or p_mission_id is not null
       or p_benefit_id is not null
       or not (p_properties ?& array['channel','landing','guide','browser','os','locale'])
       or jsonb_typeof(p_properties->'channel') <> 'string'
       or jsonb_typeof(p_properties->'landing') <> 'string'
       or jsonb_typeof(p_properties->'guide') <> 'string'
       or jsonb_typeof(p_properties->'browser') <> 'string'
       or jsonb_typeof(p_properties->'os') <> 'string'
       or jsonb_typeof(p_properties->'locale') <> 'string'
       or p_properties->>'channel' not in ('direct','search','social','email','paid','referral','internal','unknown')
       or p_properties->>'landing' not in ('home','creator_directory','creator','live_directory','live','benefit','fan_guide','unknown')
       or p_properties->>'guide' not in ('elina','ifew','none')
       or p_properties->>'browser' not in ('instagram','kakao','safari','chrome','other')
       or p_properties->>'os' not in ('ios','android','other')
       or p_properties->>'locale' not in ('ko','en') then
      raise exception 'PRODUCT_EVENT_INVALID' using errcode = '22023';
    end if;

    if p_event_name in ('signup_guide_view','signup_guide_cta') then
      if p_source <> 'signup.guide'
         or not (p_properties ? 'audience')
         or jsonb_typeof(p_properties->'audience') <> 'string'
         or p_properties->>'audience' not in ('guest','member','unknown')
         or (p_event_name = 'signup_guide_view' and (
           (select count(*) from pg_catalog.jsonb_object_keys(p_properties)) <> 7
           or p_idempotency_key !~ '^signup-guide:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}:view$'
         ))
         or (p_event_name = 'signup_guide_cta' and (
           (select count(*) from pg_catalog.jsonb_object_keys(p_properties)) <> 9
           or not (p_properties ?& array['action','placement'])
           or jsonb_typeof(p_properties->'action') <> 'string'
           or jsonb_typeof(p_properties->'placement') <> 'string'
           or p_properties->>'action' not in ('verify','live','raffles','steps','certifications','my')
           or p_properties->>'placement' not in ('hero','step','closing','history')
           or p_idempotency_key !~ '^signup-guide:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}:cta$'
         )) then
        raise exception 'PRODUCT_EVENT_INVALID' using errcode = '22023';
      end if;
    elsif p_event_name in ('login_started','login_result') then
      property_count := (select count(*) from pg_catalog.jsonb_object_keys(p_properties));
      if p_source <> 'signup.login'
         or not (p_properties ?& array['provider','trigger'])
         or jsonb_typeof(p_properties->'provider') <> 'string'
         or jsonb_typeof(p_properties->'trigger') <> 'string'
         or p_properties->>'provider' not in ('google','apple','test','unknown')
         or p_properties->>'trigger' not in ('provider','session_restore','retry','reauth')
         or (p_event_name = 'login_started' and (
           property_count <> 8
           or p_idempotency_key !~ '^signup-login:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}:started$'
         ))
         or (p_event_name = 'login_result' and (
           property_count not in (11,15)
           or not (p_properties ?& array['outcome','stage','reason'])
           or jsonb_typeof(p_properties->'outcome') <> 'string'
           or jsonb_typeof(p_properties->'stage') <> 'string'
           or jsonb_typeof(p_properties->'reason') <> 'string'
           or p_properties->>'outcome' not in ('succeeded','failed')
           or p_properties->>'stage' not in ('oauth','user','wallet','token','session','ready','reauthentication')
           or p_properties->>'reason' not in ('none','timeout','provider_error','session_error','verified_email_required','reauthentication_required','unknown')
           or (p_properties->>'outcome' = 'succeeded' and (
             p_properties->>'stage' <> 'session' or p_properties->>'reason' <> 'none'
           ))
           or (p_properties->>'outcome' = 'failed' and p_properties->>'reason' = 'none')
           or p_idempotency_key !~ (
             '^signup-login:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}:'
             || case p_properties->>'outcome' when 'succeeded' then 'succeeded' else 'failed' end || '$'
           )
         )) then
        raise exception 'PRODUCT_EVENT_INVALID' using errcode = '22023';
      end if;

      if p_event_name = 'login_result' and property_count = 15 then
        if not (p_properties ?& array[
             'walletWaitOutcome','walletWaitMs','walletReconciliation','walletReconciliationMs'
           ])
           or jsonb_typeof(p_properties->'walletWaitOutcome') <> 'string'
           or jsonb_typeof(p_properties->'walletWaitMs') <> 'number'
           or jsonb_typeof(p_properties->'walletReconciliation') <> 'string'
           or jsonb_typeof(p_properties->'walletReconciliationMs') <> 'number'
           or p_properties->>'walletWaitOutcome' not in ('succeeded','timeout','error')
           or p_properties->>'walletReconciliation' not in (
             'not_needed','wallet_found','wallet_missing','timeout','error'
           )
           or p_properties->>'stage' not in ('wallet','token','session') then
          raise exception 'PRODUCT_EVENT_INVALID' using errcode = '22023';
        end if;

        begin
          wallet_wait_ms := (p_properties->>'walletWaitMs')::numeric;
          wallet_reconciliation_ms := (p_properties->>'walletReconciliationMs')::numeric;
        exception when others then
          raise exception 'PRODUCT_EVENT_INVALID' using errcode = '22023';
        end;

        if wallet_wait_ms < 0 or wallet_wait_ms > 120000
           or wallet_wait_ms <> pg_catalog.trunc(wallet_wait_ms)
           or wallet_reconciliation_ms < 0 or wallet_reconciliation_ms > 30000
           or wallet_reconciliation_ms <> pg_catalog.trunc(wallet_reconciliation_ms)
           or (p_properties->>'walletWaitOutcome' in ('succeeded','error') and (
             p_properties->>'walletReconciliation' <> 'not_needed'
             or wallet_reconciliation_ms <> 0
           ))
           or (p_properties->>'walletWaitOutcome' = 'timeout'
             and p_properties->>'walletReconciliation' = 'not_needed')
           or (p_properties->>'outcome' = 'succeeded' and not (
             (p_properties->>'walletWaitOutcome' = 'succeeded'
               and p_properties->>'walletReconciliation' = 'not_needed')
             or (p_properties->>'walletWaitOutcome' = 'timeout'
               and p_properties->>'walletReconciliation' = 'wallet_found')
           ))
           or (not (
             p_properties->>'walletWaitOutcome' = 'succeeded'
             or (p_properties->>'walletWaitOutcome' = 'timeout'
               and p_properties->>'walletReconciliation' = 'wallet_found')
           ) and (
             p_properties->>'outcome' <> 'failed'
             or p_properties->>'stage' <> 'wallet'
           ))
           or (not (
             p_properties->>'walletWaitOutcome' = 'succeeded'
             or (p_properties->>'walletWaitOutcome' = 'timeout'
               and p_properties->>'walletReconciliation' = 'wallet_found')
           ) and p_properties->>'walletWaitOutcome' = 'timeout'
             and p_properties->>'reason' <> 'timeout') then
          raise exception 'PRODUCT_EVENT_INVALID' using errcode = '22023';
        end if;
      end if;
    end if;
  elsif is_signup_server_event then
    if p_app_user_id is null
       or p_anonymous_session_hash is not null
       or p_celebrity_id is not null
       or p_live_event_id is not null
       or p_mission_id is not null
       or p_benefit_id is not null
       or p_source <> 'server.commit_projection'
       or p_properties <> '{}'::jsonb
       or (p_event_name = 'account_created' and (
         p_idempotency_key <> 'commit:app_users:' || p_app_user_id::text || ':account_created'
         or not exists (
           select 1 from public.app_users source_record
           where source_record.id = p_app_user_id
             and source_record.created_at = p_occurred_at
         )
       ))
       or (p_event_name = 'profile_completed' and (
         p_idempotency_key <> 'commit:user_profiles:' || p_app_user_id::text || ':profile_completed'
         or not exists (
           select 1 from public.user_profiles source_record
           where source_record.app_user_id = p_app_user_id
             and source_record.created_at = p_occurred_at
         )
       )) then
      raise exception 'PRODUCT_EVENT_COMMIT_SOURCE_INVALID' using errcode = '23514';
    end if;
  end if;

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
    return pg_catalog.jsonb_build_object('id', existing.id, 'replayed', true);
  end if;

  insert into public.fan_product_events(
    schema_version,event_name,app_user_id,anonymous_session_hash,celebrity_id,
    live_event_id,mission_id,benefit_id,source,idempotency_key,occurred_at,properties
  ) values (
    p_schema_version,p_event_name,p_app_user_id,p_anonymous_session_hash,p_celebrity_id,
    p_live_event_id,p_mission_id,p_benefit_id,p_source,p_idempotency_key,p_occurred_at,p_properties
  ) returning * into inserted;
  return pg_catalog.jsonb_build_object('id', inserted.id, 'replayed', false);
end;
$$;
