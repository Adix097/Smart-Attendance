# Deployment

## Production shape

```text
Vercel (frontend)
    ↓  /api rewrite
Render (backend)
    ↓  AI_SERVICE_URL
Render (AI service)
    ↓
Supabase (Postgres + private Storage)
```

Deploy **AI service first**, then backend, then frontend, so contracts and env vars exist before traffic hits them.

## Vercel (frontend)

- Build the Vite app (`frontend/`).
- `vercel.json` rewrites:
  - `/api/(.*)` → Render backend URL
  - everything else → `/index.html` (SPA)

No Supabase service-role key and no database password belong in Vercel env for this app’s browser bundle.

Optional: `VITE_API_URL` if you ever stop using the `/api` rewrite and point elsewhere.

## Render (backend)

Web service from `backend/`.

Typical start: install, `npm run build`, `npm start` (or your Render start command).

Must set:

- `HOST` unset or `0.0.0.0`
- `PORT` from Render
- `DATABASE_URL` (Supabase Postgres)
- `AI_SERVICE_URL` = public AI URL (`https://….onrender.com`) — **not** localhost
- `AI_SERVICE_TIMEOUT_MS` (120000 or higher if videos are long)
- `APP_TIMEZONE` (example `Asia/Kolkata`)
- `ALLOW_ENDED_SESSION_TEST` only when intentionally testing (see [ended-session-test.md](ended-session-test.md))

## Render (AI service)

Web service from `ai-service/`.

Must set:

- `HOST` unset or `0.0.0.0`
- `PORT` from Render
- `ENROLLMENT_SOURCE=supabase`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY` (server secret)
- `SUPABASE_STORAGE_BUCKET=enrollment`
- optional recognition thresholds / `ENROLLMENT_CACHE_DIR`

Never put the service-role key in the frontend.

## Supabase

- Postgres: connection string → backend `DATABASE_URL`
- Storage: private bucket `enrollment` with `<studentId>/…` images
- Run migrations + import against the database before expecting classes/students to appear

## Secrets

Do not commit:

- `.env` files (gitignored)
- service-role keys
- database passwords
- real enrollment photos under `backend/data/`

Use each platform’s environment variable UI.

## Cold starts

Free Render services can sleep. First request may be slow or briefly return gateway errors. The backend retries gateway statuses and can ping `/health` before inference. Still expect the first call after idle to take longer.
