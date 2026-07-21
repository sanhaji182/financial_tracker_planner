#!/usr/bin/env python3
"""Shared Financial OS immutable release-manifest contract."""
from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path
from typing import Any

SCHEMA_KEYS = {
    "schema_version",
    "application",
    "release_id",
    "source",
    "created_at",
    "target_platform",
    "deployment_authorized",
    "application_images",
    "runtime_dependencies",
    "compose",
    "migration",
    "runtime_secret_schema",
    "previous_manifest_sha256",
}
APPLICATION_REPOSITORIES = {
    "frontend": "ghcr.io/sanhaji182/financial-os-frontend",
    "backend": "ghcr.io/sanhaji182/financial-os-backend",
    "worker": "ghcr.io/sanhaji182/financial-os-worker",
}
DEPENDENCY_REPOSITORIES = {
    "postgresql": "docker.io/library/postgres",
    "redis": "docker.io/library/redis",
}
DIGEST = re.compile(r"sha256:[0-9a-f]{64}")
HEX = re.compile(r"[0-9a-f]{64}")
GIT_SHA = re.compile(r"[0-9a-f]{40}")
RELEASE_ID = re.compile(r"[a-z0-9][a-z0-9._-]{0,127}")
UTC = re.compile(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z")


class ContractError(ValueError):
    pass


def canonical_bytes(data: dict[str, Any]) -> bytes:
    return (json.dumps(data, indent=2, sort_keys=True, separators=(",", ": ")) + "\n").encode()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _exact_keys(value: Any, expected: set[str], name: str) -> dict[str, Any]:
    if not isinstance(value, dict) or set(value) != expected:
        raise ContractError(f"{name} fields differ from the release contract")
    return value


def _immutable_ref(ref: Any, repository: str, name: str) -> str:
    expected_prefix = f"{repository}@"
    if not isinstance(ref, str) or not ref.startswith(expected_prefix):
        raise ContractError(f"{name} must use repository {repository}")
    digest = ref[len(expected_prefix) :]
    if not DIGEST.fullmatch(digest):
        raise ContractError(f"{name} must be pinned by sha256 digest")
    return digest


def validate(data: Any) -> dict[str, Any]:
    manifest = _exact_keys(data, SCHEMA_KEYS, "manifest")
    if manifest["schema_version"] != 1:
        raise ContractError("unsupported schema version")
    if manifest["application"] != "financial-os":
        raise ContractError("unexpected application")
    if not isinstance(manifest["release_id"], str) or not RELEASE_ID.fullmatch(manifest["release_id"]):
        raise ContractError("invalid release_id")
    source = _exact_keys(manifest["source"], {"repository", "git_sha", "run_id", "run_attempt"}, "source")
    if source["repository"] != "sanhaji182/financial_tracker_planner":
        raise ContractError("unexpected source repository")
    if not isinstance(source["git_sha"], str) or not GIT_SHA.fullmatch(source["git_sha"]):
        raise ContractError("invalid source git_sha")
    if not isinstance(source["run_id"], int) or source["run_id"] < 1:
        raise ContractError("invalid source run_id")
    if not isinstance(source["run_attempt"], int) or source["run_attempt"] < 1:
        raise ContractError("invalid source run_attempt")
    if not isinstance(manifest["created_at"], str) or not UTC.fullmatch(manifest["created_at"]):
        raise ContractError("created_at must be whole-second UTC")
    if manifest["target_platform"] != "linux/amd64":
        raise ContractError("unsupported target platform")
    if manifest["deployment_authorized"] is not False:
        raise ContractError("candidate must not authorize deployment")

    apps = _exact_keys(manifest["application_images"], set(APPLICATION_REPOSITORIES), "application_images")
    for name, repository in APPLICATION_REPOSITORIES.items():
        _immutable_ref(apps[name], repository, name)
    dependencies = _exact_keys(
        manifest["runtime_dependencies"], set(DEPENDENCY_REPOSITORIES), "runtime_dependencies"
    )
    for name, repository in DEPENDENCY_REPOSITORIES.items():
        _immutable_ref(dependencies[name], repository, name)

    compose = _exact_keys(manifest["compose"], {"path", "sha256"}, "compose")
    if compose["path"] != "docker/docker-compose.pull.yml":
        raise ContractError("manifest must bind the pull-only Compose path")
    if not isinstance(compose["sha256"], str) or not HEX.fullmatch(compose["sha256"]):
        raise ContractError("invalid Compose sha256")

    migration = _exact_keys(
        manifest["migration"], {"identifier", "compatibility", "execution_authorized"}, "migration"
    )
    if migration != {"identifier": "none", "compatibility": "not-applicable", "execution_authorized": False}:
        raise ContractError("WP2 candidates must not contain or authorize migrations")
    secrets = _exact_keys(manifest["runtime_secret_schema"], {"version", "values_included"}, "runtime_secret_schema")
    if secrets != {"version": 1, "values_included": False}:
        raise ContractError("runtime secret contract is invalid")
    previous = manifest["previous_manifest_sha256"]
    if previous is not None and (not isinstance(previous, str) or not HEX.fullmatch(previous)):
        raise ContractError("invalid previous manifest sha256")
    return manifest


def load(path: Path) -> dict[str, Any]:
    try:
        data = json.loads(path.read_text())
    except (OSError, json.JSONDecodeError) as exc:
        raise ContractError(f"cannot read manifest: {exc}") from exc
    return validate(data)


def compose_environment(manifest: dict[str, Any]) -> dict[str, str]:
    manifest = validate(manifest)
    refs = {**manifest["application_images"], **manifest["runtime_dependencies"]}
    return {
        "FOS_FRONTEND_DIGEST": refs["frontend"].rsplit("@sha256:", 1)[1],
        "FOS_BACKEND_DIGEST": refs["backend"].rsplit("@sha256:", 1)[1],
        "FOS_WORKER_DIGEST": refs["worker"].rsplit("@sha256:", 1)[1],
        "FOS_POSTGRES_DIGEST": refs["postgresql"].rsplit("@sha256:", 1)[1],
        "FOS_REDIS_DIGEST": refs["redis"].rsplit("@sha256:", 1)[1],
        "BUILD_SHA": manifest["source"]["git_sha"],
        "APP_VERSION": manifest["release_id"],
    }
