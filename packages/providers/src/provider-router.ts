import type { ProviderManager, RoutedTask } from "./provider-manager.js";

export type RouterTask =
  | "CHAT"
  | "PLANNING"
  | "CODING"
  | "CODE_REVIEW"
  | "VERIFICATION"
  | "REPAIR"
  | "SUMMARIZATION"
  | "STRUCTURED_GENERATION";

/** Thin task map — selection still goes through ProviderManager (capability + health + keys). */
export class ProviderRouter {
  constructor(private readonly manager: ProviderManager) {}

  async selectProviderForTask(task: RouterTask) {
    const mapped: RoutedTask =
      task === "CHAT" || task === "PLANNING" || task === "SUMMARIZATION"
        ? "chat"
        : task === "CODE_REVIEW"
          ? "code_review"
          : task === "VERIFICATION"
            ? "verification"
            : "complex_coding";
    return this.manager.selectForTask(mapped);
  }
}
