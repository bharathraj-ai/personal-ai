import express from "express";
import bcrypt from "bcryptjs";
import { findByEmail, findById, login as sessionLogin, logout as sessionLogout } from "./store.js";

const router = express.Router();

function publicUser(user) {
  const { password, password_hash, passwordHash, ...rest } = user;
  return rest;
}

router.post("/login", async (req, res, next) => {
  try {
    const { email, password } = req.body ?? {};
    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required." });
    }
    const user = await findByEmail(email);
    if (!user) return res.status(401).json({ error: "Invalid credentials." });
    const hash = user.password_hash || user.passwordHash || user.password;
    const match = await bcrypt.compare(password, hash);
    if (!match) return res.status(401).json({ error: "Invalid credentials." });
    sessionLogin(req, user);
    return res.json(publicUser(user));
  } catch (err) {
    next(err);
  }
});

router.post("/logout", async (req, res, next) => {
  try {
    await sessionLogout(req);
    res.clearCookie("connect.sid");
    return res.json({ message: "Logged out successfully." });
  } catch (err) {
    next(err);
  }
});

router.get("/me", async (req, res, next) => {
  try {
    const userId = req.session?.userId;
    if (!userId) return res.status(401).json({ error: "Not authenticated." });
    const user = await findById(userId);
    if (!user) return res.status(401).json({ error: "User not found." });
    return res.json(publicUser(user));
  } catch (err) {
    next(err);
  }
});

export default router;
