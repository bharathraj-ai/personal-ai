#!/usr/bin/env python3
"""P18 — resume with Bharath down must not HTTP 500."""
import json
import sys
import urllib.error
import urllib.request

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:3024"
PROJECT_ID = sys.argv[2] if len(sys.argv) > 2 else ""
OUT = sys.argv[3] if len(sys.argv) > 3 else "/tmp/p18-resume-audit.json"
TOKEN = "dev-token"


def orch(message, **extra):
    body = {"message": message, **extra}
    req = urllib.request.Request(
        f"{BASE}/orchestrate",
        data=json.dumps(body).encode(),
        headers={"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=600) as resp:
        return json.load(resp), resp.status


audit = {"base": BASE, "projectId": PROJECT_ID}
try:
    r, status = orch("Continue my project.", projectId=PROJECT_ID)
    audit["httpStatus"] = status
    audit["result"] = {
        "status": r.get("status"),
        "projectId": r.get("projectId"),
        "workspaceId": r.get("workspaceId"),
        "sameProjectId": r.get("projectId") == PROJECT_ID,
        "bharath500": False,
        "tail": (r.get("finalResponse") or "")[-1500:],
    }
    audit["pass"] = audit.get("httpStatus") == 200 and not audit.get("bharath500")
except urllib.error.HTTPError as e:
    audit["httpStatus"] = e.code
    audit["pass"] = False
    audit["bharath500"] = e.code == 500
    audit["error"] = e.read().decode()[:500]

with open(OUT, "w") as f:
    json.dump(audit, f, indent=2)
print(json.dumps({"pass": audit.get("pass"), "httpStatus": audit.get("httpStatus"), "bharath500": audit.get("bharath500")}, indent=2))
sys.exit(0 if audit.get("pass") and not audit.get("bharath500") else 1)
