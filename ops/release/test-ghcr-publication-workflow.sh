#!/usr/bin/env bash
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WORKFLOW="$ROOT/.github/workflows/immutable-release.yml"
[[ -f "$WORKFLOW" ]] || { echo 'immutable release workflow is missing' >&2; exit 1; }
python3 - "$WORKFLOW" <<'PY'
import re,sys,yaml
p=sys.argv[1]; text=open(p).read(); doc=yaml.safe_load(text)
jobs=doc.get("jobs",{})
assert set(jobs) == {"quality-gate","publish-candidate","verify-candidate"}, set(jobs)
for name,job in jobs.items():
    assert job.get("runs-on") == "ubuntu-latest"
    assert job.get("environment") is None, name
    assert "self-hosted" not in str(job.get("runs-on", "")).lower(), name
pub=jobs["publish-candidate"]
ver=jobs["verify-candidate"]
assert pub.get("needs") == "quality-gate"
assert pub["permissions"] == {"contents":"read","packages":"write"}
assert ver.get("needs") == "publish-candidate"
assert ver["permissions"] == {"contents":"read","packages":"read"}
pubtxt=str(pub); vertxt=str(ver)
for marker in (
    'local repository="ghcr.io/sanhaji182/financial-os-${role}"',
    "build_and_publish frontend docker/Dockerfile.frontend.prod",
    "build_and_publish backend docker/Dockerfile.backend.prod",
    "build_and_publish worker docker/Dockerfile.worker",
    "generate-release-manifest.py",
    "deployment_authorized",
):
    assert marker in pubtxt, marker
qualitytxt=str(jobs["quality-gate"])
for marker in (
    "financial_os_test",
    "redis:7-alpine",
    "database-backed test skipped; immutable candidate rejected",
):
    assert marker in qualitytxt, marker
for marker in (
    "type=docker,dest=",
    "rewrite-timestamp=true",
    "manifest.json",
    "docker load --input",
):
    assert marker in pubtxt, marker
for marker in ("download-artifact","verify-release-bundle.sh","imagetools inspect"):
    assert marker in vertxt, marker
for forbidden in ("docker compose up","finance-deploy","self-hosted","repository_dispatch","workflow_dispatch"):
    assert forbidden not in text, forbidden
for use in re.findall(r"uses:\s*([^\s]+)",text):
    assert re.search(r"@[0-9a-f]{40}$",use), use
assert re.search(r"on:\s*\n\s*push:\s*\n\s*pull_request:",text)
assert "pull_request:" in text
assert "if: github.event_name == 'push'" in text
PY
echo 'GHCR publication workflow contract: PASS'
