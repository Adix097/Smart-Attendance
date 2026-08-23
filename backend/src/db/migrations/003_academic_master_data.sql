CREATE TABLE IF NOT EXISTS timetable_entries (
  id uuid PRIMARY KEY,
  course_id uuid NOT NULL REFERENCES courses(id),
  faculty_id uuid REFERENCES faculty(id),
  faculty_name text NOT NULL,
  classroom_id uuid REFERENCES classrooms(id),
  room text NOT NULL,
  day_of_week text NOT NULL CHECK (
    day_of_week IN ('Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday')
  ),
  start_time time NOT NULL,
  end_time time NOT NULL,
  batch text NOT NULL CHECK (batch IN ('A', 'B', 'ALL')),
  UNIQUE (course_id, day_of_week, start_time, end_time, batch)
);
