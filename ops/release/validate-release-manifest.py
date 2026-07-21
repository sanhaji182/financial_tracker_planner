#!/usr/bin/env python3
from __future__ import annotations

import argparse
import sys
from pathlib import Path

from release_contract import ContractError, compose_environment, load


def main() -> None:
    parser = argparse.ArgumentParser(description="Validate Financial OS immutable release manifest")
    parser.add_argument("manifest", type=Path)
    parser.add_argument("--write-compose-env", type=Path)
    args = parser.parse_args()
    try:
        manifest = load(args.manifest)
        if args.write_compose_env:
            values = compose_environment(manifest)
            body = "".join(f"{key}={values[key]}\n" for key in sorted(values))
            args.write_compose_env.write_text(body)
    except ContractError as exc:
        raise SystemExit(f"release manifest rejected: {exc}") from exc
    print("release manifest: PASS")


if __name__ == "__main__":
    main()
