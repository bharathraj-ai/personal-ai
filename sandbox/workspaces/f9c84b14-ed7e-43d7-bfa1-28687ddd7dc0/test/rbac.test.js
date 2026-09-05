import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { canAccess, ROLES, listPermissions } from "../src/rbac.js";

describe("school RBAC", () => {
  it("defines four roles", () => {
    assert.deepEqual(ROLES, ["Admin", "Teacher", "Student", "Parent"]);
  });
  it("admin can manage users", () => {
    assert.equal(canAccess("Admin", "manage_users"), true);
  });
  it("student cannot manage users", () => {
    assert.equal(canAccess("Student", "manage_users"), false);
  });
  it("teacher can manage attendance", () => {
    assert.equal(canAccess("Teacher", "manage_attendance"), true);
    assert.ok(listPermissions("Teacher").includes("manage_attendance"));
  });
});
