# AI service

Location: `ai-service/`

FastAPI app that only does recognition. It does not write attendance to Postgres.

## Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/health` | Alive + `enrollment_source` + model cache / RSS hints |
| POST | `/v1/inference/upload` | Production video recognition (multipart file) |
| POST | `/v1/inference` | JSON path / base64 recognition (local / compatibility) |
| POST | `/v1/enrollment/refresh` | Re-download gallery from Supabase / clear caches |
| POST | `/v1/dev/recognition-test` | Local harness only if `AI_ENABLE_DEV_HARNESS=true` |

## Recognition process (simple)

1. **Startup preload** warms InsightFace (and the Supabase gallery when configured) so the first upload is not also paying model + sync cost.
2. **Request arrives** as multipart file bytes (`/v1/inference/upload`) or JSON `video_path` / base64 (`/v1/inference`).
3. **Video is materialized** on the AI host (`video_source.py`). Uploads are written to a temp file and deleted afterward. Separate Render disks mean a backend temp path is useless unless the bytes are sent.
4. **FaceAnalysis model loads** (InsightFace `buffalo_l` by default) on CPU via ONNX Runtime. The prepared model is cached in-process after first use / preload.
5. **Enrollment gallery loads**
   - `local`: read folders under `enrollment_dir`
   - `supabase`: sync private bucket into a cache dir once, then reuse in memory until refresh
6. For each enrollment image with exactly one face, compute a normalized embedding vector.
7. **Open the video**, sample frames at about `AI_SAMPLING_FPS` (default 2 fps).
8. On each sampled frame, detect faces.
9. For each face embedding, **match** against the gallery (cosine similarity = dot product of normalized vectors).
10. Apply thresholds → status per sighting: `confirmed` / `uncertain` / `unknown`.
11. Track faces roughly across frames (`LightweightTracker`).
12. **Aggregate** sightings per identity (counts, best/average similarity, margins).
13. Return JSON results + warnings. Application failures usually come back as HTTP 200 with `errors[]` filled, not as a thrown 500. Platform 502s are outside FastAPI.

## What “similarity” means

Similarity here is **cosine similarity** between two face embedding vectors (after normalizing them).

- It is a number typically between about `-1` and `1` (higher = closer match).
- **It is not a probability.**
- **It is not a confidence percentage.**
- Saying “0.72 similarity” does **not** mean “72% sure”.

The UI and API may show values like `0.453`. Read them as “how close this face embedding is to the enrollment embedding,” not as percent confidence.

Warnings returned by the pipeline also state that cosine similarity is not a probability.

## Thresholds (why they exist)

Configured in `app/config.py` / env:

| Setting | Default | Role |
| --- | --- | --- |
| `AI_ACCEPTANCE_THRESHOLD` | `0.45` | Below this → not `confirmed` |
| `AI_UNKNOWN_THRESHOLD` | `0.35` | Below this → treat as unknown identity |
| `AI_IDENTITY_MARGIN_THRESHOLD` | `0.05` | Best vs second-best must differ by at least this or stay uncertain (avoids close twins) |
| `AI_MINIMUM_OBSERVATIONS` | `3` | Need enough sightings before aggregate status can stay `confirmed` |
| `AI_SAMPLING_FPS` | `2.0` | How often frames are taken from the video |
| `AI_MODEL_NAME` | `buffalo_l` | InsightFace model pack |
| `AI_PROVIDER` | `CPUExecutionProvider` | This project supports CPU only |

Rough status logic per sighting:

1. similarity &lt; unknown threshold → `unknown`
2. else similarity &lt; acceptance threshold → `uncertain`
3. else margin too small → `uncertain`
4. else → `confirmed`

Aggregation can demote `confirmed` back to `uncertain` if there are fewer than `minimum_observations`.

## Enrollment sources

- `ENROLLMENT_SOURCE=local` — use the directory path from the request.
- `ENROLLMENT_SOURCE=supabase` — requires `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_STORAGE_BUCKET`. Downloads into `ENROLLMENT_CACHE_DIR` (or a temp folder).

`POST /v1/enrollment/refresh` re-syncs Supabase mode and rebuilds the in-memory gallery.

## CPU only

`CPUExecutionProvider` is intentional for the current MVP. No GPU provider is supported in config validation.
