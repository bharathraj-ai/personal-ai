# Infrastructure

Placeholder for deployment configs. Add per-stage:

- **Stage A:** Docker Compose for API + Postgres (Neon in prod)
- **Stage B:** Sandbox provider credentials (E2B / Daytona)
- **Stage D:** Vault, rate limiting, monitoring

## Recommended services

| Concern | Recommendation |
|---|---|
| Database | Neon PostgreSQL + pgvector |
| Secrets | HashiCorp Vault or AWS Secrets Manager |
| Sandbox | E2B or Daytona |
| LLM routing | LiteLLM |
| Hosting | Fly.io, Railway, or self-hosted |
