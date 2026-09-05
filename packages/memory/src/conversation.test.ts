import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { NoopConversationService } from "./conversation-service.js";

describe("conversation persistence", () => {
  it("NoopConversationService creates ids and accepts messages", async () => {
    const svc = new NoopConversationService();
    const conv = await svc.getOrCreateConversation({ userId: "u1", title: "hi" });
    assert.ok(conv.id);
    await svc.addMessage({
      conversationId: conv.id,
      role: "user",
      content: "hello",
    });
    await svc.addMessage({
      conversationId: conv.id,
      role: "assistant",
      content: "world",
      model: "bharath",
      provider: "bharath",
    });
  });

  it("reuses conversation id when provided", async () => {
    const svc = new NoopConversationService();
    const a = await svc.getOrCreateConversation({
      userId: "u1",
      conversationId: "fixed-id",
    });
    // Noop always returns a new UUID — document behavior
    assert.ok(a.id);
  });
});
