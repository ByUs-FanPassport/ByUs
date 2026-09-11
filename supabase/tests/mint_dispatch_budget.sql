begin;

do $$
begin
  if (select daily_job_limit from public.mint_dispatch_policy where singleton) <> 1000 then
    raise exception 'mint dispatch default daily limit must be 1000';
  end if;
  if pg_catalog.has_table_privilege('service_role', 'public.mint_dispatch_policy', 'UPDATE')
    or pg_catalog.has_table_privilege('service_role', 'public.mint_dispatch_budget_reservations', 'INSERT,UPDATE,DELETE') then
    raise exception 'service_role must not mutate mint dispatch policy tables directly';
  end if;
  if not pg_catalog.has_function_privilege('service_role', 'public.admit_mint_dispatch(uuid,text)', 'EXECUTE')
    or not pg_catalog.has_function_privilege('service_role', 'public.hold_mint_fee_policy(uuid,text,text)', 'EXECUTE') then
    raise exception 'service_role is missing mint dispatch RPC access';
  end if;
  if pg_catalog.has_function_privilege('anon', 'public.admit_mint_dispatch(uuid,text)', 'EXECUTE')
    or pg_catalog.has_function_privilege('authenticated', 'public.admit_mint_dispatch(uuid,text)', 'EXECUTE')
    or pg_catalog.has_function_privilege('anon', 'public.hold_mint_fee_policy(uuid,text,text)', 'EXECUTE')
    or pg_catalog.has_function_privilege('authenticated', 'public.hold_mint_fee_policy(uuid,text,text)', 'EXECUTE') then
    raise exception 'public application roles must not execute mint dispatch RPCs';
  end if;
end;
$$;

set local role service_role;
do $$
begin
  begin
    update public.mint_dispatch_policy set daily_job_limit = 2 where singleton;
    raise exception 'service_role unexpectedly updated mint dispatch policy';
  exception
    when insufficient_privilege then null;
  end;
  begin
    insert into public.mint_dispatch_budget_reservations (budget_day, job_id)
    values (current_date, '00000000-0000-4000-8000-000000000001');
    raise exception 'service_role unexpectedly inserted a budget reservation';
  exception
    when insufficient_privilege then null;
  end;
end;
$$;
reset role;

-- Missing configuration fails closed and leaves the active lease untouched.
insert into public.blockchain_jobs (
  id, entity_type, entity_id, operation_key, payload, status, attempts,
  lease_owner, lease_expires_at
) values (
  '00000000-0000-4000-8000-000000000101', 'passport',
  '00000000-0000-4000-8000-000000000201', 'security:budget:missing', '{}',
  'PROCESSING', 1, 'budget-worker', pg_catalog.clock_timestamp() + interval '10 minutes'
);
delete from public.mint_dispatch_policy where singleton;
set local role service_role;
do $$
begin
  begin
    perform public.admit_mint_dispatch(
      '00000000-0000-4000-8000-000000000101', 'budget-worker'
    );
    raise exception 'missing mint dispatch policy unexpectedly admitted a job';
  exception
    when others then
      if sqlerrm not like '%mint dispatch policy is missing%' then
        raise;
      end if;
  end;
end;
$$;
reset role;
do $$
begin
  if not exists (
    select 1 from public.blockchain_jobs
    where id = '00000000-0000-4000-8000-000000000101'
      and status = 'PROCESSING' and attempts = 1 and lease_owner = 'budget-worker'
  ) then
    raise exception 'missing configuration mutated the leased job';
  end if;
end;
$$;
insert into public.mint_dispatch_policy (singleton, daily_job_limit) values (true, 1000);

-- A stale lease cannot reserve budget.
insert into public.blockchain_jobs (
  id, entity_type, entity_id, operation_key, payload, status, attempts,
  lease_owner, lease_expires_at
) values (
  '00000000-0000-4000-8000-000000000102', 'passport',
  '00000000-0000-4000-8000-000000000202', 'security:budget:stale', '{}',
  'PROCESSING', 1, 'stale-worker', pg_catalog.clock_timestamp() - interval '1 second'
);
set local role service_role;
do $$
begin
  begin
    perform public.admit_mint_dispatch(
      '00000000-0000-4000-8000-000000000102', 'stale-worker'
    );
    raise exception 'stale lease unexpectedly reserved mint budget';
  exception
    when others then
      if sqlerrm not like '%job lease is not active for this worker%' then
        raise;
      end if;
  end;
end;
$$;
reset role;
do $$
begin
  if exists (
    select 1 from public.mint_dispatch_budget_reservations
    where job_id = '00000000-0000-4000-8000-000000000102'
  ) then
    raise exception 'stale lease created a mint budget reservation';
  end if;
end;
$$;

-- Re-entering the same job on the same UTC day does not consume a second slot.
insert into public.blockchain_jobs (
  id, entity_type, entity_id, operation_key, payload, status, attempts,
  lease_owner, lease_expires_at
) values (
  '00000000-0000-4000-8000-000000000103', 'passport',
  '00000000-0000-4000-8000-000000000203', 'security:budget:reentry', '{}',
  'PROCESSING', 1, 'reentry-worker', pg_catalog.clock_timestamp() + interval '10 minutes'
);
set local role service_role;
do $$
begin
  if not public.admit_mint_dispatch(
    '00000000-0000-4000-8000-000000000103', 'reentry-worker'
  ) then
    raise exception 'first same-day mint dispatch was not admitted';
  end if;
end;
$$;
reset role;
update public.blockchain_jobs
set status = 'PROCESSING', attempts = 2, lease_owner = 'reentry-worker',
  lease_expires_at = pg_catalog.clock_timestamp() + interval '10 minutes'
