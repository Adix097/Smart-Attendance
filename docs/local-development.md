# Local development

This repository contains runnable frontend, backend, AI-service, and PostgreSQL
attendance vertical slices. Authentication, production deployment, and advanced
computer-vision features remain out of scope for this MVP slice.

## Prerequisites

- Node.js and npm
- Python 3.11 or newer

## Frontend

```powershell
cd frontend
npm install
npm run dev
```

Open `http://127.0.0.1:5173/attendance` for the faculty attendance workflow.
During Vite development, `/api` requests are proxied to Express at
`http://127.0.0.1:3001`.

For a production build:

```powershell
cd frontend
npm run type-check
npm run build
npm run preview
```

The Vite development server prints its local URL when it starts.

## Backend

```powershell
cd backend
npm install
npm run dev
```

The health endpoint is available at `http://127.0.0.1:3001/api/health`.
The backend integration endpoint is `POST http://127.0.0.1:3001/api/ai/inference`.
It accepts the same JSON request contract as the AI service and forwards local
video/enrollment paths to FastAPI. Configure `AI_SERVICE_URL` and
`AI_SERVICE_TIMEOUT_MS` using `.env.example` values or process environment
variables.

For a production-style build and start:

```powershell
cd backend
npm run type-check
npm run build
npm start
```

The current server reads `PORT`, `HOST`, `AI_SERVICE_URL`,
`AI_SERVICE_TIMEOUT_MS`, and `APP_TIMEZONE` from the process environment. It defaults to
`127.0.0.1:3001`, forwards to `http://127.0.0.1:8000`, and times out AI
requests after 120 seconds. `APP_TIMEZONE` defaults to `Asia/Kolkata` and is
used to interpret recurring timetable weekdays and local start/end times;
database timestamps remain timezone-aware instants. Backend entry points load an optional `backend/.env`
file through `dotenv`; process environment variables remain valid and take
precedence.

## PostgreSQL

The backend uses the `pg` client with a small SQL migration runner. PostgreSQL
is not bundled with the repository and Docker is not required. Install or run
PostgreSQL locally, create an empty database named `smart_attendance`, and set
the variables in `backend/.env.example` in your shell. `DATABASE_URL` takes
precedence over the individual `DB_*` variables.

Run migrations:

```powershell
cd backend
npm run db:migrate
```

Seed the deterministic demo classroom scenario:

```powershell
cd backend
npm run db:seed
```

The seed creates one faculty member, one course, one classroom, one class
session, three students, their enrollments, and an open attendance session. It
does not create biometric embeddings or AI observations.

## Academic master-data import

The intentional source CSV files are stored at:

- `backend/data/courses.csv`
- `backend/data/timetable.csv`

After applying migrations, import them into PostgreSQL/Supabase with:

```powershell
cd backend
npm run db:import-data
```

The command imports faculty names, course codes/names, and recurring weekly
timetable entries. Timetable rows retain the supplied faculty name and room as
provenance while linking `faculty_id` to the imported faculty record. No student
or enrollment records are created. Required columns, weekday/time ranges,
batches, duplicate course codes, and timetable course references are validated
before import.

Known timetable name variants are normalized to the canonical names in
`backend/data/faculty.csv`. The import is idempotent: existing matching rows
are skipped, while a course code with a different name or a timetable key with
different faculty/room values fails clearly. Unknown timetable faculty names
also fail clearly. Existing data is never deleted automatically.

## Student master-data import

Student source data belongs in `backend/data/students.csv` with the columns
`student_id,first_name,last_name,batch,group`. Each row must also have an
enrollment directory at `backend/data/enrollment/<student_id>/` containing at
least one readable `.jpg`, `.jpeg`, `.png`, `.webp`, or `.bmp` image. Student
IDs are imported as strings, so leading zeros are preserved.

After all required real, consented enrollment photos have been placed in those
directories, run the same command:

```powershell
cd backend
npm run db:import-data
```

The command validates the CSV and enrollment directories before importing
students. It is idempotent, rejects duplicate IDs, and fails on conflicting
existing student data; it does not create users, enrollments, or store raw
images in PostgreSQL. Do not run this command until every supplied student has
an enrollment image.

