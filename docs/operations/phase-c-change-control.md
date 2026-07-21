# Phase C Financial OS Change Control

Status: APPROVED

## Scope

Work Package 1 only: governance and automatic deployment-authority retirement. Production deployment: PROHIBITED. No merge to master, migration, image publication, Budget/DNS/firewall/runtime change, or customer-data movement is authorized.

## Authority

| Responsibility | Assigned authority |
|---|---|
| Change owner | Platform owner (Sans / Sonickk) |
| Control-plane operator | Hermes production engineering agent, limited to approved WP1 procedure |
| Approver | Platform owner (Sans / Sonickk) |
| Data owner | Platform owner (Sans / Sonickk) |
| Incident recorder | Control-plane operator |
| Rollback/data-loss authority | Platform owner (Sans / Sonickk) |

One person may hold multiple authority roles in this single-engineer environment. The execution agent cannot self-authorize scope expansion.

## Approved policy

The 2026-07-21 WP1 authorization establishes these exact, WP1-limited decisions:

- Automatic deployment: RETIRED.
- Manual execution of the preserved legacy path: not authorized by WP1.
- Existing production release remains authoritative and unchanged.
- Expected data loss / WP1 RPO: zero; no data operation or customer-data movement is permitted.
- WP1 RTO: zero customer-service recovery time is expected because runtime services are not stopped. If timer retirement itself causes an approved dependency failure, the rollback decision must be made immediately and the recorded enablement can be restored within five minutes.
- Maximum WP1 host-control window: five minutes from stopping the timer through authority validation. Abort immediately on runtime drift, service activation, or failed health.
- S5 point of no return: prohibited and unreachable in WP1. No target plane, route switch, or target write exists in this package.
- Abort deadline: before the five-minute host-control window expires, and immediately on any stop condition.
- Selected post-write recovery decision: any unexpected application/data write is an incident; do not perform automatic routing rollback, start a second writer, or attempt unreviewed recovery. Freeze, preserve evidence, and return control to the named rollback/data-loss authority.
- Phase C migration RPO/RTO and later cutover choices are not implied by these WP1 limits and require separate approval.

## Freeze

Until another work package is explicitly approved:

1. no merge to master;
2. no manual invocation of `/usr/local/sbin/finance-deploy`;
3. no production Compose operation;
4. no schema, runtime-secret, nginx, DNS, firewall, Budget, or data change;
5. no image publication or release authorization.

## Stop conditions

Stop on any changed container ID/image/start time/restart count, unexpected deployment process, changed deployed commit, failed origin/public health probe, wrong host/repository identity, or alternate automatic actuator.
