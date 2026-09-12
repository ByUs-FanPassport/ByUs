#!/usr/bin/env bash
set -euo pipefail
root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
psql -X -v ON_ERROR_STOP=1 -f "$root_dir/supabase/tests/mission_reward_score_suite.sql"
bash "$root_dir/scripts/verify-mint-dispatch-budget-concurrency.sh"
bash "$root_dir/scripts/verify-telegram-alerts.sh"
bash "$root_dir/scripts/verify-kakao-alimtalk-concurrency.sh"
bash "$root_dir/scripts/verify-phone-sms-enrollment-concurrency.sh"
psql -X -v ON_ERROR_STOP=1 -f "$root_dir/supabase/tests/live_alert_delivery_safety.sql"
bash "$root_dir/scripts/verify-email-send-concurrency.sh"
psql -X -v ON_ERROR_STOP=1 -f "$root_dir/supabase/tests/live_alert_cutover.sql"
bash "$root_dir/scripts/verify-live-alert-cutover-concurrency.sh"

psql -X -v ON_ERROR_STOP=1 -f "$root_dir/supabase/tests/community_stamps_behavior.sql"
BYUS_COMMUNITY_STAMP_CONCURRENCY_MODE=1 bash "$root_dir/scripts/verify-community-stamp-concurrency.sh"
