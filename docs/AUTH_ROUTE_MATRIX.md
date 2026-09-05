# Route authorization matrix (Phase P0)

## Public

| Method | Path | Notes |
|--------|------|-------|
| GET | `/health` | Gateway + model health only |

## Authenticated (Bearer token)

| Method | Path | Notes |
|--------|------|-------|
| POST | `/chat` | userId from auth |
| POST | `/chat/stream` | userId from auth |
| POST | `/orchestrate` | userId from auth |
| POST | `/search` | DuckDuckGo |
| GET/POST/DELETE | `/memory*` | scoped to auth.userId |
| GET/POST/DELETE | `/documents*` | scoped to auth.userId |
| POST | `/rag/search` | scoped to auth.userId |
| GET/POST/PATCH/DELETE | `/projects*` | scoped to auth.userId |
| GET/POST/DELETE | `/workspaces*` | ownership enforced |
| POST | `/workspaces/:id/activate` | ownership |
| POST | `/workspaces/:id/exec` | auth + ownership + EXECUTE permission |
| GET/POST | `/tasks*` | owner-only |
| GET/POST | `/context` | auth.userId only |
| GET | `/system/status` | includes real sandboxProvider |
| GET | `/system/laptop` | telemetry |
| GET | `/providers` | |
| GET/POST | `/approvals*` | |
| GET | `/health/secrets` | vault ids only |

## HIGH_RISK (approval required via PermissionManager)

- `delete_file`
- `push_git`
- future: `deploy`, `access_secret`

## Identity rule

**AUTHENTICATED USER ID ≠ CLIENT-SUPPLIED userId**

Client `userId` in body/query is ignored as authority (403 if mismatched).

## Workspace rule

**LOCAL WORKSPACE ≠ CLOUD SANDBOX**

`sandboxProvider` reports `self-hosted`. Path boundary + timeout only.
