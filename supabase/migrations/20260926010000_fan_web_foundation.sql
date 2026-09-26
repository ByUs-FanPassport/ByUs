-- Shared fan-web boundaries. Browser clients never access these relations/RPCs.
create table public.user_blocks (
  id uuid primary key default extensions.gen_random_uuid(),
  app_user_id uuid not null references public.app_users(id) on delete cascade,
  blocked_app_user_id uuid not null references public.app_users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (app_user_id, blocked_app_user_id),
  check (app_user_id <> blocked_app_user_id)
);
create index user_blocks_reverse_idx
  on public.user_blocks(blocked_app_user_id, app_user_id);
alter table public.user_blocks enable row level security;
alter table public.user_blocks force row level security;
revoke all on public.user_blocks from public, anon, authenticated, service_role;

create function public.fan_web_is_member(p_app_user_id uuid, p_celebrity_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.app_users u
    join public.fan_passports p on p.app_user_id = u.id
    where u.id = p_app_user_id and u.status = 'active'
      and p.celebrity_id = p_celebrity_id and p.business_status = 'issued'
  );
$$;

create function public.fan_web_blocked(p_viewer_id uuid, p_author_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.user_blocks b
    where (b.app_user_id = p_viewer_id and b.blocked_app_user_id = p_author_id)
       or (b.app_user_id = p_author_id and b.blocked_app_user_id = p_viewer_id)
  );
$$;

create function public.fan_web_lock_active_user(p_app_user_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_app_user_id is null then
    raise exception 'FAN_WEB_ACTIVE_ACCOUNT_REQUIRED' using errcode = '42501';
  end if;
  -- Shared with deletion/sync. Always take this before feature-specific locks.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('fan-web-user:' || p_app_user_id::text, 0)
  );
  if not exists (
    select 1 from public.app_users where id = p_app_user_id and status = 'active'
  ) then
    raise exception 'FAN_WEB_ACTIVE_ACCOUNT_REQUIRED' using errcode = '42501';
  end if;
end;
$$;

revoke all on function public.fan_web_is_member(uuid,uuid) from public,anon,authenticated;
revoke all on function public.fan_web_blocked(uuid,uuid) from public,anon,authenticated;
revoke all on function public.fan_web_lock_active_user(uuid) from public,anon,authenticated;
grant execute on function public.fan_web_is_member(uuid,uuid) to service_role;
grant execute on function public.fan_web_blocked(uuid,uuid) to service_role;
grant execute on function public.fan_web_lock_active_user(uuid) to service_role;
