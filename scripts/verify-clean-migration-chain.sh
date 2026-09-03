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

# Release-critical forward migrations are deliberately enumerated.  The replay
# still applies every repository migration below, while this guard makes a
# missing or accidentally renamed PPT migration fail before PostgreSQL starts.
REQUIRED_PPT_MIGRATIONS=(
  20260902010000_phase1_reward_policy.sql
  20260902011000_phase1_tier_cutover.sql
  20260902012000_phase1_ticket_ledger.sql
  20260902013000_phase1_live_reward_settings.sql
  20260902014000_phase1_survey_reward_binding.sql
  20260902015000_activate_reward_policy_v2.sql
  20260902020000_phase2_reaction_domain.sql
  20260902021000_phase2_reaction_passport_attachment.sql
  20260902022000_phase2_verification_reward_cooldown.sql
  20260902023000_phase2_reservation_ticket.sql
  20260902024000_phase2_attendance_code_reward.sql
  20260902025000_phase2_mission_generalization.sql
  20260902026000_phase2_first_reaction_read.sql
  20260903010000_cross_phase_event_instrumentation.sql
  20260903010500_phase2_attribution_and_read_close.sql
  20260903015000_phase2_mission_option_display_mode.sql
  20260903016600_phase3_live_provider_calendar.sql
  20260903016700_phase3_live_calendar.sql
  20260903016800_phase3_live_schedule_revisions.sql
  20260903016900_phase3_live_journey.sql
  20260903016910_phase3_journey_admin_read_volatility_fix.sql
  20260903017000_phase3_collectible_claim.sql
  20260903020000_phase4_benefit_economy_schema.sql
  20260903020500_phase4_benefit_entry_rpc.sql
  20260903021000_phase4_weighted_benefit_draw.sql
  20260903022000_phase4_benefit_fulfillment_privacy.sql
  20260903022500_phase4_recipient_purge.sql
  20260903023000_phase4_my_reward_read.sql
  20260903030000_phase5_notification_channels.sql
  20260903030050_phase5_kakao_connection_state.sql
  20260903030100_phase5_external_delivery_plan.sql
  20260903030150_phase5_live_notification_kinds.sql
  20260903030200_phase5_live_reminder_revision.sql
  20260903030250_phase5_action_required_notification_kinds.sql
  20260903030300_phase5_action_required_notifications.sql
  20260903031000_phase5_my_fan_activity.sql
  20260903031100_phase5_notification_delivery_monitor.sql
  20260903031200_phase5_notification_monitor_volatility_fix.sql
  20260903040000_phase6_platform_analytics.sql
  20260903040100_phase6_platform_aggregates.sql
  20260903041000_phase6_live_analytics.sql
  20260903041100_phase6_live_attribution_fix.sql
  20260903041200_phase6_product_event_projections.sql
  20260903041300_phase6_recipient_purge_monitor.sql
  20260903041400_phase6_product_event_json_validation_fix.sql
  20260904081500_phase5_notification_email_conflict_tolerance.sql
)
for required_migration in "${REQUIRED_PPT_MIGRATIONS[@]}"; do
  if [[ ! -f "$ROOT_DIR/supabase/migrations/$required_migration" ]]; then
    echo "Missing release-critical migration: $required_migration" >&2
    exit 1
  fi
done

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

if [[ -n "${BYUS_CLEAN_DB_ASSERTION_FILE:-}" ]]; then
  psql -X -v ON_ERROR_STOP=1 -h "$SOCKET_DIR" -p "$PG_PORT" -d "$DATABASE" \
    -f "$BYUS_CLEAN_DB_ASSERTION_FILE"
fi
if [[ -n "${BYUS_CLEAN_DB_SHELL_ASSERTION_FILE:-}" ]]; then
  PGHOST="$SOCKET_DIR" PGPORT="$PG_PORT" PGDATABASE="$DATABASE" \
    bash "$BYUS_CLEAN_DB_SHELL_ASSERTION_FILE"
fi

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
  if to_regprocedure('public.read_admin_platform_analytics(uuid,uuid,timestamptz,timestamptz,timestamptz)') is null
    or to_regprocedure('public.read_admin_live_analytics(uuid,uuid,uuid,timestamptz,timestamptz,timestamptz)') is null
    or to_regprocedure('public.read_admin_recipient_purge_status(uuid,uuid,timestamptz)') is null then
    raise exception 'clean replay is missing a Phase 6 guarded read model';
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
