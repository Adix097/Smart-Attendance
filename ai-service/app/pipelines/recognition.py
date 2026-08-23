from __future__ import annotations

import importlib.metadata
import time
from pathlib import Path
from typing import Any

import cv2

from app.config import InferenceConfig
from app.recognition.aggregation import Observation, aggregate_observations
from app.recognition.gallery import load_gallery
from app.recognition.matching import match_embedding
from app.schemas import (
    InferenceResponse,
    SamplingConfiguration,
    VideoMetadata,
)


def build_analysis(config: InferenceConfig) -> Any:
    if config.provider != "CPUExecutionProvider":
        raise ValueError("This MVP supports CPUExecutionProvider only")

    from insightface.app import FaceAnalysis

    analysis = FaceAnalysis(
        name=config.model_name,
        providers=[config.provider],
    )
    analysis.prepare(ctx_id=0, det_size=(640, 640))
    return analysis


def model_version() -> str | None:
    try:
        return importlib.metadata.version("insightface")
    except importlib.metadata.PackageNotFoundError:
        return None


def _frame_interval(source_fps: float, requested_fps: float) -> int:
    if source_fps <= 0:
        return 1
    return max(1, round(source_fps / requested_fps))


def run_video_inference(
    video_path: Path,
    enrollment_dir: Path,
    config: InferenceConfig,
    analysis: Any | None = None,
) -> InferenceResponse:
    started = time.perf_counter()
    if not video_path.is_file():
        raise ValueError(f"Video file does not exist: {video_path}")

    if analysis is None:
        analysis = build_analysis(config)
    gallery = load_gallery(analysis, enrollment_dir)

    capture = cv2.VideoCapture(str(video_path))
    if not capture.isOpened():
        raise ValueError(f"Unable to open video: {video_path}")

    source_fps = float(capture.get(cv2.CAP_PROP_FPS) or 0)
    reported_frames = int(capture.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    frame_interval = _frame_interval(source_fps, config.sampling_fps)
    observations: list[Observation] = []
    sampled_frames = 0
    detected_faces = 0
    frame_index = 0
    warnings: list[str] = []

    try:
        while True:
            success, frame = capture.read()
            if not success:
                break
            if frame_index % frame_interval != 0:
                frame_index += 1
                continue

            sampled_frames += 1
            faces = analysis.get(frame)
            detected_faces += len(faces)
            for face in faces:
                try:
                    match = match_embedding(face.embedding, gallery)
                except ValueError as error:
                    warnings.append(str(error))
                    continue

                identity = (
                    match.identity
                    if match.best_similarity >= config.unknown_threshold
                    else None
                )
                observations.append(
                    Observation(
                        identity=identity,
                        similarity=match.best_similarity,
                        second_best_similarity=match.second_best_similarity,
                        identity_margin=match.identity_margin,
                    )
                )
            frame_index += 1
    finally:
        capture.release()

    total_frames = reported_frames or frame_index
    duration_seconds = (
        total_frames / source_fps if source_fps > 0 and total_frames > 0 else None
    )
    warnings.extend(
        [
            f"Enrollment images accepted: {gallery.accepted_images}",
            f"Enrollment images rejected: {gallery.rejected_images}",
            "Recognition results are provisional evidence; no attendance was finalized.",
            "Cosine similarity is not a probability or confidence percentage.",
        ]
    )
    return InferenceResponse(
        schema_version="1.0",
        model_name=config.model_name,
        model_version=model_version(),
        processing_time_seconds=time.perf_counter() - started,
        video=VideoMetadata(
            path=str(video_path),
            total_frames=total_frames,
            source_fps=source_fps,
            duration_seconds=duration_seconds,
        ),
        sampling=SamplingConfiguration(
            requested_fps=config.sampling_fps,
            frame_interval=frame_interval,
        ),
        detected_faces=detected_faces,
        sampled_frames=sampled_frames,
        results=aggregate_observations(observations, config),
        errors=[],
        warnings=warnings,
    )
