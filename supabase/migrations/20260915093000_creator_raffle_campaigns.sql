-- Standalone creator-owned raffles. Existing LIVE-owned campaigns remain compatible.

alter table public.live_benefit_campaigns
  alter column live_event_id drop not null,
  add column celebrity_id uuid references public.celebrities(id) on delete restrict,
  add constraint live_benefit_campaign_source_xor check (
    (live_event_id is not null and celebrity_id is null)
    or (live_event_id is null and celebrity_id is not null)
  );

-- Draft item edits keep row IDs, so priority swaps must be checked at the end
-- of the UPSERT rather than against an intermediate row order.
alter table public.live_benefit_campaign_items
  drop constraint live_benefit_campaign_items_campaign_id_priority_key,
  add constraint live_benefit_campaign_items_campaign_id_priority_key
    unique(campaign_id,priority) deferrable initially immediate;

create function public.enforce_creator_raffle_campaign_owner()
returns trigger language plpgsql set search_path='' as $$
begin
  if tg_op='UPDATE' and old.live_event_id is null and (
    new.live_event_id is distinct from old.live_event_id
    or new.celebrity_id is distinct from old.celebrity_id
  ) then
    raise exception 'CREATOR_RAFFLE_OWNER_IMMUTABLE';
  end if;
  return new;
end;
$$;

create trigger live_benefit_campaign_creator_owner_immutable
before update of live_event_id,celebrity_id on public.live_benefit_campaigns
for each row execute function public.enforce_creator_raffle_campaign_owner();

create function public.enforce_benefit_campaign_item_owner()
returns trigger language plpgsql set search_path='' as $$
declare v_owner uuid; v_benefit_owner uuid;
begin
  select c.celebrity_id into v_owner from public.live_benefit_campaigns c
    where c.id=new.campaign_id for share;
  if v_owner is null then
    select e.celebrity_id into v_owner from public.live_benefit_campaigns c
      join public.live_events e on e.id=c.live_event_id
      where c.id=new.campaign_id for share of e;
  end if;
  select b.celebrity_id into v_benefit_owner from public.benefits b
    where b.id=new.benefit_id for share;
  if v_owner is null or v_benefit_owner is distinct from v_owner then
    raise exception 'BENEFIT_CAMPAIGN_OWNER_MISMATCH';
  end if;
  return new;
end;
$$;

create trigger live_benefit_campaign_items_owner_integrity
before insert or update of campaign_id,benefit_id on public.live_benefit_campaign_items
for each row execute function public.enforce_benefit_campaign_item_owner();

create function public.enforce_campaign_bound_benefit_owner()
returns trigger language plpgsql set search_path='' as $$
begin
  if new.celebrity_id is distinct from old.celebrity_id and exists(
    select 1
    from public.live_benefit_campaign_items i
    join public.live_benefit_campaigns c on c.id=i.campaign_id
    left join public.live_events e on e.id=c.live_event_id
    where i.benefit_id=old.id
      and coalesce(c.celebrity_id,e.celebrity_id) is distinct from new.celebrity_id
  ) then
    raise exception 'BENEFIT_CAMPAIGN_OWNER_MISMATCH';
  end if;
  return new;
end;
$$;

create trigger benefits_campaign_owner_integrity
before update of celebrity_id on public.benefits
for each row execute function public.enforce_campaign_bound_benefit_owner();

create function public.save_admin_creator_benefit_campaign(
  p_actor_app_user_id uuid,p_actor_admin_allowlist_id uuid,p_correlation_id uuid,
  p_campaign_id uuid,p_expected_revision integer,p_celebrity_id uuid,
  p_entry_opens_at timestamptz,p_entry_closes_at timestamptz,p_benefits jsonb,
  p_public_teaser boolean default false
) returns uuid language plpgsql security definer set search_path='' as $$
declare
  v_id uuid:=coalesce(p_campaign_id,extensions.gen_random_uuid());
  v_campaign public.live_benefit_campaigns%rowtype;
  v_count integer; v_benefit_id uuid;
