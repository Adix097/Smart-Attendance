# Local development

This repository currently contains runnable foundations only. There is no database, authentication, business feature, computer vision pipeline, or production deployment configuration yet.

## Prerequisites

- Node.js and npm
- Python 3.11 or newer

## Frontend

```powershell
cd frontend
npm install
npm run dev
```

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
requests after 120 seconds. The server does not load `.env` files automatically;
set variables in the shell or add environment-file loading deliberately later.

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
