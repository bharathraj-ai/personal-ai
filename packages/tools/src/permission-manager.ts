import { ToolPermissionLevel, type ToolDefinition } from "@personal-ai/shared";

/**
 * Central permission enforcement for tools.
 * ToolRegistry → PermissionManager → execute
 *
 * HIGH_RISK always requires an approval callback that returns true.
 */

export type PermissionApprovalFn = (ctx: {
  toolName: string;
  permissionLevel: ToolPermissionLevel;
  args: Record<string, unknown>;
  reason: string;
}) => Promise<boolean>;

export class PermissionDeniedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PermissionDeniedError";
  }
}

export interface PermissionManagerOptions {
  /**
   * Called for HIGH_RISK tools. Must return true to proceed.
   * If omitted, HIGH_RISK tools are always denied.
   */
  onApprovalRequired?: PermissionApprovalFn;
  /** Minimum level the caller is allowed to exercise (default: all). */
  maxAllowedLevel?: ToolPermissionLevel;
}

const LEVEL_RANK: Record<ToolPermissionLevel, number> = {
  [ToolPermissionLevel.READ]: 1,
  [ToolPermissionLevel.WRITE]: 2,
  [ToolPermissionLevel.EXECUTE]: 3,
  [ToolPermissionLevel.HIGH_RISK]: 4,
};

export class PermissionManager {
  constructor(private readonly options: PermissionManagerOptions = {}) {}

  setApprovalHandler(handler: PermissionApprovalFn | undefined): void {
    this.options.onApprovalRequired = handler;
  }

  /** Whether `required` is within the caller's maxAllowedLevel. */
  isLevelAllowed(required: ToolPermissionLevel): boolean {
    const max = this.options.maxAllowedLevel ?? ToolPermissionLevel.HIGH_RISK;
    return LEVEL_RANK[required] <= LEVEL_RANK[max];
  }

  /**
   * Enforce permission for a tool definition before execution.
   * Throws PermissionDeniedError or returns after HIGH_RISK approval.
   */
  async assertAllowed(
    definition: ToolDefinition,
    args: Record<string, unknown>,
  ): Promise<void> {
    const level = definition.permissionLevel;

    if (!this.isLevelAllowed(level)) {
      throw new PermissionDeniedError(
        `Permission denied: ${definition.name} requires ${level}`,
      );
    }

    if (level === ToolPermissionLevel.HIGH_RISK) {
      if (!this.options.onApprovalRequired) {
        throw new PermissionDeniedError(
          `HIGH_RISK tool ${definition.name} requires approval but no approval handler is configured`,
        );
      }
      const approved = await this.options.onApprovalRequired({
        toolName: definition.name,
        permissionLevel: level,
        args,
        reason: `HIGH_RISK tool requires approval: ${definition.name}`,
      });
      if (!approved) {
        throw new PermissionDeniedError(
          `User denied approval for HIGH_RISK tool: ${definition.name}`,
        );
      }
    }
  }

  /** Map a free-form command intent to a permission level (for HTTP /exec). */
  levelForWorkspaceExec(): ToolPermissionLevel {
    return ToolPermissionLevel.EXECUTE;
  }
}
