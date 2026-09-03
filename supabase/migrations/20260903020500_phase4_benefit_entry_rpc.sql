-- Atomic, replay-safe repeated Ticket entry. There is intentionally no
-- campaign-wide cap; only an optional positive limit on the selected Benefit.

alter table public.benefit_ticket_entries
  add column benefit_ticket_total integer not null check (benefit_ticket_total > 0),
  add column per_fan_ticket_limit integer,
  add constraint benefit_ticket_entry_limit_snapshot_positive check (
    per_fan_ticket_limit is null or per_fan_ticket_limit > 0
  ),
  add constraint benefit_ticket_entry_total_within_limit check (
    per_fan_ticket_limit is null or benefit_ticket_total <= per_fan_ticket_limit
  );

create function public.get_owned_benefit_entry_state(
  p_app_user_id uuid,
  p_benefit_id uuid
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_campaign_id uuid;
  v_entry_opens_at timestamptz;
  v_entry_closes_at timestamptz;
  v_limit integer;
  v_celebrity_id uuid;
  v_total bigint;
  v_balance bigint;
begin
  select c.id,c.entry_opens_at,c.entry_closes_at,i.per_fan_ticket_limit
    into v_campaign_id,v_entry_opens_at,v_entry_closes_at,v_limit
  from public.live_benefit_campaigns c
  join public.live_benefit_campaign_items i on i.campaign_id=c.id
  where i.benefit_id=p_benefit_id and c.status='published'
  order by c.entry_closes_at desc,c.id desc limit 1;
  if not found then return null; end if;
  select b.celebrity_id into v_celebrity_id from public.benefits b where b.id=p_benefit_id;
  select coalesce(sum(e.ticket_amount),0) into v_total
    from public.benefit_ticket_entries e
    where e.app_user_id=p_app_user_id and e.campaign_id=v_campaign_id and e.benefit_id=p_benefit_id;
  v_balance:=public.get_fan_ticket_balance(p_app_user_id,v_celebrity_id);
  return jsonb_build_object(
    'campaignId',v_campaign_id,
    'creatorTicketBalance',v_balance,
    'enteredTickets',v_total,
    'perFanTicketLimit',v_limit,
    'remainingBenefitTickets',case when v_limit is null then null else greatest(v_limit-v_total,0) end,
    'entryOpensAt',v_entry_opens_at,
    'entryClosesAt',v_entry_closes_at,
    'canEnter',pg_catalog.now()>=v_entry_opens_at and pg_catalog.now()<v_entry_closes_at,
    'entries',coalesce((select jsonb_agg(jsonb_build_object(
      'entryId',e.id,'ticketAmount',e.ticket_amount,'enteredAt',e.entered_at
    ) order by e.entered_at desc,e.id desc) from public.benefit_ticket_entries e
      where e.app_user_id=p_app_user_id and e.campaign_id=v_campaign_id and e.benefit_id=p_benefit_id),'[]'::jsonb)
  );
end;
$$;

create function public.enter_owned_benefit(
  p_app_user_id uuid,
  p_benefit_id uuid,
  p_idempotency_key uuid,
  p_ticket_amount integer,
  p_now timestamptz default pg_catalog.now()
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_existing public.benefit_ticket_entries%rowtype;
  v_campaign_id uuid;
  v_status public.benefit_campaign_status;
  v_entry_opens_at timestamptz;
  v_entry_closes_at timestamptz;
  v_limit integer;
  v_celebrity_id uuid;
  v_benefit_status public.content_status;
  v_current_total bigint;
  v_next_total bigint;
  v_policy_version integer;
  v_entry_id uuid:=extensions.gen_random_uuid();
  v_ledger jsonb;
begin
  if p_app_user_id is null or p_benefit_id is null or p_idempotency_key is null
     or p_ticket_amount is null or p_ticket_amount <= 0 then
    raise exception 'PHASE4_BENEFIT_ENTRY_INVALID';
  end if;

  -- Lock order is global request key, fan x Benefit aggregate, then fan x Creator balance.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('phase4:benefit-entry:key:'||p_idempotency_key::text,0)
  );
  select * into v_existing from public.benefit_ticket_entries
    where idempotency_key=p_idempotency_key;
  if found then
    if v_existing.app_user_id<>p_app_user_id or v_existing.benefit_id<>p_benefit_id
       or v_existing.ticket_amount<>p_ticket_amount then
      raise exception 'PHASE4_BENEFIT_ENTRY_IDEMPOTENCY_CONFLICT' using errcode='23514';
    end if;
    select jsonb_build_object(
      'entryId',v_existing.id,'benefitId',v_existing.benefit_id,
      'campaignId',v_existing.campaign_id,'ticketAmount',v_existing.ticket_amount,
      'benefitTicketTotal',v_existing.benefit_ticket_total,
      'perFanTicketLimit',v_existing.per_fan_ticket_limit,
      'remainingBenefitTickets',case when v_existing.per_fan_ticket_limit is null then null else v_existing.per_fan_ticket_limit-v_existing.benefit_ticket_total end,
      'ticketLedgerId',v_existing.ticket_ledger_id,'resultingBalance',l.resulting_balance,
      'replayed',true
    ) into v_ledger from public.fan_ticket_ledger l where l.id=v_existing.ticket_ledger_id;
    return v_ledger;
  end if;

  select c.id,c.status,c.entry_opens_at,c.entry_closes_at,i.per_fan_ticket_limit,
         b.celebrity_id,b.publication_status
    into v_campaign_id,v_status,v_entry_opens_at,v_entry_closes_at,v_limit,
         v_celebrity_id,v_benefit_status
  from public.live_benefit_campaigns c
  join public.live_benefit_campaign_items i on i.campaign_id=c.id
  join public.benefits b on b.id=i.benefit_id
  where i.benefit_id=p_benefit_id and c.status='published'
  order by c.entry_closes_at desc,c.id desc limit 1;
  if not found then raise exception 'PHASE4_BENEFIT_ENTRY_UNAVAILABLE'; end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('phase4:benefit-entry:aggregate:'||p_app_user_id::text||':'||p_benefit_id::text,0)
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('phase1:ticket:balance:'||p_app_user_id::text||':'||v_celebrity_id::text,0)
  );

  if v_status<>'published' or v_benefit_status<>'published' then
    raise exception 'PHASE4_BENEFIT_ENTRY_UNAVAILABLE';
  end if;
  if p_now<v_entry_opens_at or p_now>=v_entry_closes_at then
    raise exception 'PHASE4_BENEFIT_ENTRY_WINDOW_CLOSED';
  end if;
  select coalesce(sum(e.ticket_amount),0) into v_current_total
    from public.benefit_ticket_entries e
    where e.app_user_id=p_app_user_id and e.campaign_id=v_campaign_id and e.benefit_id=p_benefit_id;
  v_next_total:=v_current_total+p_ticket_amount;
  if v_limit is not null and v_next_total>v_limit then
    raise exception 'PHASE4_BENEFIT_ENTRY_LIMIT_REACHED' using errcode='23514';
  end if;
  select policy_version into v_policy_version
    from public.reward_policy_activation where singleton;
  if v_policy_version is null then raise exception 'PHASE4_BENEFIT_ENTRY_POLICY_UNAVAILABLE'; end if;

  v_ledger:=public.post_fan_ticket_entry(
    p_app_user_id,v_celebrity_id,'debit',-p_ticket_amount::bigint,
    'benefit_entry',v_entry_id,p_idempotency_key,v_policy_version,null,null
  );
  insert into public.benefit_ticket_entries(
    id,idempotency_key,campaign_id,benefit_id,app_user_id,ticket_amount,
    ticket_ledger_id,benefit_ticket_total,per_fan_ticket_limit
  ) values(
    v_entry_id,p_idempotency_key,v_campaign_id,p_benefit_id,p_app_user_id,p_ticket_amount,
    (v_ledger->>'entryId')::uuid,v_next_total::integer,v_limit
  ) returning * into v_existing;
  return jsonb_build_object(
    'entryId',v_existing.id,'benefitId',v_existing.benefit_id,
    'campaignId',v_existing.campaign_id,'ticketAmount',v_existing.ticket_amount,
    'benefitTicketTotal',v_existing.benefit_ticket_total,
    'perFanTicketLimit',v_existing.per_fan_ticket_limit,
    'remainingBenefitTickets',case when v_existing.per_fan_ticket_limit is null then null else v_existing.per_fan_ticket_limit-v_existing.benefit_ticket_total end,
    'ticketLedgerId',v_existing.ticket_ledger_id,'resultingBalance',(v_ledger->>'balance')::bigint,
    'replayed',false
  );
end;
$$;

-- PostgreSQL grants function execution to PUBLIC by default. All Phase 4
-- security-definer entry points are server-only, including the Task 1 RPCs.
revoke all on function public.get_admin_benefit_campaigns(uuid,uuid) from public,anon,authenticated;
revoke all on function public.save_admin_benefit_campaign(uuid,uuid,uuid,uuid,integer,uuid,timestamptz,timestamptz,jsonb) from public,anon,authenticated;
revoke all on function public.publish_admin_benefit_campaign(uuid,uuid,uuid,uuid,integer) from public,anon,authenticated;
revoke all on function public.get_owned_benefit_entry_state(uuid,uuid) from public,anon,authenticated;
revoke all on function public.enter_owned_benefit(uuid,uuid,uuid,integer,timestamptz) from public,anon,authenticated;
grant execute on function public.get_owned_benefit_entry_state(uuid,uuid) to service_role;
grant execute on function public.enter_owned_benefit(uuid,uuid,uuid,integer,timestamptz) to service_role;
