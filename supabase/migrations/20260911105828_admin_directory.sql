-- Service-only administrator directory. Every RPC mutation is serialized so
-- actor authorization and the final active-admin invariant are checked together.

-- A timestamp is the optimistic-concurrency token. Unlike transaction-level
-- now(), this remains strictly monotonic when a caller performs more than one
-- directory update in the same transaction.
create or replace function public.set_admin_allowlist_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = greatest(
    pg_catalog.clock_timestamp(),
    old.updated_at + interval '1 microsecond'
  );
  return new;
end;
$$;

drop trigger if exists admin_allowlist_set_updated_at on public.admin_allowlist;
create trigger admin_allowlist_set_updated_at
before update on public.admin_allowlist
for each row execute function public.set_admin_allowlist_updated_at();

create or replace function public.assert_admin_directory_actor(
  p_actor_app_user_id uuid,
  p_actor_admin_allowlist_id uuid
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if p_actor_app_user_id is null or p_actor_admin_allowlist_id is null then
    raise exception 'ADMIN_DIRECTORY_FORBIDDEN' using errcode = 'P0001';
  end if;

  perform 1
  from public.admin_allowlist allowlist
  join public.app_users app_user
    on app_user.id = p_actor_app_user_id
   and app_user.verified_email = allowlist.email
  where allowlist.id = p_actor_admin_allowlist_id
    and allowlist.active
    and allowlist.role = 'admin'
    and app_user.status = 'active'
  for share of allowlist, app_user;

  if not found then
    raise exception 'ADMIN_DIRECTORY_FORBIDDEN' using errcode = 'P0001';
  end if;
end;
$$;

create or replace function public.read_admin_directory(
  p_actor_app_user_id uuid,
  p_actor_admin_allowlist_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_items jsonb;
begin
  perform pg_catalog.pg_advisory_xact_lock_shared(5215997671129202561);
  perform public.assert_admin_directory_actor(
    p_actor_app_user_id,
    p_actor_admin_allowlist_id
  );

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', allowlist.id,
        'email', allowlist.email,
        'role', allowlist.role,
        'active', allowlist.active,
        'createdAt', allowlist.created_at,
        'updatedAt', allowlist.updated_at
      )
      order by allowlist.email, allowlist.id
    ),
    '[]'::jsonb
  )
  into v_items
  from public.admin_allowlist allowlist;

  return jsonb_build_object(
    'items', v_items,
    'actorId', p_actor_admin_allowlist_id
  );
end;
$$;

