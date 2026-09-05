#!/usr/bin/env python3
"""P16 live school acceptance — honest evidence only."""
import json
import re
import sys
import urllib.request

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:3018"
OUT = sys.argv[2] if len(sys.argv) > 2 else "/tmp/p16-school-audit.json"
TOKEN = "dev-token"
GOAL = (
    "Build a complete Phase-1 School Management System with ADMIN, TEACHER and STUDENT roles, "
    "email/password session authentication, PostgreSQL/Neon persistence, RBAC, dashboard, "
    "student management, teacher management, class management, attendance management, "
    "real automated tests, build verification, requirement verification, and repair/retest when "
    "failures occur. Use S3 if configured; otherwise use the configured local-file storage backend. "
    "Do not use mock, in-memory, localStorage, or file-JSON persistence for application data."
)

FORBIDDEN_WS = ("454d200a", "562e2c49", "b0a22cdb", "7bd70916")


def orch(message, **extra):
    body = {"message": message, "originalGoal": GOAL, **extra}
    req = urllib.request.Request(
        f"{BASE}/orchestrate",
        data=json.dumps(body).encode(),
        headers={"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=1800) as resp:
        return json.load(resp)


def extract(tail, prefix):
    for line in tail.split("\n"):
        if line.strip().startswith(prefix):
            return line.strip()
    return None


def parse_requirement_matrix(tail):
    rows = []
    in_section = False
    for line in tail.split("\n"):
        if "Requirement evidence" in line:
            in_section = True
            continue
        if in_section:
            if line.strip().startswith("- "):
                text = line.strip()[2:]
                status = "UNKNOWN"
                for s in ("VERIFIED", "PARTIAL", "FAILED", "NOT_TESTED"):
                    if f": {s}" in text:
                        status = s
                        break
                rows.append({"requirement": text[:200], "status": status})
            elif line.strip() and not line.startswith(" "):
                break
    return rows


def snap(label, r, audit):
    tail = r.get("finalResponse") or ""
    obs_ws = []
    for o in r.get("observations", []):
        out = o.get("output") or {}
        nested = out.get("output") if isinstance(out, dict) else None
        target = nested if isinstance(nested, dict) else out
        if isinstance(target, dict) and target.get("workspaceId"):
            obs_ws.append({"workspaceId": target["workspaceId"], "reused": target.get("reused")})

    provider = next((ln.strip() for ln in tail.split("\n") if "Provider routing:" in ln), None)
    build = extract(tail, "Build:")
    tests = extract(tail, "Tests:")
    req_matrix = parse_requirement_matrix(tail)
    verified = sum(1 for x in req_matrix if x["status"] == "VERIFIED")
    failed = sum(1 for x in req_matrix if x["status"] == "FAILED")

    entry = {
        "label": label,
        "status": r.get("status"),
        "projectStatus": r.get("projectStatus"),
        "workspaceId": r.get("workspaceId"),
        "projectId": r.get("projectId"),
        "observationWorkspaces": obs_ws,
        "providerEvidence": provider,
        "build": build,
        "tests": tests,
        "buildPass": bool(build and "PASS" in build.upper() and "FAIL" not in build.upper()),
        "testsPass": bool(tests and ("PASS" in tests.upper() or re.search(r"\d+/\d+", tests)) and "FAIL" not in tests.upper()),
        "requirementMatrix": req_matrix,
        "verifiedCount": verified,
        "failedCount": failed,
        "repairHistory": (r.get("projectPlan") or {}).get("implementationProgress", {}).get("repairHistory"),
        "architecture": (r.get("projectPlan") or {}).get("architecture"),
        "finalResponseTail": tail[-3000:],
    }
    audit["steps"].append(entry)
    print(f"\n=== {label} ===")
    print("status:", entry["status"], "projectStatus:", entry["projectStatus"])
    print("workspace:", entry["workspaceId"], "project:", entry["projectId"])
    print("build:", entry["build"], "tests:", entry["tests"])
    print("verified/failed reqs:", verified, failed)
    return r


audit = {"goal": GOAL, "base": BASE, "phase": "P16-SCHOOL", "steps": []}

r = orch(GOAL)
snap("1-clarify-or-plan", r, audit)
if r.get("status") == "awaiting_clarification":
    r = orch("use defaults")
    snap("2-clarify-defaults", r, audit)
if r.get("status") == "awaiting_implementation_approval":
    r = orch("approve", implementationApproved=True, forceNewWorkspace=True)
    snap("3-approve-implement", r, audit)

last = audit["steps"][-1] if audit["steps"] else {}
ws = r.get("workspaceId") or ""

audit["final"] = {
    "status": r.get("status"),
    "projectStatus": r.get("projectStatus"),
    "workspaceId": ws,
    "projectId": r.get("projectId"),
    "buildPass": last.get("buildPass"),
    "testsPass": last.get("testsPass"),
    "verifiedCount": last.get("verifiedCount", 0),
    "failedCount": last.get("failedCount", 0),
    "reusedForbiddenWorkspace": any(ws.startswith(p) for p in FORBIDDEN_WS),
}

with open(OUT, "w") as f:
    json.dump(audit, f, indent=2)
print(f"\nWrote {OUT}")
print("BUILD:", audit["final"]["buildPass"])
print("TESTS:", audit["final"]["testsPass"])
print("VERIFIED REQS:", audit["final"]["verifiedCount"])
