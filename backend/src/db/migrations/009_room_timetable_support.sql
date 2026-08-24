-- Room CSV files replace the single timetable.csv, so a timetable entry is now
-- identified by its classroom as well as its course and time slot.

-- Room files carry no capacity figure.
ALTER TABLE classrooms
  ALTER COLUMN capacity DROP NOT NULL;

ALTER TABLE classrooms
  DROP CONSTRAINT IF EXISTS classrooms_capacity_check;

-- Real batch labels are values such as 'B1 A', 'B2-A' and 'B2 / B1'.
ALTER TABLE timetable_entries
  DROP CONSTRAINT IF EXISTS timetable_entries_batch_check;

-- The 'class' column of the room CSVs, for example 'AIDS-III'. Stored verbatim.
ALTER TABLE timetable_entries
  ADD COLUMN IF NOT EXISTS class_name text NOT NULL DEFAULT '';

-- The old key was UNIQUE (course_id, day_of_week, start_time, end_time, batch),
-- which forbids one course running in two rooms at the same time. Postgres
-- truncated that generated name to 63 bytes, so drop it by its real name and
-- fall back to a lookup in case an older database spelled it differently.
ALTER TABLE timetable_entries
  DROP CONSTRAINT IF EXISTS timetable_entries_course_id_day_of_week_start_time_end_time_key;

DO $$
DECLARE
  legacy_key text;
BEGIN
  SELECT conname INTO legacy_key
  FROM pg_constraint
  WHERE conrelid = 'timetable_entries'::regclass
    AND contype = 'u'
    AND pg_get_constraintdef(oid) =
        'UNIQUE (course_id, day_of_week, start_time, end_time, batch)';
  IF legacy_key IS NOT NULL THEN
    EXECUTE format('ALTER TABLE timetable_entries DROP CONSTRAINT %I', legacy_key);
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS timetable_entries_room_occurrence_key
  ON timetable_entries (
    course_id,
    classroom_id,
    day_of_week,
    start_time,
    end_time,
    batch,
    class_name
  );
