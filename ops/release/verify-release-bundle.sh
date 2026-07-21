#!/usr/bin/env bash
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MANIFEST="" CHECKSUM="" COMPOSE="" RENDER=""
while (($#)); do
  case "$1" in
    --manifest) MANIFEST="${2:?}"; shift 2 ;;
    --checksum) CHECKSUM="${2:?}"; shift 2 ;;
    --compose) COMPOSE="${2:?}"; shift 2 ;;
    --render-output) RENDER="${2:?}"; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
[[ -f "$MANIFEST" && -f "$CHECKSUM" && -f "$COMPOSE" && -n "$RENDER" ]] || {
  echo 'manifest, checksum, compose, and render output are required' >&2; exit 2;
}
EXPECTED_LINE="$(awk 'NF {print; exit}' "$CHECKSUM")"
EXPECTED="${EXPECTED_LINE%% *}"
[[ "$EXPECTED" =~ ^[0-9a-f]{64}$ ]] || { echo 'invalid checksum sidecar' >&2; exit 1; }
ACTUAL="$(sha256sum "$MANIFEST" | cut -d' ' -f1)"
[[ "$EXPECTED" == "$ACTUAL" ]] || { echo 'release manifest checksum mismatch' >&2; exit 1; }
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
python3 "$ROOT/ops/release/validate-release-manifest.py" "$MANIFEST" --write-compose-env "$TMP/release.env"
MANIFEST_COMPOSE_SHA="$(python3 - "$MANIFEST" <<'PY'
import json,sys
print(json.load(open(sys.argv[1]))['compose']['sha256'])
PY
)"
ACTUAL_COMPOSE_SHA="$(sha256sum "$COMPOSE" | cut -d' ' -f1)"
[[ "$MANIFEST_COMPOSE_SHA" == "$ACTUAL_COMPOSE_SHA" ]] || { echo 'pull-only Compose checksum mismatch' >&2; exit 1; }
touch "$TMP/runtime.env"
printf 'FOS_RUNTIME_ENV_FILE=%s\nDB_PASSWORD=validation-only\nWORKER_SECRET=validation-only\nCORS_ALLOWED_ORIGINS=http://localhost\n' "$TMP/runtime.env" >> "$TMP/release.env"
docker compose --env-file "$TMP/release.env" -f "$COMPOSE" config --format json > "$RENDER"
python3 - "$RENDER" <<'PY'
import json,re,sys
compose=json.load(open(sys.argv[1]))
expected={'frontend','backend','worker','postgres','redis'}
if set(compose.get('services',{})) != expected: raise SystemExit('unexpected pull-only service set')
for name,service in compose['services'].items():
    if 'build' in service: raise SystemExit(f'{name} contains build directive')
    image=service.get('image','')
    if not re.fullmatch(r'[^:@\s]+(?:/[^:@\s]+)*@sha256:[0-9a-f]{64}',image):
        raise SystemExit(f'{name} image is not immutable: {image}')
PY
echo 'release bundle integrity: PASS'
