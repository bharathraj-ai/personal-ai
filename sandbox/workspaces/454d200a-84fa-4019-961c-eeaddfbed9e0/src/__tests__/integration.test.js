import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { setupApp, loginAs } from "./harness.js";

let app;
let admin;

before(async () => {
  ({ app, admin } = await setupApp());
});

describe("integration flow", () => {
  it("login → dashboard → student → teacher → class → enroll → attendance → stats", async () => {
    const unauth = await (await import("supertest")).default(app).get("/api/dashboard/stats");
    assert.equal(unauth.status, 401);

    const agent = await loginAs(app, admin.email, "admin-pass-1");

    const emptyDash = await agent.get("/api/dashboard/stats");
    assert.equal(emptyDash.status, 200);
    assert.equal(typeof emptyDash.body.students, "number");
    assert.equal(typeof emptyDash.body.teachers, "number");
    assert.equal(typeof emptyDash.body.classes, "number");
    assert.equal(typeof emptyDash.body.attendance.total, "number");

    const student = await agent.post("/api/students").send({
      name: "Integration Student",
      email: `int-s-${Date.now()}@school.test`,
      grade: "8",
    });
    assert.equal(student.status, 201);

    const teacher = await agent.post("/api/teachers").send({
      name: "Integration Teacher",
      email: `int-t-${Date.now()}@school.test`,
      subject: "Science",
    });
    assert.equal(teacher.status, 201);

    const cls = await agent.post("/api/classes").send({ name: "Science 8" });
    assert.equal(cls.status, 201);

    const assigned = await agent
      .post(`/api/classes/${cls.body.id}/teacher`)
      .send({ teacherId: teacher.body.id });
    assert.equal(assigned.body.teacher_id, teacher.body.id);

    const enrolled = await agent
      .post(`/api/classes/${cls.body.id}/enroll`)
      .send({ studentId: student.body.id });
    assert.ok(enrolled.body.some((s) => s.id === student.body.id));

    const marked = await agent.post("/api/attendance").send({
      studentId: student.body.id,
      classId: cls.body.id,
      day: "2026-09-01",
      status: "present",
    });
    assert.equal(marked.status, 201);

    const dash = await agent.get("/api/dashboard/stats");
    assert.ok(dash.body.students >= 1);
    assert.ok(dash.body.teachers >= 1);
    assert.ok(dash.body.classes >= 1);
    assert.ok(dash.body.attendance.total >= 1);
    assert.ok(dash.body.attendance.present >= 1);

    const page = await agent.get("/dashboard.html");
    assert.equal(page.status, 200);
    assert.match(page.text, /\/api\/dashboard\/stats/);
  });
});
