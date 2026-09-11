-- Keep the original four-argument admin comment RPC for older callers. The
-- server uses this exact six-argument overload for stable tuple pagination.
create function public.read_admin_notice_comments(
  p_actor_app_user_id uuid,
  p_actor_admin_allowlist_id uuid,
  p_slug text,
  p_before timestamptz,
  p_before_id uuid,
  p_limit integer
)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_result jsonb;
begin
  perform public.assert_active_admin(
    p_actor_app_user_id,
    p_actor_admin_allowlist_id,
    false
  );
  if p_limit is null or p_limit not between 1 and 100
     or ((p_before is null) <> (p_before_id is null)) then
    raise exception 'FANPAGE_INVALID_REQUEST';
  end if;

  select jsonb_build_object(
    'comments',
    coalesce(
      jsonb_agg(row.body order by row.created_at desc, row.id desc),
      '[]'::jsonb
    )
  )
  into v_result
  from (
    select
      cm.created_at,
      cm.id,
      jsonb_build_object(
        'id', cm.id,
        'body', cm.body,
        'nickname', coalesce(p.nickname, '팬'),
        'celebritySlug', c.slug,
        'noticeSlug', n.slug,
        'createdAt', cm.created_at
      ) body
    from public.celebrity_notice_comments cm
    join public.celebrity_notices n on n.id = cm.notice_id
    join public.celebrities c on c.id = n.celebrity_id
    left join public.user_profiles p on p.app_user_id = cm.app_user_id
    where cm.removed_at is null
      and (p_slug is null or c.slug = p_slug)
      and (
        p_before is null
        or (cm.created_at, cm.id) < (p_before, p_before_id)
      )
    order by cm.created_at desc, cm.id desc
    limit p_limit
  ) row;
  return v_result;
end;
$$;

revoke all on function public.read_admin_notice_comments(
  uuid, uuid, text, timestamptz, uuid, integer
) from public, anon, authenticated;
grant execute on function public.read_admin_notice_comments(
  uuid, uuid, text, timestamptz, uuid, integer
) to service_role;

-- The HTTP contract allows 100 rows. The repository requests one additional
-- row to prove that another page exists, so widen only the internal RPC bound.
do $$
declare
  function_signature regprocedure :=
    'public.get_admin_fans(uuid,uuid,uuid,public.content_locale,text,uuid,public.app_user_status,timestamptz,uuid,integer)'::regprocedure;
  previous_definition text;
  next_definition text;
begin
  previous_definition := pg_get_functiondef(function_signature);
  next_definition := replace(
    previous_definition,
    'p_limit not between 1 and 100',
    'p_limit not between 1 and 101'
  );
  if next_definition = previous_definition then
    raise exception 'get_admin_fans limit guard was not found';
  end if;
  execute next_definition;
end;
$$;

revoke all on function public.get_admin_fans(
  uuid, uuid, uuid, public.content_locale, text, uuid,
  public.app_user_status, timestamptz, uuid, integer
) from public, anon, authenticated;
grant execute on function public.get_admin_fans(
  uuid, uuid, uuid, public.content_locale, text, uuid,
  public.app_user_status, timestamptz, uuid, integer
) to service_role;
