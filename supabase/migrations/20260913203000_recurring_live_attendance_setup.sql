-- Allow one explicit attendance setup for a published recurring occurrence.
-- Subsequent window changes continue through the audited reschedule command.

create or replace function public.protect_live_lifecycle_source()
returns trigger language plpgsql set search_path='' as $$
begin
  if tg_op='INSERT' and new.content_status<>'scheduled' then raise exception 'new live events must start scheduled'; end if;
  if tg_op='UPDATE' and new.content_status is distinct from old.content_status then
    raise exception 'live lifecycle changes require an append-only override'; end if;
  if tg_op='UPDATE' and old.ever_published_at is not null and (
    new.reservation_opens_at is distinct from old.reservation_opens_at
    or new.reservation_closes_at is distinct from old.reservation_closes_at
    or new.starts_at is distinct from old.starts_at or new.ends_at is distinct from old.ends_at
    or new.attendance_valid_from is distinct from old.attendance_valid_from
    or new.attendance_valid_until is distinct from old.attendance_valid_until
    or new.schedule_revision is distinct from old.schedule_revision)
    and not (
      current_user=pg_catalog.pg_get_userbyid((select routine.proowner from pg_catalog.pg_proc routine
        where routine.oid='public.reschedule_admin_live(uuid,uuid,uuid,uuid,integer,text,timestamptz,timestamptz,timestamptz,timestamptz,timestamptz,timestamptz)'::regprocedure))
      and pg_catalog.current_setting('byus.live_reschedule_event_id',true) is not distinct from old.id::text
      and new.schedule_revision=old.schedule_revision+1)
    and not (
      old.live_type='recurring' and old.fan_code_hash is null and old.attendance_valid_from is null and old.attendance_valid_until is null
      and new.fan_code_hash is not null and new.attendance_valid_from is not null and new.attendance_valid_until is not null
      and new.reservation_opens_at is not distinct from old.reservation_opens_at
      and new.reservation_closes_at is not distinct from old.reservation_closes_at
      and new.starts_at is not distinct from old.starts_at and new.ends_at is not distinct from old.ends_at
      and new.schedule_revision=old.schedule_revision
      and pg_catalog.current_setting('byus.recurring_attendance_setup_event_id',true) is not distinct from old.id::text)
  then raise exception 'published live schedule is immutable; use the audited reschedule command'; end if;
  return new;
end $$;

alter function public.generate_admin_live_attendance_code(uuid,uuid,uuid,uuid,timestamptz,timestamptz)
  rename to generate_admin_live_attendance_code_before_recurring_live;
create function public.generate_admin_live_attendance_code(
  p_actor_app_user_id uuid,p_actor_admin_allowlist_id uuid,p_correlation_id uuid,p_live_event_id uuid,
  p_valid_from timestamptz,p_valid_until timestamptz
) returns jsonb language plpgsql security definer set search_path='' as $$
declare live_record public.live_events%rowtype; generated_code text; before_safe jsonb;
begin
  perform public.require_live_manager_actor(p_actor_app_user_id,p_actor_admin_allowlist_id,true);
  if p_correlation_id is null or p_valid_from is null or p_valid_until is null or p_valid_from>=p_valid_until then
    raise exception 'invalid attendance code window'; end if;
  select * into live_record from public.live_events where id=p_live_event_id and archived_at is null for update;
  if not found then raise exception 'active live event not found'; end if;
  if live_record.live_type<>'recurring' or live_record.ever_published_at is null
    or live_record.fan_code_hash is not null or live_record.attendance_valid_from is not null or live_record.attendance_valid_until is not null then
    return public.generate_admin_live_attendance_code_before_recurring_live(p_actor_app_user_id,p_actor_admin_allowlist_id,
      p_correlation_id,p_live_event_id,p_valid_from,p_valid_until);
  end if;
  before_safe:=jsonb_build_object('validFrom',null,'validUntil',null,'codeConfigured',false);
  generated_code:=public.generate_attendance_code_value();
  perform pg_catalog.set_config('byus.recurring_attendance_setup_event_id',live_record.id::text,true);
  update public.live_events set fan_code_hash=extensions.crypt(generated_code,extensions.gen_salt('bf',12)),
    attendance_valid_from=p_valid_from,attendance_valid_until=p_valid_until where id=live_record.id;
  insert into public.audit_logs(actor_app_user_id,actor_admin_allowlist_id,action,entity_type,entity_id,before_after_summary,correlation_id)
  values(p_actor_app_user_id,p_actor_admin_allowlist_id,'live.attendance_code.generated','live_event',live_record.id::text,
    jsonb_build_object('before',before_safe,'after',jsonb_build_object('validFrom',p_valid_from,'validUntil',p_valid_until,'codeConfigured',true)),p_correlation_id);
  return jsonb_build_object('fanCode',generated_code,'validFrom',p_valid_from,'validUntil',p_valid_until);
end $$;

revoke all on function public.generate_admin_live_attendance_code_before_recurring_live(uuid,uuid,uuid,uuid,timestamptz,timestamptz)
from public,anon,authenticated,service_role;
revoke all on function public.generate_admin_live_attendance_code(uuid,uuid,uuid,uuid,timestamptz,timestamptz)
from public,anon,authenticated;
grant execute on function public.generate_admin_live_attendance_code(uuid,uuid,uuid,uuid,timestamptz,timestamptz) to service_role;
revoke all on function public.protect_live_lifecycle_source() from public,anon,authenticated,service_role;
