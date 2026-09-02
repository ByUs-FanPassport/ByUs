create or replace function public.get_owned_reaction(p_app_user_id uuid,p_celebrity_slug text)
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object(
    'reactionId',r.id,
    'status',r.business_status,
    'mintStatus',r.mint_status,
    'blockchainJobId',r.blockchain_job_id,
    'created',false,
    'passportExists',exists(
      select 1 from public.fan_passports p
      where p.app_user_id=r.app_user_id and p.celebrity_id=r.celebrity_id
    )
  )
  from public.fan_reactions r
  join public.celebrities c on c.id=r.celebrity_id
  where r.app_user_id=p_app_user_id and c.slug=p_celebrity_slug;
$$;

revoke all on function public.get_owned_reaction(uuid,text) from public,anon,authenticated;
grant execute on function public.get_owned_reaction(uuid,text) to service_role;
