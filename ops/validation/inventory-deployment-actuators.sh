#!/usr/bin/env bash
set -Eeuo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUTPUT=""
EXPECTED_MANUAL_SHA256=""
while (($#)); do
  case "$1" in
    --output) OUTPUT="${2:?}"; shift 2 ;;
    --expected-manual-sha256) EXPECTED_MANUAL_SHA256="${2:?}"; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
[[ -n "$OUTPUT" && "$EXPECTED_MANUAL_SHA256" =~ ^[0-9a-f]{64}$ ]] || { echo 'output and expected manual sha256 are required' >&2; exit 2; }
TIMER_ENABLED="$(systemctl is-enabled finance-deploy.timer 2>/dev/null || true)"
TIMER_ACTIVE="$(systemctl is-active finance-deploy.timer 2>/dev/null || true)"
SERVICE_ACTIVE="$(systemctl is-active finance-deploy.service 2>/dev/null || true)"
TIMER_LISTED=0
systemctl list-timers --all --no-pager --no-legend 2>/dev/null | grep -qE '(^|[[:space:]])finance-deploy\.timer([[:space:]]|$)' && TIMER_LISTED=1
QUEUED="$(systemctl list-jobs --no-pager --no-legend 2>/dev/null | grep -cE '(^|[[:space:]])finance-deploy\.(timer|service)([[:space:]]|$)' || true)"
PROCESSES="$(ps -eo args= | { grep -E '^(/usr/bin/)?(bash[[:space:]]+)?/usr/local/sbin/finance-deploy([[:space:]]|$)' || true; } | wc -l)"
CRON_MATCHES="$({ crontab -l 2>/dev/null || true; sudo -n crontab -l 2>/dev/null || true; sudo -n grep -R -h -E 'financial_tracker_planner|finance-deploy' /etc/crontab /etc/cron.d 2>/dev/null || true; } | grep -cE 'financial_tracker_planner|finance-deploy' || true)"
WORKFLOW_REFS="$(git -C "$ROOT_DIR" grep -nEi 'runs-on:.*self-hosted|/usr/local/sbin/finance-deploy|finance-deploy\.service|repository_dispatch|docker[[:space:]]+compose.*(up|build)' -- .github/workflows 2>/dev/null || true)"
HOOKS_JSON="$(gh api repos/sanhaji182/financial_tracker_planner/hooks 2>/dev/null)" || { echo 'cannot verify GitHub hooks' >&2; exit 3; }
RUNNERS_JSON="$(gh api repos/sanhaji182/financial_tracker_planner/actions/runners 2>/dev/null)" || { echo 'cannot verify GitHub runners' >&2; exit 3; }
MANUAL=/usr/local/sbin/finance-deploy
MANUAL_EXISTS=false; MANUAL_EXEC=false; MANUAL_SHA=""
[[ -f "$MANUAL" ]] && MANUAL_EXISTS=true
[[ -x "$MANUAL" ]] && MANUAL_EXEC=true
[[ -f "$MANUAL" ]] && MANUAL_SHA="$(sha256sum "$MANUAL" | cut -d' ' -f1)"
python3 - "$OUTPUT" "$TIMER_ENABLED" "$TIMER_ACTIVE" "$TIMER_LISTED" "$SERVICE_ACTIVE" "$QUEUED" "$PROCESSES" "$CRON_MATCHES" "$HOOKS_JSON" "$RUNNERS_JSON" "$WORKFLOW_REFS" "$MANUAL_EXISTS" "$MANUAL_EXEC" "$MANUAL_SHA" "$EXPECTED_MANUAL_SHA256" <<'PY'
import json,sys
from datetime import datetime,timezone
(out,timer_enabled,timer_active,timer_listed,service_active,queued,processes,cron,hooks_raw,runners_raw,workflow_raw,manual_exists,manual_exec,manual_sha,expected)=sys.argv[1:]
hooks=json.loads(hooks_raw); runners=json.loads(runners_raw)
data={
 "schema_version":1,"captured_at":datetime.now(timezone.utc).isoformat().replace("+00:00","Z"),
 "timer":{"unit_file_state":timer_enabled,"active_state":timer_active,"listed":timer_listed=="1"},
 "service":{"active_state":service_active},"queued_jobs":int(queued),"deploy_processes":int(processes),"cron_matches":int(cron),
 "github_hooks":len(hooks),"github_runners":int(runners.get("total_count",len(runners.get("runners",[])))),
 "workflow_automatic_refs":[x for x in workflow_raw.splitlines() if x],
 "manual_path":{"path":"/usr/local/sbin/finance-deploy","exists":manual_exists=="true","executable":manual_exec=="true","sha256":manual_sha,"expected_sha256":expected},
}
with open(out,"w") as f: json.dump(data,f,indent=2,sort_keys=True); f.write("\n")
PY
