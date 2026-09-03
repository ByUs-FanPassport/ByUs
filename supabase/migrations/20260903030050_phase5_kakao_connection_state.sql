-- Owner-bound Kakao PKCE state and destination enrollment. OAuth tokens are never persisted.

create table public.kakao_connection_states (
  id uuid primary key default extensions.gen_random_uuid(),
  app_user_id uuid not null references public.app_users(id) on delete restrict,
  state_hash text not null unique check (state_hash ~ '^[0-9a-f]{64}$'),
  code_verifier text not null check (length(code_verifier) between 43 and 128),
  return_path text not null check (return_path ~ '^/(?:my|settings)(?:[/?#].*)?$'),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default pg_catalog.now(),
  check (expires_at<=created_at+interval '10 minutes')
);

create table public.kakao_notification_enrollment_proofs (
  proof_hash text primary key check (proof_hash ~ '^[0-9a-f]{64}$'),
  app_user_id uuid not null references public.app_users(id) on delete restrict,
  consumed_at timestamptz not null,
  created_at timestamptz not null default pg_catalog.now()
);

alter table public.kakao_connection_states enable row level security;
alter table public.kakao_connection_states force row level security;
alter table public.kakao_notification_enrollment_proofs enable row level security;
alter table public.kakao_notification_enrollment_proofs force row level security;
revoke all on table public.kakao_connection_states,public.kakao_notification_enrollment_proofs
from public,anon,authenticated,service_role;

create trigger kakao_notification_enrollment_proofs_reject_update_delete before update or delete
on public.kakao_notification_enrollment_proofs for each row execute function public.reject_benefit_economy_history_mutation();
create trigger kakao_notification_enrollment_proofs_reject_truncate before truncate
on public.kakao_notification_enrollment_proofs for each statement execute function public.reject_benefit_economy_history_truncate();

create function public.create_owned_kakao_connection_state(
  p_app_user_id uuid,p_state_hash text,p_code_verifier text,p_return_path text,
  p_now timestamptz default pg_catalog.now()
) returns boolean language plpgsql security definer set search_path='' as $$
begin
  if p_state_hash !~ '^[0-9a-f]{64}$' or length(p_code_verifier) not between 43 and 128
    or p_return_path !~ '^/(?:my|settings)(?:[/?#].*)?$' then raise exception 'PHASE5_KAKAO_STATE_INVALID'; end if;
  insert into public.kakao_connection_states(app_user_id,state_hash,code_verifier,return_path,expires_at,created_at)
  values(p_app_user_id,p_state_hash,p_code_verifier,p_return_path,p_now+interval '10 minutes',p_now);
  return true;
end $$;

