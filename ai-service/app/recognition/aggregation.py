from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from statistics import mean

from app.config import InferenceConfig
from app.schemas import RecognitionResult


@dataclass(frozen=True)
class Observation:
    identity: str | None
    similarity: float
    second_best_similarity: float | None
    identity_margin: float | None


def status_for_sighting(
    best_similarity: float,
    identity_margin: float | None,
    config: InferenceConfig,
) -> str:
    if best_similarity < config.unknown_threshold:
        return "unknown"
    if best_similarity < config.acceptance_threshold:
        return "uncertain"
    if (
        identity_margin is not None
        and identity_margin < config.identity_margin_threshold
    ):
        return "uncertain"
    return "confirmed"


def _aggregate_status(
    observation_count: int,
    best_similarity: float,
    identity_margin: float | None,
    config: InferenceConfig,
) -> str:
    status = status_for_sighting(best_similarity, identity_margin, config)
    if status == "confirmed" and observation_count < config.minimum_observations:
        return "uncertain"
    return status


def aggregate_observations(
    observations: list[Observation], config: InferenceConfig
) -> list[RecognitionResult]:
    grouped: dict[str, list[Observation]] = defaultdict(list)
    for observation in observations:
        grouped[observation.identity or "unknown"].append(observation)

    results: list[RecognitionResult] = []
    for identity, items in sorted(grouped.items()):
        similarities = [item.similarity for item in items]
        second_scores = [
            item.second_best_similarity
            for item in items
            if item.second_best_similarity is not None
        ]
        margins = [
            item.identity_margin
            for item in items
            if item.identity_margin is not None
        ]
        best_similarity = max(similarities)
        average_similarity = mean(similarities)
        average_margin = mean(margins) if margins else None
        results.append(
            RecognitionResult(
                identity=identity,
                status=_aggregate_status(
                    len(items), best_similarity, average_margin, config
                ),
                observation_count=len(items),
                best_similarity=best_similarity,
                average_similarity=average_similarity,
                second_best_similarity=mean(second_scores) if second_scores else None,
                identity_margin=average_margin,
            )
        )
    return results
