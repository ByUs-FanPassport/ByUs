-- PostgreSQL may resolve trigger-record fields before evaluating a boolean
-- short-circuit. Keep table-specific credential fields inside explicit
-- branches so the shared trigger never resolves a column from the other table.
create or replace function public.enforce_credential_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id is distinct from old.id
     or new.app_user_id is distinct from old.app_user_id
     or new.celebrity_id is distinct from old.celebrity_id
     or new.business_status is distinct from old.business_status
     or new.issued_at is distinct from old.issued_at then
    raise exception 'credential identity and business fields are immutable';
  end if;

  if tg_table_name = 'fan_passports' then
    if new.quiz_pass_id is distinct from old.quiz_pass_id then
      raise exception 'credential identity and business fields are immutable';
    end if;
  elsif tg_table_name = 'stamps' then
    if new.passport_id is distinct from old.passport_id
       or new.activity_id is distinct from old.activity_id
       or new.stamp_type is distinct from old.stamp_type then
      raise exception 'credential identity and business fields are immutable';
    end if;
  else
    raise exception 'credential update trigger attached to unsupported table';
  end if;

  if old.blockchain_job_id is not null
     and new.blockchain_job_id is distinct from old.blockchain_job_id then
    raise exception 'credential blockchain job link is immutable once assigned';
  end if;
  if old.mint_status = 'minted' then
    raise exception 'minted credential is immutable';
  end if;

  if new.mint_status is distinct from old.mint_status
     and not (
       (old.mint_status = 'queued' and new.mint_status in ('processing', 'retryable', 'permanent_failure'))
       or (old.mint_status = 'processing' and new.mint_status in ('minted', 'retryable', 'permanent_failure'))
       or (old.mint_status = 'retryable' and new.mint_status in ('processing', 'permanent_failure'))
       or (old.mint_status = 'permanent_failure' and new.mint_status = 'retryable')
     ) then
    raise exception 'invalid credential mint status transition';
  end if;
  return new;
end;
$$;

