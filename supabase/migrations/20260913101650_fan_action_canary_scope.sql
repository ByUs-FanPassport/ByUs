-- Bounds an enabled producer route to explicitly selected actors during canary rollout.
-- An empty scope preserves the existing globally-enabled route behavior.
create table public.fan_action_canary_scope (
  action_code integer not null references public.fan_action_producer_routes(action_code) on delete cascade,
  app_user_id uuid not null references public.app_users(id),
  created_at timestamptz not null default clock_timestamp(),
  primary key (action_code, app_user_id)
);

alter table public.fan_action_canary_scope enable row level security;
revoke all on table public.fan_action_canary_scope from public, anon, authenticated, service_role;

create function public.fan_action_native_enabled(p_action_code integer, p_app_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_enabled boolean;
begin
  if p_action_code not between 1 and 11 then
    raise exception 'FAN_ACTION_INVALID_CODE';
  end if;

  select route.enabled
    into v_enabled
  from public.fan_action_producer_routes route
  where route.action_code = p_action_code
  for update;

  if not coalesce(v_enabled, false) then
    return false;
  end if;

  return not exists (
      select 1 from public.fan_action_canary_scope scope
      where scope.action_code = p_action_code
    ) or (
      p_app_user_id is not null and exists (
        select 1 from public.fan_action_canary_scope scope
        where scope.action_code = p_action_code
          and scope.app_user_id = p_app_user_id
      )
    );
end;
$$;

create function public.configure_fan_action_canary_scope(
  p_action_code integer,
  p_app_user_ids uuid[]
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
  v_requested_count integer;
begin
  if p_action_code not between 1 and 11 then
    raise exception 'FAN_ACTION_INVALID_CODE';
  end if;
  if p_app_user_ids is null or array_position(p_app_user_ids, null::uuid) is not null then
    raise exception 'FAN_ACTION_CANARY_ACTOR_REQUIRED';
  end if;

  select count(*)
    into v_requested_count
  from (select distinct unnest(p_app_user_ids) as app_user_id) actor;

  -- Producers lock their actor before the route. Match that order so a canary
  -- update cannot hold the route while waiting on a producer-owned actor row.
  perform app_user.id
  from public.app_users app_user
  join (select distinct unnest(p_app_user_ids) as app_user_id) actor
    on actor.app_user_id = app_user.id
  order by app_user.id
  for key share of app_user;
  get diagnostics v_count = row_count;
  if v_count <> v_requested_count then
    raise exception 'FAN_ACTION_CANARY_ACTOR_NOT_FOUND';
  end if;

  perform 1
  from public.fan_action_producer_routes route
  where route.action_code = p_action_code
  for update;
  if not found then
    raise exception 'FAN_ACTION_ROUTE_NOT_FOUND';
  end if;

  delete from public.fan_action_canary_scope scope
  where scope.action_code = p_action_code;

  insert into public.fan_action_canary_scope(action_code, app_user_id)
  select p_action_code, actor.app_user_id
  from (
    select distinct unnest(p_app_user_ids) as app_user_id
  ) actor;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- The producer bodies are large and are owned by their source migrations. Replace
-- exactly one known route check in each bounded function, preserving every other byte.
do $$
declare
  target record;
  function_definition text;
  occurrence_count integer;
begin
  for target in
    select * from (values
      ('public.submit_owned_quiz_attempt(uuid,uuid,uuid,text,text,text,text)'::regprocedure, 'public.fan_action_native_enabled(1)', 'public.fan_action_native_enabled(1,p_app_user_id)'),
      ('public.attend_owned_live_event(uuid,text,uuid,text,uuid,text,text)'::regprocedure, 'public.fan_action_native_enabled(3)', 'public.fan_action_native_enabled(3,p_app_user_id)'),
      ('public.reserve_owned_live_event(uuid,uuid,uuid,uuid,text,text)'::regprocedure, 'public.fan_action_native_enabled(2)', 'public.fan_action_native_enabled(2,p_app_user_id)'),
      ('public.submit_owned_live_survey(uuid,text,uuid,jsonb,uuid,text,text)'::regprocedure, 'public.fan_action_native_enabled(5)', 'public.fan_action_native_enabled(5,p_app_user_id)'),
      ('public.submit_owned_live_mission(uuid,uuid,uuid,jsonb,uuid,text,text)'::regprocedure, 'public.fan_action_native_enabled(4)', 'public.fan_action_native_enabled(4,p_app_user_id)'),
      ('public.react_to_creator(uuid,uuid,uuid,uuid,text)'::regprocedure, 'public.fan_action_native_enabled(6)', 'public.fan_action_native_enabled(6,p_app_user_id)'),
      ('public.claim_owned_live_collectible(uuid,text,uuid)'::regprocedure, 'public.fan_action_native_enabled(11)', 'public.fan_action_native_enabled(11,p_app_user_id)'),
      ('public.issue_community_stamp(uuid,uuid,public.community_stamp_kind,text)'::regprocedure, 'public.fan_action_native_enabled(v_action_code)', 'public.fan_action_native_enabled(v_action_code,p_app_user_id)')
    ) as bounded(function_signature, old_call, new_call)
  loop
    function_definition := pg_get_functiondef(target.function_signature);
    occurrence_count := (
      length(function_definition) - length(replace(function_definition, target.old_call, ''))
    ) / length(target.old_call);
    if occurrence_count <> 1 then
      raise exception 'FAN_ACTION_CANARY_PRODUCER_SHAPE_CHANGED: % expected one %, found %',
        target.function_signature, target.old_call, occurrence_count;
    end if;
    execute replace(function_definition, target.old_call, target.new_call);
  end loop;
end;
$$;

revoke all on function public.fan_action_native_enabled(integer,uuid),
  public.configure_fan_action_canary_scope(integer,uuid[])
  from public, anon, authenticated, service_role;
grant execute on function public.configure_fan_action_canary_scope(integer,uuid[]) to service_role;
