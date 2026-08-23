from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

import cv2
import numpy as np


IMAGE_EXTENSIONS = {".bmp", ".jpeg", ".jpg", ".png", ".webp"}


@dataclass
class EnrollmentGallery:
    embeddings: dict[str, list[np.ndarray]]
    accepted_images: int
    rejected_images: int


def normalize_embedding(embedding: Any) -> np.ndarray:
    vector = np.asarray(embedding, dtype=np.float32)
    norm = float(np.linalg.norm(vector))
    if norm == 0:
        raise ValueError("embedding norm must be greater than zero")
    return vector / norm


def _image_files(directory: Path) -> list[Path]:
    return sorted(
        path
        for path in directory.rglob("*")
        if path.is_file() and path.suffix.lower() in IMAGE_EXTENSIONS
    )


def load_gallery(analysis: Any, enrollment_dir: Path) -> EnrollmentGallery:
    if not enrollment_dir.is_dir():
        raise ValueError(f"Enrollment directory does not exist: {enrollment_dir}")

    person_dirs = sorted(path for path in enrollment_dir.iterdir() if path.is_dir())
    if not person_dirs:
        raise ValueError(
            "Enrollment directory must contain one subdirectory per identity"
        )

    embeddings: dict[str, list[np.ndarray]] = {}
    accepted_images = 0
    rejected_images = 0

    for person_dir in person_dirs:
        for image_path in _image_files(person_dir):
            image = cv2.imread(str(image_path))
            if image is None:
                rejected_images += 1
                continue

            faces = analysis.get(image)
            if len(faces) != 1:
                rejected_images += 1
                continue

            try:
                embedding = normalize_embedding(faces[0].embedding)
            except ValueError:
                rejected_images += 1
                continue

            embeddings.setdefault(person_dir.name, []).append(embedding)
            accepted_images += 1

    if not embeddings:
        raise ValueError("No usable enrollment embeddings were extracted")

    return EnrollmentGallery(
        embeddings=embeddings,
        accepted_images=accepted_images,
        rejected_images=rejected_images,
    )
