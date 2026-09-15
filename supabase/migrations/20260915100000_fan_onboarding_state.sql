-- Account-wide first-use onboarding state. Completion is derived from canonical
-- owner records; only profile completion needs a monotonic snapshot because the
-- immutable profile may be removed when an account is deleted.

create table public.fan_onboarding_states (
  app_user_id uuid primary key references public.app_users(id) on delete cascade,
  profile_completed boolean not null default false,
  dismissed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.fan_onboarding_states enable row level security;
alter table public.fan_onboarding_states force row level security;
revoke all on public.fan_onboarding_states from public, anon, authenticated, service_role;

create or replace function public.read_owned_onboarding_state(
  p_app_user_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_profile_completed boolean;
  v_dismissed boolean;
begin
  if p_app_user_id is null or not exists (
    select 1
    from public.app_users users
    where users.id = p_app_user_id
      and users.status = 'active'
  ) then
    raise exception 'ONBOARDING_USER_UNAVAILABLE' using errcode = '42501';
  end if;

  v_profile_completed := exists (
    select 1
    from public.user_profiles profiles
    where profiles.app_user_id = p_app_user_id
      and pg_catalog.btrim(profiles.nickname) <> ''
  );

  if v_profile_completed then
    insert into public.fan_onboarding_states (
      app_user_id,
      profile_completed
    ) values (
      p_app_user_id,
      true
    )
    on conflict (app_user_id) do update
      set profile_completed = true,
          updated_at = pg_catalog.now()
      where not public.fan_onboarding_states.profile_completed;
  end if;

  select
    coalesce(states.profile_completed, false),
    coalesce(states.dismissed, false)
  into v_profile_completed, v_dismissed
  from (select 1) seed
  left join public.fan_onboarding_states states
    on states.app_user_id = p_app_user_id;

  return pg_catalog.jsonb_build_object(
    'completed', pg_catalog.jsonb_build_object(
      'profile', v_profile_completed,
      'verify', exists (
        select 1
        from public.fan_passports passports
        where passports.app_user_id = p_app_user_id
      ),
      'reserve', exists (
        select 1
        from public.live_reservations reservations
        where reservations.app_user_id = p_app_user_id
      )
    ),
    'dismissed', v_dismissed
  );
end;
$$;

create or replace function public.dismiss_owned_onboarding(
  p_app_user_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_profile_completed boolean;
begin
  if p_app_user_id is null or not exists (
    select 1
    from public.app_users users
    where users.id = p_app_user_id
      and users.status = 'active'
  ) then
    raise exception 'ONBOARDING_USER_UNAVAILABLE' using errcode = '42501';
  end if;

  v_profile_completed := exists (
    select 1
    from public.user_profiles profiles
    where profiles.app_user_id = p_app_user_id
      and pg_catalog.btrim(profiles.nickname) <> ''
  );

  insert into public.fan_onboarding_states (
    app_user_id,
    profile_completed,
    dismissed
  ) values (
    p_app_user_id,
    v_profile_completed,
    true
  )
  on conflict (app_user_id) do update
    set profile_completed = public.fan_onboarding_states.profile_completed
          or excluded.profile_completed,
        dismissed = true,
        updated_at = pg_catalog.now()
  returning profile_completed into v_profile_completed;

  return pg_catalog.jsonb_build_object(
    'completed', pg_catalog.jsonb_build_object(
      'profile', v_profile_completed,
      'verify', exists (
        select 1
        from public.fan_passports passports
        where passports.app_user_id = p_app_user_id
      ),
      'reserve', exists (
        select 1
        from public.live_reservations reservations
        where reservations.app_user_id = p_app_user_id
      )
    ),
    'dismissed', true
  );
end;
$$;

revoke all on function public.read_owned_onboarding_state(uuid)
  from public, anon, authenticated;
revoke all on function public.dismiss_owned_onboarding(uuid)
  from public, anon, authenticated;
grant execute on function public.read_owned_onboarding_state(uuid) to service_role;
grant execute on function public.dismiss_owned_onboarding(uuid) to service_role;
