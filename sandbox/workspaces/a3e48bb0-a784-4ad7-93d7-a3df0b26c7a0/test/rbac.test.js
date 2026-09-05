import test from 'node:test';
import assert from 'node:assert';
import { can } from '../src/rbac.js';

// Helper to assert permission expectations
function expectPermission(role, permission, expected) {
  const result = can(role, permission);
  if (expected) {
    assert.ok(result, `${role} should have permission '${permission}'`);
  } else {
    assert.ok(!result, `${role} should NOT have permission '${permission}'`);
  }
}

test('RBAC permission matrix', (t) => {
  // Admin: unrestricted access (using a wildcard permission to represent "any")
  expectPermission('Admin', '*', true);

  // Teacher permissions
  expectPermission('Teacher', 'grade:read', true);
  expectPermission('Teacher', 'grade:write', true);
  expectPermission('Teacher', 'user:delete', false);

  // Student permissions
  expectPermission('Student', 'grade:read', true);
  expectPermission('Student', 'grade:write', false);
  expectPermission('Student', 'profile:update', false);

  // Parent permissions
  expectPermission('Parent', 'grade:read', true);
  expectPermission('Parent', 'grade:write', false);
  expectPermission('Parent', 'student:message', false);
});