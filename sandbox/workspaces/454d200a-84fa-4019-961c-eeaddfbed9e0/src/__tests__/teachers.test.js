import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { setupApp, loginAs } from "./harness.js";

let app;
let admin;
let agent;

before(async () => {
  ({ app, admin } = await setupApp());
  agent = await loginAs(app, admin.email, "admin-pass-1");
});

describe("teacher CRUD", () => {
  it("creates, lists, updates, and deletes a teacher", async () => {
    const email = `tea-${Date.now()}@school.test`;
    const created = await agent.post("/api/teachers").send({ name: "Turing", email, subject: "CS" });
    assert.equal(created.status, 201);

    const listed = await agent.get("/api/teachers");
    assert.equal(listed.status, 200);
    assert.ok(listed.body.some((t) => t.id === created.body.id));

    const updated = await agent.put(`/api/teachers/${created.body.id}`).send({ subject: "Math" });
    assert.equal(updated.status, 200);
    assert.equal(updated.body.subject, "Math");

    const del = await agent.delete(`/api/teachers/${created.body.id}`);
    assert.equal(del.status, 204);
  });
});
