-- G5 content lifecycle: published or referenced content is archived, never
-- hard-deleted. Only never-published, unreferenced drafts may be removed.

alter table public.celebrities
  add column ever_published_at timestamptz,
  add column archived_at timestamptz,
  add column archived_by_admin_allowlist_id uuid
    references public.admin_allowlist(id) on delete restrict,
  add column archive_reason text,
  add constraint celebrities_archive_shape check (
    (archived_at is not null
      and archived_by_admin_allowlist_id is not null
      and length(trim(archive_reason)) between 10 and 1000)
    or (archived_at is null
      and archived_by_admin_allowlist_id is null
      and archive_reason is null)
  );

alter table public.brands
  add column ever_published_at timestamptz,
  add column archived_at timestamptz,
  add column archived_by_admin_allowlist_id uuid
    references public.admin_allowlist(id) on delete restrict,
  add column archive_reason text,
  add constraint brands_archive_shape check (
    (archived_at is not null
      and archived_by_admin_allowlist_id is not null
      and length(trim(archive_reason)) between 10 and 1000)
    or (archived_at is null
      and archived_by_admin_allowlist_id is null
      and archive_reason is null)
  );

alter table public.live_events
  add column ever_published_at timestamptz,
  add column archived_at timestamptz,
  add column archived_by_admin_allowlist_id uuid
    references public.admin_allowlist(id) on delete restrict,
  add column archive_reason text,
  add constraint live_events_archive_shape check (
    (archived_at is not null
      and archived_by_admin_allowlist_id is not null
      and length(trim(archive_reason)) between 10 and 1000)
    or (archived_at is null
      and archived_by_admin_allowlist_id is null
      and archive_reason is null)
  );

alter table public.benefits
  add column ever_published_at timestamptz,
  add column archived_at timestamptz,
  add column archived_by_admin_allowlist_id uuid
    references public.admin_allowlist(id) on delete restrict,
  add column archive_reason text,
  add constraint benefits_archive_shape check (
    (archived_at is not null
      and archived_by_admin_allowlist_id is not null
      and length(trim(archive_reason)) between 10 and 1000)
    or (archived_at is null
      and archived_by_admin_allowlist_id is null
      and archive_reason is null)
  );

update public.celebrities set ever_published_at = published_at where published_at is not null;
update public.brands set ever_published_at = published_at where published_at is not null;
update public.live_events set ever_published_at = published_at where published_at is not null;
update public.benefits set ever_published_at = published_at where published_at is not null;

create function public.enforce_content_lifecycle()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  old_status public.content_status;
  new_status public.content_status;
begin
  if tg_op = 'DELETE' then
    if current_user <> 'postgres' then
      raise exception 'content hard delete requires the lifecycle command';
    end if;
    return old;
  end if;

  if tg_table_name in ('celebrities', 'brands') then
    old_status := old.status;
    new_status := new.status;
  else
    old_status := old.publication_status;
    new_status := new.publication_status;
  end if;

  if old.ever_published_at is not null
     and new.ever_published_at is distinct from old.ever_published_at then
    raise exception 'first publication evidence is immutable';
  end if;

  if old.ever_published_at is null
     and new.ever_published_at is not null
     and new_status <> 'published' then
    raise exception 'first publication evidence requires a publication transition';
  end if;

  if old.ever_published_at is null and new_status = 'published' then
    new.ever_published_at := coalesce(new.published_at, now());
  end if;

  if old.archived_at is not null then
    raise exception 'archived content is immutable';
  end if;

  if old.archived_at is null and new.archived_at is not null and current_user <> 'postgres' then
    raise exception 'content archive requires the lifecycle command';
  end if;

  if old.archived_at is not null and new.archived_at is null then
    raise exception 'archive evidence is immutable';
  end if;

  return new;
end;
$$;

create trigger celebrities_enforce_lifecycle
before update or delete on public.celebrities
for each row execute function public.enforce_content_lifecycle();
create trigger brands_enforce_lifecycle
before update or delete on public.brands
for each row execute function public.enforce_content_lifecycle();
create trigger live_events_enforce_lifecycle
before update or delete on public.live_events
for each row execute function public.enforce_content_lifecycle();
create trigger benefits_enforce_lifecycle
before update or delete on public.benefits
for each row execute function public.enforce_content_lifecycle();

