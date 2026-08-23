import os
from functools import lru_cache
from pathlib import Path

from fastapi import FastAPI

from app.config import InferenceConfig, settings
from app.pipelines.recognition import build_analysis, run_video_inference
from app.schemas import InferenceRequest, InferenceResponse, SamplingConfiguration


app = FastAPI(title="Smart Attendance AI Service", version="0.1.0")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "ai-service"}


@lru_cache(maxsize=1)
def _analysis_for(config: InferenceConfig):
    return build_analysis(config)


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
        return run_video_inference(
            video_path=Path(request.video_path),
            enrollment_dir=Path(request.enrollment_dir),
            config=config,
            analysis=_analysis_for(config),
        )
    except (OSError, RuntimeError, ValueError) as error:
        return InferenceResponse(
            schema_version="1.0",
            model_name=config.model_name,
            model_version=None,
            processing_time_seconds=0,
            video=None,
            sampling=SamplingConfiguration(
                requested_fps=config.sampling_fps,
                frame_interval=1,
            ),
            detected_faces=0,
            sampled_frames=0,
            results=[],
            errors=[str(error)],
            warnings=[
                "Inference did not complete; no attendance was finalized.",
            ],
        )


def server_config() -> tuple[str, int]:
    host = os.getenv("HOST", "127.0.0.1")
    raw_port = os.getenv("PORT", "8000")

    try:
        port = int(raw_port)
    except ValueError as error:
        raise ValueError("PORT must be an integer") from error

    if not 1 <= port <= 65535:
        raise ValueError("PORT must be between 1 and 65535")

    return host, port


if __name__ == "__main__":
    import uvicorn

    host, port = server_config()
    uvicorn.run(app, host=host, port=port)
