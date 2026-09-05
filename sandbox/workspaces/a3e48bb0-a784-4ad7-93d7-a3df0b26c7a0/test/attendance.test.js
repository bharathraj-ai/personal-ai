const test = require('node:test');
const assert = require('node:assert');
const attendance = require('../src/attendance');

test.describe('Attendance module', () => {
  test.it('should have recordAttendance function', () => {
    assert.strictEqual(typeof attendance.recordAttendance, 'function');
  });

  test.it('should have getAttendance function', () => {
    assert.strictEqual(typeof attendance.getAttendance, 'function');
  });
});
