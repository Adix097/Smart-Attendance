# Database

The app uses **PostgreSQL**. In production that is **Supabase Postgres**. Locally it can be any Postgres with a matching schema.

Schema changes are applied with **migrations**, not by hand-editing production tables.

## Why migrations

Every SQL file in `backend/src/db/migrations/` is numbered (`001` … `009`). Running:

```bash
cd backend
npm run db:migrate
```

applies any file that has not been applied yet. That keeps every environment on the same schema.

## What each migration does

| File | Meaning |
| --- | --- |
| `001_initial.sql` | Core tables: users, students, faculty, courses, classrooms, enrollments, class_sessions, attendance_sessions, observations, records, audit_logs |
| `002_attendance_processing_status.sql` | Allows session status `failed` and keeps `processing_error` |
| `003_academic_master_data.sql` | Adds recurring `timetable_entries` |
| `004_faculty_master_data.sql` | Faculty can exist without a user account; unique faculty names |
| `005_student_master_data.sql` | Students can exist without a user account; adds batch/group/name parts |
| `006_timetable_class_sessions.sql` | Links `class_sessions` to a timetable entry + occurrence time |
| `007_attendance_verification.sql` | Context, expected students snapshot, sightings, occupancy, verification fields on records |
| `008_attendance_evidence_idempotency.sql` | Unique keys so the same sighting/occupancy bucket is not stored twice |
| `009_room_timetable_support.sql` | Room-based uniqueness, free-form batch labels, `class_name` on timetable rows |

## Important tables (plain English)

### Academic master data

- **courses** — subject codes/titles (example: `ARD253`).
- **faculty** — teachers by name.
- **classrooms** — rooms (example: `A-204`). Capacity is optional after migration 009.
- **students** — real student numbers (digit strings, including leading zeros), names, batch, group.
- **enrollments** — which students are linked to which courses (used as one of the ways to decide “expected”).
- **timetable_entries** — recurring weekly slots per room: weekday, start/end time, course, faculty, batch, class name, room.

### Runtime class instances

- **class_sessions** — one concrete occurrence of a timetable row on a calendar day (`scheduled_start` / `scheduled_end`). Created when the API ensures upcoming (and optionally recent ended) sessions.

### Attendance run

- **attendance_sessions** — one processing run tied to one `class_session`. Statuses: `open`, `processing`, `ready_for_review`, `finalized`, `failed`.
- **attendance_contexts** — copy of the scheduled window (+ entry deadline) frozen when the session is created.
- **attendance_context_students** — snapshot of who was expected for that run.
- **attendance_sightings** — per-face detections over time (tracker id, time, similarity, optional bbox).
- **occupancy_snapshots** — how many expected students were seen in time buckets.
- **attendance_observations** — per-identity summary from the AI response (status, similarity, evidence JSON).
- **attendance_records** — provisional then finalized attendance per student (present/absent/uncertain/unknown), with verification metadata.

### Older / supporting

- **users** — role-capable accounts (admin/faculty/student). Faculty/students can exist without users after later migrations.
- **audit_logs** — intended for finalization/correction auditing.

## Relationships (simple)

```text
timetable_entries  →  class_sessions (one slot, one day/time)
class_sessions     →  attendance_sessions (one processing run)
attendance_sessions → observations, sightings, records, context
students           ← referenced by enrollments, records, observations, context students
```

## How class sessions are generated

`ensureUpcomingClassSession()` in the repository:

1. Reads all timetable entries.
2. Groups by classroom.
3. Uses `APP_TIMEZONE` to expand weekly rows into concrete start/end datetimes.
4. Picks the **active** class if any, otherwise the **next upcoming** one (per room).
5. Optionally also inserts the **most recent ended** slot when `ALLOW_ENDED_SESSION_TEST=true`.
6. Inserts into `class_sessions` with `ON CONFLICT DO NOTHING` so repeats are safe.

The attendance class list then only shows the relevant rows (active, next upcoming, and maybe latest ended).

## Evidence storage

AI results are not “trusted attendance” by themselves. The backend stores:

- raw-ish **sightings** for timing/presence checks
- **observations** with evidence JSON (warnings, video metadata, verification tags)
- **provisional records** that faculty can finalize

That is why you can review similarities and still change the final status.
