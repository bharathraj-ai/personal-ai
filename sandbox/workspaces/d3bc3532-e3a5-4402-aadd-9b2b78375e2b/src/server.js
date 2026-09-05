require('dotenv').config();

const express = require('express');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
const auth = require('./auth');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cookieParser());

// Simple CORS handling (optional, can be removed if not needed)
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', process.env.CORS_ORIGIN || '*');
  res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.header('Access-Control-Allow-Credentials', 'true');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }
  next();
});

// Authentication routes
// POST /login - expects { username, password } in body
app.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }
    const session = await auth.login(username, password);
    // Assuming auth.login returns a session object and sets a cookie internally or returns token
    // If token is returned, set it as a cookie
    if (session && session.token) {
      res.cookie('session_token', session.token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: session.expiresIn ? session.expiresIn * 1000 : undefined,
      });
    }
    res.json({ success: true, user: session.user });
  } catch (err) {
    console.error('Login error:', err);
    res.status(401).json({ error: err.message || 'Invalid credentials' });
  }
});

// POST /logout - clears session cookie
app.post('/logout', async (req, res) => {
  try {
    const token = req.cookies.session_token;
    await auth.logout(token);
    res.clearCookie('session_token');
    res.json({ success: true });
  } catch (err) {
    console.error('Logout error:', err);
    res.status(500).json({ error: err.message || 'Logout failed' });
  }
});

// GET /session - returns current session info if authenticated
app.get('/session', async (req, res) => {
  try {
    const token = req.cookies.session_token;
    if (!token) {
      return res.status(401).json({ error: 'No session token' });
    }
    const sessionInfo = await auth.getSession(token);
    res.json({ authenticated: true, session: sessionInfo });
  } catch (err) {
    console.error('Session retrieval error:', err);
    res.status(401).json({ error: err.message || 'Invalid session' });
  }
});

// Health check endpoint (optional)
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
