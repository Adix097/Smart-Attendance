from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path
from typing import Any

import cv2
import numpy as np
import onnxruntime as ort
from insightface.app import FaceAnalysis


IMAGE_EXTENSIONS = {".bmp", ".jpeg", ".jpg", ".png", ".webp"}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Run an isolated InsightFace buffalo_l recognition experiment."
    )
    parser.add_argument(
        "--enrollment-dir",
        type=Path,
        help="Directory containing one subdirectory per enrolled demo person.",
    )
    parser.add_argument(
        "--test-dir",
        type=Path,
        help="Directory containing test images, optionally in nested directories.",
    )
    parser.add_argument(
        "--threshold",
        type=float,
        default=0.45,
        help="Exploratory cosine-similarity acceptance threshold (default: 0.45).",
    )
    parser.add_argument(
        "--det-size",
        type=int,
        default=640,
        help="Square detector input size (default: 640).",
    )
    parser.add_argument(
        "--init-only",
        action="store_true",
        help="Initialize the model and print diagnostics without reading images.",
    )
    return parser.parse_args()


def image_files(directory: Path) -> list[Path]:
    return sorted(
        path
        for path in directory.rglob("*")
        if path.is_file() and path.suffix.lower() in IMAGE_EXTENSIONS
    )


def normalized_embedding(face: Any) -> np.ndarray | None:
    embedding = np.asarray(face.embedding, dtype=np.float32)
    norm = float(np.linalg.norm(embedding))
    if norm == 0:
        return None
    return embedding / norm


def initialize_model(det_size: int) -> FaceAnalysis:
    available = ort.get_available_providers()
    if "CPUExecutionProvider" not in available:
        raise RuntimeError(
            "CPUExecutionProvider is not available in this ONNX Runtime installation."
        )

    print(f"ONNX Runtime available providers: {', '.join(available)}")
    print("Requested provider: CPUExecutionProvider")

    started = time.perf_counter()
    analysis = FaceAnalysis(
        name="buffalo_l",
        providers=["CPUExecutionProvider"],
    )
    analysis.prepare(ctx_id=0, det_size=(det_size, det_size))
    elapsed = time.perf_counter() - started

    print(f"Model initialization completed in {elapsed:.2f}s")
    for model_name, model in analysis.models.items():
        session = getattr(model, "session", None)
        if session is not None:
            print(f"Model {model_name} providers: {session.get_providers()}")
    return analysis


def load_enrollment(
    analysis: FaceAnalysis, enrollment_dir: Path
) -> dict[str, list[np.ndarray]]:
    if not enrollment_dir.is_dir():
        raise ValueError(f"Enrollment directory does not exist: {enrollment_dir}")

    gallery: dict[str, list[np.ndarray]] = {}
    person_dirs = sorted(path for path in enrollment_dir.iterdir() if path.is_dir())
    if not person_dirs:
        raise ValueError(
            f"Enrollment directory must contain one subdirectory per person: {enrollment_dir}"
        )

    for person_dir in person_dirs:
        files = image_files(person_dir)
        if not files:
            print(f"[enrollment] {person_dir.name}: no supported images; skipped")
            continue

        person_embeddings: list[np.ndarray] = []
        for image_path in files:
            image = cv2.imread(str(image_path))
            if image is None:
                print(f"[enrollment] {image_path}: unreadable; rejected")
                continue

            started = time.perf_counter()
            faces = analysis.get(image)
            elapsed = time.perf_counter() - started
            if len(faces) == 0:
                print(
                    f"[enrollment] {image_path}: zero faces; rejected "
                    f"({elapsed:.2f}s)"
                )
                continue
            if len(faces) > 1:
                print(
                    f"[enrollment] {image_path}: multiple faces ({len(faces)}); "
                    f"rejected ({elapsed:.2f}s)"
                )
                continue

            embedding = normalized_embedding(faces[0])
            if embedding is None:
                print(f"[enrollment] {image_path}: zero-length embedding; rejected")
                continue

            person_embeddings.append(embedding)
            print(
                f"[enrollment] {person_dir.name}/{image_path.name}: accepted "
                f"({elapsed:.2f}s)"
            )

        if person_embeddings:
            gallery[person_dir.name] = person_embeddings
            print(
                f"[enrollment] {person_dir.name}: "
                f"{len(person_embeddings)}/{len(files)} usable images"
            )

    if not gallery:
        raise ValueError("No usable enrollment embeddings were extracted.")
    return gallery


def best_match(
    embedding: np.ndarray, gallery: dict[str, list[np.ndarray]]
) -> tuple[str, float]:
    scores = {
        person: max(float(np.dot(embedding, reference)) for reference in references)
        for person, references in gallery.items()
    }
    return max(scores.items(), key=lambda item: item[1])


def evaluate_tests(
    analysis: FaceAnalysis,
    test_dir: Path,
    gallery: dict[str, list[np.ndarray]],
    threshold: float,
) -> None:
    if not test_dir.is_dir():
        raise ValueError(f"Test directory does not exist: {test_dir}")

    files = image_files(test_dir)
    if not files:
        print("No supported test images found; recognition accuracy was not evaluated.")
        return

    processed_images = 0
    detected_faces = 0
    for image_path in files:
        image = cv2.imread(str(image_path))
        if image is None:
            print(f"[test] {image_path}: unreadable; skipped")
            continue

        started = time.perf_counter()
        faces = analysis.get(image)
        elapsed = time.perf_counter() - started
        processed_images += 1

        if not faces:
            print(f"[test] {image_path.name}: zero faces ({elapsed:.2f}s)")
            continue

        for face_index, face in enumerate(faces, start=1):
            embedding = normalized_embedding(face)
            if embedding is None:
                print(
                    f"[test] {image_path.name} face {face_index}: "
                    "zero-length embedding; skipped"
                )
                continue

            detected_faces += 1
            person, similarity = best_match(embedding, gallery)
            result = "accepted" if similarity >= threshold else "unknown"
            print(
                f"[test] {image_path.name} face {face_index}: "
                f"best_match={person} similarity={similarity:.4f} "
                f"result={result} ({elapsed:.2f}s)"
            )

    print(
        f"Processed {processed_images} test images and {detected_faces} detected faces. "
        "Cosine similarity is not a probability or confidence percentage."
    )
    print(
        "Recognition accuracy was not calculated automatically; provide ground-truth "
        "labels and evaluate results separately."
    )


def main() -> int:
    args = parse_args()
    if not 0 <= args.threshold <= 1:
        raise ValueError("--threshold must be between 0 and 1")
    if args.det_size <= 0:
        raise ValueError("--det-size must be positive")
    if not args.init_only and (args.enrollment_dir is None or args.test_dir is None):
        raise ValueError(
            "--enrollment-dir and --test-dir are required unless --init-only is used"
        )

    analysis = initialize_model(args.det_size)
    if args.init_only:
        print("Initialization-only experiment succeeded.")
        return 0

    assert args.enrollment_dir is not None
    assert args.test_dir is not None
    gallery = load_enrollment(analysis, args.enrollment_dir)
    evaluate_tests(analysis, args.test_dir, gallery, args.threshold)
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (OSError, RuntimeError, ValueError) as error:
        print(f"Experiment failed: {error}", file=sys.stderr)
        sys.exit(1)
