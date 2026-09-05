const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

// In a real application, replace this with your user data source (e.g., a database model)
// For this module we assume a User model exposing findOne({ username }) returning a user object
// with properties: id, username, passwordHash (bcrypt hash)
const User = require('../models/User'); // placeholder path – adjust as needed

// JWT secret – should be set in environment variables
const JWT_SECRET = process.env.JWT_SECRET || 'your-secure-jwt-secret';
// Token expiration (e.g., 1 hour)
const JWT_EXPIRES_IN = '1h';

/**
 * Generate a JWT for a given payload.
 * @param {Object} payload
 * @returns {string} JWT token
 */
function generateToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

/**
 * Authenticate a user and return a signed JWT.
 * @param {string} username
 * @param {string} password Plain‑text password supplied by the client
 * @returns {Promise<string>} JWT token
 */
async function login(username, password) {
  // Locate the user – this will throw if the user does not exist
  const user = await User.findOne({ username });
  if (!user) {
    throw new Error('Invalid username or password');
  }

  // Compare supplied password with stored hash
  const passwordMatches = await bcrypt.compare(password, user.passwordHash);
  if (!passwordMatches) {
    throw new Error('Invalid username or password');
  }

  // Create token payload (avoid sending sensitive data)
  const payload = { id: user.id, username: user.username };
  return generateToken(payload);
}

/**
 * Invalidate a token. This implementation is a placeholder – real logout
 * typically involves a token blacklist or client‑side token removal.
 * @param {string} token JWT token to invalidate
 * @returns {Promise<boolean>} Always resolves to true in this stub
 */
async function logout(token) {
  // No server‑side state is kept, so we cannot truly invalidate the token.
  // In production you might store the token in a blacklist until it expires.
  // Here we simply resolve to true to indicate the operation succeeded.
  return true;
}

/**
 * Verify the JWT from an HTTP request and return the associated user payload.
 * @param {Object} req Express request object (expects token in Authorization header)
 * @returns {Promise<Object|null>} Decoded payload or null if verification fails
 */
async function getCurrentUser(req) {
  const authHeader = req.headers['authorization'];
  if (!authHeader) return null;

  const token = authHeader.split(' ')[1]; // Expect "Bearer <token>"
  if (!token) return null;

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    // Optionally, fetch fresh user data from DB if needed
    return decoded;
  } catch (err) {
    // Token invalid or expired
    return null;
  }
}

module.exports = { login, logout, getCurrentUser };