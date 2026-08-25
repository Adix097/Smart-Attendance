# Local development

## Prerequisites

- Node.js (for frontend + backend)
- Python 3 + venv (for AI service)
- PostgreSQL or a Supabase project URL
- Local enrollment photos under `backend/data/enrollment/<studentId>/`
- Timetable CSVs under `backend/data/timetables/`
- `backend/data/students.csv`

## 1. Database

```bash
cd backend
cp .env.example .env
# set DATABASE_URL or DB_* 
npm install
npm run db:migrate
npm run db:import-data
```

## 2. AI service

```bash
cd ai-service
cp .env.example .env
```

For local photos:

```text
ENROLLMENT_SOURCE=local
```

```bash
python -m venv .venv
# Windows: .venv\Scripts\activate
# macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
pip uninstall -y opencv-python
python -m app.main
```

(`insightface` may install full `opencv-python`; uninstall it so only `opencv-python-headless` provides `cv2`.)

Default: `http://127.0.0.1:8000` (binds `0.0.0.0` unless you override `HOST`).

## 3. Backend

In `backend/.env`:

```text
AI_SERVICE_URL=http://127.0.0.1:8000
AI_SERVICE_TIMEOUT_MS=120000
DATABASE_URL=postgresql://USER:PASSWORD@127.0.0.1:5432/smart_attendance
APP_TIMEZONE=Asia/Kolkata
```

```bash
cd backend
npm run dev
```

## 4. Frontend

```bash
cd frontend
npm install
npm run dev
```

Open the Vite URL (usually `http://127.0.0.1:5173`). `/api` is proxied to port 3001.

## Smoke checks

- Backend: `GET http://127.0.0.1:3001/api/health`
- AI via backend: `GET http://127.0.0.1:3001/api/ai/health`
- AI direct: `GET http://127.0.0.1:8000/health`
