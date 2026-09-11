#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
bash "$SCRIPT_DIR/verify-mint-dispatch-budget-concurrency.sh"
bash "$SCRIPT_DIR/verify-kakao-alimtalk-concurrency.sh"
