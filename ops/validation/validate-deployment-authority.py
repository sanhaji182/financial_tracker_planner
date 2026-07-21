#!/usr/bin/env python3
"""Validate that Financial OS has no automatic production deployment authority."""
from __future__ import annotations
import json, re, sys
from pathlib import Path

EXPECTED_KEYS={
 "schema_version","captured_at","timer","service","queued_jobs","deploy_processes",
 "cron_matches","github_hooks","github_runners","workflow_automatic_refs","manual_path"
}

def reject(msg: str) -> None:
    raise SystemExit(f"deployment authority gate rejected: {msg}")

def main() -> None:
    if len(sys.argv)!=2: reject("usage: validate-deployment-authority.py INVENTORY.json")
    try: data=json.loads(Path(sys.argv[1]).read_text())
    except (OSError,json.JSONDecodeError) as e: reject(f"cannot read inventory: {e}")
    if not isinstance(data,dict) or set(data)!=EXPECTED_KEYS: reject("inventory fields differ from schema")
    if data["schema_version"]!=1: reject("unsupported schema version")
    timer=data["timer"]; service=data["service"]; manual=data["manual_path"]
    if not isinstance(timer,dict) or set(timer)!={"unit_file_state","active_state","listed"}: reject("invalid timer evidence")
    if timer["unit_file_state"] not in {"disabled","masked"}: reject("timer remains enabled")
    if timer["active_state"]!="inactive": reject("timer remains active")
    if timer["listed"] is not False: reject("timer remains scheduled")
    if not isinstance(service,dict) or set(service)!={"active_state"} or service["active_state"]!="inactive": reject("deployment service is active")
    for field in ("queued_jobs","deploy_processes","cron_matches"):
        if not isinstance(data[field],int) or data[field]!=0: reject(f"{field} is not zero")
    for field in ("github_hooks","github_runners"):
        if not isinstance(data[field],int) or data[field]!=0: reject(f"{field} is not zero or was not verified")
    refs=data["workflow_automatic_refs"]
    if not isinstance(refs,list) or refs: reject("repository workflow retains an automatic production actuator")
    if not isinstance(manual,dict) or set(manual)!={"path","exists","executable","sha256","expected_sha256"}: reject("invalid manual path evidence")
    if manual["path"]!="/usr/local/sbin/finance-deploy": reject("unexpected manual recovery path")
    if manual["exists"] is not True or manual["executable"] is not True: reject("manual recovery path is unavailable")
    for field in ("sha256","expected_sha256"):
        if not isinstance(manual[field],str) or not re.fullmatch(r"[0-9a-f]{64}",manual[field]): reject(f"invalid {field}")
    if manual["sha256"]!=manual["expected_sha256"]: reject("manual recovery path checksum changed")
    print("deployment authority gate: PASS")
if __name__=="__main__": main()