create function public.consume_owned_kakao_connection_state(
  p_app_user_id uuid,p_state_hash text,p_now timestamptz default pg_catalog.now()
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v public.kakao_connection_states%rowtype;
begin
  select * into v from public.kakao_connection_states where state_hash=p_state_hash for update;
  if not found or v.app_user_id<>p_app_user_id then raise exception 'PHASE5_KAKAO_STATE_NOT_OWNED'; end if;
  if v.consumed_at is not null then raise exception 'PHASE5_KAKAO_STATE_REPLAY'; end if;
  if p_now>=v.expires_at then raise exception 'PHASE5_KAKAO_STATE_EXPIRED'; end if;
  update public.kakao_connection_states set consumed_at=p_now where id=v.id;
  return jsonb_build_object('codeVerifier',v.code_verifier,'returnPath',v.return_path);
end $$;

create function public.complete_owned_kakao_connection(
  p_app_user_id uuid,p_subject_hash text,p_now timestamptz default pg_catalog.now()
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v public.fan_connected_accounts%rowtype;
begin
  if p_subject_hash !~ '^[0-9a-f]{64}$' then raise exception 'PHASE5_KAKAO_SUBJECT_INVALID'; end if;
  if exists(select 1 from public.fan_connected_accounts where provider='kakao' and provider_subject_hash=p_subject_hash and app_user_id<>p_app_user_id) then
    raise exception 'PHASE5_KAKAO_SUBJECT_CONFLICT';
  end if;
  insert into public.fan_connected_accounts(app_user_id,provider,provider_subject_hash,status,connected_at,updated_at)
  values(p_app_user_id,'kakao',p_subject_hash,'connected',p_now,p_now)
  on conflict(app_user_id,provider) do update set provider_subject_hash=excluded.provider_subject_hash,status='connected',
    connected_at=case when public.fan_connected_accounts.status='connected' then public.fan_connected_accounts.connected_at else excluded.connected_at end,
    disconnected_at=null,updated_at=excluded.updated_at returning * into v;
  return jsonb_build_object('provider','kakao','status',v.status,'connectedAt',v.connected_at,'disconnectedAt',v.disconnected_at);
end $$;

create function public.disconnect_owned_kakao_connection(p_app_user_id uuid,p_now timestamptz default pg_catalog.now())
returns jsonb language plpgsql security definer set search_path='' as $$
declare v public.fan_connected_accounts%rowtype;
begin
  update public.fan_connected_accounts set status='disconnected',disconnected_at=coalesce(disconnected_at,p_now),updated_at=p_now
  where app_user_id=p_app_user_id and provider='kakao' returning * into v;
  if not found then raise exception 'PHASE5_KAKAO_CONNECTION_NOT_FOUND'; end if;
  return jsonb_build_object('provider','kakao','status',v.status,'connectedAt',v.connected_at,'disconnectedAt',v.disconnected_at);
end $$;

create function public.enroll_owned_kakao_notification_channel(
  p_app_user_id uuid,p_proof_hash text,p_recipient_key text,p_destination_label text,
  p_consent_version text,p_now timestamptz default pg_catalog.now()
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_channel public.fan_notification_channels%rowtype;
begin
  if not exists(select 1 from public.fan_connected_accounts where app_user_id=p_app_user_id and provider='kakao' and status='connected') then
    raise exception 'PHASE5_KAKAO_NOT_CONNECTED'; end if;
  if p_proof_hash !~ '^[0-9a-f]{64}$' or nullif(trim(p_recipient_key),'') is null or nullif(trim(p_consent_version),'') is null then
    raise exception 'PHASE5_KAKAO_ENROLLMENT_INVALID'; end if;
  insert into public.kakao_notification_enrollment_proofs(proof_hash,app_user_id,consumed_at,created_at)
  values(p_proof_hash,p_app_user_id,p_now,p_now);
  insert into public.fan_notification_channels(app_user_id,kind,status,consent_version,consented_at,
    destination_fingerprint,destination_label,verified_at,priority,updated_at)
  values(p_app_user_id,'kakao','eligible',p_consent_version,p_now,
    encode(extensions.digest(trim(p_recipient_key),'sha256'),'hex'),trim(p_destination_label),p_now,100,p_now)
  on conflict(app_user_id,kind) do update set status='eligible',consent_version=excluded.consent_version,
    consented_at=excluded.consented_at,consent_revoked_at=null,destination_fingerprint=excluded.destination_fingerprint,
    destination_label=excluded.destination_label,verified_at=excluded.verified_at,updated_at=excluded.updated_at
  returning * into v_channel;
  insert into public.fan_notification_channel_private(channel_id,destination,updated_at)
  values(v_channel.id,trim(p_recipient_key),p_now) on conflict(channel_id) do update set destination=excluded.destination,updated_at=excluded.updated_at;
  insert into public.fan_notification_consent_audits(channel_id,app_user_id,consented,consent_version,created_at)
  values(v_channel.id,p_app_user_id,true,p_consent_version,p_now);
  return jsonb_build_object('id',v_channel.id,'kind','kakao','status','eligible','consented',true,
    'destinationLabel',v_channel.destination_label,'verifiedAt',v_channel.verified_at);
exception when unique_violation then raise exception 'PHASE5_KAKAO_ENROLLMENT_REPLAY';
end $$;

revoke all on function public.create_owned_kakao_connection_state(uuid,text,text,text,timestamptz) from public,anon,authenticated;
revoke all on function public.consume_owned_kakao_connection_state(uuid,text,timestamptz) from public,anon,authenticated;
revoke all on function public.complete_owned_kakao_connection(uuid,text,timestamptz) from public,anon,authenticated;
revoke all on function public.disconnect_owned_kakao_connection(uuid,timestamptz) from public,anon,authenticated;
revoke all on function public.enroll_owned_kakao_notification_channel(uuid,text,text,text,text,timestamptz) from public,anon,authenticated;
grant execute on function public.create_owned_kakao_connection_state(uuid,text,text,text,timestamptz) to service_role;
grant execute on function public.consume_owned_kakao_connection_state(uuid,text,timestamptz) to service_role;
grant execute on function public.complete_owned_kakao_connection(uuid,text,timestamptz) to service_role;
grant execute on function public.disconnect_owned_kakao_connection(uuid,timestamptz) to service_role;
grant execute on function public.enroll_owned_kakao_notification_channel(uuid,text,text,text,text,timestamptz) to service_role;
