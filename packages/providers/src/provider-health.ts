import type { ProviderKeyManager } from "./provider-key-manager.js";
import type { ProviderManager } from "./provider-manager.js";

/** Combines key health with capability probes. /models healthy ≠ coding PASS. */
export class ProviderHealthManager {
  constructor(
    private readonly keys: ProviderKeyManager,
    private readonly providers: ProviderManager,
  ) {}

  snapshot() {
    const keys = this.keys.statusView();
    const tests = this.providers.getCapabilityTests();
    return {
      keys,
      bharathCapability: tests,
      note: "Health endpoints do not grant coding capability",
    };
  }
}
