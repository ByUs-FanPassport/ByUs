create table public.kyaa_upgrade_fixture(job uuid,old_binding uuid,new_binding uuid,owner_id uuid,creator uuid,happened timestamptz,descriptor jsonb,original jsonb);
do $$
declare
  owner_id uuid:=extensions.gen_random_uuid(); creator uuid:=extensions.gen_random_uuid();
  old_binding uuid; new_binding uuid; old_job uuid; new_job uuid; legacy_job uuid;
  descriptor jsonb; before_snapshot jsonb; before_payload jsonb; q public.fan_action_outbox;
  happened timestamptz:=clock_timestamp(); h text:='0x'||repeat('1',64);
  h2 text:='0x'||repeat('2',64); h3 text:='0x'||repeat('3',64);
  hub text:='0x'||repeat('2',40); writer text:='0x'||repeat('3',40);
begin
  insert into public.celebrities(id,slug,status,image_url,published_at,roles,primary_role)
    values(creator,'kyaa-cutover-test','published','/cutover.webp',now(),'{artist}','idol');
  insert into public.celebrity_localizations(celebrity_id,locale,name,summary,image_alt)
    values(creator,'ko','전환 검사','전환 검사','전환 검사'),(creator,'en','Cutover test','Cutover test','Cutover test');
  insert into public.app_users(id,privy_user_id,verified_email,status)
    values(owner_id,'did:privy:kyaa-cutover','cutover@example.test','active');
  insert into public.user_wallets(app_user_id,chain_id,address,provider,wallet_type)
    values(owner_id,91342,'0x'||repeat('1',40),'privy','embedded');
  insert into public.fan_action_bindings(chain_id,environment_id,hub_proxy,relayer,schema_uid,
    schema_version,binding_version,asset_base_uri,assets)
    values(91342,h,hub,writer,h2,1,1,'ipfs://bafyfixture',jsonb_build_object('1','0x'||repeat('4',40)))
    returning id into old_binding;
  insert into public.fan_action_bindings(chain_id,environment_id,hub_proxy,relayer,schema_uid,
    schema_version,binding_version,asset_base_uri,assets)
    values(91342,h,hub,writer,h2,1,2,'ipfs://bafyfixture',jsonb_build_object('1','0x'||repeat('5',40)))
    returning id into new_binding;
  insert into public.fan_action_producer_routes(action_code,binding_id,enabled,policy_version,enabled_at)
    values(6,old_binding,true,1,clock_timestamp());
  descriptor:=jsonb_build_array(jsonb_build_object('entityType','reaction','entityId',extensions.gen_random_uuid(),
    'kind',1,'issuanceKey',h3,'operationKey','kyaa:cutover:old','legacyPayload',jsonb_build_object(
      'recipient','0x'||repeat('1',40),'celebritySlug','kyaa-cutover-test','issuanceId',h3,'reactionType','FirstReaction')));
  old_job:=public.enqueue_fan_action_source('cutover_fixture','old',owner_id,creator,null,happened,6,descriptor);
  select source_snapshot into before_snapshot from public.fan_action_outbox where id=old_job;
  insert into public.kyaa_upgrade_fixture values(old_job,old_binding,new_binding,owner_id,creator,happened,descriptor,to_jsonb((select existing from public.fan_action_outbox existing where existing.id=old_job)));
end $$;
