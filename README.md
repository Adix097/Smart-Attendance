# smart-attendance

College classroom attendance helper. Faculty pick a room and class, upload a short classroom video, and the system runs face recognition to produce provisional attendance that still needs human review before it is finalized.

## Stack

- Frontend: React, Vite, Tailwind, React Router (hosted on Vercel)
- Backend: Node.js, Express, TypeScript (hosted on Render)
- AI service: FastAPI, InsightFace, ONNX Runtime (hosted on Render)
- Database and enrollment photos: Supabase (PostgreSQL + private Storage)

## Layout

```text
frontend/     React UI
backend/      Express API, migrations, CSV import
ai-service/   Face recognition service
docs/         Full project documentation
```

## Quick start (local)

You need Node.js, Python 3, and PostgreSQL (or a Supabase connection string).

```bash
# database
cd backend
cp .env.example .env          # edit DATABASE_URL etc.
npm install
npm run db:migrate
# put CSVs under backend/data/, then:
npm run db:import-data

# AI service
cd ../ai-service
cp .env.example .env          # ENROLLMENT_SOURCE=local for local photos
python -m venv .venv
# Windows: .venv\Scripts\activate
# macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
python -m app.main

# backend
cd ../backend
npm run dev

# frontend
cd ../frontend
npm install
npm run dev
```

Frontend defaults to `http://127.0.0.1:5173` and proxies `/api` to the backend.

## The three services

- **frontend** — UI for timetable browsing, session creation, video upload, and reviewing AI results.
- **backend** — API, timetable/session logic, attendance verification, Postgres writes, and calls to the AI service.
- **AI service** — Loads the enrollment gallery, runs InsightFace on the video, returns recognition evidence. It does not finalize attendance.

Production uses Vercel for the frontend and Render for both backend and AI. See [docs/](docs/) for architecture, env vars, deployment, and troubleshooting.

## Live Deployment

- Frontend: https://smart-attendance-five-silk.vercel.app/
- Backend API: https://smart-attendance-backend-6vzc.onrender.com
- AI Service: https://smart-attendance-ai-0b1g.onrender.com/

## Docs

Full documentation is in [`docs/`](docs/README.md).
