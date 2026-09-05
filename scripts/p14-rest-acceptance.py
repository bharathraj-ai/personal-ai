#!/usr/bin/env python3
"""P14 live REST acceptance — records evidence to stdout and JSON file."""
import json
import sys
import urllib.request

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:3011"
OUT = sys.argv[2] if len(sys.argv) > 2 else "/tmp/p14-rest-audit.json"
TOKEN = "dev-token"
GOAL = "Create a small REST API with one endpoint and a real automated test."

def orch(message, **extra):
    body = {"message": message, "originalGoal": GOAL, **extra}
    req = urllib.request.Request(
        f"{BASE}/orchestrate",
        data=json.dumps(body).encode(),
        headers={"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=600) as resp:
        return json.load(resp)

def snap(label, r, audit):
    obs_ws = []
    provider = None
    for o in r.get("observations", []):
        out = o.get("output") or {}
        nested = out.get("output") if isinstance(out, dict) else None
        target = nested if isinstance(nested, dict) else out
        if isinstance(target, dict) and target.get("workspaceId"):
            obs_ws.append({"workspaceId": target["workspaceId"], "reused": target.get("reused")})
        txt = json.dumps(out)
        if "Provider routing:" in (r.get("finalResponse") or ""):
            pass
    tail = r.get("finalResponse") or ""
    if "Provider routing:" in tail:
        for line in tail.split("\n"):
            if "Provider routing:" in line:
                provider = line.strip()
    entry = {
        "label": label,
        "status": r.get("status"),
        "projectStatus": r.get("projectStatus"),
        "taskId": r.get("taskId"),
        "workspaceId": r.get("workspaceId"),
        "projectId": r.get("projectId"),
        "observationWorkspaces": obs_ws,
        "providerEvidence": provider,
        "build": _extract(tail, "Build:"),
        "tests": _extract(tail, "Tests:"),
        "repairHistory": (r.get("projectPlan") or {}).get("implementationProgress", {}).get("repairHistory"),
        "requirementEvidence": [
            line.strip() for line in tail.split("\n")
            if line.strip().startswith("- ") and ("VERIFIED" in line or "FAILED" in line or "PARTIAL" in line)
        ],
        "finalResponseTail": tail[-1500:],
    }
    audit["steps"].append(entry)
    print(f"\n=== {label} ===")
    print("status:", entry["status"], "projectStatus:", entry["projectStatus"])
    print("workspace:", entry["workspaceId"], "project:", entry["projectId"])
    print("obs ws:", obs_ws)
    print("build:", entry["build"], "tests:", entry["tests"])
    return r

def _extract(tail, prefix):
    for line in tail.split("\n"):
        if line.strip().startswith(prefix):
            return line.strip()
    return None

audit = {"goal": GOAL, "base": BASE, "steps": []}

# Health pre-check
for path in ("/health/db", "/health"):
    req = urllib.request.Request(f"{BASE}{path}")
    with urllib.request.urlopen(req, timeout=30) as resp:
        audit[f"precheck{path.replace('/', '_')}"] = json.load(resp)

r = orch(GOAL)
snap("1-clarify-or-plan", r, audit)
if r.get("status") == "awaiting_clarification":
    r = orch("use defaults")
    snap("2-clarify-defaults", r, audit)
if r.get("status") == "awaiting_implementation_approval":
    r = orch("approve", implementationApproved=True)
    snap("3-approve-implement", r, audit)

audit["final"] = {
    "status": r.get("status"),
    "projectStatus": r.get("projectStatus"),
    "workspaceId": r.get("workspaceId"),
    "projectId": r.get("projectId"),
    "verified": r.get("projectStatus") == "COMPLETE" or "VERIFIED" in (r.get("finalResponse") or ""),
}

with open(OUT, "w") as f:
    json.dump(audit, f, indent=2)
print(f"\nWrote {OUT}")
print("VERIFIED:", audit["final"]["verified"])
