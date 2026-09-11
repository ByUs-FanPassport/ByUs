#!/usr/bin/env bash
set -euo pipefail
root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
psql -X -v ON_ERROR_STOP=1 -f "$root_dir/supabase/tests/mission_reward_score_suite.sql"
bash "$root_dir/scripts/verify-mint-dispatch-budget-concurrency.sh"
bash "$root_dir/scripts/verify-telegram-alerts.sh"
bash "$root_dir/scripts/verify-kakao-alimtalk-concurrency.sh"
