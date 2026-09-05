#!/usr/bin/env bash
# Verify Personal AI is build-ready (unit tests; optional live acceptance if gateway up).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "==> Building packages..."
pnpm --filter @personal-ai/shared --filter @personal-ai/storage \
  --filter @personal-ai/orchestrator --filter @personal-ai/api build

echo "==> Unit tests..."
pnpm --filter @personal-ai/orchestrator test
pnpm --filter @personal-ai/storage exec node --test dist/path-utils.test.js 2>/dev/null || \
  pnpm --filter @personal-ai/storage test
pnpm --filter @personal-ai/api test

if curl -sf http://127.0.0.1:3001/health >/dev/null 2>&1; then
  echo "==> Live acceptance (gateway detected)..."
  pnpm --filter @personal-ai/api test:acceptance
else
  echo "==> Gateway not running — skip live acceptance (run: pnpm start:all)"
fi

echo ""
echo "READY — start with: pnpm start:all"
echo "  Web:     http://localhost:3000"
echo "  Gateway: http://localhost:3001/health"
echo "  Bharath: http://localhost:8000"
