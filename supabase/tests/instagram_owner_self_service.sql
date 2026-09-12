begin;
set local role service_role;
insert into public.app_users(id,privy_user_id,verified_email,status) values
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','did:owner:1','owner1@example.invalid','active'),
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2','did:owner:2','owner2@example.invalid','active');
insert into public.celebrities(id,slug,status,image_url,archived_at) values
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1','owner-one','published','/owner-one.webp',null),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2','owner-two','published','/owner-two.webp',null);
insert into public.celebrity_localizations(celebrity_id,locale,name) values
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1','ko','오너 원'),('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2','ko','오너 투');
insert into public.celebrity_social_links(celebrity_id,platform,url,active) values
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1','instagram','https://www.instagram.com/owner_one/',true),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2','instagram','https://www.instagram.com/owner_two/',true);
insert into public.instagram_connections(celebrity_id) values('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1');

select public.instagram_owner_transition('start',repeat('e',64),'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',repeat('f',64),'{"locale":"ko"}');
select public.instagram_owner_transition('consume',repeat('e',64),'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',repeat('f',64));
do $$begin
 begin perform public.instagram_owner_transition('resolve',repeat('e',64),'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',repeat('f',64),'{"identity":{"id":"1099","user_id":"2099","username":"missing","account_type":"BUSINESS"}}');raise exception 'zero match accepted';exception when others then if sqlerrm='zero match accepted' then raise;end if;end;
 update public.celebrity_social_links set url='https://www.instagram.com/owner_one/' where celebrity_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2';
 begin perform public.instagram_owner_transition('resolve',repeat('e',64),'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',repeat('f',64),'{"identity":{"id":"1099","user_id":"2099","username":"owner_one","account_type":"BUSINESS"}}');raise exception 'multi match accepted';exception when others then if sqlerrm='multi match accepted' then raise;end if;end;
 update public.celebrity_social_links set url='https://www.instagram.com/owner_two/' where celebrity_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2';
 delete from public.instagram_owner_flows where actor_app_user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
end$$;

select public.instagram_owner_transition('start',repeat('a',64),'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',repeat('b',64),'{"locale":"ko"}');
select public.instagram_owner_transition('consume',repeat('a',64),null,repeat('b',64));
select public.instagram_owner_transition('resolve',repeat('a',64),null,repeat('b',64),'{"identity":{"id":"1001","user_id":"2001","username":"owner_one","account_type":"BUSINESS"}}');
select public.instagram_owner_transition('pending',repeat('a',64),null,repeat('b',64),jsonb_build_object('next_hash',repeat('c',64),'identity',jsonb_build_object('id','1001','user_id','2001','username','owner_one','account_type','BUSINESS'),'token_ciphertext','sealed','token_issued_at',now(),'token_expires_at',now()+interval '60 days'));

do $$begin
 if (select (public.instagram_owner_transition('peek_pending',repeat('c',64),'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',repeat('b',64))->'account'->>'avatarUrl'))<>'/owner-one.webp' then raise exception 'pending projection missing registered portrait';end if;
 begin perform public.instagram_owner_transition('peek_pending',repeat('c',64),'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',repeat('b',64));raise exception 'foreign actor accepted';exception when others then if sqlerrm='foreign actor accepted' then raise;end if;end;
 begin perform public.instagram_owner_transition('peek_pending',repeat('c',64),'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',repeat('d',64));raise exception 'foreign browser accepted';exception when others then if sqlerrm='foreign browser accepted' then raise;end if;end;
 begin perform public.instagram_owner_transition('peek_pending',repeat('c',64),null,repeat('b',64));raise exception 'null actor accepted';exception when others then if sqlerrm='null actor accepted' then raise;end if;end;
 begin perform public.instagram_owner_transition('peek_pending',repeat('c',64),'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',null);raise exception 'null browser accepted';exception when others then if sqlerrm='null browser accepted' then raise;end if;end;
end$$;

