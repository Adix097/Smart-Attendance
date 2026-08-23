CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY,
  email text NOT NULL UNIQUE,
  display_name text NOT NULL,
  role text NOT NULL CHECK (role IN ('admin', 'faculty', 'student'))
);

CREATE TABLE IF NOT EXISTS students (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL UNIQUE REFERENCES users(id),
  student_number text NOT NULL UNIQUE,
  name text NOT NULL,
  programme text
);

CREATE TABLE IF NOT EXISTS faculty (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL UNIQUE REFERENCES users(id),
  faculty_number text NOT NULL UNIQUE,
  name text NOT NULL
);

CREATE TABLE IF NOT EXISTS courses (
  id uuid PRIMARY KEY,
  code text NOT NULL UNIQUE,
  title text NOT NULL
);

CREATE TABLE IF NOT EXISTS classrooms (
  id uuid PRIMARY KEY,
  name text NOT NULL UNIQUE,
  capacity integer NOT NULL CHECK (capacity > 0)
);

CREATE TABLE IF NOT EXISTS enrollments (
  id uuid PRIMARY KEY,
  course_id uuid NOT NULL REFERENCES courses(id),
  student_id uuid NOT NULL REFERENCES students(id),
  UNIQUE (course_id, student_id)
);

CREATE TABLE IF NOT EXISTS class_sessions (
  id uuid PRIMARY KEY,
  course_id uuid NOT NULL REFERENCES courses(id),
  faculty_id uuid NOT NULL REFERENCES faculty(id),
  classroom_id uuid NOT NULL REFERENCES classrooms(id),
  scheduled_start timestamptz NOT NULL,
  scheduled_end timestamptz NOT NULL,
  CHECK (scheduled_end > scheduled_start),
  UNIQUE (course_id, classroom_id, scheduled_start)
);

CREATE TABLE IF NOT EXISTS attendance_sessions (
  id uuid PRIMARY KEY,
  class_session_id uuid NOT NULL UNIQUE REFERENCES class_sessions(id),
  status text NOT NULL CHECK (
    status IN ('open', 'processing', 'ready_for_review', 'finalized')
  ),
  started_at timestamptz NOT NULL DEFAULT now(),
  finalized_at timestamptz
);

CREATE TABLE IF NOT EXISTS attendance_observations (
  id uuid PRIMARY KEY,
  attendance_session_id uuid NOT NULL REFERENCES attendance_sessions(id),
  student_id uuid REFERENCES students(id),
  status text NOT NULL CHECK (status IN ('confirmed', 'uncertain', 'unknown')),
  similarity double precision CHECK (similarity IS NULL OR similarity BETWEEN -1 AND 1),
  observation_count integer NOT NULL DEFAULT 1 CHECK (observation_count > 0),
  second_best_similarity double precision,
  identity_margin double precision,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  model_name text NOT NULL,
  model_version text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS attendance_records (
  id uuid PRIMARY KEY,
  attendance_session_id uuid NOT NULL REFERENCES attendance_sessions(id),
  student_id uuid NOT NULL REFERENCES students(id),
  status text NOT NULL CHECK (
    status IN ('present', 'absent', 'uncertain', 'unknown')
  ),
  source text NOT NULL CHECK (source IN ('ai', 'faculty', 'manual')),
  confidence double precision,
  evidence_observation_id uuid REFERENCES attendance_observations(id),
  finalized_by uuid REFERENCES users(id),
  finalized_at timestamptz,
  UNIQUE (attendance_session_id, student_id)
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id uuid PRIMARY KEY,
  actor_user_id uuid REFERENCES users(id),
  action text NOT NULL CHECK (
    action IN ('attendance_finalization', 'attendance_correction')
  ),
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
