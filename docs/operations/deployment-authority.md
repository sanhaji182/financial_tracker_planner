# Financial OS Deployment Authority

Status: APPROVED

## Current WP1 state

Automatic deployment: RETIRED after the approved host checkpoint passes.
Production deployment: PROHIBITED.
No merge to master is part of WP1.

## Authority boundary

The sole current production runtime is the existing Financial OS Compose project on Core. WP1 does not replace it. The legacy executable `/usr/local/sbin/finance-deploy` and `finance-deploy.service` are preserved byte-for-byte as a current-release recovery mechanism, but are not automatic and are not authorized for invocation.

The timer is retired by the minimum truthful invariant:

- `finance-deploy.timer`: disabled and inactive;
- absent from `systemctl list-timers`;
- no queued `finance-deploy` job;
- `finance-deploy.service`: inactive;
- no matching deploy process;
- no Financial OS deployment cron, GitHub hook, runner, or workflow action.

This does not claim root cannot manually start the service. It proves future branch work and ordinary boot/timer scheduling cannot deploy automatically.

## Merge safety

Before any later merge to `master`, run:

```text
ops/validation/inventory-deployment-actuators.sh --output <evidence.json> --expected-manual-sha256 <approved-sha256>
ops/validation/validate-deployment-authority.py <evidence.json>
```

Any missing GitHub API evidence, nonzero actuator count, enabled/active/listed timer, active service/process, workflow deployment reference, or changed manual-path checksum fails closed.

## Manual path policy

`/usr/local/sbin/finance-deploy` remains executable only to preserve current-release recoverability. Invocation requires a new explicit production authorization, a fresh baseline, and a verified reason. WP1 never executes it.

## Rollback boundary

If timer retirement itself causes an approved dependency failure before a replacement authority exists, restore only the prior timer enablement after confirming the service is inactive and production is unchanged. Do not invoke the deployment service as part of rollback verification.
