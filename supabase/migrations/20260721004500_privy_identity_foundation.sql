-- ADR-002 identity foundation.
-- Privy is the sole end-user identity authority. These tables are private to
-- the server-side BFF, which accesses them with the Supabase service role.

create type public.app_user_status as enum ('active', 'disabled');
create type public.admin_role as enum ('admin', 'operator', 'viewer');

create table public.app_users (
  id uuid primary key default extensions.gen_random_uuid(),
  privy_user_id text not null unique,
  verified_email text not null,
  status public.app_user_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_authenticated_at timestamptz,
  constraint app_users_privy_user_id_not_blank
    check (length(trim(privy_user_id)) > 0 and privy_user_id = trim(privy_user_id)),
  constraint app_users_verified_email_normalized
    check (
      verified_email = lower(trim(verified_email))
      and verified_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    )
);

comment on column public.app_users.privy_user_id is
  'Canonical external subject from a verified Privy access token; email is not an identity key.';

create index app_users_verified_email_idx on public.app_users (verified_email);
create index app_users_status_idx on public.app_users (status);

create table public.user_wallets (
  id uuid primary key default extensions.gen_random_uuid(),
  app_user_id uuid not null references public.app_users(id) on delete cascade,
  chain_id bigint not null check (chain_id > 0),
  address text not null,
  provider text not null default 'privy' check (provider = 'privy'),
  wallet_type text not null default 'embedded' check (wallet_type = 'embedded'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_wallets_address_normalized
    check (address = lower(trim(address)) and address ~ '^0x[0-9a-f]{40}$'),
  constraint user_wallets_one_wallet_per_user_chain unique (app_user_id, chain_id),
  constraint user_wallets_one_owner_per_wallet unique (chain_id, address)
);

create index user_wallets_app_user_id_idx on public.user_wallets (app_user_id);

create table public.admin_allowlist (
  id uuid primary key default extensions.gen_random_uuid(),
  email text not null unique,
  role public.admin_role not null,
  active boolean not null default true,
  created_by_app_user_id uuid references public.app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint admin_allowlist_email_normalized
    check (
      email = lower(trim(email))
      and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    )
);

create index admin_allowlist_active_email_idx
  on public.admin_allowlist (email)
  where active;

create trigger app_users_set_updated_at
before update on public.app_users
for each row execute function public.set_updated_at();

create trigger user_wallets_set_updated_at
before update on public.user_wallets
for each row execute function public.set_updated_at();

create trigger admin_allowlist_set_updated_at
before update on public.admin_allowlist
for each row execute function public.set_updated_at();

-- Preserve the legacy actor_admin_id column while adding explicit, enforceable
-- identity links for all new audit records.
alter table public.audit_logs
  add column actor_app_user_id uuid references public.app_users(id) on delete set null,
  add column actor_admin_allowlist_id uuid references public.admin_allowlist(id) on delete set null;

create index audit_logs_actor_app_user_idx
  on public.audit_logs (actor_app_user_id, created_at desc);
create index audit_logs_actor_admin_allowlist_idx
  on public.audit_logs (actor_admin_allowlist_id, created_at desc);

alter table public.app_users enable row level security;
alter table public.user_wallets enable row level security;
alter table public.admin_allowlist enable row level security;

revoke all on public.app_users from public, anon, authenticated;
revoke all on public.user_wallets from public, anon, authenticated;
revoke all on public.admin_allowlist from public, anon, authenticated;

grant select, insert, update on public.app_users to service_role;
grant select, insert, update, delete on public.user_wallets to service_role;
grant select, insert, update, delete on public.admin_allowlist to service_role;

comment on table public.app_users is
  'Private canonical mapping for verified Privy subjects; inaccessible to browser roles.';
comment on table public.user_wallets is
  'Private one-owner mapping for Privy embedded wallets; relinks require explicit reviewed application logic.';
comment on table public.admin_allowlist is
  'Private server-checked admin authorization list; it is evaluated on every privileged request.';
