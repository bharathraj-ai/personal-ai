# Personal AI Orchestrator

A model-agnostic, secure, mobile-first personal AI system. Your own model is the brain; external providers are optional specialist workers; the orchestrator plans, executes, verifies, and retries every task.

## Architecture

```
Phone / Web (PWA) → AI Gateway → Orchestrator → Own Model + Tools
                                              → Secret Vault
                                              → Cloud Sandbox (Stage B)
                                              → Memory/RAG (Stage C)
```

## Quick Start

### Prerequisites

- Node.js 20+
- pnpm 9+
- **Bharath AI** running locally (`/home/bharath/Documents/model` — your own model)

### Setup

```bash
cd personal-ai
pnpm install
```

### Start everything (one command)

```bash
pnpm start:all
```

Starts Bharath AI (`:8000`), AI Gateway (`:3001`), and Web PWA (`:3000`).  
Logs go to `.run-logs/`. Ctrl+C stops all three.

Or manually in separate terminals:

```bash
# Bharath AI (no make required)
cd /home/bharath/Documents/model
.venv/bin/python -m uvicorn api.main:app --host 0.0.0.0 --port 8000

# Gateway
cd personal-ai
pnpm --filter @personal-ai/api dev

# Web
pnpm --filter @personal-ai/web dev
```

Open http://localhost:3000 on your phone or desktop.

### Bharath AI (default own model)

The gateway connects to your Bharath AI server at `http://localhost:8000` via the `BharathModelAdapter`. No Ollama or third-party models required.

```bash
# In /home/bharath/Documents/model
make serve          # starts FastAPI on :8000
# Load weights if needed via /api/training/load
```

Gateway env (`apps/api/.env`):
```
OWN_MODEL_ADAPTER=bharath
BHARATH_AI_URL=http://localhost:8000
```

## Project Structure

```
personal-ai/
├── apps/
│   ├── web/          # Next.js PWA (mobile-first UI)
│   └── api/          # Fastify AI Gateway
├── packages/
│   ├── orchestrator/ # Plan → Execute → Observe → Verify loop
│   ├── ai-core/      # ModelAdapter + Bharath AI adapter (default)
│   ├── providers/    # Provider manager (own model + specialists)
│   ├── tools/        # Tool registry with permission levels
│   ├── security/     # Secret vault wrapper
│   ├── memory/       # Personal memory (Stage C)
│   ├── rag/          # Document RAG (Stage C)
│   ├── coding-agent/ # Cloud coding (Stage B)
│   └── shared/       # Shared types
├── workers/          # Background workers (Stage B/C)
├── infrastructure/   # Schema, deployment configs
└── docs/             # Architecture docs
```

## Build Stages

| Stage | Status | Scope |
|---|---|---|
| **A — MVP** | ✅ Scaffolded | Gateway, ModelAdapter, orchestrator loop, 3 tools, secret vault stub, PWA chat |
| **B — Coding** | 🔲 Planned | Cloud sandbox, coding agent, verification pipeline |
| **C — Knowledge** | 🔲 Planned | Internet agent, memory, RAG, learning pipeline |
| **D — Hardening** | 🔲 Planned | Workspace lifecycle, audit logs, production security |

## Core Contracts

### ModelAdapter (never bypass)

```typescript
interface ModelAdapter {
  generate(options): Promise<GenerateResult>;
  stream(options): AsyncIterable<StreamChunk>;
  healthCheck(): Promise<HealthStatus>;
  getUsage(): Promise<TokenUsage>;
}
```

### Orchestrator Loop

```
Goal → Plan → Execute → Observe → Verify → Retry/Fix → Result
```

### Tool Permission Levels

| Level | Requires Approval |
|---|---|
| READ | No |
| WRITE | No |
| EXECUTE | No |
| HIGH_RISK | **Always** |

## API Endpoints

| Method | Path | Description |
|---|---|---|
| GET | `/health` | Gateway + model health |
| POST | `/chat` | Direct model chat |
| POST | `/chat/stream` | Streaming chat (SSE) |
| POST | `/orchestrate` | Full orchestrator loop |

## Design Principles

- **Own model = brain** — conversation, planning, tool selection
- **Orchestrator = manager** — never assume success, always verify
- **Evidence-first answers** — never present an unverified claim as verified; if evidence is insufficient, say so
- **External APIs = optional specialists** — never the default path
- **Secrets never reach the model** — placeholder tokens only
- **Model layer is swappable** — no hard-coded model family assumptions

## License

Private — not for public distribution.
# personal-ai
