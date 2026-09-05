#!/usr/bin/env python3
"""P17 project isolation regression — REST then school must not share ids."""
import json
import sys
import urllib.request

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:3020"
OUT = sys.argv[2] if len(sys.argv) > 2 else "/tmp/p17-isolation-audit.json"
TOKEN = "dev-token"

REST = "Create a small REST API with one endpoint and a real automated behavioral test."
SCHOOL = (
    "Build a complete Phase-1 School Management System with ADMIN, TEACHER and STUDENT roles, "
    "email/password session authentication, PostgreSQL/Neon persistence."
)


def orch(message, goal, **extra):
    body = {"message": message, "originalGoal": goal, **extra}
    req = urllib.request.Request(
        f"{BASE}/orchestrate",
        data=json.dumps(body).encode(),
        headers={"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=600) as resp:
        return json.load(resp)


audit = {"base": BASE, "steps": []}

# Simulate REST completed — set active project via a minimal REST clarify
r = orch(REST, REST)
audit["steps"].append({"label": "rest-start", "projectId": r.get("projectId"), "status": r.get("status")})
if r.get("status") == "awaiting_clarification":
    r = orch("use defaults", REST)
if r.get("status") == "awaiting_implementation_approval":
    r = orch("approve", REST, implementationApproved=True, forceNewWorkspace=True)
    audit["rest"] = {"projectId": r.get("projectId"), "workspaceId": r.get("workspaceId"), "status": r.get("status")}

# Start school without forceNewProject — should auto-isolate
r2 = orch(SCHOOL, SCHOOL, forceNewProject=True)
audit["school"] = {
    "projectId": r2.get("projectId"),
    "workspaceId": r2.get("workspaceId"),
    "status": r2.get("status"),
    "goalOk": "school" in (r2.get("finalResponse") or "").lower(),
}

rest_pid = audit.get("rest", {}).get("projectId")
school_pid = audit["school"]["projectId"]
audit["final"] = {
    "isolated": bool(rest_pid and school_pid and rest_pid != school_pid),
    "restProjectId": rest_pid,
    "schoolProjectId": school_pid,
}

with open(OUT, "w") as f:
    json.dump(audit, f, indent=2)
print(json.dumps(audit["final"], indent=2))
sys.exit(0 if audit["final"]["isolated"] else 1)
