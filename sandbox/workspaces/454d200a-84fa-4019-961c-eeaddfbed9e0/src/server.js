import express from "express";
import cors from "cors";
import session from "express-session";
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import authRouter from "./auth.js";
import { requireAuth } from "./store.js";
import { requireRole, Roles } from "./rbac.js";
import * as students from "./students.js";
import * as teachers from "./teachers.js";
import * as classes from "./classes.js";
import * as attendance from "./attendance.js";
import { getDashboardStats } from "./dashboard.js";
import { migrate } from "./db.js";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(
  session({
    secret: process.env.SESSION_SECRET || "school_session_secret_change_me",
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, secure: false, maxAge: 24 * 60 * 60 * 1000 },
  }),
);

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

function sendEntity(res, entity, notFound = "Not found") {
  if (!entity) return res.status(404).json({ error: notFound });
  return res.json(entity);
}

app.use("/api/auth", authRouter);

app.get(
  "/api/dashboard/stats",
  requireAuth,
  asyncHandler(async (_req, res) => {
    res.json(await getDashboardStats());
  }),
);

app.get(
  "/api/students",
  requireAuth,
  asyncHandler(async (_req, res) => res.json(await students.listStudents())),
);
app.get(
  "/api/students/:id",
  requireAuth,
  asyncHandler(async (req, res) => sendEntity(res, await students.getStudent(Number(req.params.id)))),
);
app.post(
  "/api/students",
  requireAuth,
  requireRole(Roles.ADMIN, Roles.TEACHER),
  asyncHandler(async (req, res) => res.status(201).json(await students.createStudent(req.body ?? {}))),
);
app.put(
  "/api/students/:id",
  requireAuth,
  requireRole(Roles.ADMIN, Roles.TEACHER),
  asyncHandler(async (req, res) =>
    sendEntity(res, await students.updateStudent(Number(req.params.id), req.body ?? {})),
  ),
);
app.delete(
  "/api/students/:id",
  requireAuth,
  requireRole(Roles.ADMIN),
  asyncHandler(async (req, res) => {
    const ok = await students.deleteStudent(Number(req.params.id));
    if (!ok) return res.status(404).json({ error: "Not found" });
    res.status(204).end();
  }),
);

app.get(
  "/api/teachers",
  requireAuth,
  asyncHandler(async (_req, res) => res.json(await teachers.listTeachers())),
);
app.post(
  "/api/teachers",
  requireAuth,
  requireRole(Roles.ADMIN),
  asyncHandler(async (req, res) => res.status(201).json(await teachers.createTeacher(req.body ?? {}))),
);
app.put(
  "/api/teachers/:id",
  requireAuth,
  requireRole(Roles.ADMIN),
  asyncHandler(async (req, res) =>
    sendEntity(res, await teachers.updateTeacher(Number(req.params.id), req.body ?? {})),
  ),
);
app.delete(
  "/api/teachers/:id",
  requireAuth,
  requireRole(Roles.ADMIN),
  asyncHandler(async (req, res) => {
    const ok = await teachers.deleteTeacher(Number(req.params.id));
    if (!ok) return res.status(404).json({ error: "Not found" });
    res.status(204).end();
  }),
);

app.get(
  "/api/classes",
  requireAuth,
  asyncHandler(async (_req, res) => res.json(await classes.listClasses())),
);
app.post(
  "/api/classes",
  requireAuth,
  requireRole(Roles.ADMIN),
  asyncHandler(async (req, res) => res.status(201).json(await classes.createClass(req.body ?? {}))),
);
app.post(
  "/api/classes/:id/teacher",
  requireAuth,
  requireRole(Roles.ADMIN),
  asyncHandler(async (req, res) =>
    sendEntity(res, await classes.assignTeacher(Number(req.params.id), req.body?.teacherId)),
  ),
);
app.post(
  "/api/classes/:id/enroll",
  requireAuth,
  requireRole(Roles.ADMIN, Roles.TEACHER),
  asyncHandler(async (req, res) => {
    const list = await classes.enrollStudent(Number(req.params.id), req.body?.studentId);
    res.json(list);
  }),
);
app.get(
  "/api/classes/:id/students",
  requireAuth,
  asyncHandler(async (req, res) => res.json(await classes.listClassStudents(Number(req.params.id)))),
);

app.get(
  "/api/attendance",
  requireAuth,
  asyncHandler(async (req, res) =>
    res.json(
      await attendance.getAttendance({
        studentId: req.query.studentId ? Number(req.query.studentId) : undefined,
        classId: req.query.classId ? Number(req.query.classId) : undefined,
        day: req.query.day,
      }),
    ),
  ),
);
app.post(
  "/api/attendance",
  requireAuth,
  requireRole(Roles.ADMIN, Roles.TEACHER),
  asyncHandler(async (req, res) => res.status(201).json(await attendance.markAttendance(req.body ?? {}))),
);
app.put(
  "/api/attendance/:id",
  requireAuth,
  requireRole(Roles.ADMIN, Roles.TEACHER),
  asyncHandler(async (req, res) =>
    sendEntity(res, await attendance.updateAttendance(Number(req.params.id), req.body ?? {})),
  ),
);

app.use(express.static(path.join(__dirname, "../public")));

app.use((err, _req, res, _next) => {
  const status = err.status || 500;
  res.status(status).json({ error: err.message || "Internal server error" });
});

export async function createApp() {
  await migrate();
  return app;
}

export default app;
