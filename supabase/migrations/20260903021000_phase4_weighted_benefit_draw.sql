-- Canonical one-time weighted draw. SQL owns the snapshot and selection;
-- TypeScript mirrors the exact bytes/formula only as a deterministic oracle.

alter table public.benefit_draw_candidates
  add constraint benefit_draw_candidates_full_identity_unique
  unique (id,draw_id,campaign_id,benefit_id,app_user_id);
alter table public.benefit_draw_winners
  drop constraint benefit_draw_winners_candidate_id_fkey,
  add constraint benefit_draw_winner_candidate_identity_fk
  foreign key (candidate_id,draw_id,campaign_id,benefit_id,app_user_id)
  references public.benefit_draw_candidates(id,draw_id,campaign_id,benefit_id,app_user_id)
  on delete restrict;

create function public.benefit_digest_uint256(p_digest bytea)
returns numeric language plpgsql immutable strict set search_path = '' as $$
declare v numeric:=0; i integer;
begin
  if octet_length(p_digest)<>32 then raise exception 'digest must contain 32 bytes'; end if;
  for i in 0..31 loop v:=v*256+get_byte(p_digest,i); end loop;
  return v;
end;
$$;

create function public.execute_admin_benefit_draw(
  p_actor_app_user_id uuid,
  p_actor_admin_allowlist_id uuid,
  p_correlation_id uuid,
  p_campaign_id uuid,
  p_idempotency_key uuid,
  p_now timestamptz default pg_catalog.now()
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_campaign public.live_benefit_campaigns%rowtype;
  v_existing public.benefit_draws%rowtype;
  v_draw_id uuid:=extensions.gen_random_uuid();
  v_seed bytea:=extensions.gen_random_bytes(32);
  v_seed_hash text;
  v_item public.live_benefit_campaign_items%rowtype;
  v_candidate_count integer;
begin
  perform public.assert_active_admin(p_actor_app_user_id,p_actor_admin_allowlist_id,true);
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('phase4:benefit-draw:key:'||p_idempotency_key::text,0)
  );
  select * into v_existing from public.benefit_draws where idempotency_key=p_idempotency_key;
  if found then
    if v_existing.campaign_id<>p_campaign_id then
      raise exception 'PHASE4_BENEFIT_DRAW_IDEMPOTENCY_CONFLICT' using errcode='23514';
    end if;
    return jsonb_build_object(
      'drawId',v_existing.id,'campaignId',v_existing.campaign_id,
      'algorithm',v_existing.algorithm,'seedHash',v_existing.seed_hash,
      'executedAt',v_existing.executed_at,
      'candidateCount',(select count(*) from public.benefit_draw_candidates where draw_id=v_existing.id),
      'winners',coalesce((select jsonb_agg(jsonb_build_object(
        'winnerId',w.id,'benefitId',w.benefit_id,'appUserId',w.app_user_id,'weight',c.weight
      ) order by i.priority,c.rank_value,w.app_user_id) from public.benefit_draw_winners w
        join public.benefit_draw_candidates c on c.id=w.candidate_id
        join public.live_benefit_campaign_items i on i.campaign_id=w.campaign_id and i.benefit_id=w.benefit_id
        where w.draw_id=v_existing.id),'[]'::jsonb),'replayed',true
    );
  end if;

  select * into v_campaign from public.live_benefit_campaigns
    where id=p_campaign_id for update;
  if not found then raise exception 'PHASE4_BENEFIT_DRAW_NOT_FOUND'; end if;
  if v_campaign.status<>'published' then raise exception 'PHASE4_BENEFIT_DRAW_NOT_PUBLISHED'; end if;
  if p_now<v_campaign.entry_closes_at then raise exception 'PHASE4_BENEFIT_DRAW_ENTRY_OPEN'; end if;
  if exists(select 1 from public.benefit_draws where campaign_id=p_campaign_id) then
    raise exception 'PHASE4_BENEFIT_DRAW_ALREADY_EXECUTED' using errcode='23514';
  end if;
  if not exists(select 1 from public.live_benefit_campaign_items where campaign_id=p_campaign_id) then
    raise exception 'PHASE4_BENEFIT_DRAW_EMPTY_CAMPAIGN';
  end if;

  v_seed_hash:=encode(extensions.digest(v_seed,'sha256'),'hex');
  insert into public.benefit_draws(
    id,campaign_id,idempotency_key,algorithm,seed_hash,actor_app_user_id,
    actor_admin_allowlist_id,correlation_id,executed_at
  ) values(
    v_draw_id,p_campaign_id,p_idempotency_key,'sha256-weighted-rank-v1',v_seed_hash,
    p_actor_app_user_id,p_actor_admin_allowlist_id,p_correlation_id,p_now
  );
  insert into public.benefit_draw_secrets(draw_id,raw_seed) values(v_draw_id,v_seed);

  for v_item in
    select * from public.live_benefit_campaign_items
    where campaign_id=p_campaign_id order by priority,benefit_id
  loop
    with weights as (
      select e.app_user_id,sum(e.ticket_amount)::integer weight
      from public.benefit_ticket_entries e
      where e.campaign_id=p_campaign_id and e.benefit_id=v_item.benefit_id
      group by e.app_user_id having sum(e.ticket_amount)>0
    ), digests as (
      select w.*,extensions.digest(
        v_seed||pg_catalog.uuid_send(v_item.benefit_id)||pg_catalog.uuid_send(w.app_user_id),
        'sha256'
      ) digest_bytes from weights w
    ), scored as (
      select d.*,public.benefit_digest_uint256(d.digest_bytes) digest_number,
        (public.benefit_digest_uint256(d.digest_bytes)+1)
          /(power(2::numeric,256)+1) uniform_value
      from digests d
    ), ranked as (
      select s.*,
        (-ln(s.uniform_value)/s.weight)::double precision rank_value
      from scored s
    ), ordered as (
      select r.*,row_number() over(order by r.rank_value,r.app_user_id) ordinal
      from ranked r
    )
    insert into public.benefit_draw_candidates(
      draw_id,campaign_id,benefit_id,app_user_id,weight,digest,
      uniform_value,rank_value,result
    ) select v_draw_id,p_campaign_id,v_item.benefit_id,o.app_user_id,o.weight,
      encode(o.digest_bytes,'hex'),o.uniform_value,o.rank_value,
      case when o.ordinal<=v_item.winner_quantity then 'won'::public.benefit_draw_candidate_result
           else 'not_selected'::public.benefit_draw_candidate_result end
    from ordered o;

    insert into public.benefit_draw_winners(
      draw_id,campaign_id,benefit_id,app_user_id,candidate_id,selected_at
    ) select c.draw_id,c.campaign_id,c.benefit_id,c.app_user_id,c.id,p_now
      from public.benefit_draw_candidates c
      where c.draw_id=v_draw_id and c.benefit_id=v_item.benefit_id and c.result='won'
      order by c.rank_value,c.app_user_id;
  end loop;

  insert into public.benefit_fulfillments(winner_id,method,status)
    select w.id,i.fulfillment_method,
      case when i.fulfillment_method='digital' then 'ready'::public.benefit_fulfillment_status
           else 'information_required'::public.benefit_fulfillment_status end
    from public.benefit_draw_winners w
    join public.live_benefit_campaign_items i on i.campaign_id=w.campaign_id and i.benefit_id=w.benefit_id
    where w.draw_id=v_draw_id;
  insert into public.benefit_fulfillment_events(
    fulfillment_id,from_status,to_status,actor_app_user_id,
    actor_admin_allowlist_id,correlation_id,created_at
  ) select f.id,null,f.status,p_actor_app_user_id,p_actor_admin_allowlist_id,p_correlation_id,p_now
    from public.benefit_fulfillments f join public.benefit_draw_winners w on w.id=f.winner_id
    where w.draw_id=v_draw_id;

  -- Sanitized in-app intent: only operational IDs, never seed or recipient data.
  insert into public.fan_notifications(
    app_user_id,kind,source_key,benefit_id,scheduled_for
  ) select w.app_user_id,'benefit_available',
      'benefit-draw:'||v_draw_id::text||':'||w.benefit_id::text,w.benefit_id,p_now
    from public.benefit_draw_winners w where w.draw_id=v_draw_id
    on conflict (app_user_id,source_key) do nothing;

  insert into public.audit_logs(
    actor_app_user_id,actor_admin_allowlist_id,action,entity_type,entity_id,
    correlation_id,before_after_summary
  ) values(
    p_actor_app_user_id,p_actor_admin_allowlist_id,'benefit_campaign.draw_executed',
    'live_benefit_campaign',p_campaign_id::text,p_correlation_id,
    jsonb_build_object('drawId',v_draw_id,'algorithm','sha256-weighted-rank-v1',
      'seedHash',v_seed_hash,'candidateCount',(select count(*) from public.benefit_draw_candidates where draw_id=v_draw_id),
      'winnerCount',(select count(*) from public.benefit_draw_winners where draw_id=v_draw_id))
  );
  select count(*) into v_candidate_count from public.benefit_draw_candidates where draw_id=v_draw_id;
  return jsonb_build_object(
    'drawId',v_draw_id,'campaignId',p_campaign_id,'algorithm','sha256-weighted-rank-v1',
    'seedHash',v_seed_hash,'executedAt',p_now,'candidateCount',v_candidate_count,
    'winners',coalesce((select jsonb_agg(jsonb_build_object(
      'winnerId',w.id,'benefitId',w.benefit_id,'appUserId',w.app_user_id,'weight',c.weight
    ) order by i.priority,c.rank_value,w.app_user_id) from public.benefit_draw_winners w
      join public.benefit_draw_candidates c on c.id=w.candidate_id
      join public.live_benefit_campaign_items i on i.campaign_id=w.campaign_id and i.benefit_id=w.benefit_id
      where w.draw_id=v_draw_id),'[]'::jsonb),'replayed',false
  );
end;
$$;

revoke all on function public.benefit_digest_uint256(bytea) from public,anon,authenticated;
revoke all on function public.execute_admin_benefit_draw(uuid,uuid,uuid,uuid,uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.execute_admin_benefit_draw(uuid,uuid,uuid,uuid,uuid,timestamptz) to service_role;