create or replace function public.create_admin_directory_entry(
  p_actor_app_user_id uuid,
  p_actor_admin_allowlist_id uuid,
  p_correlation_id uuid,
  p_email text,
  p_role public.admin_role
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_email text;
  v_created public.admin_allowlist%rowtype;
  v_item jsonb;
begin
  perform pg_catalog.pg_advisory_xact_lock(5215997671129202561);
  perform public.assert_admin_directory_actor(
    p_actor_app_user_id,
    p_actor_admin_allowlist_id
  );

  if p_correlation_id is null or p_email is null or p_role is null then
    raise exception 'ADMIN_DIRECTORY_INVALID_INPUT' using errcode = 'P0001';
  end if;

  v_email := pg_catalog.lower(pg_catalog.btrim(p_email));
  if v_email = ''
     or pg_catalog.length(v_email) > 254
     or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'ADMIN_DIRECTORY_INVALID_INPUT' using errcode = 'P0001';
  end if;

  begin
    insert into public.admin_allowlist (
      email,
      role,
      active,
      created_by_app_user_id
    ) values (
      v_email,
      p_role,
      true,
      p_actor_app_user_id
    )
    returning * into v_created;
  exception
    when unique_violation then
      raise exception 'ADMIN_DIRECTORY_DUPLICATE_EMAIL' using errcode = 'P0001';
  end;

  v_item := jsonb_build_object(
    'id', v_created.id,
    'email', v_created.email,
    'role', v_created.role,
    'active', v_created.active,
    'createdAt', v_created.created_at,
    'updatedAt', v_created.updated_at
  );

  insert into public.audit_logs (
    actor_app_user_id,
    actor_admin_allowlist_id,
    action,
    entity_type,
    entity_id,
    before_after_summary,
    correlation_id
  ) values (
    p_actor_app_user_id,
    p_actor_admin_allowlist_id,
    'admin_directory.created',
    'admin_allowlist',
    v_created.id::text,
    jsonb_build_object(
      'before', null,
      'after', jsonb_build_object(
        'id', v_created.id,
        'role', v_created.role,
        'active', v_created.active
      )
    ),
    p_correlation_id
  );

  return v_item;
end;
$$;

create or replace function public.update_admin_directory_entry(
  p_actor_app_user_id uuid,
  p_actor_admin_allowlist_id uuid,
  p_correlation_id uuid,
  p_id uuid,
  p_role public.admin_role,
  p_active boolean,
  p_expected_updated_at timestamptz
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_before public.admin_allowlist%rowtype;
  v_after public.admin_allowlist%rowtype;
  v_item jsonb;
begin
  perform pg_catalog.pg_advisory_xact_lock(5215997671129202561);
  perform public.assert_admin_directory_actor(
    p_actor_app_user_id,
    p_actor_admin_allowlist_id
  );

  if p_correlation_id is null or p_id is null or p_role is null
     or p_active is null or p_expected_updated_at is null
     or not pg_catalog.isfinite(p_expected_updated_at) then
    raise exception 'ADMIN_DIRECTORY_INVALID_INPUT' using errcode = 'P0001';
  end if;

  select * into v_before
  from public.admin_allowlist allowlist
  where allowlist.id = p_id
  for update;

  if not found then
    raise exception 'ADMIN_DIRECTORY_NOT_FOUND' using errcode = 'P0001';
  end if;

  if v_before.updated_at is distinct from p_expected_updated_at then
    raise exception 'ADMIN_DIRECTORY_CONFLICT' using errcode = 'P0001';
  end if;

  if p_id = p_actor_admin_allowlist_id
     and (p_role <> 'admin' or not p_active) then
    raise exception 'ADMIN_DIRECTORY_SELF_CHANGE' using errcode = 'P0001';
  end if;

  if v_before.active and v_before.role = 'admin'
     and (not p_active or p_role <> 'admin')
     and (select count(*) from public.admin_allowlist where active and role = 'admin') <= 1 then
    raise exception 'ADMIN_DIRECTORY_LAST_ADMIN' using errcode = 'P0001';
  end if;

  if v_before.role = p_role and v_before.active = p_active then
    return jsonb_build_object(
      'id', v_before.id,
      'email', v_before.email,
      'role', v_before.role,
      'active', v_before.active,
      'createdAt', v_before.created_at,
      'updatedAt', v_before.updated_at
    );
  end if;

  update public.admin_allowlist
  set role = p_role,
      active = p_active
  where id = p_id
  returning * into v_after;

  v_item := jsonb_build_object(
    'id', v_after.id,
    'email', v_after.email,
    'role', v_after.role,
    'active', v_after.active,
    'createdAt', v_after.created_at,
    'updatedAt', v_after.updated_at
  );

  insert into public.audit_logs (
    actor_app_user_id,
    actor_admin_allowlist_id,
    action,
    entity_type,
    entity_id,
    before_after_summary,
    correlation_id
  ) values (
    p_actor_app_user_id,
    p_actor_admin_allowlist_id,
    'admin_directory.updated',
    'admin_allowlist',
    v_after.id::text,
    jsonb_build_object(
      'before', jsonb_build_object(
        'id', v_before.id,
        'role', v_before.role,
        'active', v_before.active
      ),
      'after', jsonb_build_object(
        'id', v_after.id,
        'role', v_after.role,
        'active', v_after.active
      )
    ),
    p_correlation_id
  );

  return v_item;
end;
$$;

-- The server may still read allowlist rows for its existing authorization
-- checks, but all directory mutation must pass through the guarded RPCs.
revoke insert, update, delete on public.admin_allowlist from service_role;

revoke all on function public.assert_admin_directory_actor(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.set_admin_allowlist_updated_at()
  from public, anon, authenticated, service_role;

revoke all on function public.read_admin_directory(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.read_admin_directory(uuid, uuid)
  to service_role;

revoke all on function public.create_admin_directory_entry(uuid, uuid, uuid, text, public.admin_role)
  from public, anon, authenticated;
grant execute on function public.create_admin_directory_entry(uuid, uuid, uuid, text, public.admin_role)
  to service_role;

revoke all on function public.update_admin_directory_entry(uuid, uuid, uuid, uuid, public.admin_role, boolean, timestamptz)
  from public, anon, authenticated;
grant execute on function public.update_admin_directory_entry(uuid, uuid, uuid, uuid, public.admin_role, boolean, timestamptz)
  to service_role;

comment on function public.read_admin_directory(uuid, uuid) is
  'Service-role-only administrator directory. The active admin actor and matching active app user are rechecked under the directory lock.';
comment on function public.create_admin_directory_entry(uuid, uuid, uuid, text, public.admin_role) is
  'Creates a normalized allowlist entry and an atomic PII-minimized audit record after serial actor authorization.';
comment on function public.update_admin_directory_entry(uuid, uuid, uuid, uuid, public.admin_role, boolean, timestamptz) is
  'Updates role or active access with optimistic concurrency, self-change prevention, final-admin protection, and atomic audit.';
