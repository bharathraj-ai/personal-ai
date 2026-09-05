const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

// In-memory user store (for demonstration purposes only)
const users = new Map(); // key: username, value: { passwordHash }

// Secret for signing JWTs – in a real app this should come from env vars
const JWT_SECRET = 'your-very-secure-secret';
const JWT_EXPIRES_IN = '1h';

const app = express();
app.use(express.json());

// Helper to generate JWT for a user
function generateToken(username) {
  return jwt.sign({ username }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

// Middleware to protect routes
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Expect "Bearer <token>"
  if (!token) return res.status(401).json({ error: 'Token missing' });

  jwt.verify(token, JWT_SECRET, (err, payload) => {
    if (err) return res.status(403).json({ error: 'Invalid token' });
    req.user = payload; // payload contains username
    next();
  });
}

// Register endpoint
app.post('/register', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }
  if (users.has(username)) {
    return res.status(409).json({ error: 'User already exists' });
  }
  try {
    const passwordHash = await bcrypt.hash(password, 10);
    users.set(username, { passwordHash });
    const token = generateToken(username);
    res.status(201).json({ token });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Login endpoint
app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }
  const user = users.get(username);
  if (!user) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  const match = await bcrypt.compare(password, user.passwordHash);
  if (!match) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  const token = generateToken(username);
  res.json({ token });
});

// Example protected route
app.get('/protected', authenticateToken, (req, res) => {
  res.json({ message: `Hello, ${req.user.username}! This is protected data.` });
});

module.exports = { app };
