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

The current server reads `PORT`, `HOST`, `AI_SERVICE_URL`, and
`AI_SERVICE_TIMEOUT_MS` from the process environment. It defaults to
`127.0.0.1:3001`, forwards to `http://127.0.0.1:8000`, and times out AI
requests after 120 seconds. Backend entry points load an optional `backend/.env`
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

The attendance repository/service stores AI observations and provisional
attendance evidence, finalizes records, writes finalization audit events, and
retrieves records. Express remains the source of truth for final attendance;
attendance policy calculations are not database triggers.

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
