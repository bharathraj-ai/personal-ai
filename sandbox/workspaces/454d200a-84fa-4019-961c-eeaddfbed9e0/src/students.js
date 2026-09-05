import { getPool } from "./db.js";

export async function listStudents() {
  const { rows } = await getPool().query(`SELECT * FROM school_app.students ORDER BY id`);
  return rows;
}

export async function getStudent(id) {
  const { rows } = await getPool().query(`SELECT * FROM school_app.students WHERE id = $1`, [id]);
  return rows[0] ?? null;
}

export async function createStudent({ name, email, grade }) {
  if (!name || !email) {
    const err = new Error("name and email are required");
    err.status = 400;
    throw err;
  }
  try {
    const { rows } = await getPool().query(
      `INSERT INTO school_app.students (name, email, grade) VALUES ($1, $2, $3) RETURNING *`,
      [name, email, grade ?? null],
    );
    return rows[0];
  } catch (err) {
    if (err.code === "23505") {
      err.status = 409;
      err.message = "Student email already exists";
    }
    throw err;
  }
}

export async function updateStudent(id, { name, email, grade }) {
  const existing = await getStudent(id);
  if (!existing) return null;
  const { rows } = await getPool().query(
    `UPDATE school_app.students SET name = $1, email = $2, grade = $3 WHERE id = $4 RETURNING *`,
    [name ?? existing.name, email ?? existing.email, grade ?? existing.grade, id],
  );
  return rows[0];
}

export async function deleteStudent(id) {
  const { rowCount } = await getPool().query(`DELETE FROM school_app.students WHERE id = $1`, [id]);
  return rowCount > 0;
}
