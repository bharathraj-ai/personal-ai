import { type Task, type Agent, TaskClassification } from "@personal-ai/shared";

export class AgentRegistry {
  private agents = new Map<string, Agent>();

  register(agent: Agent): void {
    if (this.agents.has(agent.id)) {
      throw new Error(`Agent ${agent.id} is already registered`);
    }
    this.agents.set(agent.id, agent);
  }

  get(id: string): Agent | undefined {
    return this.agents.get(id);
  }

  getAll(): Agent[] {
    return Array.from(this.agents.values());
  }
}

export class AgentRouter {
  constructor(private registry: AgentRegistry) {}

  async route(task: Task): Promise<{ agent?: Agent; reason: string }> {
    const agents = this.registry.getAll();
    if (agents.length === 0) {
      return { reason: "No agents registered, falling back to core orchestrator" };
    }

    // 1. Check if any agent claims it can handle the task definitively.
    const candidates: Agent[] = [];
    for (const agent of agents) {
      if (await agent.canHandle(task)) {
        candidates.push(agent);
      }
    }

    if (candidates.length === 1) {
      return { agent: candidates[0], reason: `Task explicitly matched agent: ${candidates[0].name}` };
    }

    if (candidates.length > 1) {
      // Tie breaker based on classification
      const specific = candidates.find(a => this.isSpecificMatch(a, task.type));
      if (specific) {
        return { agent: specific, reason: `Multiple agents matched, selected ${specific.name} based on task type ${task.type}` };
      }
      return { agent: candidates[0], reason: `Multiple matches, defaulting to ${candidates[0].name}` };
    }

    return { reason: "No agent matched the task, falling back to core orchestrator" };
  }

  private isSpecificMatch(agent: Agent, type: TaskClassification): boolean {
    if (type === TaskClassification.CODING && agent.capabilities.includes("coding")) return true;
    if (type === TaskClassification.RESEARCH && agent.capabilities.includes("research")) return true;
    return false;
  }
}
