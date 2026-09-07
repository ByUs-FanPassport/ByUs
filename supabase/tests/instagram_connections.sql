-- Run against the isolated fixture database with the Instagram migration applied.
-- All test data is rolled back. Never run this fixture against a deployed project.
begin;
insert into public.celebrities(id,slug,status) values('11111111-1111-4111-8111-111111111111','ig-test-creator','published');
insert into public.celebrity_localizations(celebrity_id,locale,name) values('11111111-1111-4111-8111-111111111111','ko','연결 검증');
set local role service_role;

select public.instagram_issue_invite('11111111-1111-4111-8111-111111111111',repeat('a',64),'creator_test','178400000000001');
do $$ begin
  assert (public.instagram_transition('peek_invite',repeat('a',64))->>'expected_username') = 'creator_test';
  assert (public.instagram_transition('peek_invite',repeat('a',64))->>'celebrity_name') = '연결 검증';
end $$;
select public.instagram_transition('start',repeat('a',64),repeat('b',64),jsonb_build_object('next_hash',repeat('c',64)));
do $$ begin
  begin
    perform public.instagram_transition('start',repeat('a',64),repeat('b',64),jsonb_build_object('next_hash',repeat('c',64)));
    raise exception 'invite replay accepted';
  exception when raise_exception then if sqlerrm = 'invite replay accepted' then raise; end if; end;
  begin
    perform public.instagram_transition('consume',repeat('c',64),repeat('d',64));
    raise exception 'wrong browser accepted';
  exception when raise_exception then if sqlerrm = 'wrong browser accepted' then raise; end if; end;
end $$;
select public.instagram_transition('consume',repeat('c',64),repeat('b',64));
do $$ begin
  begin
    perform public.instagram_transition('consume',repeat('c',64),repeat('b',64));
    raise exception 'callback replay accepted';
  exception when raise_exception then if sqlerrm = 'callback replay accepted' then raise; end if; end;
  begin
    perform public.instagram_transition('pending',repeat('c',64),repeat('b',64),jsonb_build_object('identity',jsonb_build_object('username','wrong','user_id','178400000000001')));
    raise exception 'wrong account accepted';
  exception when raise_exception then if sqlerrm = 'wrong account accepted' then raise; end if; end;
end $$;
select public.instagram_transition('pending',repeat('c',64),repeat('b',64),jsonb_build_object(
  'next_hash',repeat('d',64),'identity',jsonb_build_object('id','102000000000001','user_id','178400000000001','username','creator_test','account_type','BUSINESS'),
  'token_ciphertext','v1.test.encrypted.value','token_issued_at',now(),'token_expires_at',now()+interval '60 days'));
do $$ begin
  assert not (public.instagram_transition('peek_pending',repeat('d',64),repeat('b',64))->'payload' ? 'token_ciphertext');
end $$;
select public.instagram_transition('confirm',repeat('d',64),repeat('b',64));
do $$ begin
  assert (select token_ciphertext is not null from public.instagram_connections where celebrity_id='11111111-1111-4111-8111-111111111111');
  begin
    perform public.instagram_transition('confirm',repeat('d',64),repeat('b',64));
    raise exception 'confirmation replay accepted';
  exception when raise_exception then if sqlerrm = 'confirmation replay accepted' then raise; end if; end;
end $$;

-- Only one sync worker claims a connection. Erasure invalidates its eventual write.
do $$ declare claimed public.instagram_connections; begin
  select * into claimed from public.instagram_claim_sync(1);
  assert claimed.lease_id is not null;
  assert (select count(*) from public.instagram_claim_sync(1))=0;
  perform public.instagram_disconnect(claimed.celebrity_id);
  assert not public.instagram_finish_sync(claimed.celebrity_id,claimed.generation,claimed.lease_id,jsonb_build_object('media','[]'::jsonb));
  assert (select identity is null and token_ciphertext is null and media='[]'::jsonb from public.instagram_connections where celebrity_id=claimed.celebrity_id);
end $$;

-- Erasing a slot invalidates even an invite which has not started OAuth.
select public.instagram_issue_invite('11111111-1111-4111-8111-111111111111',repeat('e',64),'creator_test',null);
select public.instagram_disconnect('11111111-1111-4111-8111-111111111111');
do $$ begin
  begin
    perform public.instagram_transition('peek_invite',repeat('e',64));
    raise exception 'pre-disconnect invite accepted';
  exception when raise_exception then if sqlerrm = 'pre-disconnect invite accepted' then raise; end if; end;
