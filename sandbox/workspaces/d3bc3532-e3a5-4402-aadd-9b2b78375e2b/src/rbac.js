const db = require('database');
const auth = require('MODULE-AUTH');

/**
 * Retrieve the list of role names assigned to a user.
 * @param {string|number} userId - The identifier of the user.
 * @returns {Promise<string[]>} Array of role names.
 */
async function getUserRoles(userId) {
  const result = await db.query(
    'SELECT role FROM user_roles WHERE user_id = $1',
    [userId]
  );
  return result.map(row => row.role);
}

/**
 * Retrieve the set of permissions associated with a list of roles.
 * @param {string[]} roles - Array of role names.
 * @returns {Promise<Set<string>>} Set of permission strings.
 */
async function getPermissionsForRoles(roles) {
  if (!roles.length) return new Set();
  const result = await db.query(
    'SELECT permission FROM role_permissions WHERE role = ANY($1)',
    [roles]
  );
  const perms = result.map(row => row.permission);
  return new Set(perms);
}

/**
 * Determine whether a user has a specific permission.
 * @param {string|number} userId - The identifier of the user.
 * @param {string} permission - The permission to check.
 * @returns {Promise<boolean>} True if the user possesses the permission.
 */
async function hasPermission(userId, permission) {
  const roles = await getUserRoles(userId);
  const permSet = await getPermissionsForRoles(roles);
  return permSet.has(permission);
}

/**
 * Express middleware factory that enforces a required permission.
 * It authenticates the request using MODULE-AUTH, then checks the permission.
 * @param {string} requiredPermission - Permission needed to access the route.
 * @returns {function} Express middleware (req, res, next).
 */
function authorize(requiredPermission) {
  return async function (req, res, next) {
    try {
      const user = await auth.authenticate(req);
      if (!user) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const allowed = await hasPermission(user.id, requiredPermission);
      if (!allowed) {
        return res.status(403).json({ error: 'Forbidden' });
      }

      req.user = user;
      next();
    } catch (err) {
      next(err);
    }
  };
}

module.exports = {
  getUserRoles,
  hasPermission,
  authorize,
};