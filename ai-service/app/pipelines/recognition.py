from __future__ import annotations

import os

# Cap ONNX Runtime thread pools before any ORT session is created. Extra
# threads inflate RSS without helping single-video CPU inference on Render.
os.environ.setdefault("OMP_NUM_THREADS", "1")
os.environ.setdefault("ORT_NUM_THREADS", "1")
os.environ.setdefault("OPENCV_THREAD_COUNT", "1")

import importlib.metadata
import time
from pathlib import Path
from typing import Any

import cv2
import numpy as np
import onnxruntime as ort

from app.config import InferenceConfig
from app.logging_util import log_event, rss_mb
from app.recognition.aggregation import (
    Observation,
    aggregate_observations,
    status_for_sighting,
)
from app.recognition.gallery import EnrollmentGallery, load_gallery
from app.recognition.matching import match_embedding
from app.recognition.tracking import Box, LightweightTracker, box_from_face
from app.schemas import (
    BoundingBox,
    InferenceResponse,
    RecognitionSighting,
    SamplingConfiguration,
    VideoMetadata,
)

from insightface.app import FaceAnalysis

# Attendance only needs boxes + embeddings. Landmark / genderage packs are unused
# and add tens to hundreds of MiB for buffalo_l / buffalo_s.
_ALLOWED_MODULES = ("detection", "recognition")
_HEAVY_MODELS = frozenset({"buffalo_l", "buffalo_m", "antelopev2"})


def _allow_heavy_models() -> bool:
    """Heavy packs are blocked on memory-constrained hosts, not on a normal laptop.

    Render sets RENDER=true. Local Vite/backend against a local AI service should
    still be able to run buffalo_l if the operator chooses it in .env.
    """
    if os.getenv("AI_ALLOW_HEAVY_MODELS", "").lower() == "true":
        return True
    if os.getenv("AI_ALLOW_HEAVY_MODELS", "").lower() == "false":
        return False
    # Explicit 512MiB guard for any host (useful when testing the free-tier path).
    if os.getenv("AI_ENFORCE_MEMORY_BUDGET", "").lower() == "true":
        return False
    # Managed Render instances are the constrained deployment target.
    if os.getenv("RENDER", "").lower() == "true":
        return False
    return True


def _configure_onnx_runtime() -> None:
    """Document preferred SessionOptions; thread env vars above are the real control.

    InsightFace constructs its own InferenceSession objects, so we cannot inject
    these options directly — OMP/ORT_NUM_THREADS still constrain the CPU pools.
    """
    try:
        opts = ort.SessionOptions()
        opts.intra_op_num_threads = 1
        opts.inter_op_num_threads = 1
        opts.enable_mem_pattern = True
        _ = opts
    except Exception:  # noqa: BLE001
        pass


_configure_onnx_runtime()


def build_analysis(config: InferenceConfig) -> Any:
    if config.provider != "CPUExecutionProvider":
        raise ValueError("This MVP supports CPUExecutionProvider only")
    if config.model_name in _HEAVY_MODELS and not _allow_heavy_models():
        raise ValueError(
            f"Model '{config.model_name}' is too large for a 512MiB instance. "
            "Use buffalo_sc (default), or set AI_ALLOW_HEAVY_MODELS=true on a larger plan."
        )

    log_event(
        "model_build_begin",
        model_name=config.model_name,
        det_size=config.det_size,
        allowed_modules=list(_ALLOWED_MODULES),
        rss_mb=rss_mb(),
    )
    analysis = FaceAnalysis(
        name=config.model_name,
        allowed_modules=list(_ALLOWED_MODULES),
        providers=[config.provider],
    )
    # ctx_id=-1 forces CPU provider paths inside InsightFace helpers.
    analysis.prepare(ctx_id=-1, det_size=(config.det_size, config.det_size))
    log_event(
        "model_build_complete",
        model_name=config.model_name,
        det_size=config.det_size,
        loaded_modules=sorted(analysis.models.keys()),
        rss_mb=rss_mb(),
    )
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


