#!/usr/bin/env python3
"""Drive school project to Level 4 completion with long provider-wait retries."""
import json
import os
import re
import shutil
import sys
import time
import urllib.error
import urllib.request

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:3001"
OUT = sys.argv[2] if len(sys.argv) > 2 else "/tmp/p20-complete-audit.json"
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
MAX_WAIT_RETRIES = int(os.environ.get("P20_MAX_RETRIES", "100"))
DEFAULT_WAIT_S = int(os.environ.get("P20_WAIT_S", "45"))
RESUME_PROJECT = os.environ.get("P20_PROJECT_ID")


def wait_for_gateway(max_s=120):
    deadline = time.time() + max_s
    while time.time() < deadline:
        try:
            req = urllib.request.Request(f"{BASE}/health", method="GET")
            with urllib.request.urlopen(req, timeout=5) as resp:
                if resp.status == 200:
                    return True
        except Exception:
            pass
        time.sleep(3)
    return False


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
        "tail": tail[-4000:],
    }


def is_level4(st):
    build_pass = bool(st.get("build") and "PASS" in st["build"].upper())
    tests_txt = st.get("tests") or ""
    tests_pass = bool(re.search(r"(\d+)/(\d+)", tests_txt) and "0/" not in tests_txt.split()[0])
    return build_pass and tests_pass and st.get("verified", 0) >= 7


def should_continue(st):
    if is_level4(st):
        return False
    if st.get("status") in ("waiting_provider",) or st.get("projectStatus") == "WAITING_FOR_PROVIDER":
        return True
    if st.get("verified", 0) < 7:
        return True
    if st.get("status") in ("in_progress", "completed", "awaiting_implementation_approval"):
        return True
    return False


def compute_wait(st):
    wait_s = DEFAULT_WAIT_S
    if st.get("retryAt"):
        try:
            from datetime import datetime, timezone

            target = datetime.fromisoformat(st["retryAt"].replace("Z", "+00:00"))
            delta = (target - datetime.now(timezone.utc)).total_seconds()
            wait_s = max(20, min(120, int(delta) + 5))
        except Exception:
            pass
    if st.get("provider") and ("429" in st["provider"] or "RATE" in st["provider"].upper()):
        wait_s = max(wait_s, 60)
    return wait_s


def save_audit(audit):
    with open(OUT, "w") as f:
        json.dump(audit, f, indent=2)


audit = {"base": BASE, "attempts": [], "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}

if not wait_for_gateway():
    audit["error"] = "gateway not reachable"
    save_audit(audit)
    print(json.dumps(audit, indent=2))
    sys.exit(2)

if RESUME_PROJECT:
    r = orch("Continue my project.", goal=GOAL, projectId=RESUME_PROJECT, timeout=7200)
    audit["attempts"].append({"step": "resume-existing", **parse_status(r)})
else:
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
save_audit(audit)

for i in range(MAX_WAIT_RETRIES):
    st = parse_status(r)
    print(
        f"\n--- attempt {i + 1}/{MAX_WAIT_RETRIES} --- "
        f"status={st['status']} build={st['build']} tests={st['tests']} verified={st['verified']}",
        flush=True,
    )
    if is_level4(st):
        print("LEVEL 4 achieved", flush=True)
        break
    if not should_continue(st):
        print(f"stopping: status={st['status']} verified={st['verified']}", flush=True)
        break

    wait_s = compute_wait(st)
    print(f"waiting {wait_s}s then continue project {project_id}", flush=True)
    time.sleep(wait_s)
    try:
        r = orch("Continue my project.", goal=GOAL, projectId=project_id, timeout=7200)
        st = parse_status(r)
        audit["attempts"].append({"step": f"continue-{i + 1}", **st})
        save_audit(audit)
    except urllib.error.HTTPError as e:
        audit["attempts"].append({"step": f"continue-{i + 1}", "httpError": e.code})
        save_audit(audit)
        if e.code in (429, 502, 503):
            time.sleep(90)
            continue
        break
    except Exception as ex:
        audit["attempts"].append({"step": f"continue-{i + 1}", "error": str(ex)})
        save_audit(audit)
        time.sleep(30)
        continue

final = parse_status(r)
audit["final"] = final

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

level4 = is_level4(final)
audit["level4"] = {
    "level": "4" if level4 else "3+",
    "score": 100 if level4 else 80,
    "pass": level4,
    "projectId": project_id,
    "workspaceId": workspace_id,
}

save_audit(audit)
print(json.dumps(audit["level4"], indent=2))
sys.exit(0 if level4 else 1)