The attendance repository/service stores AI observations and provisional
attendance evidence, finalizes records, writes finalization audit events, and
retrieves records. Express remains the source of truth for final attendance;
attendance policy calculations are not database triggers.

Attendance verification is modeled separately from recognition. FastAPI returns
timestamped recognition sightings with temporary tracker IDs and retains
aggregate results for compatibility. The verification engine evaluates the
sightings against centralized thresholds for minimum sightings, duration, end
presence, and late entry. Aggregate-only responses remain faculty-review
evidence because they cannot prove timing or end-of-class presence.

The faculty workflow loads selectable attendance classes from
`GET /api/attendance-classes`. These are concrete `class_sessions` backed by
imported academic courses/timetable data; if none exist, the UI remains in an
empty state rather than falling back to seeded demo data. During processing,
Express resolves enrolled students and uses
`backend/data/enrollment/<student_id>/` as the recognition gallery. AI identity
names are matched to the students’ imported `student_number` values.

## Attendance-session inference flow

With PostgreSQL migrated and seeded, start FastAPI and Express in separate
terminals. Create a session for the seeded class session, then process a local
video and enrollment gallery through Express:

```powershell
$session = Invoke-RestMethod -Method Post `
  -Uri http://127.0.0.1:3001/api/attendance-sessions `
  -ContentType 'application/json' `
  -Body '{"class_session_id":"00000000-0000-0000-0000-000000000005"}'

Invoke-RestMethod -Method Post `
  -Uri "http://127.0.0.1:3001/api/attendance-sessions/$($session.id)/process" `
  -ContentType 'application/json' `
  -Body (@{
    video_path = 'C:\path\to\consented-classroom-video.mp4'
    enrollment_dir = 'C:\path\to\consented-enrollment'
    identity_student_ids = @{
      'student-a-folder' = '00000000-0000-0000-0000-000000000012'
    }
  } | ConvertTo-Json)
```

Inspect processing state and provisional evidence with:

```powershell
Invoke-RestMethod "http://127.0.0.1:3001/api/attendance-sessions/$($session.id)/status"
Invoke-RestMethod "http://127.0.0.1:3001/api/attendance-sessions/$($session.id)/observations"
Invoke-RestMethod "http://127.0.0.1:3001/api/attendance-sessions/$($session.id)/records"
```

The video and enrollment paths must reference real, consented local files; no
fixtures or biometric data are included in the repository. Processing stores
provisional AI evidence only and never finalizes attendance.

## Development recognition harness

The recognition harness is diagnostic-only. It accepts one real image, runs the
InsightFace gallery under `backend/data/enrollment`, returns one timestamped
sighting and temporary tracker ID, and resolves the identity against the
selected real class session. It never creates an attendance session, sighting
record, occupancy snapshot, or attendance record.

Start the AI service with the development endpoint explicitly enabled:

```powershell
cd ai-service
$env:AI_ENABLE_DEV_HARNESS = 'true'
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Then run the backend harness with a real image and concrete class-session ID:

```powershell
cd backend
npm run recognition:harness -- `
  --image C:\path\to\consented-test-image.jpg `
  --class-session <real-class-session-id>
```

A single image can validate gallery loading, face detection, similarity,
recognition status, one temporary tracker ID, global student-number resolution,
and whether that student is expected in the selected class. It cannot validate
repeated sightings, continuous tracking, arrival timing, late entry, presence
duration, end-of-class presence, occupancy over time, or automatic attendance.

For the deterministic local demo, the faculty page maps the AI enrollment
identity `adi` to seeded Student A
(`00000000-0000-0000-0000-000000000012`). This is only a local demo mapping,
not a production identity-management mechanism.

## Backend-AI integration test

The focused tests mock the AI service handler and do not require FastAPI,
InsightFace, a model, or a video:

```powershell
cd backend
npm test
```

To run only the integration test file:

```powershell
cd backend
npx tsx --test tests/ai-integration.test.ts
```

## AI service

Create and activate a local virtual environment, then install the configured dependencies:

```powershell
cd ai-service
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

The health endpoint is available at `http://127.0.0.1:8000/health`.

The service can also be started directly:

```powershell
python -m app.main
```

The current service reads `HOST` and `PORT` from the process environment, with defaults of `127.0.0.1` and `8000`.
