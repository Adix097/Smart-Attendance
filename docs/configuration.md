# Configuration reference

Placeholders only. Never commit real secrets.

## Backend (`backend/.env`)

| Variable | Purpose |
| --- | --- |
| `HOST` | Listen address. Default `0.0.0.0`. Use `127.0.0.1` only to lock to your machine. |
| `PORT` | HTTP port (local default `3001`; Render injects its own). |
| `AI_SERVICE_URL` | Base URL of the AI service. Local example `http://127.0.0.1:8000`. Production must be `https://….onrender.com`. |
| `AI_SERVICE_TIMEOUT_MS` | Inference HTTP timeout. Default `120000`. |
| `DATABASE_URL` | Postgres URL (preferred). |
| `DB_HOST` / `DB_PORT` / `DB_NAME` / `DB_USER` / `DB_PASSWORD` / `DB_SSL` | Used if `DATABASE_URL` is unset. |
| `ENROLLMENT_ROOT` | Local enrollment folder path sent as `enrollment_dir`. Default `backend/data/enrollment`. |
| `APP_TIMEZONE` | IANA timezone for timetable expansion. Default `Asia/Kolkata`. |
| `ALLOW_ENDED_SESSION_TEST` | Exact `true` enables ended-class listing for pipeline tests. |

## AI service (`ai-service/.env`)

| Variable | Purpose |
| --- | --- |
| `HOST` | Listen address. Default `0.0.0.0`. |
| `PORT` | Default `8000` locally; Render provides `PORT`. |
| `AI_MODEL_NAME` | InsightFace model pack. Default `buffalo_sc` (fits 512MiB). |
| `AI_PROVIDER` | Must be `CPUExecutionProvider` for this MVP. |
| `AI_DET_SIZE` | Detector square edge. Default `320`. |
| `AI_MAX_DETECTION_SIDE` | Max frame side before detection resize. Default `960`. |
| `AI_ALLOW_HEAVY_MODELS` | `true`/`false` override. On Render, heavy packs are blocked unless this is `true`. Locally they are allowed by default. |
| `AI_ENFORCE_MEMORY_BUDGET` | Exact `true` blocks `buffalo_l` even on a laptop (useful to mimic free Render). |
| `AI_SAMPLING_FPS` | Frame sampling rate. Default `2.0`. |
| `AI_ACCEPTANCE_THRESHOLD` | Default `0.45`. |
| `AI_UNKNOWN_THRESHOLD` | Default `0.35`. |
| `AI_IDENTITY_MARGIN_THRESHOLD` | Default `0.05`. |
| `AI_MINIMUM_OBSERVATIONS` | Default `3`. |
| `AI_ENABLE_DEV_HARNESS` | Enables `/v1/dev/recognition-test`. Keep `false` in production. |
| `ENROLLMENT_SOURCE` | `local` or `supabase`. |
| `SUPABASE_URL` | Project URL (supabase mode). |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-side secret (supabase mode). |
| `SUPABASE_STORAGE_BUCKET` | Default `enrollment`. |
| `ENROLLMENT_CACHE_DIR` | Optional disk cache for downloaded gallery. |

## Frontend

| Variable | Purpose |
| --- | --- |
| `VITE_API_URL` | Optional API base. Default `/api` (Vite proxy locally, Vercel rewrite in production). |

## Examples (fake values)

```text
# backend production-ish
AI_SERVICE_URL=https://your-ai-service.onrender.com
DATABASE_URL=postgresql://USER:PASSWORD@db.example:5432/postgres
APP_TIMEZONE=Asia/Kolkata

# ai-service production-ish
AI_MODEL_NAME=buffalo_sc
AI_DET_SIZE=320
ENROLLMENT_SOURCE=supabase
SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_SERVICE_ROLE_KEY=YOUR_SERVER_SIDE_SECRET
SUPABASE_STORAGE_BUCKET=enrollment
```
