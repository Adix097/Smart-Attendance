from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from .gallery import EnrollmentGallery, normalize_embedding


@dataclass(frozen=True)
class Match:
    identity: str
    best_similarity: float
    second_best_similarity: float | None
    identity_margin: float | None


def match_embedding(embedding: np.ndarray, gallery: EnrollmentGallery) -> Match:
    if not gallery.embeddings:
        raise ValueError("Cannot match against an empty enrollment gallery")

    normalized = normalize_embedding(embedding)
    identity_scores = {
        identity: max(float(np.dot(normalized, reference)) for reference in references)
        for identity, references in gallery.embeddings.items()
    }
    ranked = sorted(identity_scores.items(), key=lambda item: item[1], reverse=True)
    identity, best_similarity = ranked[0]
    second_best_similarity = ranked[1][1] if len(ranked) > 1 else None
    identity_margin = (
        best_similarity - second_best_similarity
        if second_best_similarity is not None
        else None
    )
    return Match(
        identity=identity,
        best_similarity=best_similarity,
        second_best_similarity=second_best_similarity,
        identity_margin=identity_margin,
    )
