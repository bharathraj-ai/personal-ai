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

describe("class operations", () => {
  it("creates a class, assigns a teacher, and enrolls a student", async () => {
    const teacher = await agent.post("/api/teachers").send({
      name: "Class Teacher",
      email: `ct-${Date.now()}@school.test`,
      subject: "History",
    });
    const student = await agent.post("/api/students").send({
      name: "Class Student",
      email: `cs-${Date.now()}@school.test`,
      grade: "9",
    });
    const cls = await agent.post("/api/classes").send({ name: "Year 9 History" });
    assert.equal(cls.status, 201);

    const assigned = await agent
      .post(`/api/classes/${cls.body.id}/teacher`)
      .send({ teacherId: teacher.body.id });
    assert.equal(assigned.status, 200);
    assert.equal(assigned.body.teacher_id, teacher.body.id);

    const enrolled = await agent
      .post(`/api/classes/${cls.body.id}/enroll`)
      .send({ studentId: student.body.id });
    assert.equal(enrolled.status, 200);
    assert.ok(enrolled.body.some((s) => s.id === student.body.id));

    const listed = await agent.get(`/api/classes/${cls.body.id}/students`);
    assert.equal(listed.status, 200);
    assert.equal(listed.body.length, 1);
  });
});
