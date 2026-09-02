alter function public.get_owned_passport_detail(uuid,uuid,public.content_locale)
  rename to get_owned_passport_detail_before_first_reaction;

create function public.get_owned_passport_detail(
  p_passport_id uuid,p_app_user_id uuid,p_locale public.content_locale
) returns setof jsonb language sql stable security definer set search_path='' as $$
  select base || jsonb_build_object('firstReaction',(
    select jsonb_build_object('reactionId',s.reaction_id,'stampId',s.id,'activityId',s.activity_id,
      'reactionType','FirstReaction','mintStatus',s.mint_status,'txHash',s.tx_hash,'issuedAt',s.issued_at)
    from public.first_reaction_stamps s join public.fan_reactions r on r.id=s.reaction_id
    where s.passport_id=p_passport_id and s.app_user_id=p_app_user_id
  )) from public.get_owned_passport_detail_before_first_reaction(p_passport_id,p_app_user_id,p_locale) base;
$$;
revoke all on function public.get_owned_passport_detail_before_first_reaction(uuid,uuid,public.content_locale) from public,anon,authenticated,service_role;
revoke all on function public.get_owned_passport_detail(uuid,uuid,public.content_locale) from public,anon,authenticated;
grant execute on function public.get_owned_passport_detail(uuid,uuid,public.content_locale) to service_role;
