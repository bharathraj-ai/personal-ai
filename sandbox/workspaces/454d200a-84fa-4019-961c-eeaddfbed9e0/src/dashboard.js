import { getPool } from "./db.js";

export async function getDashboardStats() {
  const pool = getPool();
  const [students, teachers, classes, attendance] = await Promise.all([
    pool.query(`SELECT COUNT(*)::int AS count FROM school_app.students`),
    pool.query(`SELECT COUNT(*)::int AS count FROM school_app.teachers`),
    pool.query(`SELECT COUNT(*)::int AS count FROM school_app.classes`),
    pool.query(
      `SELECT status, COUNT(*)::int AS count FROM school_app.attendance GROUP BY status`,
    ),
  ]);
  const byStatus = { present: 0, absent: 0, late: 0 };
  for (const row of attendance.rows) {
    byStatus[row.status] = row.count;
  }
  return {
    students: students.rows[0].count,
    teachers: teachers.rows[0].count,
    classes: classes.rows[0].count,
    attendance: {
      total: byStatus.present + byStatus.absent + byStatus.late,
      ...byStatus,
    },
  };
}
