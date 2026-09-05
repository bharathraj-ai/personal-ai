#!/usr/bin/env python3
"""P16 live REST acceptance — honest evidence, VERIFIED gate required."""
import json
import re
import sys
import urllib.request

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:3016"
OUT = sys.argv[2] if len(sys.argv) > 2 else "/tmp/p16-rest-audit.json"
TOKEN = "dev-token"
GOAL = "Create a small REST API with one endpoint and a real automated behavioral test."

FORBIDDEN_WS_PREFIXES = (
    "b0a22cdb", "d5f797b3", "f67fffd8", "b8617bee", "454d200a", "562e2c49",
    "8a89fe15",  # P15 workspace — do not reuse
)


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
                    if f": {s}" in text or text.endswith(s):
                        status = s
                        break
                if ": " in text:
                    name, rest = text.split(": ", 1)
                    m = re.match(r"^(VERIFIED|PARTIAL|FAILED|NOT_TESTED)\s*\|\s*", rest)
                    if m:
                        status = m.group(1)
                        rest = rest[m.end():]
                    elif rest.split()[0] in ("VERIFIED", "PARTIAL", "FAILED", "NOT_TESTED"):
                        status = rest.split()[0]
                rows.append({"requirement": text, "status": status})
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
    no_tests = "NO_TESTS" in tail or (tests and "NO_TESTS" in tests)
    req_matrix = parse_requirement_matrix(tail)
    verified_rows = [x for x in req_matrix if x["status"] == "VERIFIED"]
    partial_rows = [x for x in req_matrix if x["status"] == "PARTIAL"]

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
        "buildPass": bool(build and re.search(r"\bPASS\b", build, re.I) and "FAIL" not in build.upper()),
        "testsPass": bool(
            tests
            and not no_tests
            and (
                re.search(r"\bPASS\b", tests, re.I)
                or re.search(r"\d+/\d+", tests)
                or "PASSED" in tests.upper()
            )
            and "FAIL" not in tests.upper()
        ),
        "requirementMatrix": req_matrix,
        "requirementVerified": len(verified_rows) > 0 and len(partial_rows) == 0,
        "repairHistory": (r.get("projectPlan") or {}).get("implementationProgress", {}).get("repairHistory"),
        "finalResponseTail": tail[-2500:],
    }
    audit["steps"].append(entry)
    print(f"\n=== {label} ===")
    print("status:", entry["status"], "projectStatus:", entry["projectStatus"])
    print("workspace:", entry["workspaceId"], "project:", entry["projectId"])
    print("obs ws:", obs_ws)
    print("build:", entry["build"], "tests:", entry["tests"])
    print("requirement matrix:", req_matrix)
    print("requirementVerified:", entry["requirementVerified"])
    return r


audit = {"goal": GOAL, "base": BASE, "phase": "P16-REST", "steps": []}

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
reused_forbidden = any(ws.startswith(p) for p in FORBIDDEN_WS_PREFIXES)

audit["final"] = {
    "status": r.get("status"),
    "projectStatus": r.get("projectStatus"),
    "workspaceId": ws,
    "projectId": r.get("projectId"),
    "buildPass": last.get("buildPass"),
    "testsPass": last.get("testsPass"),
    "noTests": last.get("noTests"),
    "requirementVerified": last.get("requirementVerified"),
    "requirementMatrix": last.get("requirementMatrix"),
    "gatePass": (
        last.get("buildPass")
        and last.get("testsPass")
        and not last.get("noTests")
        and last.get("requirementVerified")
        and not reused_forbidden
    ),
    "reusedForbiddenWorkspace": reused_forbidden,
}

with open(OUT, "w") as f:
    json.dump(audit, f, indent=2)
print(f"\nWrote {OUT}")
print("BUILD PASS:", audit["final"]["buildPass"])
print("TESTS PASS:", audit["final"]["testsPass"])
print("REQUIREMENT VERIFIED:", audit["final"]["requirementVerified"])
print("REST GATE PASS:", audit["final"]["gatePass"])
sys.exit(0 if audit["final"]["gatePass"] else 1)
