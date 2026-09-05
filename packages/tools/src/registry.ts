import {
  ToolPermissionLevel,
  type ToolDefinition,
  type ToolResult,
} from "@personal-ai/shared";
import {
  PermissionDeniedError,
  PermissionManager,
  type PermissionApprovalFn,
  type PermissionManagerOptions,
} from "./permission-manager.js";

export interface ToolHandler {
  definition: ToolDefinition;
  execute(args: Record<string, unknown>): Promise<ToolResult>;
}

/**
 * Registry of tools exposed to the orchestrator and model.
 * Permission enforcement is centralized via PermissionManager —
 * HIGH_RISK tools require user approval before execute().
 */
export class ToolRegistry {
  private readonly tools = new Map<string, ToolHandler>();
  private readonly permissions: PermissionManager;

  constructor(permissionOptions: PermissionManagerOptions = {}) {
    this.permissions = new PermissionManager(permissionOptions);
  }

  get permissionManager(): PermissionManager {
    return this.permissions;
  }

  setApprovalHandler(handler: PermissionApprovalFn | undefined): void {
    this.permissions.setApprovalHandler(handler);
  }

  register(handler: ToolHandler): void {
    this.tools.set(handler.definition.name, handler);
  }

  get(name: string): ToolHandler | undefined {
    return this.tools.get(name);
  }

  listDefinitions(): ToolDefinition[] {
    return Array.from(this.tools.values()).map((t) => t.definition);
  }

  listByPermission(level: ToolPermissionLevel): ToolDefinition[] {
    return this.listDefinitions().filter((t) => t.permissionLevel === level);
  }

  async execute(name: string, args: Record<string, unknown>): Promise<ToolResult> {
    const tool = this.tools.get(name);
    if (!tool) {
      return { success: false, output: null, error: `Unknown tool: ${name}` };
    }

    try {
      await this.permissions.assertAllowed(tool.definition, args);
    } catch (err) {
      if (err instanceof PermissionDeniedError) {
        return { success: false, output: null, error: err.message };
      }
      throw err;
    }

    return tool.execute(args);
  }
}

export { PermissionDeniedError, PermissionManager };
export type { PermissionApprovalFn, PermissionManagerOptions };
