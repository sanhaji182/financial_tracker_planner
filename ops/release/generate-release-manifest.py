#!/usr/bin/env python3
from __future__ import annotations

import argparse
from pathlib import Path

from release_contract import canonical_bytes, validate


def parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="Generate canonical Financial OS release manifest")
    p.add_argument("--output", type=Path, required=True)
    p.add_argument("--release-id", required=True)
    p.add_argument("--repository", required=True)
    p.add_argument("--git-sha", required=True)
    p.add_argument("--run-id", type=int, required=True)
    p.add_argument("--run-attempt", type=int, required=True)
    p.add_argument("--created-at", required=True)
    p.add_argument("--platform", required=True)
    p.add_argument("--compose-path", required=True)
    p.add_argument("--compose-sha256", required=True)
    p.add_argument("--frontend", required=True)
    p.add_argument("--backend", required=True)
    p.add_argument("--worker", required=True)
    p.add_argument("--postgres", required=True)
    p.add_argument("--redis", required=True)
    p.add_argument("--previous-manifest-sha256")
    return p


def main() -> None:
    args = parser().parse_args()
    data = {
        "schema_version": 1,
        "application": "financial-os",
        "release_id": args.release_id,
        "source": {
            "repository": args.repository,
            "git_sha": args.git_sha,
            "run_id": args.run_id,
            "run_attempt": args.run_attempt,
        },
        "created_at": args.created_at,
        "target_platform": args.platform,
        "deployment_authorized": False,
        "application_images": {
            "frontend": args.frontend,
            "backend": args.backend,
            "worker": args.worker,
        },
        "runtime_dependencies": {"postgresql": args.postgres, "redis": args.redis},
        "compose": {"path": args.compose_path, "sha256": args.compose_sha256},
        "migration": {
            "identifier": "none",
            "compatibility": "not-applicable",
            "execution_authorized": False,
        },
        "runtime_secret_schema": {"version": 1, "values_included": False},
        "previous_manifest_sha256": args.previous_manifest_sha256,
    }
    validate(data)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_bytes(canonical_bytes(data))


if __name__ == "__main__":
    main()