begin
  perform public.assert_active_admin(p_actor_app_user_id,p_actor_admin_allowlist_id,true);
  if p_celebrity_id is null or not exists(
    select 1 from public.celebrities c
    where c.id=p_celebrity_id and c.status='published' and c.archived_at is null
  ) then raise exception 'CREATOR_RAFFLE_REQUIRES_PUBLISHED_CREATOR'; end if;
  if p_entry_opens_at is null or p_entry_closes_at is null
    or p_entry_opens_at>=p_entry_closes_at then
    raise exception 'invalid campaign entry window';
  end if;
  if jsonb_typeof(p_benefits) is distinct from 'array' or jsonb_array_length(p_benefits)=0 then
    raise exception 'campaign benefits required';
  end if;
  select count(*) into v_count
  from jsonb_to_recordset(p_benefits) as x(
    "benefitId" uuid,"priority" integer,"perFanTicketLimit" integer,
    "winnerQuantity" integer,"fulfillmentMethod" public.benefit_fulfillment_method,
    "teaserImageUrl" text
  )
  left join public.benefits b on b.id=x."benefitId"
  where x."benefitId" is null or b.id is null or b.celebrity_id is distinct from p_celebrity_id
    or x."priority" is null or x."priority"<=0
    or (x."perFanTicketLimit" is not null and x."perFanTicketLimit"<=0)
    or coalesce(x."winnerQuantity",1)<=0;
  if v_count>0 then raise exception 'invalid campaign benefit constraint'; end if;
  if (select count(*) from jsonb_to_recordset(p_benefits) as x("benefitId" uuid))
      is distinct from
     (select count(distinct x."benefitId") from jsonb_to_recordset(p_benefits) as x("benefitId" uuid))
    or (select count(*) from jsonb_to_recordset(p_benefits) as x("priority" integer))
      is distinct from
     (select count(distinct x."priority") from jsonb_to_recordset(p_benefits) as x("priority" integer)) then
    raise exception 'invalid campaign benefit constraint';
  end if;
  for v_benefit_id in
    select x."benefitId" from jsonb_to_recordset(p_benefits) as x("benefitId" uuid)
    order by x."benefitId"
  loop
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
      'creator-raffle:benefit-binding:'||v_benefit_id::text,0));
    perform 1 from public.benefits b where b.id=v_benefit_id for share;
  end loop;

  if p_campaign_id is null then
    insert into public.live_benefit_campaigns(
      id,live_event_id,celebrity_id,entry_opens_at,entry_closes_at,public_teaser,
      actor_app_user_id,actor_admin_allowlist_id
    ) values(
      v_id,null,p_celebrity_id,p_entry_opens_at,p_entry_closes_at,coalesce(p_public_teaser,false),
      p_actor_app_user_id,p_actor_admin_allowlist_id
    );
  else
    select * into v_campaign from public.live_benefit_campaigns where id=p_campaign_id for update;
    if not found then raise exception 'benefit campaign not found'; end if;
    if p_expected_revision is null or v_campaign.revision is distinct from p_expected_revision then
      raise exception 'benefit campaign revision conflict';
    end if;
    if v_campaign.status<>'draft' then raise exception 'published campaign is immutable'; end if;
    if v_campaign.live_event_id is not null or v_campaign.celebrity_id is distinct from p_celebrity_id then
      raise exception 'CREATOR_RAFFLE_OWNER_IMMUTABLE';
    end if;
    if exists(
      select 1 from public.live_benefit_campaign_items i
      where i.campaign_id=v_id and i.active_fulfillment_policy_version is not null
        and not exists(
          select 1 from jsonb_to_recordset(p_benefits) as x("benefitId" uuid)
          where x."benefitId"=i.benefit_id
        )
    ) then raise exception 'RAFFLE_POLICY_BOUND_ITEM_REMOVAL_FORBIDDEN'; end if;
    if exists(
      select 1 from public.live_benefit_campaign_items i
      join jsonb_to_recordset(p_benefits) as x(
        "benefitId" uuid,"fulfillmentMethod" public.benefit_fulfillment_method
      ) on x."benefitId"=i.benefit_id
      where i.campaign_id=v_id and i.active_fulfillment_policy_version is not null
        and i.fulfillment_method is distinct from coalesce(x."fulfillmentMethod",'digital')
    ) then raise exception 'RAFFLE_POLICY_BOUND_METHOD_MISMATCH'; end if;
    update public.live_benefit_campaigns set
      entry_opens_at=p_entry_opens_at,entry_closes_at=p_entry_closes_at,
      public_teaser=coalesce(p_public_teaser,false),revision=revision+1,
      actor_app_user_id=p_actor_app_user_id,actor_admin_allowlist_id=p_actor_admin_allowlist_id,
      updated_at=pg_catalog.statement_timestamp()
    where id=v_id;
  end if;

  set constraints public.live_benefit_campaign_items_campaign_id_priority_key deferred;
  insert into public.live_benefit_campaign_items(
    campaign_id,benefit_id,priority,per_fan_ticket_limit,winner_quantity,
    fulfillment_method,teaser_image_url
  ) select
    v_id,x."benefitId",x."priority",x."perFanTicketLimit",coalesce(x."winnerQuantity",1),
    coalesce(x."fulfillmentMethod",'digital'),x."teaserImageUrl"
  from jsonb_to_recordset(p_benefits) as x(
    "benefitId" uuid,"priority" integer,"perFanTicketLimit" integer,
    "winnerQuantity" integer,"fulfillmentMethod" public.benefit_fulfillment_method,
    "teaserImageUrl" text
  )
  on conflict(campaign_id,benefit_id) do update set
    priority=excluded.priority,per_fan_ticket_limit=excluded.per_fan_ticket_limit,
    winner_quantity=excluded.winner_quantity,fulfillment_method=excluded.fulfillment_method,
    teaser_image_url=excluded.teaser_image_url;

  delete from public.live_benefit_campaign_items i
  where i.campaign_id=v_id and not exists(
    select 1 from jsonb_to_recordset(p_benefits) as x("benefitId" uuid)
    where x."benefitId"=i.benefit_id
  );
  set constraints public.live_benefit_campaign_items_campaign_id_priority_key immediate;

  insert into public.audit_logs(
    actor_app_user_id,actor_admin_allowlist_id,action,entity_type,entity_id,
    correlation_id,before_after_summary
  ) values(
    p_actor_app_user_id,p_actor_admin_allowlist_id,'creator_benefit_campaign.saved',
    'live_benefit_campaign',v_id::text,p_correlation_id,
    jsonb_build_object('celebrityId',p_celebrity_id,'benefitCount',jsonb_array_length(p_benefits))
  );
  return v_id;
