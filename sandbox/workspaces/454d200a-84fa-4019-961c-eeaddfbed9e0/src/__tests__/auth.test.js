import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { setupApp, loginAs, request } from "./harness.js";

let app;
let admin;
let student;

before(async () => {
  ({ app, admin, student } = await setupApp());
});

describe("authentication", () => {
  it("rejects missing credentials", async () => {
    const res = await request(app).post("/api/auth/login").send({});
    assert.equal(res.status, 400);
  });

  it("rejects invalid password", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: admin.email, password: "wrong" });
    assert.equal(res.status, 401);
  });

  it("logs in and returns session user", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: admin.email, password: "admin-pass-1" });
    assert.equal(res.status, 200);
    assert.equal(res.body.email, admin.email);
    assert.equal(res.body.role, "admin");
    assert.equal(res.body.password_hash, undefined);
  });

  it("protects /api/auth/me without a session", async () => {
    const res = await request(app).get("/api/auth/me");
    assert.equal(res.status, 401);
  });

  it("returns current user and supports logout", async () => {
    const agent = await loginAs(app, student.email, "student-pass-1");
    const me = await agent.get("/api/auth/me");
    assert.equal(me.status, 200);
    assert.equal(me.body.email, student.email);
    const out = await agent.post("/api/auth/logout");
    assert.equal(out.status, 200);
    const after = await agent.get("/api/auth/me");
    assert.equal(after.status, 401);
  });
});
