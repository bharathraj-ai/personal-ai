import express from 'express';
import session from 'express-session';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';

const app = express();

// Middleware
app.use(express.json());
app.use(
  session({
    secret: 'change_this_secret_in_production', // In real apps use env variable
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false }, // set true if HTTPS
  })
);

// In‑memory user store (for demo purposes)
// Password for the default user is "password"
const users = [
  {
    id: 1,
    username: 'user',
    // bcrypt hash of "password"
    passwordHash: bcrypt.hashSync('password', 10),
    name: 'Demo User',
    email: 'user@example.com',
  },
];

// Helper to find user by username
function findUserByUsername(username) {
  return users.find((u) => u.username === username);
}

// Helper to generate a JWT (optional, can be used by client)
function generateToken(user) {
  // In a real application put the secret in an env variable and set appropriate expiresIn
  return jwt.sign({ sub: user.id, username: user.username }, 'jwt_secret', {
    expiresIn: '1h',
  });
}

// POST /api/auth/login
app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }

  const user = findUserByUsername(username);
  if (!user) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const passwordMatch = await bcrypt.compare(password, user.passwordHash);
  if (!passwordMatch) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  // Set session
  req.session.userId = user.id;

  // Optionally send a JWT token as well
  const token = generateToken(user);

  return res.json({
    message: 'Logged in successfully',
    token,
    user: { id: user.id, username: user.username, name: user.name, email: user.email },
  });
});

// POST /api/auth/logout
app.post('/api/auth/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to log out' });
    }
    // Clear cookie on client side
    res.clearCookie('connect.sid');
    return res.json({ message: 'Logged out successfully' });
  });
});

// GET /api/auth/me
app.get('/api/auth/me', (req, res) => {
  const userId = req.session.userId;
  if (!userId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  const user = users.find((u) => u.id === userId);
  if (!user) {
    // This should not happen, but handle gracefully
    return res.status(401).json({ error: 'User not found' });
  }
  return res.json({
    id: user.id,
    username: user.username,
    name: user.name,
    email: user.email,
  });
});

// Export the app for external usage (e.g., testing) and start server if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`Authentication server listening on port ${PORT}`);
  });
}

export default app;
