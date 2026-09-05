import bcrypt from "bcryptjs";
import { getPool, publicRow } from "./db.js";

export async function register({ email, password, name, role = "student" }) {
  const passwordHash = await bcrypt.hash(password, 10);
  try {
    const { rows } = await getPool().query(
      `INSERT INTO school_app.users (email, password_hash, name, role)
       VALUES ($1, $2, $3, $4)
       RETURNING id, email, name, role, created_at`,
      [email, passwordHash, name ?? "", role],
    );
    return rows[0];
  } catch (err) {
    if (err.code === "23505") throw new Error("User already exists");
    throw err;
  }
}

export async function findByEmail(email) {
  const { rows } = await getPool().query(`SELECT * FROM school_app.users WHERE email = $1`, [email]);
  return rows[0];
}

export async function findById(id) {
  const { rows } = await getPool().query(`SELECT * FROM school_app.users WHERE id = $1`, [id]);
  return rows[0];
}

export async function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash);
}

export function login(req, user) {
  if (!req.session) throw new Error("Session middleware not configured");
  req.session.userId = user.id;
  req.session.role = user.role;
}

export function logout(req) {
  return new Promise((resolve, reject) => {
    if (!req.session) return resolve();
    req.session.destroy((err) => (err ? reject(err) : resolve()));
  });
}

export async function getCurrentUser(req) {
  if (!req.session?.userId) return undefined;
  const user = await findById(req.session.userId);
  return user ? publicRow(user) : undefined;
}

export async function requireAuth(req, res, next) {
  try {
    const user = await getCurrentUser(req);
    if (!user) return res.status(401).json({ error: "Unauthorized" });
    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}

export default {
  register,
  findByEmail,
  findById,
  verifyPassword,
  login,
  logout,
  getCurrentUser,
  requireAuth,
};
