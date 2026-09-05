# Requirement matrix — School Management System
# Verification is from live tests on 2026-08-30 (node --test, 16/16 PASS against Neon).

STUDENT_CREATE
implementation: src/students.js, src/server.js
API: POST /api/students
DB: school_app.students
test: src/__tests__/students.test.js, src/__tests__/integration.test.js
result: PASS

STUDENT_LIST
implementation: src/students.js
API: GET /api/students
DB: school_app.students
test: src/__tests__/students.test.js
result: PASS

STUDENT_GET
implementation: src/students.js
API: GET /api/students/:id
DB: school_app.students
test: src/__tests__/students.test.js
result: PASS

STUDENT_UPDATE
implementation: src/students.js
API: PUT /api/students/:id
DB: school_app.students
test: src/__tests__/students.test.js
result: PASS

STUDENT_DELETE
implementation: src/students.js
API: DELETE /api/students/:id
DB: school_app.students
test: src/__tests__/students.test.js
result: PASS

TEACHER_CREATE
implementation: src/teachers.js
API: POST /api/teachers
DB: school_app.teachers
test: src/__tests__/teachers.test.js
result: PASS

TEACHER_LIST
implementation: src/teachers.js
API: GET /api/teachers
DB: school_app.teachers
test: src/__tests__/teachers.test.js
result: PASS

TEACHER_UPDATE
implementation: src/teachers.js
API: PUT /api/teachers/:id
DB: school_app.teachers
test: src/__tests__/teachers.test.js
result: PASS

TEACHER_DELETE
implementation: src/teachers.js
API: DELETE /api/teachers/:id
DB: school_app.teachers
test: src/__tests__/teachers.test.js
result: PASS

CLASS_CREATE
implementation: src/classes.js
API: POST /api/classes
DB: school_app.classes
test: src/__tests__/classes.test.js
result: PASS

CLASS_ASSIGN_TEACHER
implementation: src/classes.js
API: POST /api/classes/:id/teacher
DB: school_app.classes.teacher_id
test: src/__tests__/classes.test.js
result: PASS

CLASS_ENROLL
implementation: src/classes.js
API: POST /api/classes/:id/enroll
DB: school_app.class_enrollments
test: src/__tests__/classes.test.js
result: PASS

CLASS_LIST_STUDENTS
implementation: src/classes.js
API: GET /api/classes/:id/students
DB: school_app.class_enrollments
test: src/__tests__/classes.test.js
result: PASS

ATTENDANCE_MARK
implementation: src/attendance.js
API: POST /api/attendance
DB: school_app.attendance
test: src/__tests__/attendance.test.js
result: PASS

ATTENDANCE_UPDATE
implementation: src/attendance.js
API: PUT /api/attendance/:id
DB: school_app.attendance
test: src/__tests__/attendance.test.js
result: PASS

ATTENDANCE_GET
implementation: src/attendance.js
API: GET /api/attendance
DB: school_app.attendance
test: src/__tests__/attendance.test.js
result: PASS

ATTENDANCE_NO_DUPLICATE
implementation: src/attendance.js UNIQUE(student_id, class_id, day)
API: POST /api/attendance (409)
DB: school_app.attendance
test: src/__tests__/attendance.test.js
result: PASS

AUTH_LOGIN
implementation: src/auth.js, src/store.js
API: POST /api/auth/login
DB: school_app.users
test: src/__tests__/auth.test.js
result: PASS

AUTH_LOGOUT
implementation: src/auth.js
API: POST /api/auth/logout
DB: session
test: src/__tests__/auth.test.js
result: PASS

AUTH_PROTECTED
implementation: src/store.js requireAuth
API: GET /api/auth/me, GET /api/dashboard/stats
DB: school_app.users
test: src/__tests__/auth.test.js, src/__tests__/integration.test.js
result: PASS

RBAC_ENFORCE
implementation: src/rbac.js requireRole
API: POST /api/students, DELETE /api/students/:id, POST /api/teachers
DB: school_app.users.role
test: src/__tests__/rbac.test.js
result: PASS

DASHBOARD_STATS
implementation: src/dashboard.js, public/dashboard.html
API: GET /api/dashboard/stats
DB: COUNT students/teachers/classes/attendance
test: src/__tests__/integration.test.js
result: PASS
