begin;

insert into public.app_users(id,privy_user_id,verified_email,status) values
  ('bc000000-0000-4000-8000-000000000001','did:privy:rsvp-admin-test','rsvp-admin@example.com','active'),
  ('bc000000-0000-4000-8000-000000000002','did:privy:rsvp-fan-test','rsvp-fan@example.com','active');
insert into public.admin_allowlist(id,email,role,active) values
  ('bc000000-0000-4000-8000-000000000003','rsvp-admin@example.com','admin',true);
insert into public.byus_day_rsvps(id,locale,korean_name,english_name,phone_e164,affiliation,occupation,email_normalized,nationality,resident_registration_number_encrypted,ip_hash,payload_hash,created_at) values
  ('bc000000-0000-4000-8000-000000000010','ko','김가온','Gaon Kim','+821000000091','ByUs','매니저','rsvp-one@example.com','KR','v1.'||repeat('a',16)||'.'||repeat('b',22)||'.'||repeat('c',18),repeat('a',64),repeat('b',64),'2099-01-01'),
  ('bc000000-0000-4000-8000-000000000011','en','이지안','Jian Lee','+821000000092','ByUs','Director','rsvp-two@example.com','US','v1.'||repeat('a',16)||'.'||repeat('b',22)||'.'||repeat('c',18),repeat('a',64),repeat('c',64),'2099-01-01');

do $$
declare signature text:='public.list_admin_byus_day_rsvps(uuid,uuid)';
  result jsonb; item jsonb; admin_role public.admin_role;
begin
  if has_function_privilege('anon',signature,'execute') or has_function_privilege('authenticated',signature,'execute')
    or not has_function_privilege('service_role',signature,'execute') then raise exception 'RSVP admin RPC grants mismatch'; end if;
  if has_table_privilege('service_role','public.byus_day_rsvps','select') then raise exception 'RSVP base table became readable'; end if;

  foreach admin_role in array array['admin','operator','viewer']::public.admin_role[] loop
    update public.admin_allowlist set role=admin_role where id='bc000000-0000-4000-8000-000000000003';
    result:=public.list_admin_byus_day_rsvps('bc000000-0000-4000-8000-000000000001','bc000000-0000-4000-8000-000000000003');
    if jsonb_array_length(result->'attendees')<>(select count(*) from public.byus_day_rsvps) then raise exception 'RSVP rows omitted'; end if;
    if result#>>'{attendees,0,id}'<>'bc000000-0000-4000-8000-000000000011'
      or result#>>'{attendees,1,id}'<>'bc000000-0000-4000-8000-000000000010' then raise exception 'RSVP stable newest-first ordering failed'; end if;
    item:=result#>'{attendees,0}';
    if (select count(*) from jsonb_object_keys(item))<>9 or item->>'englishName'<>'Jian Lee'
      or item->>'phone'<>'+821000000092' or item->>'email'<>'rsvp-two@example.com' then raise exception 'RSVP projection mismatch'; end if;
    if result::text ~ 'resident|encrypted|payload|ip_hash|consented' then raise exception 'RSVP private data leaked'; end if;
  end loop;

  begin
    perform public.list_admin_byus_day_rsvps('bc000000-0000-4000-8000-000000000002','bc000000-0000-4000-8000-000000000003');
    raise exception 'mismatched actor was allowed';
  exception when insufficient_privilege then
    if sqlerrm<>'RSVP_ADMIN_FORBIDDEN' then raise; end if;
  end;
  begin
    perform public.list_admin_byus_day_rsvps(null,null);
    raise exception 'null actor was allowed';
  exception when insufficient_privilege then null;
  end;
  update public.admin_allowlist set active=false where id='bc000000-0000-4000-8000-000000000003';
  begin
    perform public.list_admin_byus_day_rsvps('bc000000-0000-4000-8000-000000000001','bc000000-0000-4000-8000-000000000003');
    raise exception 'revoked admin was allowed';
  exception when insufficient_privilege then null;
  end;
end $$;

set local role service_role;
do $$ begin
  begin
    perform public.list_admin_byus_day_rsvps('bc000000-0000-4000-8000-000000000002','bc000000-0000-4000-8000-000000000003');
    raise exception 'service role bypassed admin authorization';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
rollback;
