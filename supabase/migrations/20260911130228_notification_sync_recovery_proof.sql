-- Boolean-only service-role proof; recipient tables stay inaccessible to API roles.
create function public.can_defer_owned_notification_sync(
  p_app_user_id uuid, p_privy_user_id text, p_verified_email text, p_google_connected boolean
) returns boolean language sql stable security definer set search_path='' as $$
  select exists (
    select 1 from public.app_users u
    where u.id=p_app_user_id and u.privy_user_id=trim(p_privy_user_id)
      and u.verified_email=lower(trim(p_verified_email))
  ) and (
    not exists (select 1 from public.fan_notification_channels c
      where c.app_user_id=p_app_user_id and c.kind='email')
    or exists (
      select 1 from public.fan_notification_channels c
      join public.fan_notification_channel_private d on d.channel_id=c.id
      join public.fan_connected_accounts a on a.app_user_id=c.app_user_id and a.provider='google'
      where c.app_user_id=p_app_user_id and c.kind='email'
        and c.destination_fingerprint=encode(extensions.digest(lower(trim(p_verified_email)),'sha256'),'hex')
        and d.destination=lower(trim(p_verified_email))
        and a.provider_subject_hash=encode(extensions.digest('google:'||trim(p_privy_user_id),'sha256'),'hex')
        and a.status=case when p_google_connected then 'connected' else 'disconnected' end
    )
  )
$$;
revoke all on function public.can_defer_owned_notification_sync(uuid,text,text,boolean) from public,anon,authenticated;
grant execute on function public.can_defer_owned_notification_sync(uuid,text,text,boolean) to service_role;
