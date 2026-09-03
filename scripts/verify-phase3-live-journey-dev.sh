#!/usr/bin/env bash
set -euo pipefail

ENV_FILE="${BYUS_SUPABASE_ENV_FILE:-/Users/jewel/Desktop/Developement/byus/.env.supabase.local}"
EXPECTED_REF="xcppyedwusirqnfpbtit"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "PHASE3_DEV_ENV_FILE_MISSING" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

if [[ "${SUPABASE_DEV_PROJECT_REF:-}" != "$EXPECTED_REF" ]]; then
  echo "PHASE3_DEV_PROJECT_MISMATCH" >&2
  exit 1
fi
if [[ -z "${SUPABASE_DEV_DB_PASSWORD:-}" ]]; then
  echo "PHASE3_DEV_DB_PASSWORD_MISSING" >&2
  exit 1
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export PGPASSWORD="$SUPABASE_DEV_DB_PASSWORD"
exec psql \
  "host=aws-1-ap-northeast-2.pooler.supabase.com port=5432 dbname=postgres user=postgres.${SUPABASE_DEV_PROJECT_REF} sslmode=require connect_timeout=10" \
  -X -f "$ROOT/scripts/verify-phase3-live-journey-dev.sql"
