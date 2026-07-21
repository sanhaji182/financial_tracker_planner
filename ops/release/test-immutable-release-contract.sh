#!/usr/bin/env bash
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

GEN="$ROOT/ops/release/generate-release-manifest.py"
VALIDATE="$ROOT/ops/release/validate-release-manifest.py"
ROLLBACK="$ROOT/ops/release/generate-rollback-manifest.py"
BUNDLE="$ROOT/ops/release/verify-release-bundle.sh"
COMPOSE="$ROOT/docker/docker-compose.pull.yml"
SCHEMA="$ROOT/docs/operations/financial-os-release-manifest.schema.json"
for required in "$GEN" "$VALIDATE" "$ROLLBACK" "$BUNDLE" "$COMPOSE" "$SCHEMA"; do
  [[ -f "$required" ]] || { echo "missing required WP2 artifact: $required" >&2; exit 1; }
done

D1="sha256:$(printf '1%.0s' {1..64})"
D2="sha256:$(printf '2%.0s' {1..64})"
D3="sha256:$(printf '3%.0s' {1..64})"
PD="sha256:57c72fd2a128e416c7fcc499958864df5301e940bca0a56f58fddf30ffc07777"
RD="sha256:6ab0b6e7381779332f97b8ca76193e45b0756f38d4c0dcda72dbb3c32061ab99"
SHA="$(printf 'a%.0s' {1..40})"
COMPOSE_SHA="$(sha256sum "$COMPOSE" | cut -d' ' -f1)"

make_manifest() {
  local out="$1" release="$2" run="$3" previous="$4"
  local args=(
    --output "$out" --release-id "$release" --repository sanhaji182/financial_tracker_planner
    --git-sha "$SHA" --run-id "$run" --run-attempt 1 --created-at 2026-07-21T00:00:00Z
    --platform linux/amd64 --compose-path docker/docker-compose.pull.yml --compose-sha256 "$COMPOSE_SHA"
    --frontend "ghcr.io/sanhaji182/financial-os-frontend@$D1"
    --backend "ghcr.io/sanhaji182/financial-os-backend@$D2"
    --worker "ghcr.io/sanhaji182/financial-os-worker@$D3"
    --postgres "docker.io/library/postgres@$PD" --redis "docker.io/library/redis@$RD"
  )
  [[ "$previous" == null ]] || args+=(--previous-manifest-sha256 "$previous")
  python3 "$GEN" "${args[@]}"
}

make_manifest "$TMP/first.json" candidate-a 100 null
python3 "$VALIDATE" "$TMP/first.json"
sha256sum "$TMP/first.json" > "$TMP/first.json.sha256"

# Canonical generation must be reproducible for identical inputs.
make_manifest "$TMP/first-again.json" candidate-a 100 null
cmp "$TMP/first.json" "$TMP/first-again.json"

# The manifest contract has exactly three application images and two runtime dependencies.
python3 - "$TMP/first.json" <<'PY'
import json,sys
m=json.load(open(sys.argv[1]))
assert set(m["application_images"]) == {"frontend","backend","worker"}
assert set(m["runtime_dependencies"]) == {"postgresql","redis"}
assert m["deployment_authorized"] is False
assert m["migration"]["execution_authorized"] is False
for ref in m["application_images"].values():
    assert ref.startswith("ghcr.io/sanhaji182/financial-os-") and "@sha256:" in ref
for ref in m["runtime_dependencies"].values():
    assert "@sha256:" in ref
PY

# Pull-only Compose must have five services, no build directives, and only digest refs after rendering.
ENV_FILE="$TMP/release.env"
python3 "$VALIDATE" "$TMP/first.json" --write-compose-env "$ENV_FILE"
touch "$TMP/runtime.env"
printf 'FOS_RUNTIME_ENV_FILE=%s\nDB_PASSWORD=test-only\nWORKER_SECRET=test-only\nCORS_ALLOWED_ORIGINS=http://localhost\n' "$TMP/runtime.env" >> "$ENV_FILE"
docker compose --env-file "$ENV_FILE" -f "$COMPOSE" config --format json > "$TMP/rendered.json"
python3 - "$TMP/rendered.json" <<'PY'
import json,re,sys
c=json.load(open(sys.argv[1]))
assert set(c["services"]) == {"frontend","backend","worker","postgres","redis"}
for name,svc in c["services"].items():
    assert "build" not in svc, name
    assert re.fullmatch(r"[^:@\s]+(?:/[^:@\s]+)*@sha256:[0-9a-f]{64}",svc["image"]), (name,svc["image"])
PY

"$BUNDLE" --manifest "$TMP/first.json" --checksum "$TMP/first.json.sha256" --compose "$COMPOSE" --render-output "$TMP/bundle-rendered.yml"

# Mutable tags and service/repository swaps must fail closed.
python3 - "$TMP/first.json" "$TMP/bad.json" <<'PY'
import json,sys
m=json.load(open(sys.argv[1])); m["application_images"]["frontend"]="ghcr.io/sanhaji182/financial-os-frontend:latest"
json.dump(m,open(sys.argv[2],"w"),sort_keys=True); open(sys.argv[2],"a").write("\n")
PY
if python3 "$VALIDATE" "$TMP/bad.json" 2>/dev/null; then echo 'mutable tag accepted' >&2; exit 1; fi
python3 - "$TMP/first.json" "$TMP/bad.json" <<'PY'
import json,sys
m=json.load(open(sys.argv[1])); m["application_images"]["frontend"]=m["application_images"]["backend"]
json.dump(m,open(sys.argv[2],"w"),sort_keys=True); open(sys.argv[2],"a").write("\n")
PY
if python3 "$VALIDATE" "$TMP/bad.json" 2>/dev/null; then echo 'repository swap accepted' >&2; exit 1; fi

# A second manifest can bind and reproduce the exact prior manifest as rollback target.
FIRST_SHA="$(sha256sum "$TMP/first.json" | cut -d' ' -f1)"
make_manifest "$TMP/second.json" candidate-b 101 "$FIRST_SHA"
python3 "$ROLLBACK" --current "$TMP/second.json" --previous "$TMP/first.json" --output "$TMP/rollback.json"
cmp "$TMP/rollback.json" "$TMP/first.json"
python3 "$VALIDATE" "$TMP/rollback.json"

# Tamper detection must reject altered manifest bytes.
cp "$TMP/first.json" "$TMP/tampered.json"
printf ' ' >> "$TMP/tampered.json"
if "$BUNDLE" --manifest "$TMP/tampered.json" --checksum "$TMP/first.json.sha256" --compose "$COMPOSE" --render-output "$TMP/tampered.yml" 2>/dev/null; then
  echo 'tampered bundle accepted' >&2; exit 1
fi

echo 'immutable release contract: PASS'