end;
$$;

create or replace function public.publish_admin_benefit_campaign(
  p_actor_app_user_id uuid,p_actor_admin_allowlist_id uuid,p_correlation_id uuid,
  p_campaign_id uuid,p_expected_revision integer
) returns void language plpgsql security definer set search_path='' as $$
declare v public.live_benefit_campaigns%rowtype;
begin
  perform public.assert_active_admin(p_actor_app_user_id,p_actor_admin_allowlist_id,true);
  select * into v from public.live_benefit_campaigns where id=p_campaign_id for update;
  if not found then raise exception 'benefit campaign not found'; end if;
  if p_expected_revision is null or v.revision is distinct from p_expected_revision then
    raise exception 'benefit campaign revision conflict';
  end if;
  if v.status<>'draft' then raise exception 'benefit campaign is immutable'; end if;
  if not exists(select 1 from public.live_benefit_campaign_items where campaign_id=v.id) then
    raise exception 'campaign benefits required';
  end if;
  if exists(
    select 1 from public.live_benefit_campaign_items i join public.benefits b on b.id=i.benefit_id
    where i.campaign_id=v.id and b.publication_status<>'published'
  ) then raise exception 'campaign requires published benefits'; end if;
  if v.live_event_id is null then
    if not exists(select 1 from public.celebrities c where c.id=v.celebrity_id and c.status='published' and c.archived_at is null) then
      raise exception 'CREATOR_RAFFLE_REQUIRES_PUBLISHED_CREATOR';
    end if;
    if exists(
      select 1 from public.live_benefit_campaign_items i join public.benefits b on b.id=i.benefit_id
      where i.campaign_id=v.id and b.celebrity_id is distinct from v.celebrity_id
    ) then raise exception 'BENEFIT_CAMPAIGN_OWNER_MISMATCH'; end if;
    if exists(
      select 1 from public.live_benefit_campaign_items i
      where i.campaign_id=v.id and i.active_fulfillment_policy_version is null
    ) then raise exception 'RAFFLE_POLICY_NOT_ACTIVE'; end if;
  end if;
  update public.live_benefit_campaigns set status='published',published_at=pg_catalog.now(),revision=revision+1
    where id=v.id;
  insert into public.audit_logs(
    actor_app_user_id,actor_admin_allowlist_id,action,entity_type,entity_id,
    correlation_id,before_after_summary
  ) values(
    p_actor_app_user_id,p_actor_admin_allowlist_id,'benefit_campaign.published',
    'live_benefit_campaign',v.id::text,p_correlation_id,jsonb_build_object('from','draft','to','published')
  );
