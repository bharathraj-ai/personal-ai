export const Roles = Object.freeze({
  ADMIN: "admin",
  TEACHER: "teacher",
  STUDENT: "student",
  PARENT: "parent",
});

export const Permissions = Object.freeze({
  READ: "read",
  WRITE: "write",
  DELETE: "delete",
  MANAGE_USERS: "manage_users",
});

const rolePermissions = {
  [Roles.ADMIN]: new Set(Object.values(Permissions)),
  [Roles.TEACHER]: new Set([Permissions.READ, Permissions.WRITE]),
  [Roles.STUDENT]: new Set([Permissions.READ]),
  [Roles.PARENT]: new Set([Permissions.READ]),
};

export function hasPermission(role, permission) {
  const perms = rolePermissions[role];
  if (!perms) return false;
  return perms.has(permission);
}

export function requireRole(...allowed) {
  const allowedSet = new Set(allowed.map((r) => String(r).toLowerCase()));
  return (req, res, next) => {
    const role = String(req.user?.role || "").toLowerCase();
    if (!allowedSet.has(role)) {
      return res.status(403).json({ error: "Forbidden" });
    }
    next();
  };
}

export function requirePermission(permission) {
  return (req, res, next) => {
    if (!hasPermission(req.user?.role, permission)) {
      return res.status(403).json({ error: "Forbidden" });
    }
    next();
  };
}

export const rolePermissionMatrix = Object.freeze({
  ...rolePermissions,
});
