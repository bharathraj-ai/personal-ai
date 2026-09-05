import { getPool } from "./db.js";

const STATUSES = new Set(["present", "absent", "late"]);

export async function markAttendance({ studentId, classId, day, status }) {
  if (!studentId || !classId || !day || !status) {
    const err = new Error("studentId, classId, day, and status are required");
    err.status = 400;
    throw err;
  }
  if (!STATUSES.has(status)) {
    const err = new Error("status must be present, absent, or late");
    err.status = 400;
    throw err;
  }
  try {
    const { rows } = await getPool().query(
      `INSERT INTO school_app.attendance (student_id, class_id, day, status)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [studentId, classId, day, status],
    );
    return rows[0];
  } catch (err) {
    if (err.code === "23505") {
      err.status = 409;
      err.message = "Attendance already recorded for this student/class/day";
    }
    throw err;
  }
}

export async function updateAttendance(id, { status }) {
  if (status && !STATUSES.has(status)) {
    const err = new Error("status must be present, absent, or late");
    err.status = 400;
    throw err;
  }
  const { rows } = await getPool().query(
    `UPDATE school_app.attendance SET status = COALESCE($1, status) WHERE id = $2 RETURNING *`,
    [status ?? null, id],
  );
  return rows[0] ?? null;
}

export async function getAttendance({ studentId, classId, day } = {}) {
  const clauses = [];
  const values = [];
  if (studentId) {
    values.push(studentId);
    clauses.push(`student_id = $${values.length}`);
  }
  if (classId) {
    values.push(classId);
    clauses.push(`class_id = $${values.length}`);
  }
  if (day) {
    values.push(day);
    clauses.push(`day = $${values.length}`);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const { rows } = await getPool().query(
    `SELECT * FROM school_app.attendance ${where} ORDER BY day DESC, id DESC`,
    values,
  );
  return rows;
}
