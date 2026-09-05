CREATE TABLE IF NOT EXISTS school_app.users (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    name VARCHAR(255),
    role VARCHAR(32) NOT NULL DEFAULT 'student',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS school_app.students (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES school_app.users(id) ON DELETE SET NULL,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) NOT NULL UNIQUE,
  grade VARCHAR(32),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS school_app.teachers (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES school_app.users(id) ON DELETE SET NULL,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) NOT NULL UNIQUE,
  subject VARCHAR(128),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS school_app.classes (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  teacher_id INTEGER REFERENCES school_app.teachers(id) ON DELETE SET NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS school_app.class_enrollments (
  class_id INTEGER NOT NULL REFERENCES school_app.classes(id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES school_app.students(id) ON DELETE CASCADE,
  PRIMARY KEY (class_id, student_id)
);

CREATE TABLE IF NOT EXISTS school_app.attendance (
  id SERIAL PRIMARY KEY,
  student_id INTEGER NOT NULL REFERENCES school_app.students(id) ON DELETE CASCADE,
  class_id INTEGER NOT NULL REFERENCES school_app.classes(id) ON DELETE CASCADE,
  day DATE NOT NULL,
  status VARCHAR(16) NOT NULL CHECK (status IN ('present', 'absent', 'late')),
  UNIQUE (student_id, class_id, day)
);
