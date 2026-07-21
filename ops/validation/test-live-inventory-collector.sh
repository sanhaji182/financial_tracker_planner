#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
COLLECTOR="$ROOT_DIR/ops/validation/inventory-deployment-actuators.sh"
VALIDATOR="$ROOT_DIR/ops/validation/validate-deployment-authority.py"
FIXTURE="$ROOT_DIR/ops/validation/fixtures/authority-retired.json"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/fos-wp1-live-collector.XXXXXX")"
cleanup() {
  rm -f -- "$TMP/inventory.json" "$TMP/bin/systemctl" "$TMP/bin/ps" "$TMP/bin/crontab" "$TMP/bin/sudo" "$TMP/bin/gh" "$TMP/bin/sha256sum"
  rmdir -- "$TMP/bin" "$TMP"
}
trap cleanup EXIT
mkdir -p "$TMP/bin"

cat >"$TMP/bin/systemctl" <<'SH'
#!/usr/bin/env bash
case "$1 $2" in
  'is-enabled finance-deploy.timer') echo disabled ;;
  'is-active finance-deploy.timer') echo inactive ;;
  'is-active finance-deploy.service') echo inactive ;;
  'list-timers --all') exit 0 ;;
  'list-jobs --no-pager') exit 0 ;;
  *) exit 1 ;;
esac
SH
cat >"$TMP/bin/ps" <<'SH'
#!/usr/bin/env bash
printf '%s\n' '/usr/bin/unrelated-process'
SH
cat >"$TMP/bin/crontab" <<'SH'
#!/usr/bin/env bash
exit 1
SH
cat >"$TMP/bin/sudo" <<'SH'
#!/usr/bin/env bash
exit 1
SH
cat >"$TMP/bin/gh" <<'SH'
#!/usr/bin/env bash
case "$*" in
  *'/hooks'*) printf '[]\n' ;;
  *'/actions/runners'*) printf '{"total_count":0,"runners":[]}\n' ;;
  *) exit 1 ;;
esac
SH
cat >"$TMP/bin/sha256sum" <<'SH'
#!/usr/bin/env bash
printf '%s  %s\n' '26daff04f097f2ccddd15121fe8bd99e82f40712ca4bcecea652fedabceb7258' "$1"
SH
chmod +x "$TMP/bin/"*

PATH="$TMP/bin:/usr/bin:/bin" "$COLLECTOR" \
  --output "$TMP/inventory.json" \
  --expected-manual-sha256 26daff04f097f2ccddd15121fe8bd99e82f40712ca4bcecea652fedabceb7258

python3 "$VALIDATOR" "$TMP/inventory.json" | grep -q '^deployment authority gate: PASS$'
python3 - "$TMP/inventory.json" "$FIXTURE" <<'PY'
import json,sys
actual=json.load(open(sys.argv[1])); expected=json.load(open(sys.argv[2]))
actual.pop('captured_at'); expected.pop('captured_at')
if actual != expected:
    raise SystemExit(f"collector output differs from safe fixture: {actual!r}")
print('mocked live inventory collector: PASS')
PY
