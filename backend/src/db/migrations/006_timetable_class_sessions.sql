ALTER TABLE class_sessions
  ADD COLUMN IF NOT EXISTS timetable_entry_id uuid REFERENCES timetable_entries(id);

ALTER TABLE class_sessions
  ALTER COLUMN classroom_id DROP NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS class_sessions_timetable_occurrence_key
  ON class_sessions (timetable_entry_id, scheduled_start)
  WHERE timetable_entry_id IS NOT NULL;
