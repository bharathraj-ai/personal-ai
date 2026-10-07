# CLEANUP_REVIEW

The following files have been identified as potentially obsolete (old Phase 1 orchestration scaffolding), but were NOT deleted because they are still imported by active frontend or test files. 

### 1. `apps/api/src/routes/chat.ts`
- **Reason for Uncertainty**: This file implements the legacy monolith `/chat/stream` endpoint. It uses many of the old orchestrator internals (`Orchestrator`, etc.). 
- **Why Retained**: The frontend (`apps/web/src/app/page.tsx`) explicitly relies on `/chat/stream` for its interface. Deleting this route would instantly break the UI, violating the "DO NOT DELETE WORKING CODE" and "Only provide minimum integration required" rules.

### 2. `apps/api/src/routes/workspaces.ts`
- **Reason for Uncertainty**: Imports the legacy `Orchestrator` type.
- **Why Retained**: Still used by workspace endpoints which the frontend calls to manage local sandboxes.

### 3. `packages/orchestrator/src/orchestrator.ts`
- **Reason for Uncertainty**: This is the massive 105KB monolithic orchestrator that was completely replaced by `MasterOrchestrator` in Phase 1's modular architecture.
- **Why Retained**: It is still actively imported and relied upon by `apps/api/src/routes/chat.ts`, `apps/api/src/routes/workspaces.ts`, and multiple tests. Removing it requires completely refactoring the frontend to stop using `/chat/stream` and move completely to the new `/tasks` endpoints.

### 4. `apps/web/src/app/page.tsx`
- **Reason for Uncertainty**: Serves as the UI for the legacy `/chat/stream` interactions.
- **Why Retained**: It's the only web interface currently active.

### 5. `apps/api/src/services/orchestration-session.ts`
- **Reason for Uncertainty**: This file is tightly coupled to the old legacy `Orchestrator` session format.
- **Why Retained**: It is required by `chat.ts`.
