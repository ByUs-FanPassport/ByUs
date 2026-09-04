-- Phase 2 attendance configuration: server-generated one-time codes, explicit
-- validity windows, and the canonical Ticket reward in the attendance transaction.

alter table public.live_events
  add column attendance_valid_from timestamptz,
  add column attendance_valid_until timestamptz;

-- Archived LIVE rows are immutable to application writes, but schema backfills
-- still need to populate new required columns. Keep the lifecycle trigger
-- disabled only for this transactional backfill and restore it immediately.
alter table public.live_events disable trigger live_events_enforce_lifecycle;
update public.live_events
set attendance_valid_from = starts_at,
    attendance_valid_until = ends_at;
alter table public.live_events enable trigger live_events_enforce_lifecycle;

-- Flush deferred content-integrity triggers before changing column nullability.
set constraints all immediate;

alter table public.live_events
  alter column attendance_valid_from set not null,
  alter column attendance_valid_until set not null,
  add constraint live_events_attendance_window_valid
    check (attendance_valid_from < attendance_valid_until);

create function public.default_live_attendance_window()
returns trigger language plpgsql set search_path='' as $$
begin
  new.attendance_valid_from := coalesce(new.attendance_valid_from,new.starts_at);
  new.attendance_valid_until := coalesce(new.attendance_valid_until,new.ends_at);
  return new;
end $$;
create trigger live_events_default_attendance_window before insert on public.live_events
for each row execute function public.default_live_attendance_window();

create function public.generate_attendance_code_value()
returns text language plpgsql volatile set search_path='' as $$
declare result text := ''; sample integer;
begin
  while length(result) < 6 loop
    sample := get_byte(extensions.gen_random_bytes(1), 0);
    -- 252 is the largest multiple of 36 below 256; rejection avoids modulo bias.
    if sample < 252 then
      result := result || substr('ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', (sample % 36) + 1, 1);
    end if;
  end loop;
  return result;
end $$;

