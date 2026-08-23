# AI service

The AI service owns computer-vision processing and returns provisional
recognition evidence. It does not finalize attendance, apply attendance policy,
or persist embeddings.

## Local setup

The existing FastAPI foundation can still be run with its original environment:

```powershell
cd ai-service
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

The first inference initializes `buffalo_l` with
`CPUExecutionProvider`. The model is downloaded and cached by InsightFace
outside the repository under `%USERPROFILE%\.insightface\models\buffalo_l`.
Model files and biometric data must not be committed.

## Configuration

Environment variables provide defaults:

| Variable | Default |
| --- | --- |
| `AI_MODEL_NAME` | `buffalo_l` |
| `AI_PROVIDER` | `CPUExecutionProvider` |
| `AI_SAMPLING_FPS` | `2.0` |
| `AI_ACCEPTANCE_THRESHOLD` | `0.45` |
| `AI_UNKNOWN_THRESHOLD` | `0.35` |
| `AI_IDENTITY_MARGIN_THRESHOLD` | `0.05` |
| `AI_MINIMUM_OBSERVATIONS` | `3` |

The inference request can override these values for an experiment. This MVP
supports CPU inference only.

## Enrollment format

Use only consented demo images:

```text
enrollment/
  student-a/
    image-1.jpg
    image-2.jpg
  student-b/
    image-1.jpg
```

Each enrollment image must contain exactly one face. Images with zero or
multiple faces are rejected. Embeddings are normalized and retained only in
memory for the request.

## Inference API

Start the service, then send local paths to the versioned endpoint:

```powershell
Invoke-RestMethod `
  -Method Post `
  -Uri http://127.0.0.1:8000/v1/inference `
  -ContentType "application/json" `
  -Body (@{
    video_path = "C:\demo\classroom.mp4"
    enrollment_dir = "C:\demo\enrollment"
  } | ConvertTo-Json)
```

The typed response includes:

- `schema_version`, model name/version, and processing time;
- video frame/FPS metadata;
- sampling configuration;
- sampled-frame and detected-face counts;
- per-identity `confirmed`, `uncertain`, or `unknown` results;
- best, average, and second-best cosine similarities;
- identity margin;
- errors and warnings.

Cosine similarity is not a probability or confidence percentage. Results are
provisional evidence only; faculty/business-layer verification must determine
final attendance.

## Limitations

- Video-file input only; RTSP is not implemented.
- No tracking, person re-identification, multi-camera association, seat mapping,
  or engagement analytics.
- Temporal aggregation is session-level and does not associate observations into
  person tracks.
- Thresholds are configurable but not calibrated by this service.
- CPU inference may be slow for long or high-resolution classroom videos.
- No raw frames, face images, embeddings, or generated inference files are
  written by the pipeline.

## Tests

The focused tests use synthetic embeddings and do not initialize or download
the model:

```powershell
cd ai-service
.\.venv\Scripts\Activate.ps1
python -m unittest discover -s tests -t . -v
```