end;
$$;

create or replace function public.get_admin_benefit_campaigns(
  p_actor_app_user_id uuid,p_actor_admin_allowlist_id uuid
) returns jsonb language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(jsonb_set(item,'{benefits}',coalesce((
    select jsonb_agg(benefit_item || jsonb_build_object(
      'teaserImageUrl',campaign_item.teaser_image_url,
      'activeFulfillmentPolicyVersion',campaign_item.active_fulfillment_policy_version)
      order by (benefit_item->>'priority')::integer,(benefit_item->>'benefitId')::uuid)
    from jsonb_array_elements(item->'benefits') benefit_item
    join public.live_benefit_campaign_items campaign_item
      on campaign_item.campaign_id=c.id and campaign_item.benefit_id=(benefit_item->>'benefitId')::uuid
  ),'[]'::jsonb)) || jsonb_build_object(
    'liveEventId',c.live_event_id,'celebrityId',c.celebrity_id,
    'publicTeaser',c.public_teaser,'cancelledAt',c.cancelled_at,
    'cancellationReason',c.cancellation_reason,
    'drawPublishedAt',(select p.published_at from public.benefit_draws d join public.benefit_draw_publications p on p.draw_id=d.id where d.campaign_id=c.id)
  ) order by c.created_at desc,c.id desc),'[]'::jsonb)
  from jsonb_array_elements(public.get_admin_benefit_campaigns_base(p_actor_app_user_id,p_actor_admin_allowlist_id)) item
  join public.live_benefit_campaigns c on c.id=(item->>'id')::uuid;
$$;

create or replace function public.get_public_raffles(
  p_celebrity_slug text,p_locale public.content_locale,p_now timestamptz default pg_catalog.now()
) returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object('raffles',coalesce(jsonb_agg(jsonb_build_object(
    'id',i.id,'benefitId',i.benefit_id,'title',coalesce(l.title,b.slug),
    'summary',coalesce(l.summary,b.slug),'imageUrl',i.teaser_image_url,
    'winnerQuantity',i.winner_quantity,
    'status',case when c.cancelled_at is not null then 'cancelled'
      when c.status='draft' then 'preparing' when p_now<c.entry_opens_at then 'preparing'
      when p_now<c.entry_closes_at then 'open' else 'closed' end,
    'entryOpensAt',c.entry_opens_at,'entryClosesAt',c.entry_closes_at,
    'fulfillmentMethod',i.fulfillment_method,'perFanTicketLimit',i.per_fan_ticket_limit,
    'requiresFanVerification',c.live_event_id is null,
    'fulfillmentPolicy',public.raffle_fulfillment_policy_json(c.id,i.benefit_id,i.active_fulfillment_policy_version)
  ) order by c.entry_opens_at nulls last,i.priority,c.id),'[]'::jsonb))
  from public.live_benefit_campaigns c
  left join public.live_events e on e.id=c.live_event_id
  join public.celebrities celebrity
    on celebrity.id=coalesce(c.celebrity_id,e.celebrity_id) and celebrity.slug=p_celebrity_slug
  join public.live_benefit_campaign_items i on i.campaign_id=c.id
  join public.benefits b on b.id=i.benefit_id
  left join public.benefit_localizations l on l.benefit_id=b.id and l.locale=p_locale
  where celebrity.status='published' and celebrity.archived_at is null and b.archived_at is null
    and (c.live_event_id is null or (e.publication_status='published' and e.archived_at is null))
    and ((c.status='published' and b.publication_status='published')
      or (c.status='draft' and c.public_teaser and b.publication_status='draft'));
$$;