create function public.save_admin_live_draft_v2(
  p_actor_app_user_id uuid, p_actor_admin_allowlist_id uuid,
  p_correlation_id uuid, p_live_event_id uuid, p_slug text,
  p_celebrity_id uuid, p_brand_id uuid,
  p_starts_at timestamptz, p_ends_at timestamptz,
  p_reservation_opens_at timestamptz, p_reservation_closes_at timestamptz,
  p_youtube_url text, p_hero_url text,
  p_title_ko text, p_summary_ko text, p_hero_alt_ko text,
  p_title_en text, p_summary_en text, p_hero_alt_en text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare target_id uuid; generated_code text;
begin
  if p_live_event_id is null then
    generated_code := public.generate_attendance_code_value();
  end if;
  target_id := public.save_admin_live_draft(
    p_actor_app_user_id,p_actor_admin_allowlist_id,p_correlation_id,p_live_event_id,p_slug,
    p_celebrity_id,p_brand_id,p_starts_at,p_ends_at,p_reservation_opens_at,
    p_reservation_closes_at,p_youtube_url,p_hero_url,generated_code,
    p_title_ko,p_summary_ko,p_hero_alt_ko,p_title_en,p_summary_en,p_hero_alt_en
  );
  return jsonb_strip_nulls(jsonb_build_object('id',target_id,'fanCode',generated_code));
end $$;

create function public.generate_admin_live_attendance_code(
  p_actor_app_user_id uuid, p_actor_admin_allowlist_id uuid,
  p_correlation_id uuid, p_live_event_id uuid,
  p_valid_from timestamptz, p_valid_until timestamptz
) returns jsonb language plpgsql security definer set search_path='' as $$
declare generated_code text; before_safe jsonb;
begin
  perform public.require_live_manager_actor(p_actor_app_user_id,p_actor_admin_allowlist_id,true);
  if p_correlation_id is null or p_valid_from is null or p_valid_until is null
     or p_valid_from >= p_valid_until then
    raise exception 'invalid attendance code window';
  end if;
  select jsonb_build_object('validFrom',attendance_valid_from,'validUntil',attendance_valid_until,
    'codeConfigured',fan_code_hash is not null) into before_safe
  from public.live_events where id=p_live_event_id and archived_at is null for update;
  if before_safe is null then raise exception 'active live event not found'; end if;
  generated_code := public.generate_attendance_code_value();
  update public.live_events set
    fan_code_hash=extensions.crypt(generated_code,extensions.gen_salt('bf',12)),
    attendance_valid_from=p_valid_from,attendance_valid_until=p_valid_until
  where id=p_live_event_id;
  insert into public.audit_logs(actor_app_user_id,actor_admin_allowlist_id,action,
    entity_type,entity_id,before_after_summary,correlation_id)
  values(p_actor_app_user_id,p_actor_admin_allowlist_id,'live.attendance_code.generated',
    'live_event',p_live_event_id::text,jsonb_build_object('before',before_safe,'after',
      jsonb_build_object('validFrom',p_valid_from,'validUntil',p_valid_until,'codeConfigured',true)),p_correlation_id);
  return jsonb_build_object('fanCode',generated_code,'validFrom',p_valid_from,'validUntil',p_valid_until);
end $$;

create function public.get_admin_live_attendance_settings(
  p_actor_app_user_id uuid, p_actor_admin_allowlist_id uuid,
  p_live_event_id uuid default null
) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  perform public.require_live_manager_actor(p_actor_app_user_id,p_actor_admin_allowlist_id,false);
  return coalesce((select jsonb_agg(jsonb_build_object('liveEventId',id,
    'validFrom',attendance_valid_from,'validUntil',attendance_valid_until,
    'codeConfigured',fan_code_hash is not null) order by created_at desc)
    from public.live_events where p_live_event_id is null or id=p_live_event_id),'[]'::jsonb);
end $$;

create function public.enforce_live_attendance_window()
returns trigger language plpgsql set search_path='' as $$
declare opens_at timestamptz; closes_at timestamptz; clock_time timestamptz := statement_timestamp();
begin
  select attendance_valid_from,attendance_valid_until into strict opens_at,closes_at
  from public.live_events where id=new.live_event_id;
  if clock_time < opens_at then raise exception 'G3_ATTENDANCE_NOT_OPEN' using errcode='23514'; end if;
  if clock_time >= closes_at then raise exception 'G3_ATTENDANCE_ENDED' using errcode='23514'; end if;
  return new;
end $$;
create trigger live_attendances_window before insert on public.live_attendances
for each row execute function public.enforce_live_attendance_window();

create function public.reward_live_attendance_ticket()
returns trigger language plpgsql security definer set search_path='' as $$
declare policy_version integer;
begin
  select a.policy_version into strict policy_version from public.reward_policy_activation a where a.singleton=true;
  perform public.post_fan_ticket_entry(new.app_user_id,new.celebrity_id,'credit',2,
    'live_attendance',new.id,new.id,policy_version,null,null);
  return new;
end $$;
create trigger live_attendances_reward_ticket after insert on public.live_attendances
for each row execute function public.reward_live_attendance_ticket();

revoke all on function public.generate_attendance_code_value() from public,anon,authenticated,service_role;
revoke all on function public.default_live_attendance_window() from public,anon,authenticated,service_role;
revoke all on function public.save_admin_live_draft_v2(uuid,uuid,uuid,uuid,text,uuid,uuid,timestamptz,timestamptz,timestamptz,timestamptz,text,text,text,text,text,text,text,text) from public,anon,authenticated;
revoke all on function public.generate_admin_live_attendance_code(uuid,uuid,uuid,uuid,timestamptz,timestamptz) from public,anon,authenticated;
revoke all on function public.get_admin_live_attendance_settings(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.save_admin_live_draft_v2(uuid,uuid,uuid,uuid,text,uuid,uuid,timestamptz,timestamptz,timestamptz,timestamptz,text,text,text,text,text,text,text,text) to service_role;
grant execute on function public.generate_admin_live_attendance_code(uuid,uuid,uuid,uuid,timestamptz,timestamptz) to service_role;
grant execute on function public.get_admin_live_attendance_settings(uuid,uuid,uuid) to service_role;
revoke all on function public.enforce_live_attendance_window() from public,anon,authenticated,service_role;
revoke all on function public.reward_live_attendance_ticket() from public,anon,authenticated,service_role;
