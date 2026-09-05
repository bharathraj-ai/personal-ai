import { getPool } from "./db.js";

export async function listTeachers() {
  const { rows } = await getPool().query(`SELECT * FROM school_app.teachers ORDER BY id`);
  return rows;
}

export async function getTeacher(id) {
  const { rows } = await getPool().query(`SELECT * FROM school_app.teachers WHERE id = $1`, [id]);
  return rows[0] ?? null;
}

export async function createTeacher({ name, email, subject }) {
  if (!name || !email) {
    const err = new Error("name and email are required");
    err.status = 400;
    throw err;
  }
  try {
    const { rows } = await getPool().query(
      `INSERT INTO school_app.teachers (name, email, subject) VALUES ($1, $2, $3) RETURNING *`,
      [name, email, subject ?? null],
    );
    return rows[0];
  } catch (err) {
    if (err.code === "23505") {
      err.status = 409;
      err.message = "Teacher email already exists";
    }
    throw err;
  }
}

export async function updateTeacher(id, { name, email, subject }) {
  const existing = await getTeacher(id);
  if (!existing) return null;
  const { rows } = await getPool().query(
    `UPDATE school_app.teachers SET name = $1, email = $2, subject = $3 WHERE id = $4 RETURNING *`,
    [name ?? existing.name, email ?? existing.email, subject ?? existing.subject, id],
  );
  return rows[0];
}

export async function deleteTeacher(id) {
  const { rowCount } = await getPool().query(`DELETE FROM school_app.teachers WHERE id = $1`, [id]);
  return rowCount > 0;
}
