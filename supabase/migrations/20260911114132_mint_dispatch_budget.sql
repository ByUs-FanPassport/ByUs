create table public.mint_dispatch_policy (
  singleton boolean primary key default true check (singleton),
  daily_job_limit integer not null check (daily_job_limit between 1 and 1000000),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_at timestamptz not null default pg_catalog.clock_timestamp()
);

insert into public.mint_dispatch_policy (singleton, daily_job_limit)
values (true, 1000);

create table public.mint_dispatch_budget_reservations (
  budget_day date not null,
  job_id uuid not null references public.blockchain_jobs(id) on delete restrict,
  reserved_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (budget_day, job_id)
);

alter table public.mint_dispatch_policy enable row level security;
alter table public.mint_dispatch_budget_reservations enable row level security;

revoke all on table public.mint_dispatch_policy,
  public.mint_dispatch_budget_reservations
  from public, anon, authenticated, service_role;

create function public.admit_mint_dispatch(
  p_job_id uuid,
  p_worker_id text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_daily_job_limit integer;
  v_now timestamptz;
  v_budget_day date;
  v_reserved_count bigint;
  v_job_id uuid;
begin
  select policy.daily_job_limit
    into v_daily_job_limit
  from public.mint_dispatch_policy policy
  where policy.singleton
  for update;

  if not found then
    raise exception 'mint dispatch policy is missing' using errcode = 'P0001';
  end if;

  v_now := pg_catalog.clock_timestamp();
  v_budget_day := (v_now at time zone 'UTC')::date;

  select job.id
    into v_job_id
  from public.blockchain_jobs job
  where job.id = p_job_id
    and job.status = 'PROCESSING'
    and job.lease_owner = p_worker_id
    and job.lease_expires_at > v_now
  for update;

  if not found then
    raise exception 'job lease is not active for this worker' using errcode = 'P0001';
  end if;

  if exists (
    select 1
    from public.mint_dispatch_budget_reservations reservation
    where reservation.budget_day = v_budget_day
      and reservation.job_id = v_job_id
  ) then
    return true;
  end if;

  select pg_catalog.count(*)
    into v_reserved_count
  from public.mint_dispatch_budget_reservations reservation
  where reservation.budget_day = v_budget_day;

  if v_reserved_count < v_daily_job_limit then
    insert into public.mint_dispatch_budget_reservations (budget_day, job_id, reserved_at)
    values (v_budget_day, v_job_id, v_now);
    return true;
  end if;

  update public.blockchain_jobs job
  set status = 'RETRYING',
      attempts = case when job.attempts > 0 then job.attempts - 1 else 0 end,
      next_attempt_at = ((v_budget_day + 1)::timestamp at time zone 'UTC'),
      last_error_code = 'MINT_DAILY_DISPATCH_LIMIT',
      last_error_message = 'Daily mint dispatch limit reached',
      lease_owner = null,
      lease_expires_at = null
  where job.id = v_job_id;

  return false;
end;
$$;

create function public.hold_mint_fee_policy(
  p_job_id uuid,
  p_worker_id text,
  p_reason text
)
returns public.blockchain_jobs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_result public.blockchain_jobs;
begin
  if p_reason is distinct from 'MINT_FEE_POLICY_BLOCKED' then
    raise exception 'unsupported mint fee hold reason' using errcode = 'P0001';
  end if;

  update public.blockchain_jobs job
  set status = 'RETRYING',
      attempts = case when job.attempts > 0 then job.attempts - 1 else 0 end,
      next_attempt_at = v_now + interval '1 hour',
      last_error_code = 'MINT_FEE_POLICY_BLOCKED',
      last_error_message = 'Mint dispatch held by fee policy',
      lease_owner = null,
      lease_expires_at = null
  where job.id = p_job_id
    and job.status = 'PROCESSING'
    and job.lease_owner = p_worker_id
    and job.lease_expires_at > v_now
  returning job.* into v_result;

  if v_result.id is null then
    raise exception 'job lease is not active for this worker' using errcode = 'P0001';
  end if;

  return v_result;
end;
$$;

revoke all on function public.admit_mint_dispatch(uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function public.hold_mint_fee_policy(uuid, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.admit_mint_dispatch(uuid, text) to service_role;
grant execute on function public.hold_mint_fee_policy(uuid, text, text) to service_role;

comment on table public.mint_dispatch_policy is
  'Database-owned singleton policy for the global UTC-day mint dispatch ceiling.';
comment on table public.mint_dispatch_budget_reservations is
  'One atomic mint dispatch admission per blockchain job and UTC day.';
comment on function public.admit_mint_dispatch(uuid, text) is
  'Atomically admits an actively leased job under the database-owned UTC-day mint dispatch ceiling.';
comment on function public.hold_mint_fee_policy(uuid, text, text) is
  'Returns an actively leased job to retry without consuming an attempt when the fixed mint fee policy blocks dispatch.';
