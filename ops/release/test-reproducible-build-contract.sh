#!/usr/bin/env bash
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
python3 - "$ROOT" <<'PY'
import pathlib,re,sys
root=pathlib.Path(sys.argv[1])
dockerignore=root/'.dockerignore'
assert dockerignore.is_file(), '.dockerignore is required for release builds'
patterns={line.strip() for line in dockerignore.read_text().splitlines() if line.strip() and not line.startswith('#')}
for required in {'.git', '.env', '.env.*', '**/.env', '**/.env.*', '**/node_modules', '**/__pycache__', 'platform-review'}:
 assert required in patterns, required
files={
 "frontend":root/"docker/Dockerfile.frontend.prod",
 "backend":root/"docker/Dockerfile.backend.prod",
 "worker":root/"docker/Dockerfile.worker",
}
for name,path in files.items():
 text=path.read_text()
 froms=re.findall(r"^FROM\s+([^\s]+)",text,re.M)
 assert froms, name
 for ref in froms:
  assert "@sha256:" in ref and re.search(r"@sha256:[0-9a-f]{64}$",ref), (name,ref)
 assert "org.opencontainers.image.revision" in text, name
 assert "org.opencontainers.image.source" in text, name
 assert "org.opencontainers.image.version" in text, name
frontend=files["frontend"].read_text()
assert "npm ci" in frontend
assert "npm install" not in frontend
for name,path in files.items():
 text=path.read_text()
 assert "latest" not in text.lower(), name
PY
echo 'reproducible build contract: PASS'
