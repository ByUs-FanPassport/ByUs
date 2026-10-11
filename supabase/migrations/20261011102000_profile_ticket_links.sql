begin;

alter table public.celebrities
  add column ticket_url text,
  add constraint celebrities_ticket_url_https check (
    ticket_url is null or (
      char_length(ticket_url) between 9 and 2048
      and ticket_url ~ '^https://[^/?#@[:space:][:cntrl:]]+([/?#][^[:space:][:cntrl:]]*)?$'
    )
  );

comment on column public.celebrities.ticket_url is
  'Optional public HTTPS ticket destination. Credentials, whitespace and control characters are not accepted.';

create or replace view public.published_celebrities
with (security_barrier = true, security_invoker = true)
as
select
  c.slug,
  l.locale,
  l.name,
  l.summary,
  c.image_url,
  l.image_alt,
  c.image_position,
  coalesce(theme_data.items, '[]'::jsonb) as themes,
  coalesce(social_data.items, '[]'::jsonb) as social_links,
  c.display_order,
  c.fan_count,
  c.roles,
  c.primary_role,
  c.website_url,
  c.ticket_url
from public.celebrities c
join public.celebrity_localizations l on l.celebrity_id = c.id
left join lateral (
  select jsonb_agg(
    jsonb_build_object('slug', t.slug, 'name', tl.name)
    order by ct.position, t.slug
  ) as items
  from public.celebrity_themes ct
  join public.themes t on t.id = ct.theme_id and t.status = 'published'
  join public.theme_localizations tl
    on tl.theme_id = t.id and tl.locale = l.locale
  where ct.celebrity_id = c.id
) theme_data on true
left join lateral (
  select jsonb_agg(
    jsonb_build_object('platform', sl.platform, 'url', sl.url)
    order by sl.position, sl.platform
  ) as items
  from public.celebrity_social_links sl
  where sl.celebrity_id = c.id and sl.active
) social_data on true
where c.status = 'published'
  and c.fan_count is not null;

comment on view public.published_celebrities is
  'Published-only celebrity and brand DTO with optional website and ticket destinations. Contains no private CMS identifiers or audit metadata.';

revoke all on public.published_celebrities from public;
revoke all on public.published_celebrities from anon, authenticated;
grant select on public.published_celebrities to service_role;

do $$
declare
  v_signature regprocedure;
  v_definition text;
  v_old text;
  v_new text;
begin
  v_signature := 'public.read_admin_celebrity_cms(uuid,uuid)'::regprocedure;
  v_definition := pg_catalog.pg_get_functiondef(v_signature);
  v_old := $patch$'websiteUrl', c.website_url,
      'publishedAt',$patch$;
  v_new := $patch$'websiteUrl', c.website_url,
      'ticketUrl', c.ticket_url,
      'publishedAt',$patch$;
  if (pg_catalog.length(v_definition) - pg_catalog.length(pg_catalog.replace(v_definition,v_old,'')))
      / pg_catalog.length(v_old) <> 1 then
    raise exception 'ADMIN_CELEBRITY_READ_TICKET_SHAPE_CHANGED';
  end if;
  execute pg_catalog.replace(v_definition,v_old,v_new);

  v_signature := 'public.save_admin_celebrity(uuid,uuid,uuid,jsonb)'::regprocedure;
  v_definition := pg_catalog.pg_get_functiondef(v_signature);

  v_old := $patch$requested_website_url text;
begin$patch$;
  v_new := $patch$requested_website_url text;
  requested_ticket_url text;
begin$patch$;
  if (pg_catalog.length(v_definition) - pg_catalog.length(pg_catalog.replace(v_definition,v_old,'')))
      / pg_catalog.length(v_old) <> 1 then
    raise exception 'ADMIN_CELEBRITY_SAVE_TICKET_DECLARE_SHAPE_CHANGED';
  end if;
  v_definition := pg_catalog.replace(v_definition,v_old,v_new);

  v_old := $patch$  requested_fan_count := case$patch$;
  v_new := $patch$  if p_payload ? 'ticketUrl' then
    if jsonb_typeof(p_payload->'ticketUrl') not in ('string', 'null') then
      raise exception 'invalid celebrity ticket url';
    end if;
    requested_ticket_url := p_payload->>'ticketUrl';
  elsif p_celebrity is not null then
    select ticket_url into requested_ticket_url from public.celebrities where id = target;
  end if;

  requested_fan_count := case$patch$;
  if (pg_catalog.length(v_definition) - pg_catalog.length(pg_catalog.replace(v_definition,v_old,'')))
      / pg_catalog.length(v_old) <> 1 then
    raise exception 'ADMIN_CELEBRITY_SAVE_TICKET_INPUT_SHAPE_CHANGED';
  end if;
  v_definition := pg_catalog.replace(v_definition,v_old,v_new);

  v_old := $patch$id, slug, image_url, image_position, display_order, fan_count, roles, primary_role, website_url$patch$;
  v_new := $patch$id, slug, image_url, image_position, display_order, fan_count, roles, primary_role, website_url, ticket_url$patch$;
  if (pg_catalog.length(v_definition) - pg_catalog.length(pg_catalog.replace(v_definition,v_old,'')))
      / pg_catalog.length(v_old) <> 1 then
    raise exception 'ADMIN_CELEBRITY_SAVE_TICKET_INSERT_COLUMNS_SHAPE_CHANGED';
  end if;
  v_definition := pg_catalog.replace(v_definition,v_old,v_new);

  v_old := $patch$      requested_primary_role,
      requested_website_url
    );$patch$;
  v_new := $patch$      requested_primary_role,
      requested_website_url,
      requested_ticket_url
    );$patch$;
  if (pg_catalog.length(v_definition) - pg_catalog.length(pg_catalog.replace(v_definition,v_old,'')))
      / pg_catalog.length(v_old) <> 1 then
    raise exception 'ADMIN_CELEBRITY_SAVE_TICKET_INSERT_VALUES_SHAPE_CHANGED';
  end if;
  v_definition := pg_catalog.replace(v_definition,v_old,v_new);

  v_old := $patch$        website_url = requested_website_url
    where id = target;$patch$;
  v_new := $patch$        website_url = requested_website_url,
        ticket_url = requested_ticket_url
    where id = target;$patch$;
  if (pg_catalog.length(v_definition) - pg_catalog.length(pg_catalog.replace(v_definition,v_old,'')))
      / pg_catalog.length(v_old) <> 1 then
    raise exception 'ADMIN_CELEBRITY_SAVE_TICKET_UPDATE_SHAPE_CHANGED';
  end if;
  execute pg_catalog.replace(v_definition,v_old,v_new);
end $$;

commit;
