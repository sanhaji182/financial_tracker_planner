#!/usr/bin/env python3
from __future__ import annotations

import argparse
from pathlib import Path

from release_contract import canonical_bytes, load, sha256_file


def main() -> None:
    parser = argparse.ArgumentParser(description="Reproduce a verified prior release as rollback manifest")
    parser.add_argument("--current", type=Path, required=True)
    parser.add_argument("--previous", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    current = load(args.current)
    previous = load(args.previous)
    if current["previous_manifest_sha256"] is None:
        raise SystemExit("current release has no rollback manifest binding")
    actual = sha256_file(args.previous)
    if current["previous_manifest_sha256"] != actual:
        raise SystemExit("previous release checksum does not match current release binding")
    args.output.write_bytes(canonical_bytes(previous))
    if sha256_file(args.output) != actual:
        raise SystemExit("rollback manifest reproduction changed bytes")
    print("rollback manifest: PASS")


if __name__ == "__main__":
    main()
