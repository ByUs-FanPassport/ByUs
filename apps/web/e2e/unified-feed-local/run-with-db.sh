#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/../../../.." && pwd)"
cd "$repo_root"

psql -X -v ON_ERROR_STOP=1 -f supabase/tests/unified_feed_first_post_rewards.sql
bash supabase/tests/unified_feed_first_post_rewards_concurrency.sh
node apps/web/e2e/unified-feed-local/run.mjs
