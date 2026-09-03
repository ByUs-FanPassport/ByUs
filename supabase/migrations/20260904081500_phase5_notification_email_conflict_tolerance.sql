-- A verified email can appear on more than one Privy subject during account
-- recovery. Login must stay available, but an existing notification
-- destination must never be silently transferred between owners.
create or replace function public.sync_owned_google_notification_channel(
  p_app_user_id uuid,p_privy_user_id text,p_verified_email text,p_google_connected boolean,
  p_now timestamptz default pg_catalog.now()
) returns boolean language plpgsql security definer set search_path='' as $$
declare
  v_account_hash text;
  v_destination text;
  v_destination_fingerprint text;
  v_channel_id uuid;
  v_existing_owner uuid;
begin
  if p_app_user_id is null or nullif(trim(p_privy_user_id),'') is null then
    raise exception 'PHASE5_IDENTITY_INVALID';
  end if;

  v_account_hash:=encode(extensions.digest('google:'||trim(p_privy_user_id),'sha256'),'hex');
  insert into public.fan_connected_accounts(app_user_id,provider,provider_subject_hash,status,connected_at,disconnected_at,updated_at)
  values(p_app_user_id,'google',v_account_hash,case when p_google_connected then 'connected' else 'disconnected' end,
    p_now,case when p_google_connected then null else p_now end,p_now)
  on conflict(app_user_id,provider) do update set
    provider_subject_hash=excluded.provider_subject_hash,
    status=excluded.status,
    connected_at=case when public.fan_connected_accounts.status='connected' then public.fan_connected_accounts.connected_at else excluded.connected_at end,
    disconnected_at=excluded.disconnected_at,updated_at=excluded.updated_at;

  if p_verified_email is null or nullif(trim(p_verified_email),'') is null then return true; end if;
  v_destination:=lower(trim(p_verified_email));
  v_destination_fingerprint:=encode(extensions.digest(v_destination,'sha256'),'hex');

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('notification-email:'||v_destination_fingerprint,0)
  );
  select channel.app_user_id into v_existing_owner
  from public.fan_notification_channels channel
  where channel.kind='email' and channel.destination_fingerprint=v_destination_fingerprint;

  if found and v_existing_owner <> p_app_user_id then
    return true;
  end if;

  insert into public.fan_notification_channels(app_user_id,kind,status,consent_version,consented_at,
    destination_fingerprint,destination_label,verified_at,priority,updated_at)
  values(p_app_user_id,'email','eligible','2026-09-v1',p_now,
    v_destination_fingerprint,public.mask_notification_email(v_destination),p_now,200,p_now)
  on conflict(app_user_id,kind) do update set
    destination_fingerprint=excluded.destination_fingerprint,destination_label=excluded.destination_label,
    verified_at=excluded.verified_at,updated_at=excluded.updated_at
  returning id into v_channel_id;

  insert into public.fan_notification_channel_private(channel_id,destination,updated_at)
  values(v_channel_id,v_destination,p_now)
  on conflict(channel_id) do update set destination=excluded.destination,updated_at=excluded.updated_at;
  return true;
end $$;

revoke all on function public.sync_owned_google_notification_channel(uuid,text,text,boolean,timestamptz)
  from public,anon,authenticated;
grant execute on function public.sync_owned_google_notification_channel(uuid,text,text,boolean,timestamptz)
  to service_role;

comment on function public.sync_owned_google_notification_channel(uuid,text,text,boolean,timestamptz) is
  'Projects verified Google connection state while preserving notification destination ownership across duplicate-email Privy subjects.';
