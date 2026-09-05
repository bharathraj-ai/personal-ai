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

describe("student CRUD", () => {
  it("rejects invalid create payload", async () => {
    const res = await agent.post("/api/students").send({ name: "" });
    assert.equal(res.status, 400);
  });

  it("creates, lists, gets, updates, and deletes a student", async () => {
    const email = `stu-${Date.now()}@school.test`;
    const created = await agent.post("/api/students").send({ name: "Ada", email, grade: "10" });
    assert.equal(created.status, 201);
    assert.equal(created.body.email, email);

    const listed = await agent.get("/api/students");
    assert.equal(listed.status, 200);
    assert.ok(listed.body.some((s) => s.id === created.body.id));

    const got = await agent.get(`/api/students/${created.body.id}`);
    assert.equal(got.status, 200);
    assert.equal(got.body.name, "Ada");

    const updated = await agent.put(`/api/students/${created.body.id}`).send({ grade: "11" });
    assert.equal(updated.status, 200);
    assert.equal(updated.body.grade, "11");

    const del = await agent.delete(`/api/students/${created.body.id}`);
    assert.equal(del.status, 204);

    const missing = await agent.get(`/api/students/${created.body.id}`);
    assert.equal(missing.status, 404);
  });
});
