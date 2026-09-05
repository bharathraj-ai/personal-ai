const { Pool } = require('pg');
const http = require('http');

// PostgreSQL connection pool – configuration can be supplied via environment variables.
const pool = new Pool();

/** Parse cookies from the request into an object */
function parseCookies(req) {
  const cookieHeader = req.headers?.cookie || '';
  return cookieHeader.split(';').reduce((acc, part) => {
    const [key, ...val] = part.trim().split('=');
    if (key) acc[key] = decodeURIComponent(val.join('='));
    return acc;
  }, {});
}

/** Set a cookie on the response */
function setCookie(res, name, value, options = {}) {
  const attrs = [`${name}=${encodeURIComponent(value)}`];
  if (options.maxAge) attrs.push(`Max-Age=${options.maxAge}`);
  if (options.httpOnly) attrs.push('HttpOnly');
  if (options.path) attrs.push(`Path=${options.path}`);
  if (options.sameSite) attrs.push(`SameSite=${options.sameSite}`);
  if (options.secure) attrs.push('Secure');
  const existing = res.getHeader('Set-Cookie');
  const cookies = existing ? (Array.isArray(existing) ? existing : [existing]) : [];
  cookies.push(attrs.join('; '));
  res.setHeader('Set-Cookie', cookies);
}

/** Clear a cookie (set Max-Age=0) */
function clearCookie(res, name, options = {}) {
  setCookie(res, name, '', { ...options, maxAge: 0 });
}

/**
 * Authenticate a user and establish a session.
 * @param {string} username
 * @param {string} password Plain‑text password (demo only – use hashing in prod)
 * @param {http.IncomingMessage} req
 * @param {http.ServerResponse} res
 * @returns {Promise<object>} Resolves with the user record (without password) on success.
 */
async function login(username, password, req, res) {
  const client = await pool.connect();
  try {
    const { rows } = await client.query(
      'SELECT id, username, password FROM users WHERE username = $1',
      [username]
    );
    const user = rows[0];
    if (!user) throw new Error('Invalid credentials');
    // In real applications compare hashed passwords (e.g., bcrypt.compare).
    if (user.password !== password) throw new Error('Invalid credentials');

    // Store a simple session identifier – the user id – in a cookie.
    setCookie(res, 'session', String(user.id), { httpOnly: true, path: '/', sameSite: 'Lax' });
    const { password: _pwd, ...safeUser } = user;
    return safeUser;
  } finally {
    client.release();
  }
}

/**
 * Log the user out by clearing the session cookie.
 * @param {http.IncomingMessage} req
 * @param {http.ServerResponse} res
 */
function logout(req, res) {
  clearCookie(res, 'session', { path: '/', httpOnly: true, sameSite: 'Lax' });
}

/**
 * Retrieve the currently authenticated user based on the session cookie.
 * @param {http.IncomingMessage} req
 * @returns {Promise<object|null>} Resolves with the user record (without password) or null if unauthenticated.
 */
async function getCurrentUser(req) {
  const cookies = parseCookies(req);
  const sessionId = cookies['session'];
  if (!sessionId) return null;
  const client = await pool.connect();
  try {
    const { rows } = await client.query(
      'SELECT id, username FROM users WHERE id = $1',
      [sessionId]
    );
    return rows[0] || null;
  } finally {
    client.release();
  }
}

module.exports = { login, logout, getCurrentUser };
