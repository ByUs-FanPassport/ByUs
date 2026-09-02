-- Phase 01 off-chain Ticket accounting. Entries are immutable, Creator-scoped,
-- and can only be posted through the replay-safe service RPC below.

create table public.fan_ticket_ledger (
  id uuid primary key default extensions.gen_random_uuid(),
  app_user_id uuid not null references public.app_users(id) on delete restrict,
  celebrity_id uuid not null references public.celebrities(id) on delete restrict,
  entry_kind text not null check (entry_kind in ('credit', 'debit')),
  amount bigint not null check (amount <> 0),
  source_type text not null check (
    source_type = btrim(source_type) and length(source_type) between 1 and 100
  ),
  source_id uuid not null,
  idempotency_key uuid not null unique,
  policy_version integer not null references public.reward_policy_versions(version) on delete restrict,
  setting_revision bigint check (setting_revision is null or setting_revision > 0),
  reward_setting_revision_id uuid,
  owner_sequence bigint not null check (owner_sequence > 0),
  resulting_balance bigint not null check (resulting_balance >= 0),
  created_at timestamptz not null default now(),
  constraint fan_ticket_entry_kind_matches_amount check (
    (entry_kind = 'credit' and amount > 0)
    or (entry_kind = 'debit' and amount < 0)
  ),
  constraint fan_ticket_setting_identity_complete check (
    (setting_revision is null) = (reward_setting_revision_id is null)
  ),
  unique (app_user_id, celebrity_id, source_type, source_id),
  unique (app_user_id, celebrity_id, owner_sequence)
);

create index fan_ticket_ledger_owner_latest_idx
  on public.fan_ticket_ledger(app_user_id, celebrity_id, owner_sequence desc)
  include (resulting_balance);

create function public.reject_fan_ticket_ledger_mutation()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'fan Ticket ledger is append-only';
end;
$$;

create trigger fan_ticket_ledger_append_only
before update or delete on public.fan_ticket_ledger
for each row execute function public.reject_fan_ticket_ledger_mutation();

create trigger fan_ticket_ledger_reject_truncate
before truncate on public.fan_ticket_ledger
for each statement execute function public.reject_fan_ticket_ledger_mutation();

create function public.get_fan_ticket_balance(
  p_app_user_id uuid,
  p_celebrity_id uuid
) returns bigint language sql stable security definer set search_path = '' as $$
  select coalesce((select ledger.resulting_balance
    from public.fan_ticket_ledger ledger
    where ledger.app_user_id = p_app_user_id
      and ledger.celebrity_id = p_celebrity_id
    order by ledger.owner_sequence desc
    limit 1), 0)::bigint
$$;