create function public.require_content_lifecycle_actor(
  p_actor_admin_allowlist_id uuid,
  p_hard_delete boolean default false
)
returns public.admin_allowlist
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor public.admin_allowlist%rowtype;
begin
  select * into actor
  from public.admin_allowlist allowlist
  where allowlist.id = p_actor_admin_allowlist_id
    and allowlist.active
    and (
      (not p_hard_delete and allowlist.role in ('admin', 'operator'))
      or (p_hard_delete and allowlist.role = 'admin')
    )
  for update;

  if not found then
    raise exception 'active authorized lifecycle administrator required';
  end if;
  return actor;
end;
$$;

create function public.archive_admin_content(
  p_entity_type text,
  p_entity_id uuid,
  p_actor_admin_allowlist_id uuid,
  p_reason text,
  p_correlation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  before_row jsonb;
  after_row jsonb;
  normalized_reason text := trim(p_reason);
begin
  perform public.require_content_lifecycle_actor(p_actor_admin_allowlist_id, false);
  if p_correlation_id is null then raise exception 'correlation id is required'; end if;
  if normalized_reason is null or length(normalized_reason) not between 10 and 1000 then
    raise exception 'archive reason must be between 10 and 1000 characters';
  end if;

  case p_entity_type
    when 'celebrity' then
      select to_jsonb(row) into before_row from public.celebrities row where id = p_entity_id for update;
      if before_row is null then raise exception 'content not found'; end if;
      update public.celebrities set status = 'draft', archived_at = now(),
        archived_by_admin_allowlist_id = p_actor_admin_allowlist_id, archive_reason = normalized_reason
      where id = p_entity_id returning to_jsonb(celebrities.*) into after_row;
    when 'brand' then
      select to_jsonb(row) into before_row from public.brands row where id = p_entity_id for update;
      if before_row is null then raise exception 'content not found'; end if;
      update public.brands set status = 'draft', archived_at = now(),
        archived_by_admin_allowlist_id = p_actor_admin_allowlist_id, archive_reason = normalized_reason
      where id = p_entity_id returning to_jsonb(brands.*) into after_row;
    when 'live_event' then
      select to_jsonb(row) into before_row from public.live_events row where id = p_entity_id for update;
      if before_row is null then raise exception 'content not found'; end if;
      update public.live_events set publication_status = 'draft', archived_at = now(),
        archived_by_admin_allowlist_id = p_actor_admin_allowlist_id, archive_reason = normalized_reason
      where id = p_entity_id returning to_jsonb(live_events.*) into after_row;
    when 'benefit' then
      select to_jsonb(row) into before_row from public.benefits row where id = p_entity_id for update;
      if before_row is null then raise exception 'content not found'; end if;
      update public.benefits set publication_status = 'draft', archived_at = now(),
        archived_by_admin_allowlist_id = p_actor_admin_allowlist_id, archive_reason = normalized_reason
      where id = p_entity_id returning to_jsonb(benefits.*) into after_row;
    else raise exception 'unsupported lifecycle entity type';
  end case;

  insert into public.audit_logs (
    actor_admin_allowlist_id, action, entity_type, entity_id,
    before_after_summary, correlation_id
  ) values (
    p_actor_admin_allowlist_id, 'content.archived', p_entity_type, p_entity_id::text,
    jsonb_build_object(
      'beforeStatus', coalesce(before_row->>'status', before_row->>'publication_status'),
      'afterStatus', 'archived',
      'reason', normalized_reason,
      'everPublishedAt', after_row->'ever_published_at'
    ), p_correlation_id
  );
  return after_row;
end;
$$;

create function public.hard_delete_admin_content(
  p_entity_type text,
  p_entity_id uuid,
  p_actor_admin_allowlist_id uuid,
  p_reason text,
  p_correlation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_row jsonb;
  normalized_reason text := trim(p_reason);
begin
  perform public.require_content_lifecycle_actor(p_actor_admin_allowlist_id, true);
  if p_correlation_id is null then raise exception 'correlation id is required'; end if;
  if normalized_reason is null or length(normalized_reason) not between 10 and 1000 then
    raise exception 'deletion reason must be between 10 and 1000 characters';
  end if;

  case p_entity_type
    when 'celebrity' then
      select to_jsonb(row) into target_row from public.celebrities row where id = p_entity_id for update;
      if target_row is not null and (
        target_row->>'status' <> 'draft' or target_row->>'ever_published_at' is not null
        or exists (select 1 from public.celebrity_quizzes where celebrity_id = p_entity_id)
        or exists (select 1 from public.fan_passports where celebrity_id = p_entity_id)
        or exists (select 1 from public.live_events where celebrity_id = p_entity_id)
        or exists (select 1 from public.benefits where celebrity_id = p_entity_id)
      ) then raise exception 'published or referenced content must be archived'; end if;
      delete from public.celebrities where id = p_entity_id;
    when 'brand' then
      select to_jsonb(row) into target_row from public.brands row where id = p_entity_id for update;
      if target_row is not null and (
        target_row->>'status' <> 'draft' or target_row->>'ever_published_at' is not null
        or exists (select 1 from public.live_events where brand_id = p_entity_id)
      ) then raise exception 'published or referenced content must be archived'; end if;
      delete from public.brands where id = p_entity_id;
    when 'live_event' then
      select to_jsonb(row) into target_row from public.live_events row where id = p_entity_id for update;
      if target_row is not null and (
        target_row->>'publication_status' <> 'draft' or target_row->>'ever_published_at' is not null
        or exists (select 1 from public.live_status_overrides where live_event_id = p_entity_id)
        or exists (select 1 from public.live_reservations where live_event_id = p_entity_id)
        or exists (select 1 from public.live_attendances where live_event_id = p_entity_id)
      ) then raise exception 'published or referenced content must be archived'; end if;
      delete from public.live_events where id = p_entity_id;
    when 'benefit' then
      select to_jsonb(row) into target_row from public.benefits row where id = p_entity_id for update;
      if target_row is not null and (
        target_row->>'publication_status' <> 'draft' or target_row->>'ever_published_at' is not null
        or exists (select 1 from public.benefit_claims where benefit_id = p_entity_id)
        or exists (select 1 from public.benefit_delivery_vault where benefit_id = p_entity_id)
        or exists (select 1 from public.benefit_unique_codes where benefit_id = p_entity_id)
      ) then raise exception 'published or referenced content must be archived'; end if;
      delete from public.benefits where id = p_entity_id;
    else raise exception 'unsupported lifecycle entity type';
  end case;

  if target_row is null then raise exception 'content not found'; end if;
  insert into public.audit_logs (
    actor_admin_allowlist_id, action, entity_type, entity_id,
    before_after_summary, correlation_id
  ) values (
    p_actor_admin_allowlist_id, 'content.draft_deleted', p_entity_type, p_entity_id::text,
    jsonb_build_object('beforeStatus', 'draft', 'reason', normalized_reason),
    p_correlation_id
  );
  return jsonb_build_object('id', p_entity_id, 'entityType', p_entity_type, 'deleted', true);
exception
  when foreign_key_violation then
    raise exception 'published or referenced content must be archived';
end;
$$;

revoke delete on public.celebrities, public.brands, public.live_events, public.benefits
  from public, anon, authenticated, service_role;
revoke all on function public.enforce_content_lifecycle() from public, anon, authenticated, service_role;
revoke all on function public.require_content_lifecycle_actor(uuid, boolean)
  from public, anon, authenticated, service_role;
revoke all on function public.archive_admin_content(text, uuid, uuid, text, uuid)
  from public, anon, authenticated;
revoke all on function public.hard_delete_admin_content(text, uuid, uuid, text, uuid)
  from public, anon, authenticated;
grant execute on function public.archive_admin_content(text, uuid, uuid, text, uuid) to service_role;
grant execute on function public.hard_delete_admin_content(text, uuid, uuid, text, uuid) to service_role;

comment on function public.archive_admin_content(text, uuid, uuid, text, uuid) is
  'Only supported archive command for Celebrity, Brand, Live Event, and Benefit records.';
comment on function public.hard_delete_admin_content(text, uuid, uuid, text, uuid) is
  'Deletes only never-published, unreferenced drafts after active-admin authorization.';
