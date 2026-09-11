#!/usr/bin/env bash
set -euo pipefail
root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
bash "$root_dir/scripts/verify-mint-dispatch-budget-concurrency.sh"
bash "$root_dir/scripts/verify-telegram-alerts.sh"
bash "$root_dir/scripts/verify-kakao-alimtalk-concurrency.sh"
