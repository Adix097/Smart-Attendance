# Testing

## Backend

```bash
cd backend
npm run type-check
npm run build
npm test
```

What the tests cover (high level):

- AI client: success, bad JSON, timeouts, gateway retries, loopback warning
- `/api/ai/inference` error mapping
- Attendance routes: create/process/finalize, upload forwarding, upcoming rejection, active processing, AI failure → failed session
- Schedule helpers: active/upcoming/ended, ended-session listing helpers
- Verification and identity resolution
- CSV import / room timetable rules
- Repository persistence behaviors (where mocked or exercised)

## Frontend

There is no large Jest suite. Checks used in practice:

```bash
cd frontend
npm run type-check
npm run build
```

## AI service

```bash
cd ai-service
# with venv active
python -m compileall -q app tests
python -m unittest discover -s tests -t .
```

Tests cover:

- embedding normalize / matching / aggregation / tracker (`test_recognition.py`)
- enrollment source local vs supabase caching/errors (`test_enrollment_source.py`)
- video upload temp files and request validation (`test_video_source.py`)

Unit tests do not replace a full production video run against live Supabase.
