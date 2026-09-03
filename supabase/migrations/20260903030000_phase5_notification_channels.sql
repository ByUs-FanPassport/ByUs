-- Provider connection facts and notification destinations are deliberately separate.

create table public.fan_connected_accounts (
  id uuid primary key default extensions.gen_random_uuid(),
  app_user_id uuid not null references public.app_users(id) on delete restrict,
  provider text not null check (provider in ('google','kakao')),
  provider_subject_hash text not null check (provider_subject_hash ~ '^[0-9a-f]{64}$'),
  status text not null check (status in ('connected','disconnected')),
  connected_at timestamptz not null,
  disconnected_at timestamptz,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  unique(app_user_id,provider), unique(provider,provider_subject_hash),
  check ((status='connected' and disconnected_at is null) or (status='disconnected' and disconnected_at is not null))
);

create table public.fan_notification_channels (
  id uuid primary key default extensions.gen_random_uuid(),
  app_user_id uuid not null references public.app_users(id) on delete restrict,
  kind text not null check (kind in ('email','kakao')),
  status text not null check (status in ('eligible','disabled','needs_verification')),
  consent_version text,
  consented_at timestamptz,
  consent_revoked_at timestamptz,
  destination_fingerprint text not null check (destination_fingerprint ~ '^[0-9a-f]{64}$'),
  destination_label text not null check (length(trim(destination_label)) between 1 and 160),
  verified_at timestamptz,
  priority integer not null default 100 check (priority>0),
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  unique(app_user_id,kind), unique(kind,destination_fingerprint),
  check ((consented_at is null and consent_version is null) or (consented_at is not null and consent_version is not null))
);

create table public.fan_notification_channel_private (
  channel_id uuid primary key references public.fan_notification_channels(id) on delete restrict,
  destination text not null check (length(trim(destination)) between 3 and 512),
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now()
);

create table public.fan_notification_consent_audits (
  id uuid primary key default extensions.gen_random_uuid(),
  channel_id uuid not null references public.fan_notification_channels(id) on delete restrict,
  app_user_id uuid not null references public.app_users(id) on delete restrict,
  consented boolean not null,
  consent_version text not null check (length(trim(consent_version)) between 1 and 100),
  created_at timestamptz not null default pg_catalog.now()
);

create index fan_connected_accounts_owner_idx on public.fan_connected_accounts(app_user_id,provider);
create index fan_notification_channels_owner_idx on public.fan_notification_channels(app_user_id,kind);
create index fan_notification_consent_audits_channel_idx on public.fan_notification_consent_audits(channel_id,created_at,id);

alter table public.fan_connected_accounts enable row level security;
alter table public.fan_connected_accounts force row level security;
alter table public.fan_notification_channels enable row level security;
alter table public.fan_notification_channels force row level security;
alter table public.fan_notification_channel_private enable row level security;
alter table public.fan_notification_channel_private force row level security;
alter table public.fan_notification_consent_audits enable row level security;
alter table public.fan_notification_consent_audits force row level security;
revoke all on table public.fan_connected_accounts,public.fan_notification_channels,
  public.fan_notification_channel_private,public.fan_notification_consent_audits
  from public,anon,authenticated,service_role;

create trigger fan_notification_consent_audits_reject_update_delete
before update or delete on public.fan_notification_consent_audits for each row
execute function public.reject_benefit_economy_history_mutation();
create trigger fan_notification_consent_audits_reject_truncate
before truncate on public.fan_notification_consent_audits for each statement
execute function public.reject_benefit_economy_history_truncate();

create function public.mask_notification_email(p_email text) returns text
language sql immutable set search_path='' as $$
  select case when position('@' in p_email)>1 then left(p_email,1)||'***'||substring(p_email from position('@' in p_email)) else '***' end
$$;

