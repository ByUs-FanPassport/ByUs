do $$
declare
  owner_id uuid:=extensions.gen_random_uuid(); other_id uuid:=extensions.gen_random_uuid(); admin_id uuid:=extensions.gen_random_uuid();
  allowlist_id uuid:=extensions.gen_random_uuid(); template_live public.live_events%rowtype;
  event_ids uuid[]:=array[extensions.gen_random_uuid(),extensions.gen_random_uuid(),extensions.gen_random_uuid(),extensions.gen_random_uuid(),extensions.gen_random_uuid(),extensions.gen_random_uuid(),extensions.gen_random_uuid()];
  requirement_ids uuid[]:=array[extensions.gen_random_uuid(),extensions.gen_random_uuid(),extensions.gen_random_uuid(),extensions.gen_random_uuid(),extensions.gen_random_uuid(),extensions.gen_random_uuid(),extensions.gen_random_uuid()];
  completion_ids uuid[]:=array[extensions.gen_random_uuid(),extensions.gen_random_uuid(),extensions.gen_random_uuid(),extensions.gen_random_uuid(),extensions.gen_random_uuid(),extensions.gen_random_uuid(),extensions.gen_random_uuid()];
  setting_id uuid; setting_policy integer; i integer; observed timestamptz:=pg_catalog.statement_timestamp(); result jsonb; claimed_id uuid; before_ticket bigint; before_score bigint; claimed_job public.blockchain_jobs%rowtype;
