# AI ↔ backend communication

## Who calls whom

Only the **backend** calls the AI service.

The browser never talks to InsightFace directly and never holds Supabase Storage credentials.

## Main endpoint

```text
POST {AI_SERVICE_URL}/v1/inference
Content-Type: application/json
```

### Request (shape)

```json
{
  "video_filename": "classroom.mp4",
  "video_data_base64": "<base64 bytes>",
  "enrollment_dir": "/path/used-only-in-local-mode",
  "model_name": "buffalo_l",
  "sampling_fps": 2.0
}
```

Either `video_path` **or** (`video_filename` + `video_data_base64`) is required.

Optional overrides: thresholds, `minimum_observations`, `provider`.

### Response (shape)

Includes `schema_version`, model info, timing, video metadata, sampling info, `detected_faces`, `sampled_frames`, `results[]`, `sightings[]`, `errors[]`, `warnings[]`.

If inference cannot complete, the AI service often still returns HTTP 200 with messages in `errors`. The backend treats non-empty `errors` as failure for the attendance session.

## Video transfer

Production / separate hosts:

1. Frontend encodes the file as base64.
2. Backend accepts it (JSON limit 64mb).
3. Backend forwards filename + base64 to AI.
4. AI writes a temp file on **its** disk, runs recognition, deletes the file.

Local harnesses may still use `video_path` when both processes share a filesystem.

## Health checks

- AI: `GET /health` → `{ status, service, enrollment_source }`
- Backend: `GET /api/ai/health` → probes AI, logs target host, returns reachability + enrollment source (no secrets)

## Timeouts, retries, cold starts

Render free services can sleep after idle time. A sleeping service often shows up as HTTP **502/503/504** from the platform proxy — not as a FastAPI validation error.

Backend client behavior (`integrations/ai-service/client.ts`):

1. Optional wake: a few `GET /health` attempts before the big POST (skipped when tests inject a fake fetch).
2. Inference timeout from `AI_SERVICE_TIMEOUT_MS` (default 120s).
3. Up to 2 attempts for connection failures and gateway statuses (502/503/504), with delay between tries.
4. Clear user-facing messages for timeout vs unreachable vs “service starting up”.
5. Logs include target origin, attempt, elapsed ms, failure type, short body snippet — never the video bytes or API keys.

## Why localhost breaks on Render

| Setup | `AI_SERVICE_URL=http://127.0.0.1:8000` |
| --- | --- |
| Laptop | OK — AI is on the same machine |
| Render backend | Wrong — 127.0.0.1 is the backend container itself |

Use the public `https://<ai-service>.onrender.com` URL in the backend’s Render env.

Also: if the AI process binds only to `127.0.0.1` inside its container, Render’s proxy cannot reach it. Default listen host is `0.0.0.0`.