select public.instagram_owner_transition('start',repeat('1',64),'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',repeat('2',64),'{"locale":"ko"}');
select public.instagram_owner_transition('consume',repeat('1',64),'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',repeat('2',64));
select public.instagram_owner_transition('resolve',repeat('1',64),'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',repeat('2',64),'{"identity":{"id":"1002","user_id":"2002","username":"owner_two","account_type":"BUSINESS"}}');
do $$begin if not exists(select 1 from public.instagram_connections where celebrity_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2') then raise exception 'missing slot was not created';end if;end$$;
select public.instagram_owner_transition('pending',repeat('1',64),'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',repeat('2',64),jsonb_build_object('next_hash',repeat('3',64),'identity',jsonb_build_object('id','1002','user_id','2002','username','owner_two','account_type','BUSINESS'),'token_ciphertext','sealed2','token_issued_at',now(),'token_expires_at',now()+interval '60 days'));
update public.instagram_connections set generation=extensions.gen_random_uuid() where celebrity_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2';
do $$begin begin perform public.instagram_owner_transition('confirm',repeat('3',64),'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',repeat('2',64));raise exception 'stale confirm accepted';exception when others then if sqlerrm='stale confirm accepted' then raise;end if;end;end$$;
select public.instagram_delete_subject('1002',clock_timestamp()+interval '1 second',repeat('4',64));
do $$begin if exists(select 1 from public.instagram_owner_flows where payload->'identity'->>'id'='1002') then raise exception 'signed deletion retained owner pending';end if;end$$;
select public.instagram_owner_transition('confirm',repeat('c',64),'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',repeat('b',64));
do $$begin
 if (select owner_app_user_id from public.instagram_connections where celebrity_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1')<>'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1' then raise exception 'owner not assigned';end if;
 begin perform public.instagram_owner_transition('confirm',repeat('c',64),'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',repeat('b',64));raise exception 'replay accepted';exception when others then if sqlerrm='replay accepted' then raise;end if;end;
 begin update public.instagram_connections set identity=jsonb_set(identity,'{user_id}','"9999"') where celebrity_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';raise exception 'legacy identity replacement accepted';exception when others then if sqlerrm='legacy identity replacement accepted' then raise;end if;end;
end$$;

select public.instagram_issue_invite('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',repeat('6',64),'owner_one',null);
select public.instagram_transition('start',repeat('6',64),repeat('7',64),jsonb_build_object('next_hash',repeat('8',64)));
select public.instagram_transition('consume',repeat('8',64),repeat('7',64));
select public.instagram_transition('pending',repeat('8',64),repeat('7',64),jsonb_build_object('next_hash',repeat('9',64),'identity',jsonb_build_object('id','1010','user_id','2010','username','owner_one','account_type','BUSINESS'),'token_ciphertext','legacy-sealed','token_issued_at',now(),'token_expires_at',now()+interval '60 days'));
do $$begin
 begin perform public.instagram_transition('confirm',repeat('9',64),repeat('7',64));raise exception 'legacy subject replacement accepted';exception when others then if sqlerrm='legacy subject replacement accepted' then raise;end if;end;
 delete from public.instagram_connection_flows where celebrity_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';
end$$;

do $$declare g uuid;l uuid;t timestamptz;begin
 select generation,live_lease_id,token_issued_at into g,l,t from public.instagram_claim_live_sync(25) where celebrity_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';
 if l is null then raise exception 'enabled live not claimed';end if;
 perform public.instagram_owner_settings('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',g,false,'ko');
 if public.instagram_finish_live_sync('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',g,l,t,jsonb_build_object('state','offline','observedAt',now())) then raise exception 'late disabled finish accepted';end if;
 if exists(select 1 from public.instagram_claim_live_sync(25) where celebrity_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1') then raise exception 'disabled live claimed';end if;
 select generation into g from public.instagram_connections where celebrity_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';
 perform public.instagram_owner_settings('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',g,true,'ko');
 if not (select live_enabled from public.instagram_connections where celebrity_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1') then raise exception 'live not enabled';end if;
end$$;

do $$declare g uuid;begin
 select generation into g from public.instagram_connections where celebrity_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';
 if not public.instagram_expire_credentials('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',g) then raise exception 'owner expiry failed';end if;
 if (select owner_app_user_id is null or identity->>'username'<>'owner_one' or authorization_started_at is null from public.instagram_connections where celebrity_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1') then raise exception 'expiry lost reconnect ownership';end if;
 perform public.instagram_delete_subject('1001',clock_timestamp()+interval '1 second',repeat('5',64));
 if exists(select 1 from public.instagram_owner_accounts('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','ko')) then raise exception 'expired signed deletion retained owner account';end if;
 if exists(select 1 from public.instagram_connections where celebrity_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1' and (owner_app_user_id is not null or identity is not null)) then raise exception 'signed deletion retained owner identity';end if;
end$$;

reset role;
do $$begin
 if has_table_privilege('anon','public.instagram_owner_flows','select') or has_table_privilege('authenticated','public.instagram_owner_flows','select') then raise exception 'owner flow ACL exposed';end if;
 if has_function_privilege('anon','public.instagram_owner_transition(text,text,uuid,text,jsonb)','execute') or has_function_privilege('authenticated','public.instagram_owner_transition(text,text,uuid,text,jsonb)','execute') then raise exception 'owner RPC exposed';end if;
 if has_function_privilege('anon','public.instagram_finish_live_sync(uuid,uuid,uuid,timestamptz,jsonb)','execute') or has_function_privilege('authenticated','public.instagram_read_live_discovery(text,text)','execute') then raise exception 'live wrapper exposed';end if;
 if not has_function_privilege('service_role','public.instagram_finish_live_sync(uuid,uuid,uuid,timestamptz,jsonb)','execute') or not has_function_privilege('service_role','public.instagram_read_live_discovery(text,text)','execute') then raise exception 'live wrapper service grant missing';end if;
end$$;
rollback;
