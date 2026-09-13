#!/usr/bin/env bash
set -euo pipefail

readonly UPGRADES_CORE_VERSION="1.44.0"
readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly TEMP_ROOT="$(mktemp -d)"
readonly RAW_BUILD_INFO="$TEMP_ROOT/raw"
readonly CLEAN_BUILD_INFO="$TEMP_ROOT/build-info"
trap 'rm -rf "$TEMP_ROOT"' EXIT

cd "$SCRIPT_DIR/.."

mkdir -p "$RAW_BUILD_INFO" "$CLEAN_BUILD_INFO"
forge build --build-info --build-info-path "$RAW_BUILD_INFO" --extra-output storageLayout --force

python3 - "$RAW_BUILD_INFO" "$CLEAN_BUILD_INFO" <<'PY'
import json
import pathlib
import shutil
import sys

source = pathlib.Path(sys.argv[1])
target = pathlib.Path(sys.argv[2])
copied = 0
for path in source.glob("*.json"):
    value = json.loads(path.read_text())
    if {"input", "output", "solcVersion"}.issubset(value):
        shutil.copy2(path, target / path.name)
        copied += 1
if copied == 0:
    raise SystemExit("Foundry did not emit a complete build-info file")
PY

readonly VALIDATOR=(npx --yes "@openzeppelin/upgrades-core@$UPGRADES_CORE_VERSION" validate "$CLEAN_BUILD_INFO")
"${VALIDATOR[@]}" --contract ByUsActionHub
"${VALIDATOR[@]}" --contract ByUsActionHubV2 --reference ByUsActionHub --requireReference

if "${VALIDATOR[@]}" --contract ByUsActionHubIncompatible --reference ByUsActionHub \
    --requireReference >"$TEMP_ROOT/incompatible.log" 2>&1; then
    echo "Expected incompatible storage layout to be rejected" >&2
    exit 1
fi
if ! grep -Eq "Replaced .* of incompatible type|Upgraded .* to an incompatible type" \
    "$TEMP_ROOT/incompatible.log"; then
    cat "$TEMP_ROOT/incompatible.log" >&2
    echo "Negative fixture failed for an unexpected reason" >&2
    exit 1
fi

echo "Storage validation passed; incompatible namespace fixture was rejected."
