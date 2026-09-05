#!/usr/bin/env python3
"""P17 school live acceptance — forceNewProject, honest evidence."""
import json
import re
import sys
import urllib.request

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:3020"
OUT = sys.argv[2] if len(sys.argv) > 2 else "/tmp/p17-school-audit.json"
TOKEN = "dev-token"
GOAL = (
    "Build a complete Phase-1 School Management System with ADMIN, TEACHER and STUDENT roles, "
    "email/password session authentication, PostgreSQL/Neon persistence, RBAC, dashboard, "
    "student management, teacher management, class management, attendance management, "
    "real automated behavioral tests, build verification, requirement verification, and repair/retest when "
    "failures occur. Use S3 if configured; otherwise use the configured local-file storage backend. "
    "Do not use mock, in-memory, localStorage, or file-JSON persistence for application data."
)

FORBIDDEN_WS = ("454d200a", "562e2c49", "b0a22cdb", "7bd70916", "bce294b2")


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


def snap(label, r, audit):
    tail = r.get("finalResponse") or ""
    obs_ws = []
    for o in r.get("observations", []):
        out = o.get("output") or {}
        nested = out.get("output") if isinstance(out, dict) else None
        target = nested if isinstance(nested, dict) else out
        if isinstance(target, dict) and target.get("workspaceId"):
            obs_ws.append({"workspaceId": target["workspaceId"], "reused": target.get("reused")})

    provider = next((ln for ln in tail.split("\n") if "Provider routing:" in ln), None)
    build = next((ln.strip() for ln in tail.split("\n") if ln.strip().startswith("Build:")), None)
    tests = next((ln.strip() for ln in tail.split("\n") if ln.strip().startswith("Tests:")), None)

    req_rows = []
    if "Requirement evidence" in tail:
        for line in tail.split("\n"):
            if line.strip().startswith("- ") and any(s in line for s in ("VERIFIED", "PARTIAL", "FAILED", "NOT_TESTED")):
                status = "UNKNOWN"
                for s in ("VERIFIED", "PARTIAL", "FAILED", "NOT_TESTED"):
                    if s in line:
                        status = s
                req_rows.append({"line": line.strip()[:240], "status": status})

    arch = (r.get("projectPlan") or {}).get("architecture") or (r.get("architecture"))
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
        "architecture": arch,
        "requirementMatrix": req_rows,
        "verifiedCount": sum(1 for x in req_rows if x["status"] == "VERIFIED"),
        "repairHistory": (r.get("projectPlan") or {}).get("implementationProgress", {}).get("repairHistory"),
        "goalInResponse": "school management" in tail.lower(),
        "restContamination": "REST API" in tail and "school management" not in tail.lower(),
        "finalResponseTail": tail[-3500:],
    }
    audit["steps"].append(entry)
    print(f"\n=== {label} ===")
    print("status:", entry["status"], "project:", entry["projectId"], "ws:", entry["workspaceId"])
    print("obs ws:", obs_ws)
    print("build:", build, "tests:", tests)
    print("verified:", entry["verifiedCount"], "restContamination:", entry["restContamination"])
    if arch:
        print("arch:", arch.get("framework"), arch.get("backend"), arch.get("database"))
    return r


audit = {"goal": GOAL, "base": BASE, "phase": "P17-SCHOOL", "steps": []}

r = orch(GOAL, forceNewProject=True)
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
    "buildPass": bool(last.get("build") and "PASS" in last["build"].upper()),
    "testsPass": bool(last.get("tests") and ("PASS" in last["tests"].upper() or re.search(r"\d+/\d+", last["tests"] or ""))),
    "verifiedCount": last.get("verifiedCount", 0),
    "restContamination": last.get("restContamination"),
    "forbiddenWorkspace": any(ws.startswith(p) for p in FORBIDDEN_WS),
    "isolatedProject": last.get("projectId") != "e21d88c1-3ebb-44e5-94e8-2b514836ec5e",
}

with open(OUT, "w") as f:
    json.dump(audit, f, indent=2)
print(f"\nWrote {OUT}")
print("isolatedProject:", audit["final"]["isolatedProject"])
print("restContamination:", audit["final"]["restContamination"])
