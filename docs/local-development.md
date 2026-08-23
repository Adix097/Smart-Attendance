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

For a production-style build and start:

```powershell
cd backend
npm run type-check
npm run build
npm start
```

Copy `.env.example` to `.env` only when environment-file loading is added. The current server reads `PORT` and `HOST` from the process environment, with defaults of `3001` and `127.0.0.1`.

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
