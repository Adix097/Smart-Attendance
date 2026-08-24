# Architecture

## Pieces

| Piece | What it is | Where it runs | Job |
| --- | --- | --- | --- |
| Frontend | React + Vite | Vercel | UI, routing, upload, display results |
| Backend | Express (TypeScript) | Render | Sessions, verification, DB, AI client |
| AI service | FastAPI (Python) | Render | Face recognition only |
| PostgreSQL | Supabase Postgres | Supabase | Timetable, students, attendance data |
| Storage | Supabase Storage bucket `enrollment` | Supabase | Private enrollment photos |
| InsightFace | Face model library | Inside AI service | Detect faces and make embeddings |
| ONNX Runtime | Model runner | Inside AI service | Runs InsightFace models on CPU |

## Why they are separate

- The **frontend** should never hold database passwords or the Supabase service-role key.
- The **backend** owns business rules: class timing, expected students, verification, finalization.
- The **AI service** is heavy (InsightFace + video). Keeping it separate lets it scale/restart without taking down the API.
- **Supabase Postgres** stores structured data that must survive deploys.
- **Supabase Storage** holds biometric enrollment images. The bucket stays **private**. Only the AI service (with a server-side key) downloads them.

## Production path

```text
Browser
  → Vercel (static React app)
  → /api/* rewritten to Render backend
  → Render backend
  → Render AI service  (/v1/inference)
  → Supabase Storage   (enrollment photos)
  → Supabase Postgres  (sessions, records, evidence)
```

Vercel does not run the Node backend. It only hosts the frontend and proxies `/api` to Render. See `frontend/vercel.json`.

## Local path

```text
Browser → Vite (port 5173)
  → proxy /api → Express (port 3001)
  → AI service (port 8000)
  → local Postgres (or Supabase URL)
  → local enrollment folder (or Supabase Storage)
```

## Important rule about hosts

`127.0.0.1` / `localhost` means “this machine”.

- Locally, backend → AI as `http://127.0.0.1:8000` is fine.
- On Render, the backend and AI are **different machines**. Backend must use the public AI URL (`AI_SERVICE_URL=https://….onrender.com`). Pointing at localhost from the backend container talks to itself, not the AI service.

Both services should listen on `0.0.0.0` (or leave `HOST` unset so the code defaults to that) so Render’s proxy can reach them.