create or replace function public.get_owned_benefit_entry_state(
  p_app_user_id uuid,p_benefit_id uuid
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  result jsonb; v_campaign public.live_benefit_campaigns%rowtype; v_item public.live_benefit_campaign_items%rowtype;
  v_owner uuid; v_total bigint; v_balance bigint; v_verified boolean;
begin
  select c.* into v_campaign from public.live_benefit_campaigns c
  join public.live_benefit_campaign_items i on i.campaign_id=c.id
  where i.benefit_id=p_benefit_id and c.status='published'
  order by c.entry_closes_at desc,c.id desc limit 1;
  if not found then return null; end if;
  select * into strict v_item from public.live_benefit_campaign_items
    where campaign_id=v_campaign.id and benefit_id=p_benefit_id;
  select coalesce(v_campaign.celebrity_id,e.celebrity_id) into v_owner
    from (select 1) x left join public.live_events e on e.id=v_campaign.live_event_id;
  select coalesce(sum(ticket_amount),0) into v_total from public.benefit_ticket_entries
    where app_user_id=p_app_user_id and campaign_id=v_campaign.id and benefit_id=p_benefit_id;
  v_balance:=public.get_fan_ticket_balance(p_app_user_id,v_owner);
  v_verified:=v_campaign.live_event_id is not null or exists(
    select 1 from public.fan_passports p
    where p.app_user_id=p_app_user_id and p.celebrity_id=v_owner and p.business_status='issued'
  );
  result:=jsonb_build_object(
    'campaignId',v_campaign.id,'creatorTicketBalance',v_balance,'enteredTickets',v_total,
    'perFanTicketLimit',v_item.per_fan_ticket_limit,
    'remainingBenefitTickets',case when v_item.per_fan_ticket_limit is null then null else greatest(v_item.per_fan_ticket_limit-v_total,0) end,
    'entryOpensAt',v_campaign.entry_opens_at,'entryClosesAt',v_campaign.entry_closes_at,
    'requiresFanVerification',v_campaign.live_event_id is null,'fanVerified',v_verified,
    'canEnter',v_campaign.cancelled_at is null and v_verified
      and pg_catalog.now()>=v_campaign.entry_opens_at and pg_catalog.now()<v_campaign.entry_closes_at,
    'entries',coalesce((select jsonb_agg(jsonb_build_object(
      'entryId',e.id,'ticketAmount',e.ticket_amount,'enteredAt',e.entered_at
    ) order by e.entered_at desc,e.id desc) from public.benefit_ticket_entries e
      where e.app_user_id=p_app_user_id and e.campaign_id=v_campaign.id and e.benefit_id=p_benefit_id),'[]'::jsonb),
    'fulfillmentPolicy',public.raffle_fulfillment_policy_json(
      v_campaign.id,p_benefit_id,v_item.active_fulfillment_policy_version)
  );
  return result;
end;
$$;

alter function public.enter_owned_benefit_v2(uuid,uuid,uuid,integer,text,boolean,timestamptz)
  rename to enter_owned_benefit_v2_before_creator_fan_gate;
create function public.enter_owned_benefit_v2(
  p_app_user_id uuid,p_benefit_id uuid,p_idempotency_key uuid,p_ticket_amount integer,
  p_policy_version text,p_can_receive_in_korea boolean,p_now timestamptz default pg_catalog.now()
) returns jsonb language plpgsql security definer set search_path='' as $$
declare existing public.benefit_ticket_entries%rowtype; v_owner uuid; v_standalone boolean;
begin
  if p_idempotency_key is not null then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('phase4:benefit-entry:key:'||p_idempotency_key::text,0));
    select * into existing from public.benefit_ticket_entries where idempotency_key=p_idempotency_key;
    if found then
      return public.enter_owned_benefit_v2_before_creator_fan_gate(
        p_app_user_id,p_benefit_id,p_idempotency_key,p_ticket_amount,p_policy_version,
        p_can_receive_in_korea,p_now);
    end if;
  end if;
  select c.live_event_id is null,coalesce(c.celebrity_id,e.celebrity_id)
    into v_standalone,v_owner
  from public.live_benefit_campaigns c
  join public.live_benefit_campaign_items i on i.campaign_id=c.id
  left join public.live_events e on e.id=c.live_event_id
  where i.benefit_id=p_benefit_id and c.status='published'
  order by c.entry_closes_at desc,c.id desc limit 1;
  if coalesce(v_standalone,false) and not exists(
    select 1 from public.fan_passports p
    where p.app_user_id=p_app_user_id and p.celebrity_id=v_owner and p.business_status='issued'
  ) then raise exception 'eligible fan passport is required'; end if;
  return public.enter_owned_benefit_v2_before_creator_fan_gate(
    p_app_user_id,p_benefit_id,p_idempotency_key,p_ticket_amount,p_policy_version,
    p_can_receive_in_korea,p_now);
end;
$$;