create function public.sync_owned_google_notification_channel(
  p_app_user_id uuid,p_privy_user_id text,p_verified_email text,p_google_connected boolean,
  p_now timestamptz default pg_catalog.now()
) returns boolean language plpgsql security definer set search_path='' as $$
declare v_account_hash text; v_destination text; v_channel_id uuid;
begin
  if p_app_user_id is null or nullif(trim(p_privy_user_id),'') is null then raise exception 'PHASE5_IDENTITY_INVALID'; end if;
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
  insert into public.fan_notification_channels(app_user_id,kind,status,consent_version,consented_at,
    destination_fingerprint,destination_label,verified_at,priority,updated_at)
  values(p_app_user_id,'email','eligible','2026-09-v1',p_now,
    encode(extensions.digest(v_destination,'sha256'),'hex'),public.mask_notification_email(v_destination),p_now,200,p_now)
  on conflict(app_user_id,kind) do update set
    destination_fingerprint=excluded.destination_fingerprint,destination_label=excluded.destination_label,
    verified_at=excluded.verified_at,updated_at=excluded.updated_at
  returning id into v_channel_id;
  insert into public.fan_notification_channel_private(channel_id,destination,updated_at)
  values(v_channel_id,v_destination,p_now) on conflict(channel_id) do update set destination=excluded.destination,updated_at=excluded.updated_at;
  return true;
end $$;

create function public.get_owned_notification_connections(p_app_user_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object(
    'accounts',coalesce((select jsonb_agg(jsonb_build_object(
      'provider',a.provider,'status',a.status,'connectedAt',a.connected_at,'disconnectedAt',a.disconnected_at
    ) order by a.provider) from public.fan_connected_accounts a where a.app_user_id=p_app_user_id),'[]'::jsonb),
    'channels',coalesce((select jsonb_agg(jsonb_build_object(
      'id',c.id,'kind',c.kind,'status',c.status,
      'consented',c.consented_at is not null and c.consent_revoked_at is null,
      'destinationLabel',c.destination_label,'verifiedAt',c.verified_at
    ) order by c.priority,c.kind,c.id) from public.fan_notification_channels c where c.app_user_id=p_app_user_id),'[]'::jsonb)
  )
$$;

create function public.set_owned_notification_channel_consent(
  p_app_user_id uuid,p_channel_id uuid,p_consented boolean,p_consent_version text,
  p_now timestamptz default pg_catalog.now()
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v public.fan_notification_channels%rowtype;
begin
  if nullif(trim(p_consent_version),'') is null then raise exception 'PHASE5_CONSENT_VERSION_REQUIRED'; end if;
  update public.fan_notification_channels set
    status=case when p_consented and verified_at is not null then 'eligible' when p_consented then 'needs_verification' else 'disabled' end,
    consent_version=p_consent_version,
    consented_at=case when p_consented then p_now else consented_at end,
    consent_revoked_at=case when p_consented then null else p_now end,
    updated_at=p_now
  where id=p_channel_id and app_user_id=p_app_user_id returning * into v;
  if not found then raise exception 'PHASE5_NOTIFICATION_CHANNEL_NOT_OWNED'; end if;
  insert into public.fan_notification_consent_audits(channel_id,app_user_id,consented,consent_version,created_at)
  values(v.id,p_app_user_id,p_consented,p_consent_version,p_now);
  return jsonb_build_object('id',v.id,'kind',v.kind,'status',v.status,
    'consented',v.consented_at is not null and v.consent_revoked_at is null,
    'destinationLabel',v.destination_label,'verifiedAt',v.verified_at);
end $$;

revoke all on function public.mask_notification_email(text) from public,anon,authenticated;
revoke all on function public.sync_owned_google_notification_channel(uuid,text,text,boolean,timestamptz) from public,anon,authenticated;
revoke all on function public.get_owned_notification_connections(uuid) from public,anon,authenticated;
revoke all on function public.set_owned_notification_channel_consent(uuid,uuid,boolean,text,timestamptz) from public,anon,authenticated;
grant execute on function public.sync_owned_google_notification_channel(uuid,text,text,boolean,timestamptz) to service_role;
grant execute on function public.get_owned_notification_connections(uuid) to service_role;
grant execute on function public.set_owned_notification_channel_consent(uuid,uuid,boolean,text,timestamptz) to service_role;
