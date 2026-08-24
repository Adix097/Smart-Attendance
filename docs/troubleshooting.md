# Troubleshooting

## Frontend route gives 404 on refresh

Vercel must rewrite non-file routes to `index.html`. Check `frontend/vercel.json` has the SPA rewrite after the `/api` rewrite.

Locally, use the Vite dev server (it handles SPA fallback). Opening a built `index.html` as a file URL will break routing.

## Backend cannot reach AI service

1. From the backend host, open `AI_SERVICE_URL/health`.
2. Confirm `AI_SERVICE_URL` is not `127.0.0.1` / `localhost` on Render.
3. Confirm AI listens on `0.0.0.0`.
4. Check `GET /api/ai/health` on the backend for `reachable` and logs.

## AI service sleeping / cold start

Symptoms: intermittent HTTP 502/503/504, long first request.

- Wait and retry (backend already retries gateway statuses).
- Hit `/health` once to wake the service.
- Increase `AI_SERVICE_TIMEOUT_MS` if inference itself is slow after wake.

## Supabase authentication failure (Storage)

AI logs / refresh errors about rejected service-role credentials:

- Check `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` on the **AI** service.
- Key must be the service role (server), not an anon key meant for browsers.
- Bucket name must match `SUPABASE_STORAGE_BUCKET`.

## Database authentication failure

Backend cannot start queries / migrate:

- Verify `DATABASE_URL`.
- Check SSL settings (`DB_SSL` / URL params) for Supabase.
- Confirm the DB user can connect from Render’s network.

## Enrollment gallery not loading

- Production: `ENROLLMENT_SOURCE=supabase` and objects under `enrollment/<studentId>/…`.
- Call `POST /v1/enrollment/refresh` on the AI service after uploading new photos.
- Local: folders under `ENROLLMENT_ROOT` / `backend/data/enrollment`.
- Health should report `enrollment_source`.

## Video upload failure

- File too large (frontend limit ~48 MB; backend JSON limit 64 MB).
- Unsupported extension (mp4/webm/mov/avi).
- Empty file.
- Class still `upcoming` → processing blocked on purpose.

## AI returns an error / session failed

Read the message on the attendance page / `processing_error`:

- Timeout → raise timeout or wake service first.
- Unreachable → URL / HOST / deploy issue.
- Gateway starting up → retry after wake.
- Inference `errors[]` (bad video, empty gallery, etc.) → fix input/gallery.

Check backend logs for `attendance_session_id`, `session_timing`, AI target host, and status — without expecting secrets or raw video in the log.

## Class appears as upcoming

That means `now < scheduled_start` in `APP_TIMEZONE`.

- Wait until start, or
- Use an ended class only with `ALLOW_ENDED_SESSION_TEST=true`, or
- Verify timezone and timetable times are correct.

Do not “fix” by deleting the upcoming check.

## Works locally, fails on Render/Vercel

Common causes:

| Local | Production mistake |
| --- | --- |
| `AI_SERVICE_URL=http://127.0.0.1:8000` | Same value copied to Render backend |
| Shared disk `video_path` | Backend temp path sent to AI on another machine (fixed by sending base64) |
| `ENROLLMENT_SOURCE=local` | AI on Render has no local `backend/data/enrollment` |
| Vite proxy | Forgetting Vercel `/api` rewrite |
| `HOST=127.0.0.1` | Render proxy cannot reach the process |
