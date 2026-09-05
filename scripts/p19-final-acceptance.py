#!/usr/bin/env python3
"""P19 — Final Level-4 live acceptance audit."""
import json
import os
import re
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:3025"
OUT = sys.argv[2] if len(sys.argv) > 2 else "/tmp/p19-audit.json"
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
REST = "Create a small REST API with one endpoint and a real automated behavioral test."
MODULES = ["AUTH", "RBAC", "DASHBOARD", "STUDENT", "TEACHER", "CLASS", "ATTENDANCE"]


def _blocker(a, g):
    if not g.get("freshProject"):
        return "no fresh projectId"
    if not g.get("buildPass"):
        return "BUILD not PASS"
    if not g.get("testsPass"):
        return "TESTS not PASS"
    if not g.get("modulesVerified"):
        return f"requirements verified {a['school'].get('verifiedCount', 0)}/7+"
    if not g.get("allModulesVerified"):
        return "not all 7 modules VERIFIED"
    if not g.get("isolation"):
        return "project isolation failed"
    if not g.get("resumePass"):
        return "cross-process resume failed"
    return "mandatory gate failed"


def get(path):
    req = urllib.request.Request(
        f"{BASE}{path}",
        headers={"Authorization": f"Bearer {TOKEN}"},
        method="GET",
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.load(resp)


def orch(message, goal=GOAL, timeout=3600, **extra):
    body = {"message": message, "originalGoal": goal, **extra}
    req = urllib.request.Request(
        f"{BASE}/orchestrate",
        data=json.dumps(body).encode(),
        headers={"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
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

    mod_status = {}
    if "Modules:" in tail:
        m = re.search(r"Modules:\s*(.+)", tail)
        if m:
            for part in m.group(1).split(";"):
                if "=" in part:
                    name, st = part.strip().rsplit("=", 1)
                    mod_status[name.strip()] = st.strip()

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
        "architecture": r.get("architecture") or (r.get("projectPlan") or {}).get("architecture"),
        "requirementMatrix": req_rows,
        "verifiedCount": sum(1 for x in req_rows if x["status"] == "VERIFIED"),
        "moduleStatus": mod_status,
        "repairHistory": (r.get("projectPlan") or {}).get("implementationProgress", {}).get("repairHistory"),
        "finalResponseTail": tail[-4000:],
    }
    audit["steps"].append(entry)
    print(f"\n=== {label} === status={entry['status']} project={entry['projectId']} ws={entry['workspaceId']}")
    print(f"  build={build} tests={tests} verified={entry['verifiedCount']}")
    return r


audit = {
    "phase": "P19",
    "base": BASE,
    "goal": GOAL,
    "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    "steps": [],
}

# Phase 1 — Provider readiness
try:
    health = get("/health")
    providers = get("/providers")
    audit["providerReadiness"] = {
        "healthStatus": health.get("status"),
        "diagnostics": health.get("diagnostics"),
        "providers": health.get("providers"),
        "specialists": providers.get("specialists"),
        "s3Configured": (health.get("diagnostics") or {}).get("s3Configured"),
        "neonConnected": (health.get("diagnostics") or {}).get("neonConnected"),
        "bharathHealthy": (health.get("providers") or {}).get("bharath-ai", {}).get("healthy"),
    }
    healthy_specialists = [
        s["provider"]
        for s in (providers.get("specialists") or [])
        if s.get("healthy") and s.get("available")
    ]
    audit["providerReadiness"]["healthySpecialists"] = healthy_specialists
    print("Phase 1 providers:", healthy_specialists)
except Exception as e:
    audit["providerReadiness"] = {"error": str(e)}

# Phase 2-9 — School pipeline
r = orch(GOAL, forceNewProject=True)
snap("1-clarify", r, audit)
if r.get("status") == "awaiting_clarification":
    r = orch("use defaults")
    snap("2-clarify-defaults", r, audit)
if r.get("status") == "awaiting_implementation_approval":
    r = orch("approve", implementationApproved=True, forceNewWorkspace=True)
    snap("3-approve-implement", r, audit)

last = audit["steps"][-1] if audit["steps"] else {}
school_pid = r.get("projectId")
school_ws = r.get("workspaceId") or ""
audit["school"] = {
    "projectId": school_pid,
    "workspaceId": school_ws,
    "status": r.get("status"),
    "projectStatus": r.get("projectStatus"),
    "buildPass": bool(last.get("build") and "PASS" in (last.get("build") or "").upper()),
    "testsPass": bool(last.get("tests") and "PASS" in (last.get("tests") or "").upper()),
    "verifiedCount": last.get("verifiedCount", 0),
    "moduleStatus": last.get("moduleStatus", {}),
}

# Phase 11 — Isolation (quick REST then school id check on same gateway — school already created)
try:
    rr = orch(REST, goal=REST, forceNewProject=True)
    if rr.get("status") == "awaiting_clarification":
        rr = orch("use defaults", goal=REST)
    if rr.get("status") == "awaiting_implementation_approval":
        rr = orch("approve", goal=REST, implementationApproved=True, forceNewWorkspace=True)
    rest_pid = rr.get("projectId")
    audit["isolation"] = {
        "restProjectId": rest_pid,
        "schoolProjectId": school_pid,
        "isolated": bool(rest_pid and school_pid and rest_pid != school_pid),
        "restWorkspaceId": rr.get("workspaceId"),
        "schoolWorkspaceId": school_ws,
        "workspaceIsolated": bool(rr.get("workspaceId") and school_ws and rr.get("workspaceId") != school_ws),
    }
    print("Isolation:", audit["isolation"])
except Exception as e:
    audit["isolation"] = {"error": str(e)}

# Phase 10 — Cross-process resume (only if school has projectId + workspaceId)
audit["resume"] = {"skipped": True, "reason": "no school projectId/workspaceId"}
if school_pid and school_ws:
    ws_path = os.path.join(WS_ROOT, school_ws)
    backup = ws_path + ".p19-backup"
    if os.path.isdir(ws_path):
        if os.path.isdir(backup):
            shutil.rmtree(backup)
        shutil.move(ws_path, backup)
        audit["resume"]["workspaceRemoved"] = True
        audit["resume"]["backupPath"] = backup
    try:
        rr = orch("Continue my project.", goal=GOAL, projectId=school_pid, timeout=600)
        audit["resume"] = {
            "skipped": False,
            "httpOk": True,
            "status": rr.get("status"),
            "projectId": rr.get("projectId"),
            "workspaceId": rr.get("workspaceId"),
            "sameProjectId": rr.get("projectId") == school_pid,
            "sameWorkspaceId": rr.get("workspaceId") == school_ws,
            "bharath500": False,
            "tail": (rr.get("finalResponse") or "")[-2000:],
        }
        audit["resume"]["pass"] = (
            rr.get("projectId") == school_pid
            and rr.get("workspaceId") == school_ws
            and rr.get("status") not in ("awaiting_clarification", "awaiting_implementation_approval")
        )
    except urllib.error.HTTPError as e:
        audit["resume"] = {
            "skipped": False,
            "httpOk": False,
            "httpStatus": e.code,
            "bharath500": e.code == 500,
            "pass": False,
        }

# Final scoring
gates = {
    "freshProject": bool(school_pid),
    "freshWorkspace": bool(school_ws),
    "clarification": any(s["label"] == "1-clarify" for s in audit["steps"]),
    "plan": any(s.get("status") == "awaiting_implementation_approval" for s in audit["steps"]),
    "approval": any(s["label"] == "3-approve-implement" for s in audit["steps"]),
    "buildPass": audit["school"].get("buildPass"),
    "testsPass": audit["school"].get("testsPass"),
    "modulesVerified": audit["school"].get("verifiedCount", 0) >= 7,
    "allModulesVerified": all(
        audit["school"].get("moduleStatus", {}).get(m, "").lower() == "verified"
        for m in MODULES
    ) if audit["school"].get("moduleStatus") else False,
    "isolation": audit.get("isolation", {}).get("isolated"),
    "resumePass": audit.get("resume", {}).get("pass"),
    "noBharath500": not audit.get("resume", {}).get("bharath500"),
}
all_pass = all(
    gates[k]
    for k in (
        "freshProject", "freshWorkspace", "clarification", "plan", "approval",
        "buildPass", "testsPass", "modulesVerified", "isolation", "resumePass", "noBharath500",
    )
)
audit["gates"] = gates
audit["final"] = {
    "level": "4" if all_pass else "3+",
    "score": 100 if all_pass else 80,
    "status": "PASS" if all_pass else "PARTIAL/FAILED",
    "blocker": None if all_pass else _blocker(audit, gates),
}

with open(OUT, "w") as f:
    json.dump(audit, f, indent=2)
print(f"\nWrote {OUT}")
print(json.dumps(audit["final"], indent=2))
sys.exit(0 if all_pass else 1)
