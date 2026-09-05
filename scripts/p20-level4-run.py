#!/usr/bin/env python3
"""Drive school project to completion with provider-wait retries."""
import json
import os
import re
import shutil
import sys
import time
import urllib.error
import urllib.request

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:3001"
OUT = sys.argv[2] if len(sys.argv) > 2 else "/tmp/p20-level4-audit.json"
TOKEN = "dev-token"
WS_ROOT = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "sandbox/workspaces",
)
GOAL = (
    "Build a Phase-1 School Management System with ADMIN, TEACHER, and STUDENT roles, "
    "email/password session authentication, PostgreSQL/Neon persistence, and local disk storage "
    "when S3 is not configured. Include RBAC, dashboard, student management, teacher management, "
    "class management, attendance management, real automated behavioral tests, build verification, "
    "and requirement verification. Do not use mock, in-memory, localStorage, or file-JSON persistence "
    "for application data."
)
MODULES = ["AUTH", "RBAC", "DASHBOARD", "STUDENT", "TEACHER", "CLASS", "ATTENDANCE"]
MAX_WAIT_RETRIES = 12


def orch(message, goal=GOAL, timeout=7200, **extra):
    body = {"message": message, "originalGoal": goal, **extra}
    req = urllib.request.Request(
        f"{BASE}/orchestrate",
        data=json.dumps(body).encode(),
        headers={"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.load(resp)


def parse_status(r):
    tail = r.get("finalResponse") or ""
    build = next((ln.strip() for ln in tail.split("\n") if ln.strip().startswith("Build:")), None)
    tests = next((ln.strip() for ln in tail.split("\n") if ln.strip().startswith("Tests:")), None)
    provider = next((ln for ln in tail.split("\n") if "Provider routing:" in ln), None)
    verified = 0
    if "Requirement evidence" in tail:
        verified = sum(1 for ln in tail.split("\n") if "VERIFIED" in ln and ln.strip().startswith("- "))
    retry_at = None
    m = re.search(r"retryAt=([0-9T:.+-Z]+)", tail)
    if m:
        retry_at = m.group(1)
    return {
        "status": r.get("status"),
        "projectStatus": r.get("projectStatus"),
        "projectId": r.get("projectId"),
        "workspaceId": r.get("workspaceId"),
        "build": build,
        "tests": tests,
        "provider": provider,
        "verified": verified,
        "retryAt": retry_at,
        "tail": tail[-3000:],
    }


audit = {"base": BASE, "attempts": [], "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}

# Fresh school run
r = orch(GOAL, forceNewProject=True)
audit["attempts"].append({"step": "clarify", **parse_status(r)})
if r.get("status") == "awaiting_clarification":
    r = orch("use defaults", goal=GOAL)
    audit["attempts"].append({"step": "defaults", **parse_status(r)})
if r.get("status") == "awaiting_implementation_approval":
    r = orch("approve", goal=GOAL, implementationApproved=True, forceNewWorkspace=True)
    audit["attempts"].append({"step": "approve", **parse_status(r)})

project_id = r.get("projectId")
workspace_id = r.get("workspaceId")

for i in range(MAX_WAIT_RETRIES):
    st = parse_status(r)
    print(f"\n--- attempt {i} --- status={st['status']} build={st['build']} tests={st['tests']} verified={st['verified']}")
    if st["status"] not in ("waiting_provider",) and st.get("projectStatus") != "WAITING_FOR_PROVIDER":
        if st["status"] == "completed" and st.get("build") and "PASS" in (st.get("build") or "").upper():
            if st.get("verified", 0) >= 7:
                break
        if st["status"] not in ("waiting_provider",):
            break
    wait_s = 20
    if st.get("retryAt"):
        try:
            from datetime import datetime, timezone

            target = datetime.fromisoformat(st["retryAt"].replace("Z", "+00:00"))
            delta = (target - datetime.now(timezone.utc)).total_seconds()
            wait_s = max(15, min(120, int(delta) + 3))
        except Exception:
            pass
    print(f"waiting {wait_s}s then continue project {project_id}")
    time.sleep(wait_s)
    try:
        r = orch("Continue my project.", goal=GOAL, projectId=project_id, timeout=7200)
        audit["attempts"].append({"step": f"continue-{i+1}", **parse_status(r)})
    except urllib.error.HTTPError as e:
        audit["attempts"].append({"step": f"continue-{i+1}", "httpError": e.code})
        break

final = parse_status(r)
audit["final"] = final

# Cross-process resume if meaningful progress
audit["resume"] = {"skipped": True}
if project_id and workspace_id and final.get("verified", 0) > 0:
    ws_path = os.path.join(WS_ROOT, workspace_id)
    if os.path.isdir(ws_path):
        shutil.rmtree(ws_path)
    try:
        rr = orch("Continue my project.", goal=GOAL, projectId=project_id, timeout=7200)
        audit["resume"] = {
            "sameProjectId": rr.get("projectId") == project_id,
            "sameWorkspaceId": rr.get("workspaceId") == workspace_id,
            "status": rr.get("status"),
            "pass": rr.get("projectId") == project_id and rr.get("workspaceId") == workspace_id,
        }
    except urllib.error.HTTPError as e:
        audit["resume"] = {"pass": False, "httpError": e.code}

build_pass = bool(final.get("build") and "PASS" in final["build"].upper())
tests_pass = bool(final.get("tests") and re.search(r"\d+/\d+", final.get("tests") or ""))
level4 = build_pass and tests_pass and final.get("verified", 0) >= 7
audit["level4"] = {
    "level": "4" if level4 else "3+",
    "score": 100 if level4 else 80,
    "pass": level4,
    "projectId": project_id,
    "workspaceId": workspace_id,
}

with open(OUT, "w") as f:
    json.dump(audit, f, indent=2)
print(json.dumps(audit["level4"], indent=2))
sys.exit(0 if level4 else 1)
