import unittest

import numpy as np

from app.config import InferenceConfig
from app.recognition.aggregation import Observation, aggregate_observations
from app.recognition.gallery import EnrollmentGallery, normalize_embedding
from app.recognition.matching import match_embedding
from app.recognition.tracking import Box, LightweightTracker


def config(**overrides: object) -> InferenceConfig:
    values = {
        "sampling_fps": 2.0,
        "acceptance_threshold": 0.8,
        "unknown_threshold": 0.4,
        "identity_margin_threshold": 0.1,
        "minimum_observations": 3,
    }
    values.update(overrides)
    return InferenceConfig(**values)


class RecognitionTests(unittest.TestCase):
    def test_normalizes_embedding(self) -> None:
        normalized = normalize_embedding(np.array([3.0, 4.0]))
        np.testing.assert_allclose(normalized, np.array([0.6, 0.8]))

    def test_cosine_similarity_selects_best_identity(self) -> None:
        gallery = EnrollmentGallery(
            embeddings={
                "alice": [np.array([1.0, 0.0])],
                "bob": [np.array([0.0, 1.0])],
            },
            accepted_images=2,
            rejected_images=0,
        )

        result = match_embedding(np.array([0.9, 0.1]), gallery)

        self.assertEqual(result.identity, "alice")
        self.assertGreater(result.best_similarity, result.second_best_similarity or 0)

    def test_empty_gallery_is_rejected(self) -> None:
        gallery = EnrollmentGallery({}, accepted_images=0, rejected_images=0)

        with self.assertRaisesRegex(ValueError, "empty enrollment gallery"):
            match_embedding(np.array([1.0, 0.0]), gallery)

    def test_confirmed_after_threshold_and_observation_requirements(self) -> None:
        observations = [
            Observation("alice", 0.9, 0.2, 0.7),
            Observation("alice", 0.88, 0.2, 0.68),
            Observation("alice", 0.92, 0.2, 0.72),
        ]

        result = aggregate_observations(observations, config())[0]

        self.assertEqual(result.status, "confirmed")
        self.assertEqual(result.observation_count, 3)

    def test_insufficient_observations_are_uncertain(self) -> None:
        result = aggregate_observations(
            [Observation("alice", 0.95, 0.2, 0.75)],
            config(),
        )[0]

        self.assertEqual(result.status, "uncertain")

    def test_low_similarity_is_unknown(self) -> None:
        result = aggregate_observations(
            [Observation(None, 0.2, 0.1, 0.1)],
            config(),
        )[0]

        self.assertEqual(result.identity, "unknown")
        self.assertEqual(result.status, "unknown")

    def test_insufficient_identity_margin_is_uncertain(self) -> None:
        observations = [
            Observation("alice", 0.9, 0.86, 0.04),
            Observation("alice", 0.91, 0.87, 0.04),
            Observation("alice", 0.92, 0.88, 0.04),
        ]

        result = aggregate_observations(observations, config())[0]

        self.assertEqual(result.status, "uncertain")

    def test_tracker_keeps_id_for_nearby_boxes(self) -> None:
        tracker = LightweightTracker()
        first = tracker.update([Box(10, 10, 20, 20)], 0)[0]
        second = tracker.update([Box(12, 11, 20, 20)], 1)[0]
        self.assertEqual(first, second)

    def test_tracker_assigns_distinct_ids(self) -> None:
        tracker = LightweightTracker()
        ids = tracker.update([Box(0, 0, 10, 10), Box(100, 100, 10, 10)], 0)
        self.assertEqual(len(set(ids)), 2)


if __name__ == "__main__":
    unittest.main()
