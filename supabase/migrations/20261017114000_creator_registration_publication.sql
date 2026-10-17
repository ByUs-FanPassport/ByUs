-- A public fanpage must already be admitted by every enabled v2 creator route.
create function public.guard_creator_registration_publication()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then
    if new.slug is distinct from old.slug and exists (
      select 1 from public.fan_action_verified_creators where creator_id = old.id
    ) then
      raise exception 'celebrity slug is immutable after on-chain registration' using errcode = '23514';
    end if;
    if old.status = 'published' then return new; end if;
  end if;
  if new.status <> 'published' then return new; end if;

  -- Keep a concurrent route cutover from invalidating this publication check.
  lock table public.fan_action_producer_routes in share mode;
  lock table public.fan_action_bindings in share mode;
  if exists (
    select 1
    from public.fan_action_producer_routes route
    join public.fan_action_bindings binding on binding.id = route.binding_id
    where route.action_code in (1, 6, 8, 10) and route.enabled and binding.binding_version >= 2
      and not exists (
        select 1 from public.fan_action_verified_creators verified
        where verified.binding_id = route.binding_id and verified.creator_id = new.id
      )
  ) then
    raise exception 'celebrity publication requires completed on-chain registration' using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_creator_registration_publication()
  from public, anon, authenticated, service_role;

create trigger celebrities_registration_publication_guard
before insert or update of status, slug on public.celebrities
for each row execute function public.guard_creator_registration_publication();
