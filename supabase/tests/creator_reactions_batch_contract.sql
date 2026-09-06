begin;

insert into public.app_users (id, privy_user_id, verified_email, status)
values
  ('11111111-1111-4111-8111-111111111111', 'did:privy:reaction-batch-owner-a', 'reaction-batch-a@byus.test', 'active'),
  ('22222222-2222-4222-8222-222222222222', 'did:privy:reaction-batch-owner-b', 'reaction-batch-b@byus.test', 'active');

insert into public.celebrities (id, slug, status, image_url, published_at)
values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'reaction-batch-a', 'published', '/reaction-batch-a.webp', now()),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', 'reaction-batch-b', 'published', '/reaction-batch-b.webp', now());

insert into public.user_wallets (app_user_id, chain_id, address, provider, wallet_type)
values ('11111111-1111-4111-8111-111111111111', 91342, '0x1111111111111111111111111111111111111111', 'privy', 'embedded');

insert into public.blockchain_jobs (id, entity_type, entity_id, operation_key, payload_version, payload)
values (
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
  'reaction',
  'cccccccc-cccc-4ccc-8ccc-ccccccccccc1',
  'byus:reaction:v1:cccccccc-cccc-4ccc-8ccc-ccccccccccc1',
  1,
  jsonb_build_object(
    'recipient', '0x1111111111111111111111111111111111111111',
    'celebritySlug', 'reaction-batch-a',
    'issuanceId', '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    'reactionType', 'FirstReaction'
  )
);

insert into public.fan_reactions (id, app_user_id, celebrity_id, blockchain_job_id)
values (
  'cccccccc-cccc-4ccc-8ccc-ccccccccccc1',
  '11111111-1111-4111-8111-111111111111',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1'
);

do $$
declare
  owner_a jsonb;
  owner_b jsonb;
  public_execute boolean;
begin
  owner_a := public.get_owned_creator_reactions(
    '11111111-1111-4111-8111-111111111111',
    array['reaction-batch-b', 'reaction-batch-a', 'reaction-batch-a']
  );
  if owner_a <> '[{"slug":"reaction-batch-b","reacted":false},{"slug":"reaction-batch-a","reacted":true}]'::jsonb then
    raise exception 'owner A batch state or duplicate handling is invalid: %', owner_a;
  end if;

  owner_b := public.get_owned_creator_reactions(
    '22222222-2222-4222-8222-222222222222',
    array['reaction-batch-a', 'reaction-batch-b']
  );
  if owner_b <> '[{"slug":"reaction-batch-a","reacted":false},{"slug":"reaction-batch-b","reacted":false}]'::jsonb then
    raise exception 'owner isolation is invalid: %', owner_b;
  end if;

  select exists(
    select 1
    from pg_proc function_record
    cross join lateral aclexplode(coalesce(function_record.proacl,acldefault('f',function_record.proowner))) privilege
    where function_record.oid='public.get_owned_creator_reactions(uuid,text[])'::regprocedure
      and privilege.grantee=0
      and privilege.privilege_type='EXECUTE'
  ) into public_execute;
  if public_execute then raise exception 'PUBLIC can execute the owned reaction batch'; end if;
  if has_function_privilege('anon','public.get_owned_creator_reactions(uuid,text[])','EXECUTE') then raise exception 'anon can execute the owned reaction batch'; end if;
  if has_function_privilege('authenticated','public.get_owned_creator_reactions(uuid,text[])','EXECUTE') then raise exception 'authenticated can execute the owned reaction batch'; end if;
  if not has_function_privilege('service_role','public.get_owned_creator_reactions(uuid,text[])','EXECUTE') then raise exception 'service_role cannot execute the owned reaction batch'; end if;
end;
$$;

rollback;
