import request from "supertest";
import { createApp } from "../server.js";
import { register } from "../store.js";
import { closePool as closeDb } from "../db.js";

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

export async function setupApp() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required for tests");
  }
  const app = await createApp();
  const admin = await register({
    email: `admin-${suffix}@school.test`,
    password: "admin-pass-1",
    name: "Admin",
    role: "admin",
  });
  const teacher = await register({
    email: `teacher-${suffix}@school.test`,
    password: "teacher-pass-1",
    name: "Teacher",
    role: "teacher",
  });
  const student = await register({
    email: `student-${suffix}@school.test`,
    password: "student-pass-1",
    name: "Student",
    role: "student",
  });
  return { app, admin, teacher, student, suffix };
}

export async function loginAs(app, email, password) {
  const agent = request.agent(app);
  const res = await agent.post("/api/auth/login").send({ email, password });
  if (res.status !== 200) {
    throw new Error(`login failed ${res.status} ${JSON.stringify(res.body)}`);
  }
  return agent;
}

export { request, closeDb };
