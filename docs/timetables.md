# Timetables

## Room-based CSVs

Source files live under:

```text
backend/data/timetables/
  A-007.csv
  A-203.csv
  A-204.csv
  A-406.csv
  ...
```

**Every room has its own file.** The file name (without `.csv`) is the room id/name. That avoids mixing slots from different classrooms in one spreadsheet and matches how faculty think: “what is happening in A-204?”

These files are **not** committed if they sit under `backend/data/` (see `.gitignore`). You keep them locally / on the server for import.

## Columns

Importer accepts either:

```text
course_code,course_name,faculty_name,weekday,start_time,end_time,class,batch
```

or the same without `course_name`:

```text
course_code,faculty_name,weekday,start_time,end_time,class,batch
```

Meaning:

| Column | Meaning |
| --- | --- |
| `course_code` | Course code |
| `course_name` | Optional title; if missing, importer can keep an existing DB title |
| `faculty_name` | Teacher display name |
| `weekday` | Monday–Friday |
| `start_time` / `end_time` | `HH:MM` 24-hour |
| `class` | Class label stored as `class_name` (example `AIDS-III`) |
| `batch` | Batch label from the college data (not limited to A/B after migration 009) |

Room comes from the **file name**, not a CSV column.

## Import path

```bash
cd backend
npm run db:import-data
```

CLI (`import-data-cli.ts`):

1. Reads every `*.csv` in `data/timetables/`.
2. Parses each file with `parseTimetable(content, path, room)`.
3. Parses `data/students.csv`.
4. Checks local enrollment folders exist for every student (local import gate).
5. Derives distinct courses and faculty from the timetable rows.
6. Upserts classrooms, courses, faculty, timetable entries, students.
7. Skips exact duplicates; reports conflicts (same slot, different faculty, etc.).

## How rows become class sessions

Timetable rows are **recurring weekly templates**.

When the frontend asks for classes, the backend:

1. Ensures concrete `class_sessions` for the current/next occurrence (timezone-aware).
2. Returns those sessions with enrolled/expected students and `upcoming` / `active` / `ended`.

So CSV says “Monday 10:00–11:00 in A-204”. On a given Monday, that becomes one `class_sessions` row with real timestamps.

## Frontend classroom selection

1. `GET /api/classrooms` → rooms that have timetable entries.
2. User picks a room.
3. Attendance page: `GET /api/attendance-classes?classroom_id=...`
4. Timetable page: `GET /api/classrooms/:id/timetable` for the weekly grid + current occurrence.
