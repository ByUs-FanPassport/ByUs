#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ "${PGDATABASE:-}" == "byus_clean" ]]; then
  cd "$ROOT_DIR"
  exec node apps/web/e2e/lounge-local/marbles-run.mjs
fi
export BYUS_CLEAN_DB_PORT=55479
export BYUS_CLEAN_DB_SHELL_ASSERTION_FILE="$ROOT_DIR/scripts/verify-fan-marbles-local.sh"
export BYUS_CLEAN_DB_ASSERTION_FILE="$ROOT_DIR/supabase/tests/fan_community_cheers_behavior.sql"
exec bash "$ROOT_DIR/scripts/verify-clean-migration-chain.sh"
