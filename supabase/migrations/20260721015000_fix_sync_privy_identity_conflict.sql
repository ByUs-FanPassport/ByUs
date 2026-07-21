create or replace function public.sync_privy_identity(
  p_privy_user_id text,
  p_verified_email text,
  p_chain_id bigint,
  p_wallet_address text
)
returns table(app_user_id uuid, wallet_id uuid)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_user public.app_users%rowtype;
  v_wallet public.user_wallets%rowtype;
  v_existing_owner uuid;
begin
  p_privy_user_id := trim(p_privy_user_id);
  p_verified_email := lower(trim(p_verified_email));
  p_wallet_address := lower(trim(p_wallet_address));

  if p_privy_user_id = '' then raise exception 'invalid privy user id' using errcode = '22023'; end if;
  if p_verified_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'invalid verified email' using errcode = '22023';
  end if;
  if p_chain_id <= 0 or p_wallet_address !~ '^0x[0-9a-f]{40}$' then
    raise exception 'invalid wallet' using errcode = '22023';
  end if;

  insert into public.app_users(privy_user_id, verified_email, last_authenticated_at)
  values (p_privy_user_id, p_verified_email, now())
  on conflict (privy_user_id) do update
    set verified_email = excluded.verified_email,
        last_authenticated_at = excluded.last_authenticated_at
  returning * into v_user;

  if v_user.status <> 'active' then
    raise exception 'user disabled' using errcode = '42501';
  end if;

  select uw.app_user_id into v_existing_owner
  from public.user_wallets uw
  where uw.chain_id = p_chain_id and uw.address = p_wallet_address;
  if v_existing_owner is not null and v_existing_owner <> v_user.id then
    raise exception 'wallet already linked' using errcode = '23505';
  end if;

  select * into v_wallet
  from public.user_wallets uw
  where uw.app_user_id = v_user.id and uw.chain_id = p_chain_id
  for update;
  if found and v_wallet.address <> p_wallet_address then
    raise exception 'wallet relink requires review' using errcode = '23514';
  end if;

  insert into public.user_wallets(app_user_id, chain_id, address)
  values (v_user.id, p_chain_id, p_wallet_address)
  on conflict on constraint user_wallets_one_wallet_per_user_chain do update
    set updated_at = public.user_wallets.updated_at
  returning * into v_wallet;

  return query select v_user.id, v_wallet.id;
end;
$$;

revoke all on function public.sync_privy_identity(text, text, bigint, text) from public, anon, authenticated;
grant execute on function public.sync_privy_identity(text, text, bigint, text) to service_role;

comment on function public.sync_privy_identity(text, text, bigint, text) is
  'Atomically records a server-verified Privy subject, verified Google email, and immutable embedded EVM wallet link.';
