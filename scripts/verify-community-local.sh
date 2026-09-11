#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ "${PGDATABASE:-}" == "byus_clean" ]]; then
  if [[ "${PGPORT:-}" != "55479" || ! -d "${PGHOST:-}" || ! -S "${PGHOST}/.s.PGSQL.${PGPORT}" ]]; then
    echo "Fan community integration requires the disposable local clean-chain database" >&2
    exit 1
  fi
  cd "$ROOT_DIR"
  exec node apps/web/e2e/lounge-local/community-run.mjs
fi

export BYUS_CLEAN_DB_PORT=55479
export BYUS_CLEAN_DB_SHELL_ASSERTION_FILE="$ROOT_DIR/scripts/verify-community-local.sh"
exec bash "$ROOT_DIR/scripts/verify-clean-migration-chain.sh"
