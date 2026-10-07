import { type Task, type AgentContext, type UserContext } from "@personal-ai/shared";
import type { ToolRegistry } from "@personal-ai/tools";
import type { ContextEngine } from "@personal-ai/memory";

export class ContextManager {
  constructor(
    private registry: ToolRegistry,
    private contextEngine?: ContextEngine
  ) {}

  async buildAgentContext(task: Task, userContext: UserContext): Promise<AgentContext> {
    let relevantMemory: any[] = [];
    if (this.contextEngine) {
      try {
        relevantMemory = await this.contextEngine.retrieveContext({
          userId: task.userId,
          query: task.goal,
          projectId: userContext.projectId ?? undefined,
          taskType: task.type,
          limit: 10,
        });
      } catch (err) {
        // "If memory fails: log failure -> continue task safely"
        console.error("ContextEngine retrieval failed:", err);
      }
    }

    return {
      task,
      user: userContext,
      availableTools: this.registry.listDefinitions(),
      permissions: [], // derive from user context
      previousObservations: [],
      environment: {
        memoryContext: relevantMemory
      },
    };
  }
}
