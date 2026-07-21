create or replace function public.record_prepared_blockchain_job(
  p_job_id uuid,
  p_worker_id text,
  p_tx_hash text,
  p_signed_transaction text
)
returns public.blockchain_jobs
language plpgsql
security definer
set search_path = ''
as $$
declare
  result public.blockchain_jobs;
begin
  if p_tx_hash !~ '^0x[0-9a-fA-F]{64}$' then
    raise exception 'transaction hash must be a 32-byte hex value';
  end if;
  if p_signed_transaction !~ '^0x[0-9a-fA-F]+$'
     or length(p_signed_transaction) > 262144 then
    raise exception 'signed transaction must be bounded hex data';
  end if;

  update public.blockchain_jobs
  set tx_hash = p_tx_hash,
      payload = jsonb_set(
        payload,
        '{workerSubmission}',
        jsonb_build_object(
          'txHash', p_tx_hash,
          'signedTransaction', p_signed_transaction
        ),
        true
      )
  where id = p_job_id
    and status = 'PROCESSING'
    and lease_owner = p_worker_id
    and lease_expires_at > now()
    and (tx_hash is null or tx_hash = p_tx_hash)
  returning * into result;

  if result.id is null then
    raise exception 'job lease is not active for this worker or transaction hash conflicts';
  end if;
  return result;
end;
$$;

revoke all on function public.record_prepared_blockchain_job(uuid, text, text, text)
  from public, anon, authenticated;
grant execute on function public.record_prepared_blockchain_job(uuid, text, text, text)
  to service_role;

comment on function public.record_prepared_blockchain_job(uuid, text, text, text) is
  'Atomically persists a prepared raw transaction before broadcast while an active worker lease is owned.';
