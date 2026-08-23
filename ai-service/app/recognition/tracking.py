from __future__ import annotations

from dataclasses import dataclass
from math import hypot
from typing import Iterable


@dataclass(frozen=True)
class Box:
    x: float
    y: float
    width: float
    height: float


@dataclass
class _Track:
    track_id: str
    box: Box
    last_frame: int


def _iou(first: Box, second: Box) -> float:
    left = max(first.x, second.x)
    top = max(first.y, second.y)
    right = min(first.x + first.width, second.x + second.width)
    bottom = min(first.y + first.height, second.y + second.height)
    intersection = max(0.0, right - left) * max(0.0, bottom - top)
    union = first.width * first.height + second.width * second.height - intersection
    return intersection / union if union else 0.0


class LightweightTracker:
    """Temporary per-video tracker; replaceable by a full MOT implementation later."""

    def __init__(self, max_gap_frames: int = 8) -> None:
        self._tracks: list[_Track] = []
        self._next_id = 1
        self._max_gap_frames = max_gap_frames

    def update(self, boxes: Iterable[Box], frame_index: int) -> list[str]:
        active = [
            track
            for track in self._tracks
            if frame_index - track.last_frame <= self._max_gap_frames
        ]
        assignments: list[str] = []
        used: set[str] = set()
        for box in boxes:
            candidates = [
                track
                for track in active
                if track.track_id not in used
                and (
                    _iou(track.box, box) >= 0.2
                    or hypot(
                        (track.box.x + track.box.width / 2) - (box.x + box.width / 2),
                        (track.box.y + track.box.height / 2)
                        - (box.y + box.height / 2),
                    )
                    <= max(track.box.width, track.box.height, box.width, box.height)
                )
            ]
            match = max(candidates, key=lambda track: _iou(track.box, box), default=None)
            if match is None:
                match = _Track(f"track-{self._next_id:03d}", box, frame_index)
                self._next_id += 1
                active.append(match)
            else:
                match.box = box
                match.last_frame = frame_index
            used.add(match.track_id)
            assignments.append(match.track_id)
        self._tracks = active
        return assignments
