-- Bounded, service-only recipient PII purge and non-PII maintenance evidence.

create table public.benefit_maintenance_runs (
  id uuid primary key default extensions.gen_random_uuid(),
  maintenance_type text not null check (maintenance_type='recipient_purge'),
  started_at timestamptz not null,
  finished_at timestamptz not null,
  deleted_count integer not null check (deleted_count>=0),
  duration_ms integer not null check (duration_ms>=0),
  last_error_code text check (last_error_code in ('PURGE_RPC_FAILED','PURGE_EVIDENCE_FAILED')),
  succeeded boolean generated always as (last_error_code is null) stored,
  created_at timestamptz not null default pg_catalog.now(),
  check (finished_at>=started_at)
);
create index benefit_maintenance_runs_latest_idx
  on public.benefit_maintenance_runs(maintenance_type,finished_at desc,id desc);
alter table public.benefit_maintenance_runs enable row level security;
alter table public.benefit_maintenance_runs force row level security;
revoke all on table public.benefit_maintenance_runs from public,anon,authenticated,service_role;

create trigger benefit_maintenance_runs_reject_update_delete
before update or delete on public.benefit_maintenance_runs for each row
execute function public.reject_benefit_economy_history_mutation();
create trigger benefit_maintenance_runs_reject_truncate
before truncate on public.benefit_maintenance_runs for each statement
execute function public.reject_benefit_economy_history_truncate();

create function public.purge_due_benefit_recipient_private(
  p_now timestamptz default pg_catalog.now()
) returns integer language plpgsql security definer set search_path='' as $$
declare v_deleted integer;
begin
  with due as (
    select r.winner_id
    from public.benefit_recipient_private r
    join public.benefit_fulfillments f on f.winner_id=r.winner_id
    join lateral (
      select e.created_at
      from public.benefit_fulfillment_events e
      where e.fulfillment_id=f.id and e.to_status=f.status
        and e.to_status in ('shipping_completed','pickup_completed')
      order by e.created_at desc,e.id desc limit 1
    ) e on true
    where f.status in ('shipping_completed','pickup_completed')
      and e.created_at <= p_now - interval '30 days'
    order by e.created_at,r.winner_id
    for update of r skip locked
    limit 100
  ), deleted as (
    delete from public.benefit_recipient_private r using due
    where r.winner_id=due.winner_id returning r.winner_id
  )
  insert into public.benefit_recipient_access_audits(winner_id,access_type,accessed_at)
  select winner_id,'purged',p_now from deleted;
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

create function public.record_benefit_recipient_purge_run(
  p_started_at timestamptz,p_finished_at timestamptz,
  p_deleted_count integer,p_error_code text default null
) returns boolean language plpgsql security definer set search_path='' as $$
begin
  insert into public.benefit_maintenance_runs(
    maintenance_type,started_at,finished_at,deleted_count,duration_ms,last_error_code
  ) values(
    'recipient_purge',p_started_at,p_finished_at,p_deleted_count,
    greatest(0,floor(extract(epoch from (p_finished_at-p_started_at))*1000)::integer),
    p_error_code
  );
  return true;
end;
$$;

revoke all on function public.purge_due_benefit_recipient_private(timestamptz) from public,anon,authenticated;
revoke all on function public.record_benefit_recipient_purge_run(timestamptz,timestamptz,integer,text) from public,anon,authenticated;
grant execute on function public.purge_due_benefit_recipient_private(timestamptz) to service_role;
grant execute on function public.record_benefit_recipient_purge_run(timestamptz,timestamptz,integer,text) to service_role;
