#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
VALIDATOR="$ROOT_DIR/ops/validation/validate-deployment-authority.py"
INVENTORY="$ROOT_DIR/ops/validation/inventory-deployment-actuators.sh"
FIXTURES="$ROOT_DIR/ops/validation/fixtures"

fail() { printf 'FAIL: %s\n' "$*" >&2; exit 1; }
expect_rejected() {
  local name="$1" fixture="$2"
  set +e
  python3 "$VALIDATOR" "$fixture" >"${TMPDIR:-/tmp}/fos-wp1-$name.out" 2>"${TMPDIR:-/tmp}/fos-wp1-$name.err"
  local status=$?
  set -e
  [[ $status -ne 0 ]] || fail "$name fixture unexpectedly accepted"
}

[[ -x "$INVENTORY" ]] || fail "inventory collector is missing or not executable"
[[ -f "$VALIDATOR" ]] || fail "authority validator is missing"

python3 "$VALIDATOR" "$FIXTURES/authority-retired.json" | grep -q '^deployment authority gate: PASS$'

# Under strict pipefail, expected zero-match scans must still serialize as zero.
zero_count="$(printf 'unrelated-process\n' | { grep -E '^/usr/local/sbin/finance-deploy([[:space:]]|$)' || true; } | wc -l)"
[[ "$zero_count" -eq 0 ]] || fail "zero-match actuator scan is not zero"

expect_rejected timer-enabled "$FIXTURES/authority-timer-enabled.json"
expect_rejected timer-active "$FIXTURES/authority-timer-active.json"
expect_rejected timer-listed "$FIXTURES/authority-timer-listed.json"
expect_rejected queued-job "$FIXTURES/authority-queued-job.json"
expect_rejected service-active "$FIXTURES/authority-service-active.json"
expect_rejected process-active "$FIXTURES/authority-process-active.json"
expect_rejected cron-active "$FIXTURES/authority-cron-active.json"
expect_rejected hook-active "$FIXTURES/authority-hook-active.json"
expect_rejected runner-active "$FIXTURES/authority-runner-active.json"
expect_rejected workflow-active "$FIXTURES/authority-workflow-active.json"
expect_rejected missing-manual-path "$FIXTURES/authority-missing-manual-path.json"
expect_rejected changed-manual-path "$FIXTURES/authority-changed-manual-path.json"

python3 - "$ROOT_DIR/.github/workflows/ci.yml" <<'PY'
from pathlib import Path
import re, sys
text = Path(sys.argv[1]).read_text()
for pattern in (
    r"runs-on:\s*(?:\[.*self-hosted.*\]|self-hosted)",
    r"/usr/local/sbin/finance-deploy",
    r"finance-deploy\.service",
    r"docker\s+compose[^\n]*(?:up|build)",
    r"repository_dispatch",
):
    if re.search(pattern, text, re.I):
        raise SystemExit(f"workflow retains production actuator: {pattern}")
print("workflow automatic-deployment rejection: PASS")
PY

for file in \
  "$ROOT_DIR/docs/operations/phase-c-change-control.md" \
  "$ROOT_DIR/docs/operations/deployment-authority.md" \
  "$ROOT_DIR/docs/operations/legacy-source-baseline.schema.json" \
  "$ROOT_DIR/ops/systemd/finance-deploy.timer.retired" \
  "$ROOT_DIR/ops/systemd/finance-deploy.service.retired" \
  "$ROOT_DIR/ops/validation/test-live-inventory-collector.sh"; do
  [[ -s "$file" ]] || fail "required WP1 deliverable missing: $file"
done

python3 - "$ROOT_DIR/docs/operations/phase-c-change-control.md" "$ROOT_DIR/docs/operations/deployment-authority.md" <<'PY'
from pathlib import Path
import sys
text = "\n".join(Path(p).read_text() for p in sys.argv[1:])
required = (
    "Status: APPROVED",
    "Automatic deployment: RETIRED",
    "Production deployment: PROHIBITED",
    "No merge to master",
    "Expected data loss / WP1 RPO: zero",
    "WP1 RTO:",
    "Maximum WP1 host-control window:",
    "S5 point of no return:",
    "Abort deadline:",
    "Selected post-write recovery decision:",
)
for marker in required:
    if marker not in text:
        raise SystemExit(f"governance marker missing: {marker}")
for placeholder in ("TODO", "TBD", "CHANGEME", "<owner>", "<approver>"):
    if placeholder in text:
        raise SystemExit(f"governance placeholder remains: {placeholder}")
print("governance contract: PASS")
PY

printf '%s\n' \
  'single deployment authority contract: PASS' \
  'legacy manual recovery path preservation contract: PASS' \
  'WP1 repository validation: PASS'
