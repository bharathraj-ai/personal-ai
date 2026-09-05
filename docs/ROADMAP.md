# Development Phases — Implementation Tracker

Maps the complete project spec (Phases 1–12) to current implementation status.

| Phase | Scope | Status | Location |
|---|---|---|---|
| **1** | AI Gateway + own model adapter + basic chat | ✅ Done | `apps/api`, `apps/web`, `packages/ai-core` |
| **2** | Orchestrator + tool calling | ✅ Done | `packages/orchestrator`, `packages/tools` |
| **3** | Provider manager + fallback | ✅ Done | `packages/providers` |
| **4** | Secret vault + security layer | 🟡 Partial | `packages/security` (in-memory; Vault TBD) |
| **5** | Coding agent + local sandbox | ✅ Done | `packages/coding-agent`, real coding tools, `/workspaces` |
| **6** | Neon Postgres + pgvector memory/RAG | ✅ Done | `packages/db`, `packages/memory`, `packages/rag`, knowledge APIs + UI |
| **7** | Internet agent | 🟡 Partial | DuckDuckGo search + page fetch; Brave/Tavily optional |
| **P2** | Evidence-grounded orchestration + VerificationEngine | ✅ Done | `packages/orchestrator/src/verification`, claim-to-evidence, source quality/freshness |
| **P3** | Provider-routed specialists + hard verification gates + auto-fix | ✅ Done | `ProviderManager.selectFor`/`executeWithFallback`, fail-closed policy, CodingAgent auto-fix |
| **Full** | End-to-end Product path (Project O, school mgmt, storage, approval UI) | 🟡 Partial | Clarify→plan→approve→bootstrap; local-file storage; session store |
| **8** | (merged into Phase 6) Memory + RAG | ✅ Done | see Phase 6 |
| **9** | Learning/feedback pipeline | 🟡 Partial | `packages/memory/learning-pipeline.ts` |
| **10** | Mobile UI + workspace lifecycle | 🟡 Partial | Chat, Memory, Docs, Projects, Spaces, Status |
| **11** | Usage dashboard + audit logs | 🟡 Partial | `packages/audit`, migration `003_audit_s3_artifacts.sql`, `/audit` route |
| **12** | Production hardening + S3 persistence | 🟡 Partial | `packages/storage`, `/storage/*`, `/projects/sync|restore` |

## Own model

- **Primary:** Bharath AI (`BharathModelAdapter`) — no dependency on Qwen/Llama/Mistral/etc.
- **Swappable:** `OWN_MODEL_ADAPTER` env selects adapter type.

## Knowledge layer (Phase 6)

- **DB:** Neon PostgreSQL + pgvector via `DATABASE_URL` (`@personal-ai/db`)
- **Fallback:** In-memory memory/RAG when `DATABASE_URL` is unset
- **Embeddings:** `EmbeddingProvider` (local-hash 384-d default, or HTTP)
- **Orchestrator tools:** `search_memory`, `save_memory`, `search_documents`, `get_project_context`
- **Security:** Secret rejection before store; untrusted RAG wrapping; user/project scoping

## Tool surface

| Level | Tools |
|---|---|
| READ | `search_memory`, `search_documents`, `get_project_context`, `fetch_url`, `read_page`, `extract_links`, `search_web`, `get_current_time`, `read_file` |
| WRITE | `save_memory`, `create_file`, `edit_file` |
| EXECUTE | `run_tests`, `npm_install` |
| HIGH_RISK | `delete_file`, `push_git`, `access_secret` |

## API endpoints

| Method | Path | Phase |
|---|---|---|
| POST | `/chat`, `/chat/stream` | 1 (+ persistence/context in 6) |
| POST | `/orchestrate` | 2 |
| GET | `/health` | 1 (+ db/embeddings in 6) |
| GET | `/system/status` | 10 |
| GET/POST/DELETE | `/memory`, `/memory/search`, `/memory/:id` | 6 |
| GET/POST/DELETE | `/documents`, `/documents/:id` | 6 |
| POST | `/rag/search` | 6 |
| GET/POST/PATCH/DELETE | `/projects`, `/projects/:id` | 6 |
| GET/POST | `/workspaces` | 5 |
| GET/POST | `/approvals` | 4 |

## Next implementation priorities

1. **Phase 4** — HashiCorp Vault wrapper replacing in-memory store
2. **Phase 7** — Connect Brave/Tavily search API via secret vault
3. **Phase 9** — Stronger learning/feedback with user approval UI
4. **Phase 11–12** — Audit logs + production hardening

P3 complete — stop here for provider routing / hard gates / auto-fix.

## Design invariants (never violate)

- Own model = brain; external APIs = optional specialists
- Secrets never in prompts, RAG, logs, or training data
- HIGH_RISK tools require explicit approval
- Generated code never runs on production host
- No API-key rotation to bypass provider limits
- Never present an unverified claim as verified; if evidence is insufficient, say so
- Memory/RAG queries always scoped by authenticated user (+ optional project)
- Specialists are capability workers only; Bharath AI is the primary brain
- NO_TESTS / NOT_IMPLEMENTED must never be reported as PASSED
