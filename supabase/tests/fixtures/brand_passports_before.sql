\set ON_ERROR_STOP on

insert into public.app_users(id,privy_user_id,verified_email) values
  ('95600000-0000-4000-8000-000000000001','did:privy:brand-passport-upgrade-legacy','brand-passport-upgrade-legacy@byus.test'),
  ('95600000-0000-4000-8000-000000000002','did:privy:brand-passport-upgrade-native','brand-passport-upgrade-native@byus.test');
insert into public.user_wallets(app_user_id,chain_id,address) values
  ('95600000-0000-4000-8000-000000000001',91342,'0x9560000000000000000000000000000000000001'),
  ('95600000-0000-4000-8000-000000000002',91342,'0x9560000000000000000000000000000000000002');

insert into public.celebrities(id,slug,status,image_url,roles,primary_role) values
  ('95600000-0000-4000-8000-000000000003','brand-passport-upgrade','draft','/brand-passport-upgrade.jpg','{brand}','brand');
insert into public.celebrity_localizations(celebrity_id,locale,name,summary,image_alt) values
  ('95600000-0000-4000-8000-000000000003','ko','브랜드 패스포트 업그레이드','브랜드 패스포트 업그레이드','브랜드 패스포트 업그레이드'),
  ('95600000-0000-4000-8000-000000000003','en','Brand passport upgrade','Brand passport upgrade','Brand passport upgrade');
update public.celebrities set status='published',published_at=now()
where id='95600000-0000-4000-8000-000000000003';

select public.react_to_creator(
  '95600000-0000-4000-8000-000000000001',
  '95600000-0000-4000-8000-000000000003',
  '95600000-0000-4000-8000-000000000004',
  '95600000-0000-4000-8000-000000000005',
  '0x'||repeat('a',64)
);
update public.blockchain_jobs
set status='COMPLETED',tx_hash='0x'||repeat('d',64),token_id=77,completed_at=now()
where id='95600000-0000-4000-8000-000000000005';

insert into public.fan_action_bindings(
  id,chain_id,environment_id,hub_proxy,relayer,schema_uid,schema_version,
  binding_version,asset_base_uri,assets
) values (
  '95600000-0000-4000-8000-000000000006',91342,'0x'||repeat('1',64),'0x'||repeat('2',40),
  '0x'||repeat('3',40),'0x'||repeat('4',64),1,1,'ipfs://bafybeibrandpassportupgrade',
  jsonb_build_object(
    '0','0x9560000000000000000000000000000000000010',
    '1','0x9560000000000000000000000000000000000011',
    '2','0x9560000000000000000000000000000000000012'
  )
);
insert into public.fan_action_producer_routes(action_code,binding_id,enabled,policy_version,enabled_at)
values(6,'95600000-0000-4000-8000-000000000006',true,1,now());
insert into public.fan_action_verified_creators(
  binding_id,creator_id,verified_block_number,verified_block_hash,verified_at
) values(
  '95600000-0000-4000-8000-000000000006','95600000-0000-4000-8000-000000000003',
  1,'0x'||repeat('5',64),now()
);
select public.react_to_creator(
  '95600000-0000-4000-8000-000000000002',
  '95600000-0000-4000-8000-000000000003',
  '95600000-0000-4000-8000-000000000007',
  '95600000-0000-4000-8000-000000000008',
  '0x'||repeat('b',64)
);

do $$
begin
  if exists(select 1 from public.fan_activities
      where celebrity_id='95600000-0000-4000-8000-000000000003')
    or exists(select 1 from public.first_reaction_stamps
      where celebrity_id='95600000-0000-4000-8000-000000000003') then
    raise exception 'brand upgrade fixture was not created in the blocked state';
  end if;
end $$;

