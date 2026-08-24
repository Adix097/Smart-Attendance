import os
from functools import lru_cache
from pathlib import Path

from fastapi import FastAPI, HTTPException
import uvicorn

from app.config import InferenceConfig, enrollment_settings, settings
from app.diagnostics import run_recognition_test
from app.pipelines.recognition import build_analysis, run_video_inference
from app.recognition.enrollment_source import (
    EnrollmentSourceError,
    load_enrollment_gallery,
    refresh_enrollment_gallery,
)
from app.schemas import (
    EnrollmentRefreshResponse,
    InferenceRequest,
    InferenceResponse,
    RecognitionTestRequest,
    RecognitionTestResponse,
    SamplingConfiguration,
)
from app.video_source import resolved_video


app = FastAPI(title="Smart Attendance AI Service", version="0.1.0")


@lru_cache(maxsize=1)
def _analysis_for(config: InferenceConfig):
    return build_analysis(config)


def _dev_harness_enabled() -> bool:
    return os.getenv("AI_ENABLE_DEV_HARNESS", "").lower() == "true"


@app.get("/health")
def health() -> dict[str, str]:
    return {
        "status": "ok",
        "service": "ai-service",
        "enrollment_source": enrollment_settings.source,
    }


@app.post("/v1/inference", response_model=InferenceResponse)
def inference(request: InferenceRequest) -> InferenceResponse:
    config = settings.with_overrides(
        model_name=request.model_name,
        provider=request.provider,
        sampling_fps=request.sampling_fps,
        acceptance_threshold=request.acceptance_threshold,
        unknown_threshold=request.unknown_threshold,
        identity_margin_threshold=request.identity_margin_threshold,
        minimum_observations=request.minimum_observations,
    )
    try:
        analysis = _analysis_for(config)
        with resolved_video(
            request.video_path,
            request.video_filename,
            request.video_data_base64,
        ) as video_path:
            return run_video_inference(
                video_path=video_path,
                enrollment_dir=Path(request.enrollment_dir),
                config=config,
                analysis=analysis,
                gallery=load_enrollment_gallery(
                    analysis,
                    Path(request.enrollment_dir),
                    config,
                    enrollment_settings,
                ),
            )
    except (OSError, RuntimeError, ValueError) as error:
        return InferenceResponse(
            schema_version="1.0",
            model_name=config.model_name,
            model_version=None,
            processing_time_seconds=0,
            video=None,
            sampling=SamplingConfiguration(requested_fps=config.sampling_fps, frame_interval=1),
            detected_faces=0,
            sampled_frames=0,
            results=[],
            sightings=[],
            errors=[str(error)],
            warnings=["Inference did not complete; no attendance was finalized."],
        )


@app.post("/v1/dev/recognition-test", response_model=RecognitionTestResponse)
def recognition_test(request: RecognitionTestRequest) -> RecognitionTestResponse:
    if not _dev_harness_enabled():
        raise HTTPException(status_code=404, detail="Development harness is disabled")
    try:
        analysis = _analysis_for(settings)
        return run_recognition_test(
            image_path=Path(request.image_path),
            enrollment_dir=Path(request.enrollment_dir),
            config=settings,
            analysis=analysis,
            gallery=load_enrollment_gallery(
                analysis,
                Path(request.enrollment_dir),
                settings,
                enrollment_settings,
            ),
        )
    except (OSError, RuntimeError, ValueError) as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


@app.post("/v1/enrollment/refresh", response_model=EnrollmentRefreshResponse)
def refresh_enrollment() -> EnrollmentRefreshResponse:
    try:
        refreshed = refresh_enrollment_gallery(enrollment_settings)
    except EnrollmentSourceError as error:
        raise HTTPException(status_code=502, detail=str(error)) from error
    return EnrollmentRefreshResponse(
        source=refreshed.source,
        identities=refreshed.identities,
        images=refreshed.images,
        warnings=refreshed.warnings,
    )


def server_config() -> tuple[str, int]:
    host = os.getenv("HOST") or "0.0.0.0"
    try:
        port = int(os.getenv("PORT", "8000"))
    except ValueError as error:
        raise ValueError("PORT must be an integer") from error
    if not 1 <= port <= 65535:
        raise ValueError("PORT must be between 1 and 65535")
    return host, port


if __name__ == "__main__":
    host, port = server_config()
    uvicorn.run(app, host=host, port=port)
