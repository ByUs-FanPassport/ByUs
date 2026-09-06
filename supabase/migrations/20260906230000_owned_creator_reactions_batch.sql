create or replace function public.get_owned_creator_reactions(p_app_user_id uuid,p_celebrity_slugs text[])
returns jsonb language sql stable security definer set search_path='' as $$
  with requested as (
    select input.slug,min(input.ordinality) as ordinality
    from unnest(p_celebrity_slugs) with ordinality as input(slug,ordinality)
    group by input.slug
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'slug',requested.slug,
    'reacted',(reaction.id is not null)
  ) order by requested.ordinality),'[]'::jsonb)
  from requested
  left join public.celebrities celebrity on celebrity.slug=requested.slug
  left join public.fan_reactions reaction
    on reaction.celebrity_id=celebrity.id and reaction.app_user_id=p_app_user_id;
$$;

revoke all on function public.get_owned_creator_reactions(uuid,text[]) from public,anon,authenticated;
grant execute on function public.get_owned_creator_reactions(uuid,text[]) to service_role;
