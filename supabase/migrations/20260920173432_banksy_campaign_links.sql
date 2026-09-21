-- One Banksy campaign; metadata is fixed at link creation, not inferred from referrers.
create table public.campaign_tracking_links (
  id uuid primary key,
  creator text not null check (creator in ('elina','byus')),
  channel text not null check (channel in ('instagram','tiktok','youtube','facebook','x','mirrorworld','other')),
  content_type text not null check (content_type in ('story','reel','video','post','bio','other')),
  name text not null check (length(trim(name)) between 1 and 80),
  locale text not null check (locale in ('ko','en')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create table public.campaign_visits (
  id uuid primary key default gen_random_uuid(),
  session_hash text not null unique check (session_hash ~ '^[0-9a-f]{64}$'),
  first_link_id uuid references public.campaign_tracking_links(id),
  last_link_id uuid references public.campaign_tracking_links(id),
  last_sequence integer not null check (last_sequence between 0 and 1000000),
  created_at timestamptz not null default now()
);
create index campaign_visits_created_at_idx on public.campaign_visits(created_at);
alter table public.outbound_link_visits
  add column visit_id uuid references public.campaign_visits(id) on delete set null,
  add column destination text check (destination in ('exhibition','goods')),
  add column surface text check (surface in ('raffle_list','raffle_receipt')),
  add column request_id uuid unique,
  add constraint banksy_outbound_fields check (
    (campaign = 'banksy' and destination is not null and surface is not null and request_id is not null)
    or (campaign <> 'banksy' and visit_id is null and destination is null and surface is null and request_id is null)
  );
create index outbound_link_visits_visit_idx on public.outbound_link_visits(visit_id,created_at) where visit_id is not null;
alter table public.campaign_tracking_links enable row level security;
alter table public.campaign_visits enable row level security;
revoke all on public.campaign_tracking_links, public.campaign_visits from public, anon, authenticated;
grant select,insert,update on public.campaign_tracking_links, public.campaign_visits to service_role;
comment on table public.campaign_visits is 'Banksy browser-tab sessions. Salted hash only; not people, accounts or cross-browser identity. First attribution (including internal/null) is immutable.';
comment on table public.outbound_link_visits is 'Server-recorded redirect requests, not arrivals or purchases. Legacy campaigns have no identifiers; Banksy may reference a browser-tab visit. Request UUID deduplicates retries.';

create function public.record_banksy_visit(p_session_hash text,p_first_link_id uuid,p_link_id uuid,p_sequence integer)
returns uuid language plpgsql security invoker set search_path='' as $$
declare v_id uuid;
begin
  if p_link_id is not null then
    perform 1 from public.campaign_tracking_links where id=p_link_id and active for share;
    if not found then return null; end if;
  end if;
  insert into public.campaign_visits(session_hash,first_link_id,last_link_id,last_sequence)
  values(p_session_hash,p_first_link_id,p_link_id,p_sequence)
  on conflict(session_hash) do update set
    last_link_id=case when excluded.last_sequence>campaign_visits.last_sequence then excluded.last_link_id else campaign_visits.last_link_id end,
    last_sequence=greatest(campaign_visits.last_sequence,excluded.last_sequence)
  returning id into v_id;
  return v_id;
end $$;

create function public.record_banksy_outbound(p_visit_id uuid,p_destination text,p_surface text,p_request_id uuid)
returns void language plpgsql security invoker set search_path='' as $$
begin
  insert into public.outbound_link_visits(campaign,visit_id,destination,surface,request_id)
  values('banksy',(select id from public.campaign_visits where id=p_visit_id),p_destination,p_surface,p_request_id)
  on conflict(request_id) do nothing;
end $$;

create function public.command_banksy_tracking_link(p_actor_app_user_id uuid,p_actor_admin_allowlist_id uuid,p_command jsonb)
returns void language plpgsql security invoker set search_path='' as $$
declare v_link public.campaign_tracking_links; v_id uuid=(p_command->>'id')::uuid;
begin
  perform public.assert_active_admin(p_actor_app_user_id,p_actor_admin_allowlist_id,true);
  if p_command->>'action'='create' then
    insert into public.campaign_tracking_links(id,creator,channel,content_type,name,locale)
    values(v_id,p_command->>'creator',p_command->>'channel',p_command->>'contentType',p_command->>'name',p_command->>'locale')
    on conflict(id) do nothing;
    if not found then
      select * into v_link from public.campaign_tracking_links where id=v_id;
      if v_link.creator is distinct from p_command->>'creator' or v_link.channel is distinct from p_command->>'channel'
        or v_link.content_type is distinct from p_command->>'contentType' or v_link.name is distinct from p_command->>'name'
        or v_link.locale is distinct from p_command->>'locale' then raise exception 'link replay conflict'; end if;
      return;
    end if;
  elsif p_command->>'action'='stop' then
    update public.campaign_tracking_links set active=false where id=v_id and active;
    if not found then return; end if;
  else raise exception 'invalid command'; end if;
  insert into public.audit_logs(actor_app_user_id,actor_admin_allowlist_id,action,entity_type,entity_id,before_after_summary)
  values(p_actor_app_user_id,p_actor_admin_allowlist_id,'campaign.link.'||(p_command->>'action'),'campaign_tracking_link',v_id::text,
    jsonb_build_object('active',p_command->>'action'='create'));
end $$;

create function public.read_banksy_campaign(p_actor_app_user_id uuid,p_actor_admin_allowlist_id uuid,p_from timestamptz,p_to timestamptz)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare v_links jsonb; v_report jsonb;
begin
  perform public.assert_active_admin(p_actor_app_user_id,p_actor_admin_allowlist_id,false);
  if p_from is null or p_to is null or p_to<p_from or p_to-p_from>interval '91 days' then raise exception 'invalid window'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'creator',creator,'channel',channel,'contentType',content_type,'name',name,'locale',locale,'active',active,'createdAt',created_at) order by created_at desc,id),'[]'::jsonb)
  into v_links from public.campaign_tracking_links;
  with cohort as (
    select v.id,v.first_link_id,exists(select 1 from public.outbound_link_visits o where o.campaign='banksy' and o.visit_id=v.id and o.created_at>=v.created_at and o.created_at<p_to) as moved
    from public.campaign_visits v where v.created_at>=p_from and v.created_at<p_to
  ), per_source as (
    select first_link_id,count(*) as visits,count(*) filter(where moved) as moved from cohort group by first_link_id
  ), per_destination as (
    select destination,count(*) as requests,count(distinct visit_id) as sessions from public.outbound_link_visits
    where campaign='banksy' and created_at>=p_from and created_at<p_to group by destination
  ) select jsonb_build_object(
    'from',p_from,'to',p_to,
    'totals',jsonb_build_object('visits',(select count(*) from cohort),'outboundSessions',(select count(*) from cohort where moved)),
    'sources',coalesce((select jsonb_agg(jsonb_build_object('linkId',first_link_id,'visits',visits,'outboundSessions',moved)) from per_source),'[]'::jsonb),
    'destinations',coalesce((select jsonb_agg(jsonb_build_object('destination',destination,'requests',requests,'sessions',sessions)) from per_destination),'[]'::jsonb),
    'mirrorworldLegacyRequests',(select count(*) from public.outbound_link_visits where campaign='mirrorworld-banksy' and created_at>=p_from and created_at<p_to),
    'legacyRequests',(select count(*) from public.outbound_link_visits where campaign='elina-banksy-instagram' and created_at>=p_from and created_at<p_to)
  ) into v_report;
  return jsonb_build_object('links',v_links,'report',v_report);
