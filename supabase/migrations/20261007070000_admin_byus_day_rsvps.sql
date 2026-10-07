-- Read-only attendee projection; encrypted identity and request metadata stay private.
create function public.list_admin_byus_day_rsvps(
  p_actor_app_user_id uuid, p_actor_admin_allowlist_id uuid
) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  begin
    perform public.assert_active_admin(p_actor_app_user_id,p_actor_admin_allowlist_id,false);
  exception when others then
    raise exception 'RSVP_ADMIN_FORBIDDEN' using errcode='42501';
  end;
  return jsonb_build_object('attendees',coalesce((
    select jsonb_agg(jsonb_build_object(
      'id',r.id,'koreanName',r.korean_name,'englishName',r.english_name,
      'affiliation',r.affiliation,'occupation',r.occupation,
      'phone',r.phone_e164,'email',r.email_normalized,'nationality',r.nationality,
      'createdAt',r.created_at
    ) order by r.created_at desc,r.id desc)
    from public.byus_day_rsvps r
  ),'[]'::jsonb));
end $$;

revoke all on function public.list_admin_byus_day_rsvps(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.list_admin_byus_day_rsvps(uuid,uuid) to service_role;
