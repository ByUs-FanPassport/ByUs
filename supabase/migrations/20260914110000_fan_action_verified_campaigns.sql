-- Campaign-bound native rollout proof. Population is an operational DB-owner
-- action after the fixed Hub/Registry context is verified at a finalized block.
-- The composite foreign keys keep a campaign bound to its LIVE creator and
-- require that creator to be verified for the same ActionHub binding. Producers
-- resolve only published LIVE rows before they call the gate.

create table public.fan_action_verified_campaigns (
  binding_id uuid not null,
  campaign_id uuid not null,
  creator_id uuid not null,
  verified_block_number numeric(78,0) not null check (verified_block_number > 0),
  verified_block_hash text not null check (verified_block_hash ~ '^0x[0-9a-f]{64}$'),
  verified_at timestamptz not null,
  primary key (binding_id, campaign_id),
  constraint fan_action_verified_campaigns_binding_creator_fkey
    foreign key (binding_id, creator_id)
    references public.fan_action_verified_creators(binding_id, creator_id)
    on delete restrict,
  constraint fan_action_verified_campaigns_campaign_creator_fkey
    foreign key (campaign_id, creator_id)
    references public.live_events(id, celebrity_id)
    on delete restrict
);

alter table public.fan_action_verified_campaigns enable row level security;
revoke all on table public.fan_action_verified_campaigns
  from public, anon, authenticated, service_role;

create function public.fan_action_native_enabled(
  p_action_code integer,
  p_app_user_id uuid,
  p_creator_id uuid,
  p_campaign_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_enabled boolean;
  v_binding_id uuid;
begin
  if p_action_code not in (2, 3, 4, 5) then
    return public.fan_action_native_enabled(p_action_code, p_app_user_id, p_creator_id);
  end if;

  -- The existing actor-aware helper locks the route before this lookup. Keep
  -- that lock order so canary configuration cannot race this decision.
  v_enabled := public.fan_action_native_enabled(p_action_code, p_app_user_id);
  if not v_enabled then
    return false;
  end if;

  select route.binding_id
    into v_binding_id
  from public.fan_action_producer_routes route
  where route.action_code = p_action_code;

  return p_creator_id is not null
    and p_campaign_id is not null
    and exists (
      select 1
      from public.fan_action_verified_campaigns verified
      where verified.binding_id = v_binding_id
        and verified.campaign_id = p_campaign_id
        and verified.creator_id = p_creator_id
    );
end;
$$;

-- Replace exactly the four LIVE route checks. Each replacement uses the
-- already selected published LIVE row (or its immutable response snapshot),
-- never a caller-supplied or mutable generic source id.
do $$
declare
  target record;
  function_definition text;
  occurrence_count integer;
begin
  for target in
    select * from (values
      (
        'public.reserve_owned_live_event(uuid,uuid,uuid,uuid,text,text)'::regprocedure,
        'public.fan_action_native_enabled(2,p_app_user_id)',
        'public.fan_action_native_enabled(2,p_app_user_id,live_record.celebrity_id,live_record.id)'
      ),
      (
        -- Recurring LIVE wraps the audited producer. Patch the renamed producer
        -- that still owns the selected live_record and native outbox branch.
        'public.attend_owned_live_event_before_recurring_live(uuid,text,uuid,text,uuid,text,text)'::regprocedure,
        'public.fan_action_native_enabled(3,p_app_user_id)',
        'public.fan_action_native_enabled(3,p_app_user_id,live_record.celebrity_id,live_record.id)'
      ),
      (
        'public.submit_owned_live_mission(uuid,uuid,uuid,jsonb,uuid,text,text)'::regprocedure,
        'public.fan_action_native_enabled(4,p_app_user_id)',
        'public.fan_action_native_enabled(4,p_app_user_id,live_record.celebrity_id,mission.live_event_id)'
      ),
      (
        'public.submit_owned_live_survey(uuid,text,uuid,jsonb,uuid,text,text)'::regprocedure,
        'public.fan_action_native_enabled(5,p_app_user_id)',
        'public.fan_action_native_enabled(5,p_app_user_id,response_record.celebrity_id,response_record.live_event_id)'
      )
    ) as bounded(function_signature, old_call, new_call)
  loop
    function_definition := pg_get_functiondef(target.function_signature);
    occurrence_count := (
      length(function_definition) - length(replace(function_definition, target.old_call, ''))
    ) / length(target.old_call);
    if occurrence_count <> 1 then
      raise exception 'FAN_ACTION_CAMPAIGN_GATE_PRODUCER_SHAPE_CHANGED: % expected one %, found %',
        target.function_signature, target.old_call, occurrence_count;
    end if;
    execute replace(function_definition, target.old_call, target.new_call);
  end loop;
end;
$$;

revoke all on function public.fan_action_native_enabled(integer,uuid,uuid,uuid)
  from public, anon, authenticated, service_role;
