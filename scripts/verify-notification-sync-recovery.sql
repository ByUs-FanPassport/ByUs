-- Read-only verification. Run after the migration (or inside its rollback preview).
do $$
begin
  if has_function_privilege('anon','public.can_defer_owned_notification_sync(uuid,text,text,boolean)','execute')
    or has_function_privilege('authenticated','public.can_defer_owned_notification_sync(uuid,text,text,boolean)','execute')
    or not has_function_privilege('service_role','public.can_defer_owned_notification_sync(uuid,text,text,boolean)','execute')
    or has_table_privilege('service_role','public.fan_notification_channel_private','select') then
    raise exception 'RECOVERY_PROOF_ACL_FAILED';
  end if;
  if public.can_defer_owned_notification_sync(null,null,null,false)
    or public.can_defer_owned_notification_sync('00000000-0000-4000-8000-000000000000','nonexistent','nobody@example.invalid',false) then
    raise exception 'RECOVERY_PROOF_INVALID_OWNER_ALLOWED';
  end if;
  if exists(select 1 from public.app_users u where
      public.can_defer_owned_notification_sync(u.id,'wrong-owner',u.verified_email,false)
      or public.can_defer_owned_notification_sync(u.id,u.privy_user_id,'wrong@example.invalid',false)) then
    raise exception 'RECOVERY_PROOF_MISMATCH_ALLOWED';
  end if;
  if exists(select 1 from public.app_users u
    join public.fan_notification_channels c on c.app_user_id=u.id and c.kind='email'
    where c.destination_fingerprint<>encode(extensions.digest(lower(trim(u.verified_email)),'sha256'),'hex')
      and (public.can_defer_owned_notification_sync(u.id,u.privy_user_id,u.verified_email,true)
        or public.can_defer_owned_notification_sync(u.id,u.privy_user_id,u.verified_email,false))) then
    raise exception 'RECOVERY_PROOF_OLD_RECIPIENT_ALLOWED';
  end if;
end $$;
set local role service_role;
select not public.can_defer_owned_notification_sync('00000000-0000-4000-8000-000000000000','nonexistent','nobody@example.invalid',false) as proof_acl_owner_recipient_checks_passed;
reset role;