begin
  insert into public.app_users(id,privy_user_id,verified_email) values(owner_id,'did:privy:collectible-owner','collectible-owner@example.com'),(other_id,'did:privy:collectible-other','collectible-other@example.com'),(admin_id,'did:privy:collectible-admin','collectible-admin@example.com');
  insert into public.user_wallets(app_user_id,chain_id,address) values(owner_id,91342,'0x1111111111111111111111111111111111111111'),(other_id,91342,'0x2222222222222222222222222222222222222222');
  insert into public.admin_allowlist(id,email,role,created_by_app_user_id) values(allowlist_id,'collectible-admin@example.com','admin',admin_id);
  select * into strict template_live from public.live_events where publication_status='published' limit 1;

  for i in 1..7 loop
    insert into public.live_events
    select (pg_catalog.jsonb_populate_record(null::public.live_events,to_jsonb(template_live)||jsonb_build_object(
      'id',event_ids[i],'slug','collectible-proof-'||i,'starts_at',case when i=7 then observed+interval '3 hours' else observed-interval '2 hours' end,
      'ends_at',case when i=7 then observed+interval '4 hours' when i in (1,5) then observed+interval '1 hour' else observed end,
      'reservation_opens_at',observed-interval '4 hours','reservation_closes_at',observed-interval '2 hours',
      'attendance_valid_from',observed-interval '2 hours','attendance_valid_until',observed+interval '2 hours',
      'schedule_revision',1,'publication_status','draft','created_at',observed,'updated_at',observed,'published_at',null,'ever_published_at',null
    ))).*;
    insert into public.live_event_localizations(live_event_id,locale,title,summary,hero_alt)
    select event_ids[i],locale,title,summary,hero_alt from public.live_event_localizations where live_event_id=template_live.id;
    update public.live_events set publication_status='published',published_at=observed-interval '1 day',ever_published_at=observed-interval '1 day' where id=event_ids[i];
    select id,policy_version into strict setting_id,setting_policy from public.live_reward_setting_revisions where live_event_id=event_ids[i] and revision=1;
    insert into public.live_journey_requirement_revisions(id,live_event_id,revision,lifecycle_status,require_passport,require_reservation,require_attendance,bonus_ticket_amount,reward_setting_revision_id,reward_setting_revision,policy_version,actor_app_user_id,actor_admin_allowlist_id,correlation_id,published_at)
    values(requirement_ids[i],event_ids[i],1,'published',true,false,false,0,setting_id,1,setting_policy,admin_id,allowlist_id,extensions.gen_random_uuid(),observed-interval '1 day');
    insert into public.live_journey_completions(id,app_user_id,live_event_id,requirement_revision_id,requirement_snapshot,bonus_ticket_amount,policy_version,reward_setting_revision,reward_setting_revision_id,ticket_ledger_id,completed_at)
    values(completion_ids[i],owner_id,event_ids[i],requirement_ids[i],'{}',0,setting_policy,1,setting_id,null,observed-interval '1 hour');
  end loop;

  insert into public.live_status_overrides(live_event_id,effective_status,effective_from,effective_until,reason,actor_admin_allowlist_id)
  values(event_ids[1],'ended',observed-interval '30 minutes',null,'early terminal proof',allowlist_id);
  insert into public.live_status_overrides(live_event_id,effective_status,effective_from,effective_until,reason,actor_admin_allowlist_id)
  values(event_ids[5],'live',observed-interval '30 minutes',observed+interval '2 hours','extended live proof',allowlist_id);
  insert into public.live_collectible_claim_windows(live_event_id,schedule_revision,opens_at,frozen_at) values
    (event_ids[3],1,observed-interval '48 hours'+interval '1 second',observed),
    (event_ids[4],1,observed-interval '48 hours',observed);

  perform public.reschedule_admin_live(admin_id,allowlist_id,extensions.gen_random_uuid(),event_ids[7],1,'pre-end collectible window proof',
    observed+interval '30 minutes',observed+interval '1 hour',observed+interval '4 hours',observed+interval '5 hours',observed+interval '4 hours',observed+interval '6 hours');
  if (select schedule_revision from public.live_events where id=event_ids[7])<>2 or exists(select 1 from public.live_collectible_claim_windows where live_event_id=event_ids[7]) then raise exception 'pre-end reschedule did not preserve an unfrozen window'; end if;
  begin perform public.reschedule_admin_live(admin_id,allowlist_id,extensions.gen_random_uuid(),event_ids[2],1,'post-end rewrite rejection proof',
    observed+interval '30 minutes',observed+interval '1 hour',observed+interval '2 hours',observed+interval '3 hours',observed+interval '2 hours',observed+interval '4 hours'); raise exception 'post-end reschedule unexpectedly succeeded';
  exception when others then if sqlerrm not like '%LIVE has started%' and sqlerrm not like '%LIVE has ended%' then raise; end if; end;

  begin perform public.claim_owned_live_collectible(other_id,'collectible-proof-1',extensions.gen_random_uuid()); raise exception 'no-Journey claim unexpectedly succeeded';
  exception when sqlstate '55000' then if sqlerrm not like '%P3_COLLECTIBLE_JOURNEY_INCOMPLETE%' then raise; end if; end;
  result:=public.get_owned_live_collectible(other_id,'collectible-proof-1'); if (result->>'eligible')::boolean then raise exception 'owner isolation failed'; end if;

  begin perform public.claim_owned_live_collectible(owner_id,'collectible-proof-5',extensions.gen_random_uuid()); raise exception 'before-end claim unexpectedly succeeded';
  exception when sqlstate '55000' then if sqlerrm not like '%P3_COLLECTIBLE_WINDOW_NOT_OPEN%' then raise; end if; end;

  insert into public.live_journey_completions(id,app_user_id,live_event_id,requirement_revision_id,requirement_snapshot,bonus_ticket_amount,policy_version,reward_setting_revision,reward_setting_revision_id,ticket_ledger_id,completed_at)
  select extensions.gen_random_uuid(),admin_id,event_ids[2],requirement_ids[2],'{}',0,policy_version,1,reward_setting_revision_id,null,observed from public.live_journey_requirement_revisions where id=requirement_ids[2];
  begin perform public.claim_owned_live_collectible(admin_id,'collectible-proof-2',extensions.gen_random_uuid()); raise exception 'missing-wallet claim unexpectedly succeeded';
  exception when sqlstate '55000' then if sqlerrm not like '%P3_COLLECTIBLE_WALLET_NOT_READY%' then raise; end if; end;

  select count(*) into before_ticket from public.fan_ticket_ledger; select count(*) into before_score from public.fan_score_ledger;
  result:=public.claim_owned_live_collectible(owner_id,'collectible-proof-1','10000000-0000-4000-8000-000000000001');
  claimed_id:=(result->'claim'->>'id')::uuid;
  if (result->>'replayed')::boolean or (select opens_at from public.live_collectible_claim_windows where live_event_id=event_ids[1])<>observed-interval '30 minutes' then raise exception 'early-end freeze failed'; end if;
  result:=public.claim_owned_live_collectible(owner_id,'collectible-proof-1','10000000-0000-4000-8000-000000000001'); if not (result->>'replayed')::boolean then raise exception 'same-key replay failed'; end if;
  begin perform public.claim_owned_live_collectible(owner_id,'collectible-proof-1','10000000-0000-4000-8000-000000000002'); raise exception 'fresh key for existing claim unexpectedly succeeded';
  exception when sqlstate '23514' then if sqlerrm not like '%P3_COLLECTIBLE_IDEMPOTENCY_CONFLICT%' then raise; end if; end;
  if (select count(*) from public.live_collectible_claim_idempotency keyed where keyed.claim_id=claimed_id)<>1 then raise exception 'idempotency rows are unbounded'; end if;
  if (select count(*) from public.live_collectible_claims claim where claim.id=claimed_id)<>1 or (select count(*) from public.blockchain_jobs job where job.entity_type='collectible' and job.entity_id=claimed_id and job.operation_key='byus:collectible:v1:'||claimed_id::text)<>1 then raise exception 'claim/job cardinality failed'; end if;

  result:=public.claim_owned_live_collectible(owner_id,'collectible-proof-2',extensions.gen_random_uuid());
  result:=public.claim_owned_live_collectible(owner_id,'collectible-proof-3',extensions.gen_random_uuid());
  begin perform public.claim_owned_live_collectible(owner_id,'collectible-proof-4',extensions.gen_random_uuid()); raise exception 'expired claim unexpectedly succeeded';
  exception when sqlstate '55000' then if sqlerrm not like '%P3_COLLECTIBLE_WINDOW_EXPIRED%' then raise; end if; end;
  if (select count(*) from public.fan_ticket_ledger)<>before_ticket or (select count(*) from public.fan_score_ledger)<>before_score then raise exception 'Collectible wrote Ticket or Score'; end if;

  insert into public.live_journey_completions(id,app_user_id,live_event_id,requirement_revision_id,requirement_snapshot,bonus_ticket_amount,policy_version,reward_setting_revision,reward_setting_revision_id,ticket_ledger_id,completed_at)
  select extensions.gen_random_uuid(),other_id,event_ids[1],requirement_ids[1],'{}',0,policy_version,1,reward_setting_revision_id,null,observed from public.live_journey_requirement_revisions where id=requirement_ids[1];
  result:=public.get_owned_live_collectible(other_id,'collectible-proof-1'); if not (result->>'eligible')::boolean or result->'claim'<>'null'::jsonb then raise exception 'future qualification lookup failed'; end if;
  result:=public.claim_owned_live_collectible(other_id,'collectible-proof-1','10000000-0000-4000-8000-000000000002');
  if (result->>'replayed')::boolean then raise exception 'rejected secondary key was not reusable'; end if;
  perform public.freeze_live_collectible_window(event_ids[5],observed+interval '2 hours');
  if (select opens_at from public.live_collectible_claim_windows where live_event_id=event_ids[5])<>observed+interval '2 hours' then raise exception 'extended-live freeze failed'; end if;
  if to_regclass('public.blockchain_jobs_capability_dispatch_idx') is null then raise exception 'capability dispatch index missing'; end if;
  select job.* into strict claimed_job from public.claim_blockchain_jobs('collectible-proof-worker',100,120,array['collectible']) job where job.entity_id=claimed_id;
  perform public.complete_blockchain_job(claimed_job.id,'collectible-proof-worker','0x'||repeat('a',64),77);
  result:=public.get_owned_live_collectible(owner_id,'collectible-proof-1');
  if result->'claim'->'mint'->>'status'<>'minted' or result->'claim'->'mint'->>'tokenId'<>'77' or result->'claim'->'mint'->>'txHash'<>'0x'||repeat('a',64) then raise exception 'minted owner history projection failed'; end if;
  if exists(select 1 from public.claim_blockchain_jobs('legacy-worker',100,120) job where job.entity_type='collectible') then raise exception 'legacy worker claimed Collectible job'; end if;
end $$;

select jsonb_build_object('claims',(select count(*) from public.live_collectible_claims),'jobs',(select count(*) from public.blockchain_jobs where entity_type='collectible'),'status','PASS') as collectible_db_result;
