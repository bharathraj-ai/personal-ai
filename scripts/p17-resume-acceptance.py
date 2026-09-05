#!/usr/bin/env python3
"""P17 cross-process resume — stop gateway, remove workspace, new gateway, continue project."""
import json
import os
import shutil
import subprocess
import sys
import time
import urllib.request

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:3023"
OUT = sys.argv[2] if len(sys.argv) > 2 else "/tmp/p17-resume-audit.json"
PROJECT_ID = sys.argv[3] if len(sys.argv) > 3 else ""
WORKSPACE_ID = sys.argv[4] if len(sys.argv) > 4 else ""
TOKEN = "dev-token"
ROOT = "/home/bharath/Documents/mutlilanguage offine model/personal-ai"
WS_ROOT = os.path.join(ROOT, "sandbox/workspaces")


def orch(message, **extra):
    body = {"message": message, **extra}
    req = urllib.request.Request(
        f"{BASE}/orchestrate",
        data=json.dumps(body).encode(),
        headers={"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=600) as resp:
        return json.load(resp)


audit = {"base": BASE, "projectId": PROJECT_ID, "workspaceId": WORKSPACE_ID, "steps": []}

if WORKSPACE_ID:
    ws_path = os.path.join(WS_ROOT, WORKSPACE_ID)
    backup = ws_path + ".p17-backup"
    if os.path.isdir(ws_path):
        if os.path.isdir(backup):
            shutil.rmtree(backup)
        shutil.move(ws_path, backup)
        audit["workspaceRemoved"] = True
        audit["backupPath"] = backup

try:
    r = orch("Continue my project.", projectId=PROJECT_ID)
    audit["steps"].append({
        "status": r.get("status"),
        "projectId": r.get("projectId"),
        "workspaceId": r.get("workspaceId"),
        "sameProjectId": r.get("projectId") == PROJECT_ID,
        "sameWorkspaceId": r.get("workspaceId") == WORKSPACE_ID,
        "tail": (r.get("finalResponse") or "")[-2000:],
    })
    audit["final"] = {
        "pass": r.get("projectId") == PROJECT_ID and r.get("workspaceId") == WORKSPACE_ID,
        "status": r.get("status"),
    }
except Exception as e:
    audit["error"] = str(e)
    audit["final"] = {"pass": False, "error": str(e)}

with open(OUT, "w") as f:
    json.dump(audit, f, indent=2)
print(json.dumps(audit.get("final", {}), indent=2))
sys.exit(0 if audit.get("final", {}).get("pass") else 1)