alter function public.enter_owned_benefit(uuid,uuid,uuid,integer,timestamptz)
  rename to enter_owned_benefit_before_creator_fan_gate;
create function public.enter_owned_benefit(
  p_app_user_id uuid,p_benefit_id uuid,p_idempotency_key uuid,p_ticket_amount integer,
  p_now timestamptz default pg_catalog.now()
) returns jsonb language plpgsql security definer set search_path='' as $$
declare existing public.benefit_ticket_entries%rowtype; v_owner uuid; v_standalone boolean;
begin
  if p_idempotency_key is not null then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('phase4:benefit-entry:key:'||p_idempotency_key::text,0));
    select * into existing from public.benefit_ticket_entries where idempotency_key=p_idempotency_key;
    if found then return public.enter_owned_benefit_before_creator_fan_gate(
      p_app_user_id,p_benefit_id,p_idempotency_key,p_ticket_amount,p_now); end if;
  end if;
  select c.live_event_id is null,coalesce(c.celebrity_id,e.celebrity_id)
    into v_standalone,v_owner
  from public.live_benefit_campaigns c
  join public.live_benefit_campaign_items i on i.campaign_id=c.id
  left join public.live_events e on e.id=c.live_event_id
  where i.benefit_id=p_benefit_id and c.status='published'
  order by c.entry_closes_at desc,c.id desc limit 1;
  if coalesce(v_standalone,false) and not exists(
    select 1 from public.fan_passports p
    where p.app_user_id=p_app_user_id and p.celebrity_id=v_owner and p.business_status='issued'
  ) then raise exception 'eligible fan passport is required'; end if;
  return public.enter_owned_benefit_before_creator_fan_gate(
    p_app_user_id,p_benefit_id,p_idempotency_key,p_ticket_amount,p_now);
end;
$$;

create function public.is_standalone_raffle_benefit(p_benefit_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(
    select 1 from public.live_benefit_campaign_items i
    join public.live_benefit_campaigns c on c.id=i.campaign_id
    where i.benefit_id=p_benefit_id and c.live_event_id is null
  );
$$;

alter function public.submit_benefit_application(uuid,uuid,uuid,timestamptz)
  rename to submit_benefit_application_before_creator_raffle_gate;
create function public.submit_benefit_application(
  p_benefit_id uuid,p_app_user_id uuid,p_idempotency_key uuid,
  p_now timestamptz default pg_catalog.now()
) returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if exists(select 1 from public.benefit_applications a
    where a.idempotency_key=p_idempotency_key) then
    return public.submit_benefit_application_before_creator_raffle_gate(
      p_benefit_id,p_app_user_id,p_idempotency_key,p_now);
  end if;
  if p_benefit_id is not null then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
      'creator-raffle:benefit-binding:'||p_benefit_id::text,0));
  end if;
  if public.is_standalone_raffle_benefit(p_benefit_id) then
    raise exception 'CREATOR_RAFFLE_LEGACY_ROUTE_FORBIDDEN';
  end if;
  return public.submit_benefit_application_before_creator_raffle_gate(
    p_benefit_id,p_app_user_id,p_idempotency_key,p_now);
end;
$$;

alter function public.claim_benefit(uuid,uuid,uuid,timestamptz)
  rename to claim_benefit_before_creator_raffle_gate;
create function public.claim_benefit(
  p_benefit_id uuid,p_app_user_id uuid,p_idempotency_key uuid,
  p_now timestamptz default pg_catalog.now()
) returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if exists(select 1 from public.benefit_claims c
    where c.idempotency_key=p_idempotency_key) then
    return public.claim_benefit_before_creator_raffle_gate(
      p_benefit_id,p_app_user_id,p_idempotency_key,p_now);
  end if;
  if p_benefit_id is not null then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
      'creator-raffle:benefit-binding:'||p_benefit_id::text,0));
  end if;
  if public.is_standalone_raffle_benefit(p_benefit_id) then
    raise exception 'CREATOR_RAFFLE_LEGACY_ROUTE_FORBIDDEN';
  end if;
  return public.claim_benefit_before_creator_raffle_gate(
    p_benefit_id,p_app_user_id,p_idempotency_key,p_now);
end;
$$;