def _downscale_for_detection(frame: np.ndarray, max_side: int) -> tuple[np.ndarray, float]:
    """Shrink oversized frames before detection to cut SCRFD activation memory.

    Recognition still runs on aligned face crops; only the detector input shrinks.
    Coordinates are scaled back to the original frame space for sighting bboxes.
    """
    height, width = frame.shape[:2]
    longest = max(height, width)
    if longest <= max_side:
        return frame, 1.0
    scale = max_side / float(longest)
    resized = cv2.resize(
        frame,
        (max(1, int(width * scale)), max(1, int(height * scale))),
        interpolation=cv2.INTER_AREA,
    )
    return resized, scale


def run_video_inference(
    video_path: Path,
    enrollment_dir: Path,
    config: InferenceConfig,
    analysis: Any | None = None,
    gallery: EnrollmentGallery | None = None,
) -> InferenceResponse:
    started = time.perf_counter()
    if not video_path.is_file():
        raise ValueError(f"Video file does not exist: {video_path}")

    if analysis is None:
        analysis = build_analysis(config)
    if gallery is None:
        gallery = load_gallery(analysis, enrollment_dir)

    capture = cv2.VideoCapture(str(video_path))
    if not capture.isOpened():
        raise ValueError(f"Unable to open video: {video_path}")

    # One decode thread is enough and avoids OpenCV spawning extras on Render.
    try:
        cv2.setNumThreads(1)
    except Exception:  # noqa: BLE001
        pass

    source_fps = float(capture.get(cv2.CAP_PROP_FPS) or 0)
    reported_frames = int(capture.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    frame_interval = _frame_interval(source_fps, config.sampling_fps)

    tracker = LightweightTracker()
    observations: list[Observation] = []
    sightings: list[RecognitionSighting] = []
    warnings: list[str] = []
    sampled_frames = 0
    detected_faces = 0
    frame_index = 0
    peak_rss = rss_mb()

    log_event(
        "video_loop_begin",
        source_fps=source_fps,
        reported_frames=reported_frames,
        frame_interval=frame_interval,
        max_detection_side=config.max_detection_side,
        rss_mb=peak_rss,
    )

    try:
        while True:
            # grab() advances without decoding; retrieve()/read() only for sampled frames.
            if frame_index % frame_interval != 0:
                if not capture.grab():
                    break
                frame_index += 1
                continue

            success, frame = capture.read()
            if not success:
                break

            sampled_frames += 1
            detect_frame, scale = _downscale_for_detection(frame, config.max_detection_side)
            # Drop the full-resolution buffer before ORT runs when we downscaled.
            if scale != 1.0:
                del frame
                frame = None  # type: ignore[assignment]

            faces = analysis.get(detect_frame)
            detected_faces += len(faces)
            inv = 1.0 / scale
            boxes: list[Box] = []
            for face in faces:
                box = box_from_face(face)
                if scale != 1.0:
                    box = Box(
                        x=box.x * inv,
                        y=box.y * inv,
                        width=box.width * inv,
                        height=box.height * inv,
                    )
                boxes.append(box)

            tracker_ids = tracker.update(boxes, frame_index)
            timestamp_seconds = frame_index / source_fps if source_fps > 0 else 0.0

            for face_index, face in enumerate(faces):
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
                box = boxes[face_index]
                sightings.append(
                    RecognitionSighting(
                        timestamp_seconds=timestamp_seconds,
                        tracker_id=tracker_ids[face_index],
                        identity=identity,
                        status=status_for_sighting(
                            match.best_similarity,
                            match.identity_margin,
                            config,
                        ),
                        best_similarity=match.best_similarity,
                        second_best_similarity=match.second_best_similarity,
                        identity_margin=match.identity_margin,
                        bbox=BoundingBox(
                            x=box.x,
                            y=box.y,
                            width=box.width,
                            height=box.height,
                        ),
                    )
                )

            del detect_frame, faces, boxes
            current_rss = rss_mb()
            if current_rss is not None and (peak_rss is None or current_rss > peak_rss):
                peak_rss = current_rss
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
    log_event(
        "video_loop_complete",
        sampled_frames=sampled_frames,
        detected_faces=detected_faces,
        peak_rss_mb=peak_rss,
        rss_mb=rss_mb(),
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
        sightings=sightings,
        errors=[],
        warnings=warnings,
    )
