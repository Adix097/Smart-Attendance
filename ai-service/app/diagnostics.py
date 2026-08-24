from __future__ import annotations

from pathlib import Path
from typing import Any

import cv2

from app.config import InferenceConfig
from app.pipelines.recognition import model_version
from app.recognition.aggregation import status_for_sighting
from app.recognition.gallery import load_gallery
from app.recognition.matching import match_embedding
from app.recognition.tracking import LightweightTracker, box_from_face
from app.schemas import BoundingBox, RecognitionSighting, RecognitionTestResponse


def run_recognition_test(image_path: Path, enrollment_dir: Path, config: InferenceConfig, analysis: Any) -> RecognitionTestResponse:
    if not image_path.is_file():
        raise ValueError(f"Image file does not exist: {image_path}")
    image = cv2.imread(str(image_path))
    if image is None:
        raise ValueError(f"Unable to read image: {image_path}")

    gallery = load_gallery(analysis, enrollment_dir)
    faces = analysis.get(image)
    if not faces:
        return RecognitionTestResponse(
            model_name=config.model_name,
            model_version=model_version(),
            sighting=None,
            warnings=["No face detected in the test image."],
        )

    face = faces[0]
    box = box_from_face(face)
    tracker_id = LightweightTracker().update([box], 0)[0]
    match = match_embedding(face.embedding, gallery)
    identity = match.identity if match.best_similarity >= config.unknown_threshold else None
    return RecognitionTestResponse(
        model_name=config.model_name,
        model_version=model_version(),
        sighting=RecognitionSighting(
            timestamp_seconds=0,
            tracker_id=tracker_id,
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
        ),
        warnings=[
            f"Enrollment images accepted: {gallery.accepted_images}",
            f"Enrollment images rejected: {gallery.rejected_images}",
            "Diagnostic only: no attendance, timing, occupancy, or presence decision was created.",
        ],
    )
