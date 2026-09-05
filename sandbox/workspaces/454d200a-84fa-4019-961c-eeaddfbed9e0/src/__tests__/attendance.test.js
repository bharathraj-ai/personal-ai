import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { setupApp, loginAs } from "./harness.js";

let app;
let admin;
let agent;
let studentId;
let classId;

before(async () => {
  ({ app, admin } = await setupApp());
  agent = await loginAs(app, admin.email, "admin-pass-1");
  const student = await agent.post("/api/students").send({
    name: "Attendee",
    email: `att-${Date.now()}@school.test`,
  });
  const cls = await agent.post("/api/classes").send({ name: "Attendance Class" });
  studentId = student.body.id;
  classId = cls.body.id;
});

describe("attendance", () => {
  it("marks, rejects duplicates, updates, and retrieves records", async () => {
    const day = "2026-08-30";
    const marked = await agent.post("/api/attendance").send({
      studentId,
      classId,
      day,
      status: "present",
    });
    assert.equal(marked.status, 201);

    const dup = await agent.post("/api/attendance").send({
      studentId,
      classId,
      day,
      status: "absent",
    });
    assert.equal(dup.status, 409);

    const updated = await agent.put(`/api/attendance/${marked.body.id}`).send({ status: "late" });
    assert.equal(updated.status, 200);
    assert.equal(updated.body.status, "late");

    const listed = await agent.get(`/api/attendance?studentId=${studentId}&classId=${classId}`);
    assert.equal(listed.status, 200);
    assert.ok(listed.body.some((r) => r.id === marked.body.id && r.status === "late"));
  });

  it("rejects invalid status", async () => {
    const res = await agent.post("/api/attendance").send({
      studentId,
      classId,
      day: "2026-08-31",
      status: "maybe",
    });
    assert.equal(res.status, 400);
  });
});
