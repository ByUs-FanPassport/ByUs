\set ON_ERROR_STOP on
begin;

create function pg_temp.assert(ok boolean, message text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'CREATOR_PUBLICATION: %',message; end if; end $$;
create function pg_temp.expect_error(statement text, expected text) returns void language plpgsql as $$
declare caught boolean:=false;
begin
  begin execute statement;
  exception when others then
    if position(expected in sqlerrm)=0 then raise exception 'Unexpected %, wanted %',sqlerrm,expected; end if;
    caught:=true;
  end;
  if not caught then raise exception 'Expected error: %',expected; end if;
end $$;

do $$
declare
  creator uuid:=extensions.gen_random_uuid();
  legacy_creator uuid:=extensions.gen_random_uuid();
  disabled_creator uuid:=extensions.gen_random_uuid();
  existing_creator uuid:=extensions.gen_random_uuid();
  old_binding uuid; new_binding uuid;
  h text:='0x'||repeat('1',64);
begin
  insert into public.celebrities(id,slug,status,image_url,published_at,roles,primary_role) values
    (creator,'registration-publish-test','draft','/test.webp',null,'{artist}','idol'),
    (legacy_creator,'registration-legacy-test','draft','/test.webp',null,'{artist}','idol'),
    (disabled_creator,'registration-disabled-test','draft','/test.webp',null,'{artist}','idol'),
    (existing_creator,'registration-existing-test','published','/test.webp',now(),'{artist}','idol');
  insert into public.fan_action_bindings(chain_id,environment_id,hub_proxy,relayer,schema_uid,
    schema_version,binding_version,asset_base_uri,assets) values
    (91342,h,'0x'||repeat('2',40),'0x'||repeat('3',40),h,1,1,'ipfs://bafyfixture','{}') returning id into old_binding;
  insert into public.fan_action_bindings(chain_id,environment_id,hub_proxy,relayer,schema_uid,
    schema_version,binding_version,asset_base_uri,assets) values
    (91342,h,'0x'||repeat('2',40),'0x'||repeat('3',40),h,1,2,'ipfs://bafyfixture','{}') returning id into new_binding;
  insert into public.fan_action_producer_routes(action_code,binding_id,enabled,policy_version,enabled_at)
    values(1,new_binding,true,1,clock_timestamp()),(6,new_binding,true,1,clock_timestamp());

  perform pg_temp.expect_error(format('update public.celebrities set status=''published'' where id=%L',creator),
    'celebrity publication requires completed on-chain registration');
  perform pg_temp.assert((select status='draft' from public.celebrities where id=creator),'failed publication changed the source');
  insert into public.fan_action_verified_creators(binding_id,creator_id,verified_block_number,verified_block_hash,verified_at)
    values(old_binding,creator,100,h,clock_timestamp());
  perform pg_temp.expect_error(format('update public.celebrities set status=''published'' where id=%L',creator),
    'celebrity publication requires completed on-chain registration');
  insert into public.fan_action_verified_creators(binding_id,creator_id,verified_block_number,verified_block_hash,verified_at)
    values(new_binding,creator,101,h,clock_timestamp());
  perform pg_temp.expect_error(format('update public.celebrities set slug=''renamed-after-registration'' where id=%L',creator),
    'celebrity slug is immutable after on-chain registration');
  update public.celebrities set status='published' where id=creator;
  perform pg_temp.assert((select status='published' from public.celebrities where id=creator),'verified creator could not publish');

  update public.celebrities set image_url='/updated.webp',status='published' where id=existing_creator;
  perform pg_temp.assert((select image_url='/updated.webp' from public.celebrities where id=existing_creator),'unrelated existing publication changed');
  perform pg_temp.expect_error('insert into public.celebrities(slug,status,image_url,published_at,roles,primary_role) values(''registration-direct-insert'',''published'',''/test.webp'',now(),''{artist}'',''idol'')',
    'celebrity publication requires completed on-chain registration');
  update public.celebrities set status='draft' where id=creator;
  update public.fan_action_producer_routes set enabled=false;
  update public.celebrities set status='published' where id=disabled_creator;
  update public.fan_action_producer_routes set enabled=true,binding_id=old_binding;
  update public.celebrities set status='published' where id=legacy_creator;
  perform pg_temp.assert((select count(*)=2 from public.celebrities where id in(disabled_creator,legacy_creator) and status='published'),
    'disabled or legacy route publication regressed');
end $$;

select pg_temp.assert(not has_function_privilege('anon','public.guard_creator_registration_publication()','execute')
  and not has_function_privilege('authenticated','public.guard_creator_registration_publication()','execute')
  and not has_function_privilege('service_role','public.guard_creator_registration_publication()','execute'),
  'publication trigger must not become a callable public API');

rollback;