-- Preserve creator attribution for standalone campaigns in committed events,
-- Telegram draw alerts, and the platform active-creator aggregate. Guarded
-- replacements make canonical-function drift fail the migration visibly.
do $$
declare v_definition text; v_rewritten text;
begin
  select pg_catalog.pg_get_functiondef(
    'public.project_committed_product_event_v1()'::regprocedure) into v_definition;
  if (length(v_definition)-length(replace(v_definition,
    'select c.live_event_id,e.celebrity_id into v_live,v_celebrity from public.live_benefit_campaigns c join public.live_events e on e.id=c.live_event_id where c.id=new.campaign_id;','')))
    /length('select c.live_event_id,e.celebrity_id into v_live,v_celebrity from public.live_benefit_campaigns c join public.live_events e on e.id=c.live_event_id where c.id=new.campaign_id;')<>2 then
    raise exception 'creator raffle product-event campaign attribution fragment count changed';
  end if;
  if (length(v_definition)-length(replace(v_definition,
      'select w.app_user_id,w.benefit_id,c.live_event_id,e.celebrity_id','')))
      /length('select w.app_user_id,w.benefit_id,c.live_event_id,e.celebrity_id')<>1
    or (length(v_definition)-length(replace(v_definition,
      'join public.live_benefit_campaigns c on c.id=w.campaign_id join public.live_events e on e.id=c.live_event_id','')))
      /length('join public.live_benefit_campaigns c on c.id=w.campaign_id join public.live_events e on e.id=c.live_event_id')<>1 then
    raise exception 'creator raffle product-event fulfillment attribution fragments changed';
  end if;
  v_rewritten:=replace(v_definition,
    'select c.live_event_id,e.celebrity_id into v_live,v_celebrity from public.live_benefit_campaigns c join public.live_events e on e.id=c.live_event_id where c.id=new.campaign_id;',
    'select c.live_event_id,coalesce(c.celebrity_id,e.celebrity_id) into v_live,v_celebrity from public.live_benefit_campaigns c left join public.live_events e on e.id=c.live_event_id where c.id=new.campaign_id;');
  v_rewritten:=replace(v_rewritten,
    'select w.app_user_id,w.benefit_id,c.live_event_id,e.celebrity_id',
    'select w.app_user_id,w.benefit_id,c.live_event_id,coalesce(c.celebrity_id,e.celebrity_id)');
  v_rewritten:=replace(v_rewritten,
    'join public.live_benefit_campaigns c on c.id=w.campaign_id join public.live_events e on e.id=c.live_event_id',
    'join public.live_benefit_campaigns c on c.id=w.campaign_id left join public.live_events e on e.id=c.live_event_id');
  if v_rewritten is not distinct from v_definition
    or position('coalesce(c.celebrity_id,e.celebrity_id)' in v_rewritten)=0
    or position('left join public.live_events e on e.id=c.live_event_id' in v_rewritten)=0 then
    raise exception 'creator raffle product-event attribution rewrite did not match canonical function';
  end if;
  execute v_rewritten;

  select pg_catalog.pg_get_functiondef(
    'public.capture_telegram_major_event()'::regprocedure) into v_definition;
  if (length(v_definition)-length(replace(v_definition,
    'select c.live_event_id,l.celebrity_id into live_id,creator','')))
      /length('select c.live_event_id,l.celebrity_id into live_id,creator')<>1
    or (length(v_definition)-length(replace(v_definition,
    'from public.live_benefit_campaigns c join public.live_events l on l.id=c.live_event_id where c.id=new.campaign_id;','')))
      /length('from public.live_benefit_campaigns c join public.live_events l on l.id=c.live_event_id where c.id=new.campaign_id;')<>1 then
    raise exception 'creator raffle Telegram attribution fragment count changed';
  end if;
  v_rewritten:=replace(v_definition,
    'select c.live_event_id,l.celebrity_id into live_id,creator',
    'select c.live_event_id,coalesce(c.celebrity_id,l.celebrity_id) into live_id,creator');
  v_rewritten:=replace(v_rewritten,
    'from public.live_benefit_campaigns c join public.live_events l on l.id=c.live_event_id where c.id=new.campaign_id;',
    'from public.live_benefit_campaigns c left join public.live_events l on l.id=c.live_event_id where c.id=new.campaign_id;');
  if v_rewritten is not distinct from v_definition
    or position('coalesce(c.celebrity_id,l.celebrity_id)' in v_rewritten)=0
    or position('left join public.live_events l on l.id=c.live_event_id' in v_rewritten)=0 then
    raise exception 'creator raffle Telegram attribution rewrite did not match canonical function';
  end if;
  execute v_rewritten;

  select pg_catalog.pg_get_functiondef(
    'public.read_admin_platform_analytics(uuid,uuid,timestamptz,timestamptz,timestamptz)'::regprocedure)
    into v_definition;
  if (length(v_definition)-length(replace(v_definition,
    'union select e.celebrity_id from public.benefit_ticket_entries b join public.live_benefit_campaigns c on c.id=b.campaign_id join public.live_events e on e.id=c.live_event_id where b.entered_at>=p_from and b.entered_at<p_to','')))
      /length('union select e.celebrity_id from public.benefit_ticket_entries b join public.live_benefit_campaigns c on c.id=b.campaign_id join public.live_events e on e.id=c.live_event_id where b.entered_at>=p_from and b.entered_at<p_to')<>1 then
    raise exception 'creator raffle analytics attribution fragment count changed';
  end if;
  v_rewritten:=replace(v_definition,
    'union select e.celebrity_id from public.benefit_ticket_entries b join public.live_benefit_campaigns c on c.id=b.campaign_id join public.live_events e on e.id=c.live_event_id where b.entered_at>=p_from and b.entered_at<p_to',
    'union select coalesce(c.celebrity_id,e.celebrity_id) from public.benefit_ticket_entries b join public.live_benefit_campaigns c on c.id=b.campaign_id left join public.live_events e on e.id=c.live_event_id where b.entered_at>=p_from and b.entered_at<p_to');
  if v_rewritten is not distinct from v_definition
    or position('coalesce(c.celebrity_id,e.celebrity_id)' in v_rewritten)=0
    or position('left join public.live_events e on e.id=c.live_event_id' in v_rewritten)=0 then
    raise exception 'creator raffle analytics attribution rewrite did not match canonical function';
  end if;
  execute v_rewritten;
