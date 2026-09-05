# Architecture

## Stage A — MVP ✅
Gateway, Bharath AI adapter, orchestrator loop, providers, secret vault stub, PWA chat.

## Stage B — Coding + Workspaces ✅ (local sandbox)
- `LocalWorkspaceManager` — isolated dirs under `sandbox/workspaces/`
- Real coding tools: create/read/edit/delete file, npm_install, run_build, run_tests, run_command, git_*
- Path traversal protection, command timeouts, 30-day expiry cleanup
- API: `POST/GET/DELETE /workspaces`, `/workspaces/:id/activate`, `/workspaces/:id/exec`
- Tasks: `GET /tasks/:id`, `POST /tasks/:id/cancel`
- Orchestrator: task IDs, event log, cancel, workspaceId injection
- PWA: Projects tab for workspace lifecycle

## Phase P2 — Evidence-grounded orchestration ✅
- `VerificationEngine` verifies claims, web/RAG evidence, tool results, and generated code
- Standard `Evidence` objects (web, document, memory, tool, code-test, runtime, provider)
- Internet flow: DuckDuckGo `search_web` → candidate ranking → `read_page`/`fetch_url` → verify
- Source quality is a retrieval preference, not proof; freshness is required for time-sensitive questions
- Policy: never present an unverified claim as verified; if evidence is insufficient, say so explicitly

## Phase P3 — Provider-routed execution + hard verification gates ✅
- `ProviderManager.selectFor` / `executeWithFallback` wired through Orchestrator (not chat-primary)
- Specialists (Groq / Gemini / Cerebras) declare capabilities; Bharath remains primary brain
- Hard gates: evidence-required UNCERTAIN/FAILED do not present drafts as facts; COMPLETE after VERIFY
- Coding: honest NO_TESTS / NOT_IMPLEMENTED outcomes; bounded auto-fix (max 3) with workspace-only patches
- Tool success ≠ claim verified (`not_verified`)

Swap `LocalWorkspaceManager` for E2B/Daytona later without changing tool names.

## Still planned
- Phase 4 HashiCorp Vault
- Phase 7 search API keys (Brave/Tavily)
- Phase 9–12 learning, audit, production hardening
- Container network lockdown (Docker-in-Docker / Firecracker) — not in P3