end $$;
revoke all on function public.record_banksy_visit(text,uuid,uuid,integer),public.record_banksy_outbound(uuid,text,text,uuid),public.command_banksy_tracking_link(uuid,uuid,jsonb),public.read_banksy_campaign(uuid,uuid,timestamptz,timestamptz) from public,anon,authenticated;
grant execute on function public.record_banksy_visit(text,uuid,uuid,integer),public.record_banksy_outbound(uuid,text,text,uuid),public.command_banksy_tracking_link(uuid,uuid,jsonb),public.read_banksy_campaign(uuid,uuid,timestamptz,timestamptz) to service_role;

-- Delete campaign browser records after 90 days; legacy no-identifier counts are unchanged.
grant delete on public.campaign_visits to service_role;
create function public.maintain_banksy_campaign()
returns void language plpgsql security invoker set search_path='' as $$
begin
  delete from public.outbound_link_visits where campaign='banksy' and created_at < now()-interval '90 days';
  delete from public.campaign_visits where created_at < now()-interval '90 days';
end $$;
revoke all on function public.maintain_banksy_campaign() from public,anon,authenticated;
-- Scheduler runs as the migration owner; no public or client execution path.
select cron.schedule('banksy-campaign-retention','41 * * * *','select public.maintain_banksy_campaign()');

-- Existing public Mirrorworld URL resolves to this administrator-managed link.
insert into public.campaign_tracking_links(id,creator,channel,content_type,name,locale)
values('fa4be7ed-782e-48f2-8537-628e5cd4e920','byus','mirrorworld','post','Mirrorworld · 뱅크시 이벤트','ko');
