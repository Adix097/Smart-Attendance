from __future__ import annotations

import os
import traceback
from contextlib import asynccontextmanager
from functools import lru_cache
from pathlib import Path
from typing import Any

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
import uvicorn

from app.config import InferenceConfig, enrollment_settings, settings
from app.diagnostics import run_recognition_test
from app.logging_util import log_event, rss_mb
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
from app.video_source import resolved_video, resolved_video_bytes


def _empty_failure_response(config: InferenceConfig, errors: list[str]) -> InferenceResponse:
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
        errors=errors,
        warnings=["Inference did not complete; no attendance was finalized."],
    )


@lru_cache(maxsize=2)
def _analysis_for(model_name: str, provider: str, det_size: int):
    """Cache by model identity only — threshold overrides must not reload weights."""
    config = InferenceConfig(
        model_name=model_name,
        provider=provider,
        det_size=det_size,
    )
    log_event(
        "model_init_begin",
        model_name=model_name,
        provider=provider,
        det_size=det_size,
        rss_mb=rss_mb(),
    )
    analysis = build_analysis(config)
    log_event(
        "model_init_complete",
        model_name=model_name,
        provider=provider,
        det_size=det_size,
        rss_mb=rss_mb(),
    )
    return analysis


def _get_analysis(config: InferenceConfig):
    return _analysis_for(config.model_name, config.provider, config.det_size)


def _preload() -> None:
    """Warm InsightFace and the enrollment gallery before the first upload.

    On Render free instances the first inference otherwise pays model download,
    ONNX session build, Supabase sync, and video decode in one request — which
    commonly trips the proxy timeout or the memory limit and surfaces as 502.
    """
    log_event(
        "preload_begin",
        enrollment_source=enrollment_settings.source,
        model_name=settings.model_name,
        rss_mb=rss_mb(),
    )
    analysis = _get_analysis(settings)
    if enrollment_settings.source != "supabase":
        log_event(
            "preload_complete",
            enrollment_source=enrollment_settings.source,
            gallery="skipped_local",
            model_name=settings.model_name,
            rss_mb=rss_mb(),
        )
        return

    gallery = load_enrollment_gallery(
        analysis,
        Path("."),
        settings,
        enrollment_settings,
    )
    log_event(
        "preload_complete",
        enrollment_source=enrollment_settings.source,
        identities=len(gallery.embeddings),
        accepted_images=gallery.accepted_images,
        rejected_images=gallery.rejected_images,
        model_name=settings.model_name,
        rss_mb=rss_mb(),
    )


@asynccontextmanager
async def lifespan(_app: FastAPI):
    try:
        _preload()
    except Exception as error:  # noqa: BLE001 — startup must not take the process down
        log_event(
            "preload_failed",
            error=str(error),
            error_type=type(error).__name__,
            rss_mb=rss_mb(),
        )
    yield


app = FastAPI(
    title="Smart Attendance AI Service",
    version="0.1.0",
    lifespan=lifespan,
)


def _dev_harness_enabled() -> bool:
    return os.getenv("AI_ENABLE_DEV_HARNESS", "").lower() == "true"


def _config_from_overrides(
    *,
    model_name: str | None = None,
    provider: str | None = None,
    sampling_fps: float | None = None,
    acceptance_threshold: float | None = None,
    unknown_threshold: float | None = None,
    identity_margin_threshold: float | None = None,
    minimum_observations: int | None = None,
) -> InferenceConfig:
    return settings.with_overrides(
        model_name=model_name,
        provider=provider,
        sampling_fps=sampling_fps,
        acceptance_threshold=acceptance_threshold,
        unknown_threshold=unknown_threshold,
        identity_margin_threshold=identity_margin_threshold,
        minimum_observations=minimum_observations,
    )


def _execute_inference(
    *,
    video_path: Path,
    enrollment_dir: Path,
    config: InferenceConfig,
    video_bytes: int | None,
    transport: str,
) -> InferenceResponse:
    log_event(
        "inference_run_begin",
        transport=transport,
        video_bytes=video_bytes,
        video_suffix=video_path.suffix,
        enrollment_source=enrollment_settings.source,
        model_name=config.model_name,
        rss_mb=rss_mb(),
    )
    analysis = _get_analysis(config)
    log_event(
        "gallery_load_begin",
        enrollment_source=enrollment_settings.source,
        rss_mb=rss_mb(),
    )
    gallery = load_enrollment_gallery(
        analysis,
        enrollment_dir,
        config,
        enrollment_settings,
    )
    log_event(
        "gallery_load_complete",
        identities=len(gallery.embeddings),
        accepted_images=gallery.accepted_images,
        rejected_images=gallery.rejected_images,
        rss_mb=rss_mb(),
    )
    log_event("video_processing_start", transport=transport, rss_mb=rss_mb())
    try:
        result = run_video_inference(
            video_path=video_path,
            enrollment_dir=enrollment_dir,
            config=config,
            analysis=analysis,
            gallery=gallery,
        )
    except MemoryError as error:
        log_event(
            "inference_failed",
            stage="video_processing",
            failure="memory_error",
            error=str(error) or "MemoryError",
            rss_mb=rss_mb(),
        )
        raise
    except Exception:
        log_event(
            "inference_failed",
            stage="video_processing",
            failure="exception",
            error_type=traceback.format_exc().splitlines()[-1][:200],
            rss_mb=rss_mb(),
        )
        raise

    log_event(
        "inference_run_complete",
        transport=transport,
        sampled_frames=result.sampled_frames,
        detected_faces=result.detected_faces,
        processing_time_seconds=result.processing_time_seconds,
        result_count=len(result.results),
        error_count=len(result.errors),
        rss_mb=rss_mb(),
    )
    return result


