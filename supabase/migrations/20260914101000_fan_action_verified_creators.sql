-- Creator-bound native rollout proof. Population is an operational DB-owner
-- action after the fixed Hub/Registry context is verified at a finalized block.
create table public.fan_action_verified_creators (
  binding_id uuid not null references public.fan_action_bindings(id),
  creator_id uuid not null references public.celebrities(id),
  verified_block_number numeric(78,0) not null check (verified_block_number > 0),
  verified_block_hash text not null check (verified_block_hash ~ '^0x[0-9a-f]{64}$'),
  verified_at timestamptz not null,
  primary key (binding_id, creator_id)
);

alter table public.fan_action_verified_creators enable row level security;
revoke all on table public.fan_action_verified_creators
  from public, anon, authenticated, service_role;

create function public.fan_action_native_enabled(
  p_action_code integer,
  p_app_user_id uuid,
  p_creator_id uuid
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
  v_enabled := public.fan_action_native_enabled(p_action_code, p_app_user_id);
  if not v_enabled then
    return false;
  end if;

  if p_action_code not in (1, 6, 8, 10) then
    return true;
  end if;

  select route.binding_id
    into v_binding_id
  from public.fan_action_producer_routes route
  where route.action_code = p_action_code;

  return p_creator_id is not null and exists (
    select 1
    from public.fan_action_verified_creators verified
    where verified.binding_id = v_binding_id
      and verified.creator_id = p_creator_id
  );
end;
$$;

-- Replace exactly the three creator-aware route checks and preserve every other
-- byte of their current definitions.
do $$
declare
  target record;
  function_definition text;
  occurrence_count integer;
begin
  for target in
    select * from (values
      (
        'public.submit_owned_quiz_attempt(uuid,uuid,uuid,text,text,text,text)'::regprocedure,
        'public.fan_action_native_enabled(1,p_app_user_id)',
        'public.fan_action_native_enabled(1,p_app_user_id,attempt_record.celebrity_id)'
      ),
      (
        'public.react_to_creator(uuid,uuid,uuid,uuid,text)'::regprocedure,
        'public.fan_action_native_enabled(6,p_app_user_id)',
        'public.fan_action_native_enabled(6,p_app_user_id,p_celebrity_id)'
      ),
      (
        'public.issue_community_stamp(uuid,uuid,public.community_stamp_kind,text)'::regprocedure,
        'public.fan_action_native_enabled(v_action_code,p_app_user_id)',
        'public.fan_action_native_enabled(v_action_code,p_app_user_id,p_celebrity_id)'
      )
    ) as bounded(function_signature, old_call, new_call)
  loop
    function_definition := pg_get_functiondef(target.function_signature);
    occurrence_count := (
      length(function_definition) - length(replace(function_definition, target.old_call, ''))
    ) / length(target.old_call);
    if occurrence_count <> 1 then
      raise exception 'FAN_ACTION_CREATOR_GATE_PRODUCER_SHAPE_CHANGED: % expected one %, found %',
        target.function_signature, target.old_call, occurrence_count;
    end if;
    execute replace(function_definition, target.old_call, target.new_call);
  end loop;
end;
$$;

revoke all on function public.fan_action_native_enabled(integer,uuid,uuid)
  from public, anon, authenticated, service_role;
