#!/usr/bin/env python3
"""P15 live REST acceptance — honest evidence only."""
import json
import sys
import urllib.request

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:3014"
OUT = sys.argv[2] if len(sys.argv) > 2 else "/tmp/p15-rest-audit.json"
TOKEN = "dev-token"
GOAL = "Create a small REST API with one endpoint and a real automated test."

FORBIDDEN_WS = {
    "b0a22cdb",
    "d5f797b3",
    "f67fffd8",
    "b8617bee",
    "454d200a",
    "562e2c49",
}


def orch(message, **extra):
    body = {"message": message, "originalGoal": GOAL, **extra}
    req = urllib.request.Request(
        f"{BASE}/orchestrate",
        data=json.dumps(body).encode(),
        headers={"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=900) as resp:
        return json.load(resp)


def _extract(tail, prefix):
    for line in tail.split("\n"):
        if line.strip().startswith(prefix):
            return line.strip()
    return None


def snap(label, r, audit):
    tail = r.get("finalResponse") or ""
    obs_ws = []
    for o in r.get("observations", []):
        out = o.get("output") or {}
        nested = out.get("output") if isinstance(out, dict) else None
        target = nested if isinstance(nested, dict) else out
        if isinstance(target, dict) and target.get("workspaceId"):
            obs_ws.append({"workspaceId": target["workspaceId"], "reused": target.get("reused")})

    provider = None
    for line in tail.split("\n"):
        if "Provider routing:" in line:
            provider = line.strip()

    build = _extract(tail, "Build:")
    tests = _extract(tail, "Tests:")
    no_tests = "NO_TESTS" in tail or (tests and "NO_TESTS" in tests)

    entry = {
        "label": label,
        "status": r.get("status"),
        "projectStatus": r.get("projectStatus"),
        "taskId": r.get("taskId"),
        "workspaceId": r.get("workspaceId"),
        "projectId": r.get("projectId"),
        "observationWorkspaces": obs_ws,
        "providerEvidence": provider,
        "build": build,
        "tests": tests,
        "noTests": no_tests,
        "buildPass": bool(build and "PASS" in build.upper() and "FAIL" not in build.upper()),
        "testsPass": bool(tests and "PASS" in tests.upper() and "FAIL" not in tests.upper() and not no_tests),
        "repairHistory": (r.get("projectPlan") or {}).get("implementationProgress", {}).get("repairHistory"),
        "requirementEvidence": [
            line.strip()
            for line in tail.split("\n")
            if line.strip().startswith("- ") and ("VERIFIED" in line or "FAILED" in line or "PARTIAL" in line)
        ],
        "finalResponseTail": tail[-2000:],
    }
    audit["steps"].append(entry)
    print(f"\n=== {label} ===")
    print("status:", entry["status"], "projectStatus:", entry["projectStatus"])
    print("workspace:", entry["workspaceId"], "project:", entry["projectId"])
    print("obs ws:", obs_ws)
    print("build:", entry["build"], "tests:", entry["tests"])
    return r


audit = {"goal": GOAL, "base": BASE, "steps": []}

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
    r = orch("approve", implementationApproved=True, forceNewWorkspace=True)
    snap("3-approve-implement", r, audit)

last = audit["steps"][-1] if audit["steps"] else {}
ws = r.get("workspaceId") or ""
reused_forbidden = any(f in (ws or "") for f in FORBIDDEN_WS)

audit["final"] = {
    "status": r.get("status"),
    "projectStatus": r.get("projectStatus"),
    "workspaceId": ws,
    "projectId": r.get("projectId"),
    "buildPass": last.get("buildPass"),
    "testsPass": last.get("testsPass"),
    "noTests": last.get("noTests"),
    "verified": r.get("projectStatus") == "COMPLETE"
    and last.get("buildPass")
    and last.get("testsPass")
    and not last.get("noTests"),
    "reusedForbiddenWorkspace": reused_forbidden,
}

with open(OUT, "w") as f:
    json.dump(audit, f, indent=2)
print(f"\nWrote {OUT}")
print("BUILD PASS:", audit["final"]["buildPass"])
print("TESTS PASS:", audit["final"]["testsPass"])
print("VERIFIED:", audit["final"]["verified"])
