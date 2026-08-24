# Code map

Only the files you usually need to open.

## Frontend (`frontend/src`)

| File | Role |
| --- | --- |
| `App.tsx` | React Router routes |
| `main.tsx` | App mount |
| `pages/HomePage.tsx` | Landing links |
| `pages/AttendancePage.tsx` | Full attendance UI wiring |
| `pages/ClassroomTimetablePage.tsx` | Room timetable UI |
| `components/BackLink.tsx` | Shared back navigation |
| `components/attendance/*` | Session header, upload, evidence, table, status |
| `components/timetable/*` | Room picker, grid, current class, clock |
| `hooks/useAttendance.ts` | Session create/process/poll/finalize |
| `hooks/useClassSessions.ts` | Load selectable classes |
| `hooks/useClassroomTimetable.ts` | Load room timetable |
| `api/client.ts` | fetch wrapper + `/api` base |
| `api/attendance.ts` / `api/timetable.ts` | Endpoint helpers |
| `../vercel.json` | API rewrite + SPA fallback |

## Backend (`backend/src`)

| File | Role |
| --- | --- |
| `server.ts` | Listen + warn if ended-session test flag is on |
| `app.ts` | Express app, health, AI health, mount attendance router |
| `config.ts` | Env config |
| `modules/attendance/routes.ts` | HTTP attendance API + process pipeline |
| `modules/attendance/repository.ts` | Postgres queries, class session ensure/list |
| `modules/attendance/schedule.ts` | Timezone occurrences, status, ended helpers |
| `modules/attendance/verification.ts` | Expected/unexpected + presence rules |
| `modules/attendance/types.ts` | Shared types |
| `integrations/ai-service/client.ts` | Call AI, retries, wake, safe logging |
| `integrations/ai-service/types.ts` | AI request/response types |
| `db/pool.ts` | pg pool |
| `db/migrate.ts` | Run migrations |
| `db/migrations/*.sql` | Schema history |
| `db/import-data.ts` | CSV parsing/import |
| `db/import-data-cli.ts` | `npm run db:import-data` |

## AI service (`ai-service/app`)

| File | Role |
| --- | --- |
| `main.py` | FastAPI routes |
| `config.py` | Inference + enrollment env (loads `.env` from ai-service dir) |
| `schemas.py` | Pydantic request/response models |
| `video_source.py` | Path vs base64 upload temp files |
| `pipelines/recognition.py` | Video loop + InsightFace |
| `recognition/gallery.py` | Load embeddings from a directory |
| `recognition/enrollment_source.py` | local vs Supabase gallery + cache/refresh |
| `recognition/matching.py` | Cosine similarity match |
| `recognition/aggregation.py` | Thresholds + aggregate statuses |
| `recognition/tracking.py` | Lightweight face tracker across frames |
| `diagnostics.py` | Single-image harness helper |

## Docs / root

| File | Role |
| --- | --- |
| `README.md` | Short start guide |
| `docs/*` | Detailed documentation (this folder) |

## Data (local, usually gitignored)

| Path | Role |
| --- | --- |
| `backend/data/timetables/*.csv` | Per-room timetable |
| `backend/data/students.csv` | Student master list |
| `backend/data/enrollment/<id>/` | Local enrollment images |
