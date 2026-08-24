# Backend

Location: `backend/`

Express + TypeScript API. This is the “brain” for attendance rules. Recognition math lives in the AI service; this service decides *when* to call it and *what* to store afterward.

## Start

- `src/server.ts` — listens on `HOST`/`PORT` (default `0.0.0.0:3001`).
- `src/app.ts` — builds the Express app, JSON body limit 64mb (videos are large), mounts routes.
- `src/config.ts` — loads `.env` via `dotenv`.

## Route groups

All under `/api`:

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/health` | Backend alive; includes `ended_session_test` flag |
| GET | `/ai/health` | Probes the AI service `/health` |
| POST | `/ai/inference` | Thin proxy to AI (mostly for debugging) |
| GET | `/attendance-classes` | Current/next class options (optional `classroom_id`) |
| GET | `/classrooms` | Rooms that have timetable data |
| GET | `/classrooms/:id/timetable` | Room grid + current occurrence |
| POST | `/attendance-sessions` | Create session for a class session |
| POST | `/attendance-sessions/:id/process` | Upload/process video |
| GET | `/attendance-sessions/:id/status` | Session status |
| GET | `/attendance-sessions/:id/observations` | AI observations |
| GET | `/attendance-sessions/:id/records` | Provisional/final records |
| POST | `/attendance-sessions/:id/finalize` | Faculty finalizes one record |

Attendance routes live in `src/modules/attendance/routes.ts`.

## Modules

```text
modules/attendance/
  routes.ts         HTTP handlers
  repository.ts     SQL / Postgres access
  schedule.ts       Timetable → occurrences, upcoming/active/ended
  verification.ts   Presence rules from sightings
  types.ts          Shared TypeScript types
```

## Database layer

- `src/db/pool.ts` — `pg` pool from `DATABASE_URL` or `DB_*`.
- `src/db/migrate.ts` — runs SQL files in order.
- `src/db/migrations/` — numbered schema changes.
- `src/db/import-data.ts` + `import-data-cli.ts` — CSV import for rooms, courses, faculty, students.

## AI integration

`src/integrations/ai-service/`:

- `client.ts` — `requestAIInference`, retries, wake ping, logging
- `types.ts` — request/response shapes
- `index.ts` — re-exports

The process route builds a request with either:

- `video_path` (local shared filesystem / harness), or
- `video_filename` + `video_data_base64` (normal upload path for separate hosts)

plus `enrollment_dir` (local path string; ignored by AI when `ENROLLMENT_SOURCE=supabase`).

## Process request flow (important)

1. Validate body has a video.
2. Load attendance session.
3. If already reviewed/finalized → return early.
4. Load attendance context (scheduled start/end).
5. If class is **upcoming** → `409 SESSION_NOT_STARTED`, **no AI call**.
6. Validate video format (bad format → `400`, not a fake AI 502).
7. Load expected students; fail if none.
8. Mark session `processing`.
9. Call AI service.
10. If AI returns `errors[]`, treat as failure.
11. Resolve identities (expected / unexpected / unknown).
12. Store sightings, occupancy snapshots, observations, provisional records.
13. Mark session `ready_for_review`.
14. On failure: mark `failed`, store message, return `502` with a clear error code/message (not a blank gateway message when the client already classified it).

## Error handling

- Typed `AIServiceError` codes: timeout, unavailable, HTTP/gateway, invalid response.
- Backend logs include AI host (no secrets), status, body snippet, session id, timing.
- Frontend only gets sanitized `error.message` (and code), not stack traces or keys.

## Config worth knowing

See [configuration.md](configuration.md). Especially:

- `AI_SERVICE_URL` — must be the public AI URL on Render
- `AI_SERVICE_TIMEOUT_MS` — default 120000
- `APP_TIMEZONE` — default `Asia/Kolkata`
- `ALLOW_ENDED_SESSION_TEST` — see [ended-session-test.md](ended-session-test.md)
