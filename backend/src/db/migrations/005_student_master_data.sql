ALTER TABLE students
  ALTER COLUMN user_id DROP NOT NULL;

ALTER TABLE students
  ADD COLUMN IF NOT EXISTS first_name text,
  ADD COLUMN IF NOT EXISTS last_name text,
  ADD COLUMN IF NOT EXISTS batch text,
  ADD COLUMN IF NOT EXISTS student_group text;
