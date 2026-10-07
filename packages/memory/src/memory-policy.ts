import type { MemoryType } from "./memory-service.js";
import { detectSecrets } from "./secret-filter.js";

export interface MemoryPolicyResult {
  shouldStore: boolean;
  reason?: string;
  memoryType: MemoryType;
  importance: number;
  projectId?: string | null;
  ttl?: number; // Time to live in days, if applicable
}

export interface MemoryPolicyInput {
  content: string;
  source: string; // e.g. "user", "task_execution", "system"
  taskType?: string;
  projectId?: string | null;
}

export class MemoryPolicyEngine {
  evaluate(input: MemoryPolicyInput): MemoryPolicyResult {
    const secrets = detectSecrets(input.content);
    if (!secrets.safe) {
      return {
        shouldStore: false,
        reason: `Rejected by secret filter: ${secrets.reason}`,
        memoryType: "working",
        importance: 0
      };
    }

    if (input.content.trim().length < 5) {
      return {
        shouldStore: false,
        reason: "Content too short to be meaningful",
        memoryType: "working",
        importance: 0
      };
    }

    // Heuristics for determining memory type and importance
    const content = input.content.toLowerCase();

    // Profile Heuristics
    if (content.includes("i am") || content.includes("my name") || content.includes("i prefer") || content.includes("i like") || content.includes("i hate") || content.includes("my favorite")) {
      return {
        shouldStore: true,
        memoryType: "profile",
        importance: 0.9,
        projectId: null, // Profile is global
      };
    }

    // Career Heuristics
    if (content.includes("resume") || content.includes("graduated") || content.includes("career goal") || content.includes("lpa") || content.includes("interview preparation") || content.includes("offer from")) {
      return {
        shouldStore: true,
        memoryType: "career",
        importance: 0.9,
        projectId: null,
      };
    }

    // Episodic Heuristics (Events)
    if (content.includes("completed") || content.includes("finished") || content.includes("failed") || content.includes("fixed") || content.includes("deployed")) {
      return {
        shouldStore: true,
        memoryType: "episodic",
        importance: 0.6,
        projectId: input.projectId,
      };
    }

    // Working Heuristics (Temporary)
    if (content.includes("temporary") || content.includes("debugging") || content.includes("port occupied") || content.includes("console.log")) {
      return {
        shouldStore: true,
        memoryType: "working",
        importance: 0.2,
        projectId: input.projectId,
        ttl: 7 // Expire or cleanup after 7 days conceptually
      };
    }

    // Project Architecture / Semantic Fact
    if (input.projectId) {
      return {
        shouldStore: true,
        memoryType: "project",
        importance: 0.7,
        projectId: input.projectId,
      };
    }

    // General Semantic Fact
    return {
      shouldStore: true,
      memoryType: "semantic",
      importance: 0.5,
      projectId: null,
    };
  }
}
