#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PG_PORT="${BYUS_CLEAN_DB_PORT:-55432}"
WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/byus-clean-db.XXXXXX")"
DATA_DIR="$WORK_DIR/data"
SOCKET_DIR="$WORK_DIR/socket"
DATABASE="byus_clean"

cleanup() {
  pg_ctl -D "$DATA_DIR" stop -m fast >/dev/null 2>&1 || true
  find "$WORK_DIR" -depth -delete >/dev/null 2>&1 || true
}
trap cleanup EXIT

command -v initdb >/dev/null
command -v pg_ctl >/dev/null
command -v psql >/dev/null

initdb -D "$DATA_DIR" --no-locale -E UTF8 >/dev/null
mkdir -p "$SOCKET_DIR"
pg_ctl -D "$DATA_DIR" -o "-p $PG_PORT -k $SOCKET_DIR" -l "$WORK_DIR/postgres.log" start >/dev/null
createdb -h "$SOCKET_DIR" -p "$PG_PORT" "$DATABASE"

psql -X -v ON_ERROR_STOP=1 -h "$SOCKET_DIR" -p "$PG_PORT" -d "$DATABASE" <<'SQL' >/dev/null
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;

create schema extensions;
create extension pgcrypto with schema extensions;

-- Minimal Supabase platform surface used by repository migrations. The
-- production extensions are supplied by Supabase; this shim keeps the replay
-- focused on repository-owned schema, seed, and data-migration assumptions.
create schema storage;
create table storage.buckets (
  id text primary key,
  name text not null,
  public boolean not null default false,
  file_size_limit bigint,
  allowed_mime_types text[]
);
create table storage.objects (
  id uuid primary key default extensions.gen_random_uuid(),
  bucket_id text references storage.buckets(id),
  name text not null,
  owner uuid,
  metadata jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  last_accessed_at timestamptz default now()
);

create schema cron;
create table cron.job (
  jobid bigint generated always as identity primary key,
  jobname text unique,
  schedule text,
  command text,
  active boolean default true
);
create function cron.schedule(text, text, text) returns bigint
language plpgsql as $$
declare scheduled_id bigint;
begin
  insert into cron.job(jobname, schedule, command)
  values ($1, $2, $3)
  returning jobid into scheduled_id;
  return scheduled_id;
end;
$$;
create function cron.unschedule(bigint) returns boolean
language sql as $$
  delete from cron.job where jobid = $1 returning true;
$$;

create schema vault;
create table vault.secrets (
  id uuid primary key default extensions.gen_random_uuid(),
  name text,
  secret text,
  description text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create view vault.decrypted_secrets as
select id, name, secret as decrypted_secret, description, created_at, updated_at
from vault.secrets;
create function vault.create_secret(text, text, text) returns uuid
language plpgsql as $$
declare secret_id uuid;
begin
  insert into vault.secrets(secret, name, description)
  values ($1, $2, $3)
  returning id into secret_id;
  return secret_id;
end;
$$;
create function vault.update_secret(uuid, text, text, text) returns void
language sql as $$
  update vault.secrets
  set secret = $2, name = $3, description = $4, updated_at = now()
  where id = $1;
$$;

create schema net;
create function net.http_post(
  url text,
  headers jsonb default '{}'::jsonb,
  body jsonb default '{}'::jsonb
) returns bigint language sql as $$ select 1::bigint; $$;
SQL

while IFS= read -r migration; do
  echo "Applying $(basename "$migration")"
  # pg_cron, pg_net, and supabase_vault are Supabase platform extensions. Their
  # minimal schemas are already present above; all repository SQL is unchanged.
  sed -E '/^create extension if not exists (pgcrypto|pg_cron|pg_net|supabase_vault) /d' "$migration" \
    | psql -X -v ON_ERROR_STOP=1 -h "$SOCKET_DIR" -p "$PG_PORT" -d "$DATABASE" >/dev/null
done < <(find "$ROOT_DIR/supabase/migrations" -maxdepth 1 -type f -name '*.sql' | sort)

psql -X -v ON_ERROR_STOP=1 -h "$SOCKET_DIR" -p "$PG_PORT" -d "$DATABASE" <<'SQL'
do $$
begin
  if (select policy_version from public.reward_policy_activation where singleton) <> 2 then
    raise exception 'clean replay did not activate reward policy v2';
  end if;
  if public.fan_level_for_score(0, 2) <> 'Bronze'
    or public.fan_level_for_score(15, 2) <> 'Silver'
    or public.fan_level_for_score(50, 2) <> 'Gold'
    or public.fan_level_for_score(120, 2) <> 'Platinum'
    or public.fan_level_for_score(250, 2) <> 'Diamond' then
    raise exception 'clean replay tier boundaries are invalid';
  end if;
  if exists (
    select 1 from public.live_surveys survey
    left join public.live_survey_reward_setting_bindings binding on binding.survey_id = survey.id
    where binding.survey_id is null
  ) then
    raise exception 'clean replay left an unbound survey';
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.fan_ticket_ledger'::regclass
      and contype = 'u'
      and pg_get_constraintdef(oid) like '%app_user_id, celebrity_id, source_type, source_id%'
  ) then
    raise exception 'clean replay is missing canonical Ticket source uniqueness';
  end if;
end;
$$;

select jsonb_build_object(
  'migrationsApplied', (select count(*) from pg_tables where schemaname = 'public'),
  'activePolicyVersion', (select policy_version from public.reward_policy_activation where singleton),
  'tierBoundaries', jsonb_build_array(
    public.fan_level_for_score(0, 2),
    public.fan_level_for_score(15, 2),
    public.fan_level_for_score(50, 2),
    public.fan_level_for_score(120, 2),
    public.fan_level_for_score(250, 2)
  )
) as clean_replay_result;
SQL
