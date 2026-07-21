-- G5 / ADM-012: immutable, service-only audit-log read model.
-- Raw audit evidence remains private. The only supported read surface returns
-- recursively redacted summaries after re-checking an active administrator.

create or replace function public.reject_audit_log_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'audit logs are append-only';
end;
$$;

drop trigger if exists audit_logs_reject_update_delete on public.audit_logs;
create trigger audit_logs_reject_update_delete
before update or delete on public.audit_logs
for each row execute function public.reject_audit_log_mutation();

drop trigger if exists audit_logs_reject_truncate on public.audit_logs;
create trigger audit_logs_reject_truncate
before truncate on public.audit_logs
for each statement execute function public.reject_audit_log_mutation();

revoke update, delete, truncate on public.audit_logs from public, anon, authenticated, service_role;
grant select, insert on public.audit_logs to service_role;

create index if not exists audit_logs_stable_page_idx
  on public.audit_logs (created_at desc, id desc);
create index if not exists audit_logs_entity_page_idx
  on public.audit_logs (entity_type, entity_id, created_at desc, id desc);
create index if not exists audit_logs_correlation_page_idx
  on public.audit_logs (correlation_id, created_at desc, id desc);

create or replace function public.redact_audit_summary(value jsonb)
returns jsonb
language plpgsql
immutable
strict
set search_path = ''
as $$
declare
  kind text := jsonb_typeof(value);
  item record;
  output jsonb;
  scalar text;
begin
  if kind = 'object' then
    output := '{}'::jsonb;
    for item in
      select entry.key, entry.entry_value
      from jsonb_each(value) as entry(key, entry_value)
    loop
      if lower(item.key) ~ '(email|e_mail|wallet|address|token|authorization|bearer|jwt|secret|password|api[_-]?key|((fan|benefit|reward|unique|shared|voucher|claim|delivery).*(code|value)|(code|value).*(fan|benefit|reward|unique|shared|voucher|claim|delivery))|^code$|quiz.*(answer|correct|option)|(answer|correct|selected).*(answer|correct|option)|^answer$)' then
        output := output || jsonb_build_object(item.key, '[REDACTED]');
      else
        output := output || jsonb_build_object(item.key, public.redact_audit_summary(item.entry_value));
      end if;
    end loop;
    return output;
  elsif kind = 'array' then
    select coalesce(jsonb_agg(public.redact_audit_summary(element) order by ordinal), '[]'::jsonb)
      into output
    from jsonb_array_elements(value) with ordinality as values_(element, ordinal);
    return output;
  elsif kind = 'string' then
    scalar := value #>> '{}';
    if scalar ~* '[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+'
       or scalar ~* '0x[0-9a-f]{40}'
       or scalar ~ '(^|[^1-9A-HJ-NP-Za-km-z])[1-9A-HJ-NP-Za-km-z]{32,44}($|[^1-9A-HJ-NP-Za-km-z])' then
      return to_jsonb('[REDACTED]'::text);
    end if;
  end if;
  return value;
end;
$$;

create or replace function public.read_admin_audit_logs(
  p_actor_admin_allowlist_id uuid,
  p_limit integer default 50,
  p_cursor_created_at timestamptz default null,
  p_cursor_id bigint default null,
  p_actor_id uuid default null,
  p_entity_type text default null,
  p_entity_id text default null,
  p_action text default null,
  p_result text default null,
  p_created_from timestamptz default null,
  p_created_to timestamptz default null,
  p_correlation_id uuid default null
)
returns table (
  id text,
  actor_type text,
  actor_id uuid,
  actor_role public.admin_role,
  action text,
  entity_type text,
  entity_id text,
  result text,
  summary jsonb,
  correlation_id uuid,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  safe_limit integer;
  verified_role public.admin_role;
begin
  select allowlist.role
    into verified_role
  from public.admin_allowlist allowlist
  where allowlist.id = p_actor_admin_allowlist_id
    and allowlist.active = true
  for share;

  if verified_role is null then
    raise exception 'active administrator is required';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 100 then
    raise exception 'audit page limit must be between 1 and 100';
  end if;
  if (p_cursor_created_at is null) <> (p_cursor_id is null) then
    raise exception 'audit cursor is incomplete';
  end if;
  if p_created_from is not null and p_created_to is not null and p_created_from > p_created_to then
    raise exception 'audit time range is invalid';
  end if;

  safe_limit := p_limit;
  return query
  select
    logs.id::text,
    case
      when logs.actor_admin_allowlist_id is not null then 'admin'
      when logs.actor_app_user_id is not null then 'app_user'
      else 'system'
    end,
    coalesce(logs.actor_admin_allowlist_id, logs.actor_app_user_id, logs.actor_admin_id),
    actor.role,
    logs.action,
    logs.entity_type,
    logs.entity_id,
    coalesce(redacted.value ->> 'result', redacted.value ->> 'outcome'),
    case
      when jsonb_typeof(redacted.value) = 'object' then redacted.value
      else jsonb_build_object('value', redacted.value)
    end,
    logs.correlation_id,
    logs.created_at
  from public.audit_logs logs
  left join public.admin_allowlist actor on actor.id = logs.actor_admin_allowlist_id
  cross join lateral (select public.redact_audit_summary(logs.before_after_summary) as value) redacted
  where (p_cursor_created_at is null or (logs.created_at, logs.id) < (p_cursor_created_at, p_cursor_id))
    and (p_actor_id is null or p_actor_id in (logs.actor_admin_allowlist_id, logs.actor_app_user_id, logs.actor_admin_id))
    and (p_entity_type is null or logs.entity_type = p_entity_type)
    and (p_entity_id is null or logs.entity_id = p_entity_id)
    and (p_action is null or logs.action = p_action)
    and (p_result is null or coalesce(redacted.value ->> 'result', redacted.value ->> 'outcome') = p_result)
    and (p_created_from is null or logs.created_at >= p_created_from)
    and (p_created_to is null or logs.created_at < p_created_to)
    and (p_correlation_id is null or logs.correlation_id = p_correlation_id)
  order by logs.created_at desc, logs.id desc
  limit safe_limit;
end;
$$;

revoke all on function public.reject_audit_log_mutation() from public, anon, authenticated, service_role;
revoke all on function public.redact_audit_summary(jsonb) from public, anon, authenticated;
grant execute on function public.redact_audit_summary(jsonb) to service_role;
revoke all on function public.read_admin_audit_logs(uuid, integer, timestamptz, bigint, uuid, text, text, text, text, timestamptz, timestamptz, uuid)
  from public, anon, authenticated;
grant execute on function public.read_admin_audit_logs(uuid, integer, timestamptz, bigint, uuid, text, text, text, text, timestamptz, timestamptz, uuid)
  to service_role;

comment on function public.read_admin_audit_logs(uuid, integer, timestamptz, bigint, uuid, text, text, text, text, timestamptz, timestamptz, uuid) is
  'ADM-012 stable cursor audit feed. Service-role only; active admin is rechecked and summaries are recursively redacted.';
