#!/usr/bin/env python3
"""P20 — Structured generation reliability + Level-4 re-acceptance."""
import json
import os
import re
import shutil
import sys
import time
import urllib.error
import urllib.request

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:3027"
OUT = sys.argv[2] if len(sys.argv) > 2 else "/tmp/p20-audit.json"
TOKEN = "dev-token"
WS_ROOT = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "sandbox/workspaces",
)
REST = "Build a small REST API with one endpoint and a real automated behavioral test."
SCHOOL = (
    "Build a Phase-1 School Management System with ADMIN, TEACHER, and STUDENT roles, "
    "email/password session authentication, PostgreSQL/Neon persistence, and local disk storage "
    "when S3 is not configured. Include RBAC, dashboard, student management, teacher management, "
    "class management, attendance management, real automated behavioral tests, build verification, "
    "and requirement verification. Do not use mock, in-memory, localStorage, or file-JSON persistence "
    "for application data."
)
MODULES = ["AUTH", "RBAC", "DASHBOARD", "STUDENT", "TEACHER", "CLASS", "ATTENDANCE"]


def _blocker(a, g):
    if not g.get("restPass"):
        return "REST regression failed"
    if not g.get("freshProject"):
        return "no fresh school projectId"
    if not g.get("buildPass"):
        return "BUILD not PASS"
    if not g.get("testsPass"):
        return "TESTS not PASS"
    if not g.get("modulesVerified"):
        return f"requirements verified {a.get('school', {}).get('verifiedCount', 0)}/7+"
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


