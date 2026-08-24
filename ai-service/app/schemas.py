from __future__ import annotations
from typing import Literal
from pydantic import BaseModel, Field


RecognitionStatus = Literal["confirmed", "uncertain", "unknown"]


class InferenceRequest(BaseModel):
    video_path: str = Field(min_length=1)
    enrollment_dir: str = Field(min_length=1)
    model_name: str | None = None
    provider: str | None = None
    sampling_fps: float | None = Field(default=None, gt=0)
    acceptance_threshold: float | None = Field(default=None, ge=0, le=1)
    unknown_threshold: float | None = Field(default=None, ge=0, le=1)
    identity_margin_threshold: float | None = Field(default=None, ge=0, le=2)
    minimum_observations: int | None = Field(default=None, ge=1)


class VideoMetadata(BaseModel):
    path: str
    total_frames: int
    source_fps: float
    duration_seconds: float | None


class SamplingConfiguration(BaseModel):
    requested_fps: float
    frame_interval: int


class RecognitionResult(BaseModel):
    identity: str
    status: RecognitionStatus
    observation_count: int
    best_similarity: float | None
    average_similarity: float | None
    second_best_similarity: float | None
    identity_margin: float | None


class BoundingBox(BaseModel):
    x: float
    y: float
    width: float
    height: float


class RecognitionSighting(BaseModel):
    timestamp_seconds: float
    tracker_id: str
    identity: str | None
    status: RecognitionStatus
    best_similarity: float | None
    second_best_similarity: float | None
    identity_margin: float | None
    camera_id: str | None = None
    bbox: BoundingBox | None = None


class InferenceResponse(BaseModel):
    schema_version: str
    model_name: str
    model_version: str | None
    processing_time_seconds: float
    video: VideoMetadata | None
    sampling: SamplingConfiguration
    detected_faces: int
    sampled_frames: int
    results: list[RecognitionResult]
    sightings: list[RecognitionSighting]
    errors: list[str]
    warnings: list[str]


class RecognitionTestRequest(BaseModel):
    image_path: str = Field(min_length=1)
    enrollment_dir: str = Field(min_length=1)


class RecognitionTestResponse(BaseModel):
    model_name: str
    model_version: str | None
    sighting: RecognitionSighting | None
    warnings: list[str]
