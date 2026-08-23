CREATE TABLE IF NOT EXISTS attendance_contexts (
  id uuid PRIMARY KEY,
  attendance_session_id uuid NOT NULL UNIQUE REFERENCES attendance_sessions(id),
  class_session_id uuid NOT NULL REFERENCES class_sessions(id),
  scheduled_start timestamptz NOT NULL,
  scheduled_end timestamptz NOT NULL,
  entry_deadline timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS attendance_context_students (
  attendance_context_id uuid NOT NULL REFERENCES attendance_contexts(id),
  student_id uuid NOT NULL REFERENCES students(id),
  student_number text NOT NULL,
  student_name text NOT NULL,
  batch text,
  student_group text,
  PRIMARY KEY (attendance_context_id, student_id)
);

CREATE TABLE IF NOT EXISTS attendance_sightings (
  id uuid PRIMARY KEY,
  attendance_session_id uuid NOT NULL REFERENCES attendance_sessions(id),
  student_id uuid REFERENCES students(id),
  tracker_id text NOT NULL,
  observed_at timestamptz NOT NULL,
  camera_id text,
  similarity double precision,
  x double precision,
  y double precision,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS occupancy_snapshots (
  id uuid PRIMARY KEY,
  attendance_session_id uuid NOT NULL REFERENCES attendance_sessions(id),
  observed_at timestamptz NOT NULL,
  expected_count integer NOT NULL CHECK (expected_count >= 0),
  observed_count integer NOT NULL CHECK (observed_count >= 0),
  occupancy_ratio double precision NOT NULL CHECK (occupancy_ratio BETWEEN 0 AND 1)
);

ALTER TABLE attendance_records
  ADD COLUMN IF NOT EXISTS verification_result text,
  ADD COLUMN IF NOT EXISTS first_seen timestamptz,
  ADD COLUMN IF NOT EXISTS last_seen timestamptz,
  ADD COLUMN IF NOT EXISTS total_sightings integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS late_entry boolean NOT NULL DEFAULT false;
