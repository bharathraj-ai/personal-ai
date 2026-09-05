import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { hasPermission, Roles, Permissions } from "../rbac.js";
import { setupApp, loginAs } from "./harness.js";

let app;
let admin;
let teacher;
let student;

before(async () => {
  ({ app, admin, teacher, student } = await setupApp());
});

describe("rbac", () => {
  it("admin has manage_users; student does not", () => {
    assert.equal(hasPermission(Roles.ADMIN, Permissions.MANAGE_USERS), true);
    assert.equal(hasPermission(Roles.STUDENT, Permissions.MANAGE_USERS), false);
    assert.equal(hasPermission(Roles.STUDENT, Permissions.WRITE), false);
  });

  it("student cannot create students", async () => {
    const agent = await loginAs(app, student.email, "student-pass-1");
    const res = await agent.post("/api/students").send({
      name: "Blocked",
      email: `blocked-${Date.now()}@school.test`,
    });
    assert.equal(res.status, 403);
  });

  it("teacher cannot delete students", async () => {
    const adminAgent = await loginAs(app, admin.email, "admin-pass-1");
    const created = await adminAgent.post("/api/students").send({
      name: "Temp",
      email: `temp-rbac-${Date.now()}@school.test`,
    });
    const teacherAgent = await loginAs(app, teacher.email, "teacher-pass-1");
    const res = await teacherAgent.delete(`/api/students/${created.body.id}`);
    assert.equal(res.status, 403);
  });

  it("teacher cannot create teachers", async () => {
    const agent = await loginAs(app, teacher.email, "teacher-pass-1");
    const res = await agent.post("/api/teachers").send({
      name: "Nope",
      email: `nope-${Date.now()}@school.test`,
    });
    assert.equal(res.status, 403);
  });
});