def _handle_inference_failure(config: InferenceConfig, error: BaseException) -> InferenceResponse:
    if isinstance(error, MemoryError):
        message = "AI service ran out of memory during inference"
    else:
        message = str(error) or type(error).__name__
    log_event(
        "inference_failed",
        stage="request",
        failure=type(error).__name__,
        error=message[:300],
        rss_mb=rss_mb(),
    )
    return _empty_failure_response(config, [message])


@app.get("/health")
def health() -> dict[str, Any]:
    return {
        "status": "ok",
        "service": "ai-service",
        "enrollment_source": enrollment_settings.source,
        "model_cached": _analysis_for.cache_info().currsize > 0,
        "model_name": settings.model_name,
        "det_size": settings.det_size,
        "rss_mb": rss_mb(),
    }


@app.post("/v1/inference", response_model=InferenceResponse)
def inference(request: InferenceRequest) -> InferenceResponse:
    """JSON inference path (path or base64). Prefer /v1/inference/upload in production."""
    config = _config_from_overrides(
        model_name=request.model_name,
        provider=request.provider,
        sampling_fps=request.sampling_fps,
        acceptance_threshold=request.acceptance_threshold,
        unknown_threshold=request.unknown_threshold,
        identity_margin_threshold=request.identity_margin_threshold,
        minimum_observations=request.minimum_observations,
    )
    base64_chars = len(request.video_data_base64 or "")
    log_event(
        "inference_request",
        transport="json",
        has_path=bool(request.video_path),
        has_upload=bool(request.video_data_base64),
        video_filename_suffix=Path(request.video_filename or "").suffix.lower() or None,
        base64_chars=base64_chars,
        rss_mb=rss_mb(),
    )
    try:
        with resolved_video(
            request.video_path,
            request.video_filename,
            request.video_data_base64,
        ) as video_path:
            return _execute_inference(
                video_path=video_path,
                enrollment_dir=Path(request.enrollment_dir),
                config=config,
                video_bytes=video_path.stat().st_size if video_path.is_file() else None,
                transport="json",
            )
    except (OSError, RuntimeError, ValueError, MemoryError) as error:
        return _handle_inference_failure(config, error)


@app.post("/v1/inference/upload", response_model=InferenceResponse)
async def inference_upload(
    video: UploadFile = File(...),
    enrollment_dir: str = Form(...),
    model_name: str | None = Form(default=None),
    provider: str | None = Form(default=None),
    sampling_fps: float | None = Form(default=None),
    acceptance_threshold: float | None = Form(default=None),
    unknown_threshold: float | None = Form(default=None),
    identity_margin_threshold: float | None = Form(default=None),
    minimum_observations: int | None = Form(default=None),
) -> InferenceResponse:
    """Multipart upload path — avoids a second base64 expansion in the AI process."""
    config = _config_from_overrides(
        model_name=model_name,
        provider=provider,
        sampling_fps=sampling_fps,
        acceptance_threshold=acceptance_threshold,
        unknown_threshold=unknown_threshold,
        identity_margin_threshold=identity_margin_threshold,
        minimum_observations=minimum_observations,
    )
    filename = video.filename or "upload.mp4"
    try:
        payload = await video.read()
    except Exception as error:  # noqa: BLE001
        log_event(
            "inference_failed",
            stage="multipart_read",
            failure=type(error).__name__,
            error=str(error)[:300],
            rss_mb=rss_mb(),
        )
        return _handle_inference_failure(config, error)

    log_event(
        "inference_request",
        transport="multipart",
        video_filename_suffix=Path(filename).suffix.lower() or None,
        video_bytes=len(payload),
        rss_mb=rss_mb(),
    )
    try:
        with resolved_video_bytes(filename, payload) as video_path:
            # Drop the in-memory upload once it lives on disk so inference peak
            # does not keep a second full copy of the recording.
            payload_size = len(payload)
            del payload
            return _execute_inference(
                video_path=video_path,
                enrollment_dir=Path(enrollment_dir),
                config=config,
                video_bytes=payload_size,
                transport="multipart",
            )
    except (OSError, RuntimeError, ValueError, MemoryError) as error:
        return _handle_inference_failure(config, error)


@app.post("/v1/dev/recognition-test", response_model=RecognitionTestResponse)
def recognition_test(request: RecognitionTestRequest) -> RecognitionTestResponse:
    if not _dev_harness_enabled():
        raise HTTPException(status_code=404, detail="Development harness is disabled")
    try:
        analysis = _get_analysis(settings)
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
