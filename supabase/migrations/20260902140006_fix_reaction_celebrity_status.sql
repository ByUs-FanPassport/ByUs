-- Repair the deployed Reaction RPC to use the canonical celebrities.status column.
create or replace function public.react_to_creator(
  p_app_user_id uuid,p_celebrity_id uuid,p_reaction_id uuid,p_job_id uuid,p_issuance_id text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare existing public.fan_reactions%rowtype; slug text; recipient text; payload jsonb;
begin
  if p_reaction_id is null or p_job_id is null or coalesce(p_issuance_id,'') !~ '^0x[0-9a-f]{64}$'
  then raise exception 'P2_REACTION_INPUT_INVALID' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('reaction:'||p_app_user_id::text||':'||p_celebrity_id::text,0));
  perform 1 from public.app_users u where u.id=p_app_user_id and u.status='active' for update;
  if not found then raise exception 'P2_USER_UNAVAILABLE' using errcode='42501'; end if;
  select * into existing from public.fan_reactions r where r.app_user_id=p_app_user_id and r.celebrity_id=p_celebrity_id;
  if found then return jsonb_build_object('reactionId',existing.id,'status',existing.business_status,
    'mintStatus',existing.mint_status,'blockchainJobId',existing.blockchain_job_id,'created',false,
    'passportExists',exists(select 1 from public.fan_passports p where p.app_user_id=p_app_user_id and p.celebrity_id=p_celebrity_id)); end if;
  select c.slug into slug from public.celebrities c where c.id=p_celebrity_id and c.status='published' and c.archived_at is null for key share;
  if not found then raise exception 'P2_CREATOR_NOT_FOUND' using errcode='P0002'; end if;
  select w.address into recipient from public.user_wallets w where w.app_user_id=p_app_user_id and w.chain_id=91342
    and w.provider='privy' and w.wallet_type='embedded' for key share;
  if not found then raise exception 'P2_WALLET_NOT_READY' using errcode='55000'; end if;
  payload:=jsonb_build_object('recipient',recipient,'celebritySlug',slug,'issuanceId',p_issuance_id,'reactionType','FirstReaction');
  insert into public.blockchain_jobs(id,entity_type,entity_id,operation_key,payload_version,payload)
    values(p_job_id,'reaction',p_reaction_id,'byus:reaction:v1:'||p_reaction_id::text,1,payload);
  insert into public.fan_reactions(id,app_user_id,celebrity_id,blockchain_job_id)
    values(p_reaction_id,p_app_user_id,p_celebrity_id,p_job_id) returning * into existing;
  return jsonb_build_object('reactionId',existing.id,'status',existing.business_status,
    'mintStatus',existing.mint_status,'blockchainJobId',existing.blockchain_job_id,'created',true,
    'passportExists',exists(select 1 from public.fan_passports p where p.app_user_id=p_app_user_id and p.celebrity_id=p_celebrity_id));
end $$;

revoke all on function public.react_to_creator(uuid,uuid,uuid,uuid,text)
  from public,anon,authenticated,service_role;
grant execute on function public.react_to_creator(uuid,uuid,uuid,uuid,text)
  to service_role;