where id = '00000000-0000-4000-8000-000000000103';
set local role service_role;
do $$
begin
  if not public.admit_mint_dispatch(
    '00000000-0000-4000-8000-000000000103', 'reentry-worker'
  ) then
    raise exception 'same-day mint dispatch re-entry was not admitted';
  end if;
end;
$$;
reset role;
do $$
begin
  if (select pg_catalog.count(*) from public.mint_dispatch_budget_reservations
      where job_id = '00000000-0000-4000-8000-000000000103') <> 1 then
    raise exception 'same-day re-entry consumed more than one mint budget slot';
  end if;
end;
$$;

-- Previous UTC-day reservations do not consume today's capacity.
delete from public.mint_dispatch_budget_reservations;
update public.mint_dispatch_policy set daily_job_limit = 1 where singleton;
insert into public.blockchain_jobs (
  id, entity_type, entity_id, operation_key, payload, status, attempts
) values (
  '00000000-0000-4000-8000-000000000104', 'passport',
  '00000000-0000-4000-8000-000000000204', 'security:budget:prior-day', '{}',
  'PENDING', 0
);
insert into public.mint_dispatch_budget_reservations (budget_day, job_id, reserved_at)
values (
  ((pg_catalog.clock_timestamp() at time zone 'UTC')::date - 1),
  '00000000-0000-4000-8000-000000000104',
  pg_catalog.clock_timestamp() - interval '1 day'
);
insert into public.blockchain_jobs (
  id, entity_type, entity_id, operation_key, payload, status, attempts,
  lease_owner, lease_expires_at
) values (
  '00000000-0000-4000-8000-000000000105', 'passport',
  '00000000-0000-4000-8000-000000000205', 'security:budget:rollover', '{}',
  'PROCESSING', 1, 'rollover-worker', pg_catalog.clock_timestamp() + interval '10 minutes'
);
set local role service_role;
do $$
begin
  if not public.admit_mint_dispatch(
    '00000000-0000-4000-8000-000000000105', 'rollover-worker'
  ) then
    raise exception 'previous UTC-day reservation blocked current UTC day';
  end if;
end;
$$;
reset role;

-- At capacity, the lease is released until the next UTC day without spending an attempt.
insert into public.blockchain_jobs (
  id, entity_type, entity_id, operation_key, payload, status, attempts,
  lease_owner, lease_expires_at
) values (
  '00000000-0000-4000-8000-000000000106', 'passport',
  '00000000-0000-4000-8000-000000000206', 'security:budget:blocked', '{}',
  'PROCESSING', 4, 'blocked-worker', pg_catalog.clock_timestamp() + interval '10 minutes'
);
set local role service_role;
do $$
begin
  if public.admit_mint_dispatch(
    '00000000-0000-4000-8000-000000000106', 'blocked-worker'
  ) then
    raise exception 'job above the daily mint limit was admitted';
  end if;
end;
$$;
reset role;
do $$
declare
  blocked public.blockchain_jobs;
  expected_retry timestamptz := ((((pg_catalog.clock_timestamp() at time zone 'UTC')::date + 1)::timestamp) at time zone 'UTC');
begin
  select * into strict blocked from public.blockchain_jobs
  where id = '00000000-0000-4000-8000-000000000106';
  if blocked.status <> 'RETRYING' or blocked.attempts <> 3
    or blocked.lease_owner is not null or blocked.lease_expires_at is not null
    or blocked.next_attempt_at <> expected_retry
    or blocked.last_error_code <> 'MINT_DAILY_DISPATCH_LIMIT' then
    raise exception 'daily limit hold did not preserve retry budget and UTC rollover';
  end if;
end;
$$;

-- Fee policy holds are fixed-reason, lease checked, and decrement only once.
insert into public.blockchain_jobs (
  id, entity_type, entity_id, operation_key, payload, status, attempts,
  lease_owner, lease_expires_at
) values (
  '00000000-0000-4000-8000-000000000107', 'passport',
  '00000000-0000-4000-8000-000000000207', 'security:budget:fee-hold', '{}',
  'PROCESSING', 3, 'fee-worker', pg_catalog.clock_timestamp() + interval '10 minutes'
);
set local role service_role;
do $$
begin
  perform public.hold_mint_fee_policy(
    '00000000-0000-4000-8000-000000000107', 'fee-worker', 'MINT_FEE_POLICY_BLOCKED'
  );
  begin
    perform public.hold_mint_fee_policy(
      '00000000-0000-4000-8000-000000000107', 'fee-worker', 'MINT_FEE_POLICY_BLOCKED'
    );
    raise exception 'repeated fee hold unexpectedly reused a released lease';
  exception
    when others then
      if sqlerrm not like '%job lease is not active for this worker%' then
        raise;
      end if;
  end;
  begin
    perform public.hold_mint_fee_policy(
      '00000000-0000-4000-8000-000000000107', 'fee-worker', 'ARBITRARY_REASON'
    );
    raise exception 'arbitrary fee hold reason was accepted';
  exception
    when others then
      if sqlerrm not like '%unsupported mint fee hold reason%' then
        raise;
      end if;
  end;
end;
$$;
reset role;
do $$
declare
  held public.blockchain_jobs;
begin
  select * into strict held from public.blockchain_jobs
  where id = '00000000-0000-4000-8000-000000000107';
  if held.status <> 'RETRYING' or held.attempts <> 2
    or held.lease_owner is not null or held.lease_expires_at is not null
    or held.next_attempt_at < pg_catalog.clock_timestamp() + interval '59 minutes'
    or held.next_attempt_at > pg_catalog.clock_timestamp() + interval '61 minutes'
    or held.last_error_code <> 'MINT_FEE_POLICY_BLOCKED' then
    raise exception 'fee policy hold did not preserve one retry attempt and release the lease';
  end if;
end;
$$;

rollback;
