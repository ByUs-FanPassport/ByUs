#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
cd "$ROOT_DIR"
exec node --input-type=module -e 'const { startHarness } = await import("./apps/web/e2e/lounge-local/server.mjs"); const harness = await startHarness({ fanWebMode: true }); console.log(`Fan web harness ready at ${harness.baseURL}`); await new Promise(() => {});'
