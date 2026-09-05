#!/usr/bin/env bash
# Start all Personal AI services with one command:
#   Bharath AI  :8000
#   AI Gateway  :3001
#   Web PWA     :3000
#
# Usage (from personal-ai/):
#   pnpm start:all
#   ./scripts/start-all.sh

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MODEL_DIR="${BHARATH_MODEL_DIR:-/home/bharath/Documents/model}"
LOG_DIR="${ROOT}/.run-logs"
mkdir -p "$LOG_DIR"

PIDS=()

cleanup() {
  echo ""
  echo "==> Stopping all services..."
  for pid in "${PIDS[@]:-}"; do
    if kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
      wait "$pid" 2>/dev/null || true
    fi
  done
  # Also stop anything we launched on these ports (best-effort)
  for port in 8000 3001 3000; do
    if command -v fuser >/dev/null 2>&1; then
      fuser -k "${port}/tcp" >/dev/null 2>&1 || true
    fi
  done
  echo "Done."
}
trap cleanup EXIT INT TERM

port_busy() {
  local port="$1"
  if command -v ss >/dev/null 2>&1; then
    ss -ltn "sport = :${port}" 2>/dev/null | grep -q ":${port}"
  elif command -v lsof >/dev/null 2>&1; then
    lsof -iTCP:"${port}" -sTCP:LISTEN >/dev/null 2>&1
  else
    return 1
  fi
}

wait_http() {
  local url="$1"
  local name="$2"
  local tries="${3:-40}"
  for ((i = 1; i <= tries; i++)); do
    if curl -sf "$url" >/dev/null 2>&1; then
      echo "    ${name} ready"
      return 0
    fi
    sleep 0.5
  done
  echo "    warning: ${name} not responding yet (${url})"
  return 0
}

echo "========================================"
echo " Personal AI — start all"
echo "========================================"
echo "Root:  ${ROOT}"
echo "Model: ${MODEL_DIR}"
echo ""

# ——— JS deps ———
cd "$ROOT"
if [[ ! -d node_modules ]] || [[ ! -e node_modules/typescript && ! -d node_modules/typescript ]]; then
  echo "==> pnpm install..."
  pnpm install
fi

# Ensure env files exist
[[ -f apps/api/.env ]] || cp apps/api/.env.example apps/api/.env
[[ -f apps/web/.env.local ]] || cp apps/web/.env.example apps/web/.env.local

# ——— Bharath AI :8000 ———
echo "==> Bharath AI (:8000)"
if port_busy 8000; then
  echo "    already listening on :8000"
else
  if [[ ! -d "$MODEL_DIR" ]]; then
    echo "    ERROR: model dir not found: ${MODEL_DIR}"
    echo "    Set BHARATH_MODEL_DIR or install Bharath AI."
    exit 1
  fi

  # Prefer a working model venv; otherwise use a writable local venv under personal-ai.
  # (The stock /home/bharath/Documents/model/.venv is often root-owned / missing pip.)
  LOCAL_VENV="${ROOT}/.run/bharath-venv"
  PY=""

  if [[ -x "${MODEL_DIR}/.venv/bin/python" ]] \
    && "${MODEL_DIR}/.venv/bin/python" -m pip --version >/dev/null 2>&1; then
    PY="${MODEL_DIR}/.venv/bin/python"
    echo "    using ${MODEL_DIR}/.venv"
  else
    echo "    model .venv missing/broken pip — using ${LOCAL_VENV}"
    if [[ ! -x "${LOCAL_VENV}/bin/python" ]] \
      || ! "${LOCAL_VENV}/bin/python" -m pip --version >/dev/null 2>&1; then
      rm -rf "${LOCAL_VENV}"
      python3 -m venv --upgrade-deps "${LOCAL_VENV}"
    fi
    PY="${LOCAL_VENV}/bin/python"
  fi

  if ! "$PY" -m pip --version >/dev/null 2>&1; then
    echo "    ERROR: no working pip"
    echo "    Try:"
    echo "      python3 -m venv --upgrade-deps ${LOCAL_VENV}"
    echo "      ${LOCAL_VENV}/bin/python -m pip install -r ${MODEL_DIR}/requirements.txt"
    exit 1
  fi

  if ! "$PY" -c "import uvicorn, fastapi" >/dev/null 2>&1; then
    echo "    installing Python deps (this may take a few minutes)..."
    "$PY" -m pip install -U pip
    if [[ -f "${MODEL_DIR}/requirements.txt" ]]; then
      "$PY" -m pip install -r "${MODEL_DIR}/requirements.txt"
    else
      "$PY" -m pip install fastapi "uvicorn[standard]"
    fi
  fi

  (
    cd "$MODEL_DIR"
    # Ensure model package imports resolve
    export PYTHONPATH="${MODEL_DIR}${PYTHONPATH:+:$PYTHONPATH}"
    exec "$PY" -m uvicorn api.main:app --host 0.0.0.0 --port 8000
  ) >"${LOG_DIR}/bharath.log" 2>&1 &
  PIDS+=($!)
  echo "    pid ${PIDS[-1]}  log: ${LOG_DIR}/bharath.log"
  wait_http "http://127.0.0.1:8000/api/health" "Bharath AI" 60 || true
  if ! curl -sf "http://127.0.0.1:8000/api/health" >/dev/null 2>&1; then
    wait_http "http://127.0.0.1:8000/" "Bharath AI" 20 || true
  fi
fi

# ——— Gateway :3001 ———
echo "==> AI Gateway (:3001)"
if port_busy 3001; then
  echo "    already listening on :3001"
else
  (
    cd "$ROOT"
    exec pnpm --filter @personal-ai/api dev
  ) >"${LOG_DIR}/gateway.log" 2>&1 &
  PIDS+=($!)
  echo "    pid ${PIDS[-1]}  log: ${LOG_DIR}/gateway.log"
  wait_http "http://127.0.0.1:3001/health" "Gateway" 60
fi

# ——— Web :3000 ———
echo "==> Web PWA (:3000)"
if port_busy 3000; then
  echo "    already listening on :3000"
else
  (
    cd "$ROOT"
    exec pnpm --filter @personal-ai/web dev
  ) >"${LOG_DIR}/web.log" 2>&1 &
  PIDS+=($!)
  echo "    pid ${PIDS[-1]}  log: ${LOG_DIR}/web.log"
  wait_http "http://127.0.0.1:3000/" "Web" 80
fi

echo ""
echo "========================================"
echo " Running"
echo "  Web:      http://localhost:3000"
echo "  Gateway:  http://localhost:3001/health"
echo "  Bharath:  http://localhost:8000"
echo "  Auth:     Authorization: Bearer ${AUTH_DEV_TOKEN:-dev-token}"
echo "  Logs:     ${LOG_DIR}/"
echo "========================================"
echo "Ctrl+C stops all services."
echo ""

# Keep attached so Ctrl+C cleans up
wait
