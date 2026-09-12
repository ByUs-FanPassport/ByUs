#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if ! command -v initdb >/dev/null && command -v pg_config >/dev/null; then
  export PATH="$(pg_config --bindir):$PATH"
fi

export BYUS_CLEAN_DB_ASSERTION_FILE="$ROOT_DIR/supabase/tests/signup_funnel_measurement.sql"
export BYUS_CLEAN_DB_SHELL_ASSERTION_FILE="$ROOT_DIR/scripts/verify-backend-security-behavior.sh"
export BYUS_CLEAN_DB_PORT=55472
export BYUS_MINT_BUDGET_TEST_SENTINEL=mint-dispatch-budget-clean-replay
export BYUS_KAKAO_TEST_SENTINEL=kakao-alimtalk-clean-replay
export BYUS_EMAIL_SAFETY_TEST_SENTINEL=email-send-safety-clean-replay
export BYUS_CLEAN_DB_UPGRADE_MIGRATION=20260912144419_live_alert_delivery_safety.sql
export BYUS_CLEAN_DB_UPGRADE_BEFORE_FILE="$ROOT_DIR/supabase/tests/fixtures/live_alert_delivery_safety_before.sql"
export BYUS_CLEAN_DB_UPGRADE_AFTER_FILE="$ROOT_DIR/supabase/tests/fixtures/live_alert_delivery_safety_after.sql"
bash "$ROOT_DIR/scripts/verify-clean-migration-chain.sh"
