# Copilot instructions

## Project context

This repository is building a hackathon MVP for an AI Smart Classroom Attendance & Analytics System. The MVP should demonstrate:

```text
classroom video
  -> detection
  -> tracking
  -> identity recognition
  -> provisional attendance evidence
  -> faculty verification
  -> PostgreSQL
  -> dashboard
```

Build incrementally as vertical slices. Do not implement the entire production architecture before the end-to-end MVP works.

## Repository structure

- `frontend/` — React + TypeScript application for faculty and administrator workflows.
- `backend/` — Node.js + Express + TypeScript application containing institutional business logic and API orchestration.
- `ai-service/` — Python + FastAPI application containing computer vision and inference.
- `shared/` — cross-service API contracts and types where sharing is practical.
- `docs/` — architecture, privacy, API, evaluation, and demo documentation.
- `.github/copilot-instructions.md` — repository guidance; this file is intentionally tracked and must remain committed.

Keep implementation in the directory matching its responsibility. Do not duplicate institutional rules between `backend/` and `ai-service/`.

## Technology decisions

- Frontend: React + TypeScript.
- Frontend styling: Tailwind CSS is the default; prefer utility classes in
  React components. Keep manual CSS only for requirements Tailwind cannot
  reasonably express.
- Backend: Node.js + Express + TypeScript.
- Database: PostgreSQL.
- AI service: Python + FastAPI.
- Initial computer vision stack: OpenCV + InsightFace.
- Introduce YOLO and ByteTrack only when person tracking, occupancy, or seat mapping requires them.
- Do not add DeepFace, FaceNet, TensorFlow, PyTorch, DeepSORT, or other AI frameworks without a demonstrated requirement and an explicit design decision.
- Process video files first. RTSP ingestion is deferred.
- AI inference must work locally before cloud deployment.
- Free-tier deployment is a project constraint; do not require paid GPU infrastructure for the MVP.

## Service boundaries

### Express backend owns

- Authentication and role-based access control.
- Users, students, faculty, courses, classrooms, timetable, and enrollments.
- Attendance sessions, attendance policy, attendance percentages, and the 75 percent detention warning.
- Calling the AI service and translating its results into application records.
- Faculty verification, corrections, disputes, dashboards, reports, alerts, and audit logs.
- Privacy/consent state and retention policy enforcement.

Express is the source of truth for institutional business logic and final attendance.

### FastAPI AI service owns

- Video decoding and frame extraction.
- Face/person detection, tracking, embedding generation, and identity association.
- Temporal confidence aggregation.
- Occupancy and seat mapping when the required detectors/configuration exist.
- Returning structured, versioned inference evidence.

FastAPI produces provisional recognition evidence only. It must not finalize attendance, apply detention policy, manage users, or own faculty corrections.

### Frontend owns

- Role-aware faculty and administrator workflows.
- Current-class processing status.
- Attendance review and uncertain-case verification.
- Correction/dispute interfaces.
- Attendance percentages, detention warnings, occupancy, trends, alerts, and reports.

The UI must make uncertainty visible and must not present every recognition as certain.

## Computer vision rules

Use this approximate pipeline:

```text
video file
  -> frame extraction
  -> detection
  -> tracking when required
  -> face recognition
  -> identity association
  -> temporal confidence aggregation
  -> provisional attendance evidence
  -> faculty verification
```

- Never mark attendance from a single low-confidence recognition.
- Require repeated observations, face-quality checks, a configurable confidence threshold, and a margin over competing identities before classifying a match as confirmed.
- Always support explicit `confirmed`, `uncertain`, and `unknown` states.
- Unknown faces must never be silently assigned to a student.
- Preserve confidence, observation count, model version, and relevant evidence for faculty review.
- Deduplicate a student across camera inputs at the attendance-session level.
- A dedicated person re-identification model is not required for the MVP; add one only if testing demonstrates that recognition embeddings and time/camera association are insufficient.
- Prefer conservative false-positive handling over aggressive automatic attendance.
- Keep engagement analytics experimental and clearly separate from attendance facts.