end $$;

-- Revocation delivered while exchanging blocks a pending account not yet identified in DB.
select public.instagram_issue_invite('11111111-1111-4111-8111-111111111111',repeat('a',64),'creator_test',null);
select public.instagram_transition('start',repeat('a',64),repeat('b',64),jsonb_build_object('next_hash',repeat('c',64)));
select public.instagram_transition('consume',repeat('c',64),repeat('b',64));
select public.instagram_delete_subject('102000000000001',now(),repeat('f',64));
do $$ begin
  begin
    perform public.instagram_transition('pending',repeat('c',64),repeat('b',64),jsonb_build_object(
      'next_hash',repeat('d',64),'identity',jsonb_build_object('id','102000000000001','user_id','178400000000001','username','creator_test','account_type','BUSINESS'),
      'token_ciphertext','v1.test.encrypted.value','token_issued_at',now(),'token_expires_at',now()+interval '60 days'));
    raise exception 'revoked pending account accepted';
  exception when raise_exception then if sqlerrm = 'revoked pending account accepted' then raise; end if; end;
  assert (select count(*) from public.instagram_deletion_receipts where confirmation_hash=repeat('f',64))=1;
end $$;

-- Expiration is enforced by the DB, not only route code.
update public.instagram_connection_flows set expires_at=now()-interval '1 second';
do $$ begin
  begin
    perform public.instagram_transition('consume',repeat('c',64),repeat('b',64));
    raise exception 'expired state accepted';
  exception when raise_exception then if sqlerrm = 'expired state accepted' then raise; end if; end;
end $$;

-- A delayed webhook must delete an authorization begun before the event even
-- when ByUs confirmation (or a token refresh) was completed AFTER that event.
select public.instagram_disconnect('11111111-1111-4111-8111-111111111111');
update public.instagram_connections set identity=jsonb_build_object('id','102000000000002','user_id','178400000000002','username','creator_test','account_type','BUSINESS'),
  ig_scoped_id='102000000000002',ig_user_id='178400000000002',token_ciphertext='v1.test.encrypted.value',
  token_issued_at=now(),token_expires_at=now()+interval '60 days',authorization_started_at=now()-interval '2 minutes',connected_at=now()
  where celebrity_id='11111111-1111-4111-8111-111111111111';
select public.instagram_delete_subject('102000000000002',now()-interval '1 minute',repeat('1',64));
do $$ begin
  assert (select token_ciphertext is null and identity is null from public.instagram_connections where celebrity_id='11111111-1111-4111-8111-111111111111');
end $$;

-- A NEW OAuth flow after the deletion event must remain valid if Meta retries
-- the OLD signed callback. Generation and immutable authorization time both matter.
select public.instagram_issue_invite('11111111-1111-4111-8111-111111111111',repeat('a',64),'creator_test',null);
select public.instagram_transition('start',repeat('a',64),repeat('b',64),jsonb_build_object('next_hash',repeat('c',64)));
select public.instagram_transition('consume',repeat('c',64),repeat('b',64));
select public.instagram_transition('pending',repeat('c',64),repeat('b',64),jsonb_build_object(
  'next_hash',repeat('d',64),'identity',jsonb_build_object('id','102000000000002','user_id','178400000000002','username','creator_test','account_type','BUSINESS'),
  'token_ciphertext','v1.test.encrypted.value','token_issued_at',now(),'token_expires_at',now()+interval '60 days'));
select public.instagram_transition('confirm',repeat('d',64),repeat('b',64));
select public.instagram_delete_subject('102000000000002',now()-interval '1 minute',repeat('2',64));
do $$ begin
  assert (select token_ciphertext is not null from public.instagram_connections where celebrity_id='11111111-1111-4111-8111-111111111111');
end $$;

set local role anon;
do $$ begin
  begin
    perform public.instagram_claim_sync(1);
    raise exception 'anon RPC accepted';
  exception when insufficient_privilege then null; end;
  begin
    perform token_ciphertext from public.instagram_connections;
    raise exception 'anon token read accepted';
  exception when insufficient_privilege then null; end;
end $$;
set local role authenticated;
do $$ begin
  begin
    perform public.instagram_disconnect('11111111-1111-4111-8111-111111111111');
    raise exception 'authenticated RPC accepted';
  exception when insufficient_privilege then null; end;
  begin
    perform payload from public.instagram_connection_flows;
    raise exception 'authenticated pending read accepted';
  exception when insufficient_privilege then null; end;
end $$;
rollback;
