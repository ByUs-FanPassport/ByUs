-- Read-only private inventory. Never export the result to a public artifact.
with business as (
  select 'passport'::text entity_type,p.id entity_id,p.app_user_id,p.celebrity_id,
    'passport'::text artwork_type,p.business_status,p.mint_status::text,p.blockchain_job_id,
    p.fan_action_outbox_id,p.tx_hash,p.token_id::text,p.issued_at,null::text eligibility
  from public.fan_passports p
  union all
  select 'stamp',s.id,s.app_user_id,s.celebrity_id,s.stamp_type,s.business_status,s.mint_status::text,
    s.blockchain_job_id,s.fan_action_outbox_id,s.tx_hash,s.token_id::text,s.issued_at,
    case when s.stamp_type='membership' and a.source_type='certification_submission' then cs.status::text end
  from public.stamps s left join public.fan_activities a on a.id=s.activity_id
  left join public.certification_submissions cs on a.source_type='certification_submission' and cs.id=a.source_id
  union all
  select 'reaction',r.id,r.app_user_id,r.celebrity_id,'reaction','completed',r.mint_status::text,
    r.blockchain_job_id,r.fan_action_outbox_id,r.tx_hash,r.token_id::text,r.completed_at,null
  from public.fan_reactions r
  union all
  select 'community_stamp',s.id,s.app_user_id,s.celebrity_id,'community/'||s.kind::text,
    'issued',s.mint_status::text,s.blockchain_job_id,s.fan_action_outbox_id,s.tx_hash,s.token_id::text,s.issued_at,null
  from public.community_stamps s
), entities as (
  select b.*,w.address wallet,c.slug creator_slug,
    case when j.id is not null then jsonb_build_object('id',j.id,'entity_type',j.entity_type,
      'entity_id',j.entity_id,'status',j.status,'operation_key',j.operation_key,'payload',j.payload,
      'tx_hash',j.tx_hash,'token_id',j.token_id::text) end legacy_job
  from business b left join public.user_wallets w on w.app_user_id=b.app_user_id and w.chain_id=91342
  left join public.celebrities c on c.id=b.celebrity_id
  left join public.blockchain_jobs j on j.id=b.blockchain_job_id
), credentials as (
  select c.id,c.entity_type,c.entity_id,c.credential_kind,c.issuance_key,c.legacy_job_id,
    c.token_id::text,c.nft_contract,c.metadata_uri,c.link_origin,c.outbox_id,
    o.action_id,o.occurrence_id,o.revision,o.operation_kind,o.status action_job_status,
    o.payload,o.tx_hash action_tx_hash,oc.source_namespace,oc.canonical_source_key,
    oc.app_user_id occurrence_owner,oc.source_occurred_at,
    fb.chain_id,fb.hub_proxy,fb.environment_id,fb.schema_uid,
    r.inclusion_status,r.block_number::text,r.block_hash,r.eas_uid
  from public.fan_action_credentials c
  join public.fan_action_outbox o on o.id=c.outbox_id
  join public.fan_action_occurrences oc on oc.id=o.occurrence_row_id
  join public.fan_action_bindings fb on fb.id=o.binding_id
  left join public.fan_action_chain_receipts r on r.outbox_id=o.id
)
select jsonb_build_object('captured_at',clock_timestamp(),
  'entities',coalesce((select jsonb_agg(to_jsonb(e) order by entity_type,entity_id) from entities e),'[]'),
  'credentials',coalesce((select jsonb_agg(to_jsonb(c) order by id) from credentials c),'[]'),
  'aliases',coalesce((select jsonb_agg(jsonb_build_object('id',id,'reaction_id',reaction_id,
    'blockchain_source_id',blockchain_source_id,'app_user_id',app_user_id,'passport_id',passport_id))
    from public.first_reaction_stamps),'[]'));