def orch(message, goal, timeout=3600, **extra):
    body = {"message": message, "originalGoal": goal, **extra}
    req = urllib.request.Request(
        f"{BASE}/orchestrate",
        data=json.dumps(body).encode(),
        headers={"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.load(resp)


def snap(label, r, audit, track="steps"):
    tail = r.get("finalResponse") or ""
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
        "providerEvidence": provider,
        "build": build,
        "tests": tests,
        "requirementMatrix": req_rows,
        "verifiedCount": sum(1 for x in req_rows if x["status"] == "VERIFIED"),
        "moduleStatus": mod_status,
        "repairHistory": (r.get("projectPlan") or {}).get("implementationProgress", {}).get("repairHistory"),
        "finalResponseTail": tail[-4000:],
    }
    audit.setdefault(track, []).append(entry)
    print(f"\n=== {label} === status={entry['status']} project={entry['projectId']} ws={entry['workspaceId']}")
    print(f"  build={build} tests={tests} verified={entry['verifiedCount']}")
    return r


def run_pipeline(label_prefix, goal, track):
    r = orch(goal, goal=goal, forceNewProject=True)
    snap(f"{label_prefix}-clarify", r, audit, track=track)
    if r.get("status") == "awaiting_clarification":
        r = orch("use defaults", goal=goal)
        snap(f"{label_prefix}-defaults", r, audit, track=track)
    if r.get("status") == "awaiting_implementation_approval":
        r = orch("approve", goal=goal, implementationApproved=True, forceNewWorkspace=True)
        snap(f"{label_prefix}-implement", r, audit, track=track)
    return r


audit = {
    "phase": "P20",
    "base": BASE,
    "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    "steps": [],
    "restSteps": [],
    "schoolSteps": [],
}

try:
    health = get("/health")
    providers = get("/providers")
    audit["providerReadiness"] = {
        "healthStatus": health.get("status"),
        "providers": health.get("providers"),
        "specialists": providers.get("specialists"),
        "neonConnected": (health.get("diagnostics") or {}).get("neonConnected"),
        "s3Configured": (health.get("diagnostics") or {}).get("s3Configured"),
        "bharathHealthy": (health.get("providers") or {}).get("bharath-ai", {}).get("healthy"),
        "healthySpecialists": [
            s["provider"]
            for s in (providers.get("specialists") or [])
            if s.get("healthy") and s.get("available")
        ],
    }
except Exception as e:
    audit["providerReadiness"] = {"error": str(e)}

# Phase 8 — REST regression first
rest_r = run_pipeline("rest", REST, "restSteps")
rest_last = audit["restSteps"][-1] if audit["restSteps"] else {}
audit["rest"] = {
    "projectId": rest_r.get("projectId"),
    "workspaceId": rest_r.get("workspaceId"),
    "status": rest_r.get("status"),
    "buildPass": bool(rest_last.get("build") and "PASS" in (rest_last.get("build") or "").upper()),
    "testsPass": bool(rest_last.get("tests") and "PASS" in (rest_last.get("tests") or "").upper()),
    "verifiedCount": rest_last.get("verifiedCount", 0),
}
rest_pass = audit["rest"]["buildPass"] and audit["rest"]["testsPass"] and audit["rest"]["verifiedCount"] >= 1
audit["rest"]["pass"] = rest_pass
print("REST pass:", rest_pass)

school_r = {"status": "skipped", "projectId": None, "workspaceId": None}
if rest_pass:
    school_r = run_pipeline("school", SCHOOL, "schoolSteps")
else:
    audit["schoolSteps"].append({"label": "skipped", "reason": "REST regression failed"})

school_last = audit["schoolSteps"][-1] if audit["schoolSteps"] and audit["schoolSteps"][-1].get("label") != "skipped" else {}
school_pid = school_r.get("projectId")
school_ws = school_r.get("workspaceId") or ""
audit["school"] = {
    "projectId": school_pid,
    "workspaceId": school_ws,
    "status": school_r.get("status"),
    "projectStatus": school_r.get("projectStatus"),
    "buildPass": bool(school_last.get("build") and "PASS" in (school_last.get("build") or "").upper()),
    "testsPass": bool(school_last.get("tests") and "PASS" in (school_last.get("tests") or "").upper()),
    "verifiedCount": school_last.get("verifiedCount", 0),
    "moduleStatus": school_last.get("moduleStatus", {}),
}

# Isolation
audit["isolation"] = {"skipped": not rest_pass or not school_pid}
if rest_pass and school_pid:
    audit["isolation"] = {
        "restProjectId": audit["rest"]["projectId"],
        "schoolProjectId": school_pid,
        "isolated": audit["rest"]["projectId"] != school_pid,
        "restWorkspaceId": audit["rest"]["workspaceId"],
        "schoolWorkspaceId": school_ws,
        "workspaceIsolated": audit["rest"]["workspaceId"] != school_ws,
    }

# Cross-process resume — delete workspace (not rename)
audit["resume"] = {"skipped": True}
if school_pid and school_ws and school_last.get("verifiedCount", 0) > 0:
    ws_path = os.path.join(WS_ROOT, school_ws)
    if os.path.isdir(ws_path):
        shutil.rmtree(ws_path)
        audit["resume"]["workspaceDeleted"] = True
    try:
        rr = orch("Continue my project.", goal=SCHOOL, projectId=school_pid, timeout=600)
        audit["resume"] = {
            "skipped": False,
            "httpOk": True,
            "status": rr.get("status"),
            "projectId": rr.get("projectId"),
            "workspaceId": rr.get("workspaceId"),
            "sameProjectId": rr.get("projectId") == school_pid,
            "sameWorkspaceId": rr.get("workspaceId") == school_ws,
            "pass": (
                rr.get("projectId") == school_pid
                and rr.get("workspaceId") == school_ws
                and rr.get("status") not in ("awaiting_clarification", "awaiting_implementation_approval")
            ),
        }
    except urllib.error.HTTPError as e:
        audit["resume"] = {"skipped": False, "httpOk": False, "httpStatus": e.code, "pass": False}

gates = {
    "restPass": rest_pass,
    "freshProject": bool(school_pid),
    "freshWorkspace": bool(school_ws),
    "clarification": any(s.get("label", "").endswith("-clarify") for s in audit.get("schoolSteps", [])),
    "plan": any(s.get("status") == "awaiting_implementation_approval" for s in audit.get("schoolSteps", [])),
    "approval": any(s.get("label") == "school-implement" for s in audit.get("schoolSteps", [])),
    "buildPass": audit["school"].get("buildPass"),
    "testsPass": audit["school"].get("testsPass"),
    "modulesVerified": audit["school"].get("verifiedCount", 0) >= 7,
    "allModulesVerified": all(
        audit["school"].get("moduleStatus", {}).get(m, "").lower() == "verified" for m in MODULES
    ) if audit["school"].get("moduleStatus") else False,
    "isolation": audit.get("isolation", {}).get("isolated"),
    "resumePass": audit.get("resume", {}).get("pass") if not audit.get("resume", {}).get("skipped") else None,
}
all_pass = rest_pass and all(
    gates[k]
    for k in (
        "freshProject", "freshWorkspace", "clarification", "plan", "approval",
        "buildPass", "testsPass", "modulesVerified", "isolation",
    )
) and gates.get("allModulesVerified")
audit["gates"] = gates
audit["final"] = {
    "level": "4" if all_pass else "3+",
    "score": 100 if all_pass else 80,
    "status": "PASS" if all_pass else "PARTIAL/FAILED",
    "blocker": None if all_pass else _blocker(audit, {**gates, "restPass": rest_pass}),
}

with open(OUT, "w") as f:
    json.dump(audit, f, indent=2)
print(f"\nWrote {OUT}")
print(json.dumps(audit["final"], indent=2))
sys.exit(0 if all_pass else 1)
