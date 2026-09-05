import { ToolPermissionLevel } from "@personal-ai/shared";
import type { CodingWorkspace } from "@personal-ai/coding-agent";
import type { MemoryService } from "@personal-ai/memory";
import type { RagService } from "@personal-ai/rag";
import { createCodingTools } from "./coding-tools.js";
import { createInternetTools } from "./internet-tools.js";
import { createKnowledgeTools } from "./knowledge-tools.js";
import { ToolRegistry } from "./registry.js";
import type { PermissionManagerOptions } from "./permission-manager.js";

export * from "./registry.js";
export * from "./permission-manager.js";
export * from "./internet-tools.js";
export * from "./coding-tools.js";
export * from "./knowledge-tools.js";
export * from "./pdf-reader.js";
export * from "./pdf-generator.js";
export * from "./image-generator.js";

export interface ToolsConfig {
  searchApiUrl?: string;
  searchApiKey?: string;
  /** CodingWorkspace contract — LocalWorkspaceManager or future cloud providers. */
  workspaces?: CodingWorkspace;
  getWorkspaceId?: () => string | undefined;
  getUserId?: () => string;
  getProjectId?: () => string | undefined;
  onWorkspaceCreated?: (workspaceId: string, projectName: string) => void;
  memory?: MemoryService;
  rag?: RagService;
  permissions?: PermissionManagerOptions;
}

/** Full tool surface. Coding tools need a CodingWorkspace; knowledge tools need memory/RAG. */
export function createDefaultTools(config: ToolsConfig = {}): ToolRegistry {
  const registry = new ToolRegistry(config.permissions ?? {});

  registry.register({
    definition: {
      name: "get_current_time",
      description: "Get the current date and time in ISO format",
      parameters: { type: "object", properties: {} },
      permissionLevel: ToolPermissionLevel.READ,
    },
    async execute() {
      return { success: true, output: { time: new Date().toISOString() } };
    },
  });

  for (const tool of createKnowledgeTools({
    memory: config.memory,
    rag: config.rag,
    getUserId: config.getUserId,
    getProjectId: config.getProjectId,
  })) {
    registry.register(tool);
  }

  for (const tool of createInternetTools({
    searchApiUrl: config.searchApiUrl,
    searchApiKey: config.searchApiKey,
  })) {
    registry.register(tool);
  }

  if (config.workspaces) {
    for (const tool of createCodingTools({
      workspaces: config.workspaces,
      getWorkspaceId: config.getWorkspaceId,
      getUserId: config.getUserId,
      onWorkspaceCreated: config.onWorkspaceCreated,
    })) {
      registry.register(tool);
    }
  }

  return registry;
}