end;
$$;

revoke all on function public.enforce_creator_raffle_campaign_owner(),
  public.enforce_benefit_campaign_item_owner(),public.enforce_campaign_bound_benefit_owner(),
  public.is_standalone_raffle_benefit(uuid),
  public.enter_owned_benefit_v2_before_creator_fan_gate(uuid,uuid,uuid,integer,text,boolean,timestamptz),
  public.enter_owned_benefit_before_creator_fan_gate(uuid,uuid,uuid,integer,timestamptz),
  public.submit_benefit_application_before_creator_raffle_gate(uuid,uuid,uuid,timestamptz),
  public.claim_benefit_before_creator_raffle_gate(uuid,uuid,uuid,timestamptz)
  from public,anon,authenticated,service_role;
revoke all on function public.save_admin_creator_benefit_campaign(uuid,uuid,uuid,uuid,integer,uuid,timestamptz,timestamptz,jsonb,boolean)
  from public,anon,authenticated,service_role;
grant execute on function public.save_admin_creator_benefit_campaign(uuid,uuid,uuid,uuid,integer,uuid,timestamptz,timestamptz,jsonb,boolean)
  to service_role;
revoke all on function public.enter_owned_benefit_v2(uuid,uuid,uuid,integer,text,boolean,timestamptz),
  public.enter_owned_benefit(uuid,uuid,uuid,integer,timestamptz),
  public.submit_benefit_application(uuid,uuid,uuid,timestamptz),
  public.claim_benefit(uuid,uuid,uuid,timestamptz),
  public.get_owned_benefit_entry_state(uuid,uuid),
  public.get_public_raffles(text,public.content_locale,timestamptz),
  public.get_admin_benefit_campaigns(uuid,uuid),public.publish_admin_benefit_campaign(uuid,uuid,uuid,uuid,integer)
  from public,anon,authenticated,service_role;
grant execute on function public.enter_owned_benefit_v2(uuid,uuid,uuid,integer,text,boolean,timestamptz),
  public.enter_owned_benefit(uuid,uuid,uuid,integer,timestamptz),
  public.submit_benefit_application(uuid,uuid,uuid,timestamptz),
  public.claim_benefit(uuid,uuid,uuid,timestamptz),
  public.get_owned_benefit_entry_state(uuid,uuid),
  public.get_public_raffles(text,public.content_locale,timestamptz),
  public.get_admin_benefit_campaigns(uuid,uuid),public.publish_admin_benefit_campaign(uuid,uuid,uuid,uuid,integer)
  to service_role;
