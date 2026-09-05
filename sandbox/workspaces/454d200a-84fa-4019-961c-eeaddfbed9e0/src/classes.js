import { getPool } from "./db.js";

export async function listClasses() {
  const { rows } = await getPool().query(
    `SELECT c.*, t.name AS teacher_name
     FROM school_app.classes c
     LEFT JOIN school_app.teachers t ON t.id = c.teacher_id
     ORDER BY c.id`,
  );
  return rows;
}

export async function getClass(id) {
  const { rows } = await getPool().query(`SELECT * FROM school_app.classes WHERE id = $1`, [id]);
  return rows[0] ?? null;
}

export async function createClass({ name, teacherId }) {
  if (!name) {
    const err = new Error("name is required");
    err.status = 400;
    throw err;
  }
  const { rows } = await getPool().query(
    `INSERT INTO school_app.classes (name, teacher_id) VALUES ($1, $2) RETURNING *`,
    [name, teacherId ?? null],
  );
  return rows[0];
}

export async function assignTeacher(classId, teacherId) {
  const { rows } = await getPool().query(
    `UPDATE school_app.classes SET teacher_id = $1 WHERE id = $2 RETURNING *`,
    [teacherId, classId],
  );
  return rows[0] ?? null;
}

export async function enrollStudent(classId, studentId) {
  try {
    await getPool().query(
      `INSERT INTO school_app.class_enrollments (class_id, student_id) VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [classId, studentId],
    );
  } catch (err) {
    err.status = 400;
    throw err;
  }
  return listClassStudents(classId);
}

export async function listClassStudents(classId) {
  const { rows } = await getPool().query(
    `SELECT s.* FROM school_app.students s
     INNER JOIN school_app.class_enrollments e ON e.student_id = s.id
     WHERE e.class_id = $1
     ORDER BY s.id`,
    [classId],
  );
  return rows;
}