## Privacy and biometric-data handling

Privacy is a first-class architectural requirement.

- Raw CCTV footage and biometric datasets must never be committed to Git.
- Model weights, embeddings, datasets, videos, generated inference outputs, `.env` files, and Python environments must remain ignored.
- Prefer privacy-preserving face embeddings over retained face images.
- Minimize video retention and delete temporary media according to the documented policy.
- Encrypt biometric data, stored media, backups, and service communication.
- Enforce role-based access to student, biometric, video, attendance, and audit data.
- Require and record student notification/consent before biometric enrollment or processing.
- Support consent withdrawal and a manual attendance/correction path.
- Do not penalize a student solely on unverified recognition evidence.
- Audit enrollment, inference, attendance finalization, corrections, disputes, administrative access, and deletion.
- Do not expose CCTV or AI-service credentials directly to the frontend.

## Data and business rules

Use PostgreSQL for relational academic and attendance data. The design should cover:

- Users, students, faculty, roles, and consent records.
- Classrooms, cameras, courses, timetable entries, class sessions, and enrollments.
- Student identity profiles/embeddings with model and enrollment versions.
- Attendance sessions, observations, provisional evidence, final records, corrections, and disputes.
- Occupancy/seat measurements, alerts, and audit logs.

Important invariants:

- One enrollment per student/course/academic period.
- One final attendance record per student/class session.
- Corrections are append-only and retain the original decision, reason, reviewer, and timestamps.
- Embeddings identify their model version and consent/enrollment context.
- Only enrolled students can receive ordinary attendance records.
- Express, not FastAPI, calculates final attendance percentages and detention warnings.

## MVP scope

The critical MVP is a working vertical slice with seeded academic data, consented demo identities, prerecorded classroom video, detection, recognition, temporal aggregation, provisional attendance, faculty verification, PostgreSQL persistence, and faculty/admin dashboards.

Do not block the MVP on:

- Live RTSP cameras.
- Production ERP/LMS integration.
- Campus-scale distributed inference.
- Dedicated person re-identification.
- Automatic seat discovery.
- Advanced engagement inference.
- Paid GPU hosting.

Add secondary features only after the core flow works, such as two-camera deduplication, manual seat calibration, occupancy/utilization reports, CSV import/export, low-attendance alerts, disputes, and processing-progress events.

## Deployment guidance

The hackathon demo should distinguish local inference from hosted application services:

- React may be deployed to Vercel.
- Express may be deployed to Render or an equivalent free-tier service.
- PostgreSQL may use a free-tier managed provider.
- FastAPI inference should remain locally runnable and may run locally during the demo if hosted CPU limits are unsuitable.

Do not design the MVP around paid GPU infrastructure, persistent local disk on ephemeral hosts, or live camera networking. A future campus deployment can add edge inference, queues, object storage, workers, and RTSP adapters without changing the Express/FastAPI responsibility split.

## Commands

No build, test, lint, or dependency manifests are currently defined in this scaffold. Do not invent commands for unselected tools. When tooling is introduced, document the exact repository commands here, including:

- frontend development, build, lint, type-check, and single-test commands;
- backend development, build, lint, type-check, integration, and single-test commands;
- AI-service development, formatting, type-check, test, and single-test commands;
- database migration and seed commands.

## Change conventions for Copilot sessions

- Read the relevant service boundary and existing API/data contract before editing.
- Implement one demonstrable vertical slice at a time.
- Prefer existing helpers and contracts over duplicating logic.
- Keep AI results provisional until Express/faculty verification finalizes attendance.
- Make invalid input, service failures, uncertain identities, and missing consent explicit; do not silently convert them into successful attendance.
- Add or update directly related documentation when introducing a new architectural boundary, policy, command, or data-retention behavior.
- Never commit secrets, biometric data, classroom recordings, generated model output, model weights, or local environments.
