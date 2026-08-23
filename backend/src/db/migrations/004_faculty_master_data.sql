ALTER TABLE faculty
  ALTER COLUMN user_id DROP NOT NULL,
  ALTER COLUMN faculty_number DROP NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS faculty_name_unique
  ON faculty (name);

ALTER TABLE timetable_entries
  ADD COLUMN IF NOT EXISTS faculty_id uuid REFERENCES faculty(id);
