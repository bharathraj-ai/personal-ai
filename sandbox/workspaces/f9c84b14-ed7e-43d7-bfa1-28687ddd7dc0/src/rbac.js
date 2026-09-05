/** Role-based access — stdlib only */
export const ROLES = ["Admin", "Teacher", "Student", "Parent"];

const PERMISSIONS = {
  Admin: ["manage_users", "manage_classes", "view_grades", "manage_attendance"],
  Teacher: ["manage_classes", "view_grades", "manage_attendance"],
  Student: ["view_grades", "view_attendance"],
  Parent: ["view_grades", "view_attendance"],
};

export function canAccess(role, permission) {
  if (!ROLES.includes(role)) return false;
  return PERMISSIONS[role]?.includes(permission) ?? false;
}

export function listPermissions(role) {
  return PERMISSIONS[role] ?? [];
}
