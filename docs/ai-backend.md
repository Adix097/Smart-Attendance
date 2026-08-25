# AI ↔ backend communication

## Who calls whom

Only the **backend** calls the AI service.

The browser never talks to InsightFace directly and never holds Supabase Storage credentials.

## Main endpoints

### Production uploads (preferred)

```text
POST {AI_SERVICE_URL}/v1/inference/upload
Content-Type: multipart/form-data
```

Fields: `video` (file), `enrollment_dir`, plus optional threshold/model overrides.

The backend decodes the browser’s base64 payload and forwards **raw bytes** so the AI process does not hold a second huge base64 string while loading InsightFace.

### Path / JSON (local harness)

```text
POST {AI_SERVICE_URL}/v1/inference
Content-Type: application/json
```

```json
{
  "video_path": "/shared/classroom.mp4",
  "enrollment_dir": "/path/used-only-in-local-mode",
  "model_name": "buffalo_sc",
  "sampling_fps": 2.0
}
```

JSON may still accept `video_filename` + `video_data_base64` for compatibility, but production traffic should use multipart.

Optional overrides: thresholds, `minimum_observations`, `provider`.

### Response (shape)

Includes `schema_version`, model info, timing, video metadata, sampling info, `detected_faces`, `sampled_frames`, `results[]`, `sightings[]`, `errors[]`, `warnings[]`.

If inference cannot complete **inside FastAPI**, the AI service usually returns HTTP **200** with messages in `errors`. The backend treats non-empty `errors` as failure for the attendance session.

A true HTTP **502/503/504** on this hop almost always means the **Render proxy** (or a process crash / OOM) — not a FastAPI validation error.

## Video transfer

Production / separate hosts:

1. Frontend encodes the file as base64.
2. Backend accepts it (JSON limit 64mb).
3. Backend forwards multipart file bytes to AI (`/v1/inference/upload`).
4. AI writes a temp file on **its** disk, runs recognition, deletes the file.

Local harnesses may still use `video_path` when both processes share a filesystem.

## Health checks

- AI: `GET /health` → `{ status, service, enrollment_source, model_cached, rss_mb }`
- Backend: `GET /api/ai/health` → probes AI, logs target host, returns reachability + enrollment source (no secrets)

## Timeouts, retries, cold starts

Render free services can sleep after idle time. A sleeping service often shows up as HTTP **502/503/504** from the platform proxy — not as a FastAPI validation error.

InsightFace + gallery sync on the **first** request can also push memory/time over free-tier limits. The AI service preloads the model (and Supabase gallery when configured) at startup so inference is not paying that cost on the upload request.

Backend client behavior (`integrations/ai-service/client.ts`):

1. Optional wake: a few `GET /health` attempts before the big POST (skipped when tests inject a fake fetch).
2. Inference timeout from `AI_SERVICE_TIMEOUT_MS` (default 120000).
3. Up to 2 attempts for connection failures and **fast** gateway statuses (502/503/504). Gateway failures that already took ≥45s are **not** retried (likely proxy timeout / OOM mid-inference).
4. Error messages keep the HTTP status and a **sanitized** upstream body snippet (no credentials, no video/base64).
5. Logs include target origin, transport, video byte size, attempt, elapsed ms, failure type, short body snippet — never the video bytes or API keys.

## Why localhost breaks on Render

| Setup | `AI_SERVICE_URL=http://127.0.0.1:8000` |
| --- | --- |
| Laptop | OK — AI is on the same machine |
| Render backend | Wrong — 127.0.0.1 is the backend container itself |

Use the public `https://<ai-service>.onrender.com` URL in the backend’s Render env.

Also: if the AI process binds only to `127.0.0.1` inside its container, Render’s proxy cannot reach it. Default listen host is `0.0.0.0`.
