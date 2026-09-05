const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

// In production, set JWT_SECRET via environment variable.
const JWT_SECRET = process.env.JWT_SECRET || 'change_this_secret';
const JWT_EXPIRES_IN = '1h';

/**
 * Login handler.
 * Expects { username, password } in req.body.
 * On success, issues a JWT and sets it as an httpOnly cookie.
 */
function loginHandler(req, res) {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }

  // Placeholder user store – replace with real DB lookup.
  const users = (req.app && req.app.locals && req.app.locals.users) || [];
  const user = users.find(u => u.username === username);
  if (!user) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const passwordMatches = bcrypt.compareSync(password, user.passwordHash);
  if (!passwordMatches) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const token = jwt.sign({ sub: user.id }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
  res.cookie('token', token, { httpOnly: true, sameSite: 'strict' });
  return res.json({ token });
}

/**
 * Logout handler – clears the authentication cookie.
 */
function logoutHandler(req, res) {
  res.clearCookie('token');
  return res.json({ message: 'Logged out' });
}

/**
 * Middleware that validates a JWT from the Authorization header (Bearer) or cookie.
 * On success, attaches the user payload to req.user.
 */
function authenticateMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  const tokenFromHeader = authHeader && authHeader.split(' ')[0] === 'Bearer' ? authHeader.split(' ')[1] : null;
  const token = tokenFromHeader || req.cookies?.token;

  if (!token) {
    return res.status(401).json({ error: 'Authentication token missing' });
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = { id: payload.sub };
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

/**
 * Helper to retrieve the current authenticated user from the request.
 */
function getCurrentUser(req) {
  return req.user || null;
}

module.exports = {
  loginHandler,
  logoutHandler,
  authenticateMiddleware,
  getCurrentUser,
};