create function public.post_fan_ticket_entry(
  p_app_user_id uuid,
  p_celebrity_id uuid,
  p_entry_kind text,
  p_amount bigint,
  p_source_type text,
  p_source_id uuid,
  p_idempotency_key uuid,
  p_policy_version integer,
  p_setting_revision bigint default null,
  p_reward_setting_revision_id uuid default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  existing public.fan_ticket_ledger%rowtype;
  existing_source public.fan_ticket_ledger%rowtype;
  normalized_source_type text;
  current_balance numeric;
  next_balance numeric;
  next_owner_sequence bigint;
  inserted public.fan_ticket_ledger%rowtype;
begin
  if p_app_user_id is null or p_celebrity_id is null or p_source_id is null
     or p_idempotency_key is null or p_policy_version is null or p_amount is null
     or p_entry_kind is null
     or p_amount = 0 or p_entry_kind not in ('credit', 'debit')
     or (p_entry_kind = 'credit' and p_amount < 0)
     or (p_entry_kind = 'debit' and p_amount > 0)
     or p_setting_revision is not null and p_setting_revision <= 0 then
    raise exception 'PHASE1_TICKET_INVALID';
  end if;
  normalized_source_type := btrim(coalesce(p_source_type, ''));
  if length(normalized_source_type) not between 1 and 100 then
    raise exception 'PHASE1_TICKET_INVALID';
  end if;

  -- Global request-key lock always comes first. Every writer then takes exactly
  -- one fan/Creator balance lock, preventing overdrafts without cross-Creator contention.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('phase1:ticket:key:' || p_idempotency_key::text, 0)
  );
  select * into existing
  from public.fan_ticket_ledger ledger
  where ledger.idempotency_key = p_idempotency_key;
  if found then
    if existing.app_user_id <> p_app_user_id
       or existing.celebrity_id <> p_celebrity_id
       or existing.entry_kind <> p_entry_kind
       or existing.amount <> p_amount
       or existing.source_type <> normalized_source_type
       or existing.source_id <> p_source_id
       or existing.policy_version <> p_policy_version
       or existing.setting_revision is distinct from p_setting_revision
       or existing.reward_setting_revision_id is distinct from p_reward_setting_revision_id then
      raise exception 'PHASE1_TICKET_IDEMPOTENCY_CONFLICT' using errcode = '23514';
    end if;
    return jsonb_build_object(
      'entryId', existing.id,
      'amount', existing.amount,
      'balance', existing.resulting_balance,
      'replayed', true,
      'createdAt', existing.created_at
    );
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'phase1:ticket:balance:' || p_app_user_id::text || ':' || p_celebrity_id::text,
      0
    )
  );

  -- A semantic business source is single-use even if a caller changes its key.
  select * into existing_source
  from public.fan_ticket_ledger ledger
  where ledger.app_user_id = p_app_user_id
    and ledger.celebrity_id = p_celebrity_id
    and ledger.source_type = normalized_source_type
    and ledger.source_id = p_source_id;
  if found then
    raise exception 'PHASE1_TICKET_SOURCE_CONFLICT' using errcode = '23514';
  end if;

  perform 1 from public.app_users where id = p_app_user_id and status = 'active' for share;
  if not found then raise exception 'PHASE1_TICKET_OWNER_UNAVAILABLE'; end if;
  perform 1 from public.celebrities where id = p_celebrity_id and archived_at is null for share;
  if not found then raise exception 'PHASE1_TICKET_CREATOR_UNAVAILABLE'; end if;
  perform 1 from public.reward_policy_versions where version = p_policy_version for share;
  if not found then raise exception 'PHASE1_TICKET_POLICY_UNAVAILABLE'; end if;

  select ledger.resulting_balance, ledger.owner_sequence + 1
    into current_balance, next_owner_sequence
  from public.fan_ticket_ledger ledger
  where ledger.app_user_id = p_app_user_id
    and ledger.celebrity_id = p_celebrity_id
  order by ledger.owner_sequence desc
  limit 1;
  current_balance := coalesce(current_balance, 0);
  next_owner_sequence := coalesce(next_owner_sequence, 1);
  next_balance := current_balance + p_amount::numeric;
  if next_balance < 0 then
    raise exception 'PHASE1_TICKET_NEGATIVE_BALANCE' using errcode = '23514';
  end if;
  if next_balance > 9223372036854775807 then
    raise exception 'PHASE1_TICKET_BALANCE_OVERFLOW' using errcode = '22003';
  end if;

  insert into public.fan_ticket_ledger(
    app_user_id, celebrity_id, entry_kind, amount, source_type, source_id,
    idempotency_key, policy_version, setting_revision, reward_setting_revision_id,
    owner_sequence, resulting_balance
  ) values (
    p_app_user_id, p_celebrity_id, p_entry_kind, p_amount, normalized_source_type,
    p_source_id, p_idempotency_key, p_policy_version, p_setting_revision,
    p_reward_setting_revision_id, next_owner_sequence, next_balance::bigint
  ) returning * into inserted;

  return jsonb_build_object(
    'entryId', inserted.id,
    'amount', inserted.amount,
    'balance', inserted.resulting_balance,
    'replayed', false,
    'createdAt', inserted.created_at
  );
end;
$$;

alter table public.fan_ticket_ledger enable row level security;
alter table public.fan_ticket_ledger force row level security;

revoke all on table public.fan_ticket_ledger from public,anon,authenticated,service_role;
revoke all on function public.reject_fan_ticket_ledger_mutation()
  from public,anon,authenticated,service_role;
revoke all on function public.get_fan_ticket_balance(uuid,uuid)
  from public,anon,authenticated,service_role;
revoke all on function public.post_fan_ticket_entry(uuid,uuid,text,bigint,text,uuid,uuid,integer,bigint,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.get_fan_ticket_balance(uuid,uuid) to service_role;
grant execute on function public.post_fan_ticket_entry(uuid,uuid,text,bigint,text,uuid,uuid,integer,bigint,uuid)
  to service_role;

comment on table public.fan_ticket_ledger is
  'Immutable off-chain Ticket Credit/Debit ledger scoped to one fan and Creator; each deterministic owner sequence stores its resulting bigint balance.';
