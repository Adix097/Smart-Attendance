from __future__ import annotations

import os
from dataclasses import dataclass, replace

def _float_env(name: str, default: float) -> float:
    raw_value = os.getenv(name)
    if raw_value is None:
        return default
    try:
        return float(raw_value)
    except ValueError as error:
        raise ValueError(f"{name} must be a number") from error


def _int_env(name: str, default: int) -> int:
    raw_value = os.getenv(name)
    if raw_value is None:
        return default
    try:
        return int(raw_value)
    except ValueError as error:
        raise ValueError(f"{name} must be an integer") from error

@dataclass(frozen=True)
class InferenceConfig:
    model_name: str = os.getenv("AI_MODEL_NAME", "buffalo_l")
    provider: str = os.getenv("AI_PROVIDER", "CPUExecutionProvider")
    sampling_fps: float = _float_env("AI_SAMPLING_FPS", 2.0)
    acceptance_threshold: float = _float_env("AI_ACCEPTANCE_THRESHOLD", 0.45)
    unknown_threshold: float = _float_env("AI_UNKNOWN_THRESHOLD", 0.35)
    identity_margin_threshold: float = _float_env("AI_IDENTITY_MARGIN_THRESHOLD", 0.05)
    minimum_observations: int = _int_env("AI_MINIMUM_OBSERVATIONS", 3)

    def __post_init__(self) -> None:
        if not self.model_name:
            raise ValueError("model_name must not be empty")
        if self.provider != "CPUExecutionProvider":
            raise ValueError("This MVP supports CPUExecutionProvider only")
        if self.sampling_fps <= 0:
            raise ValueError("sampling_fps must be greater than zero")
        if not 0 <= self.unknown_threshold <= 1:
            raise ValueError("unknown_threshold must be between zero and one")
        if not 0 <= self.acceptance_threshold <= 1:
            raise ValueError("acceptance_threshold must be between zero and one")
        if self.unknown_threshold > self.acceptance_threshold:
            raise ValueError("unknown_threshold must not exceed acceptance_threshold")
        if not 0 <= self.identity_margin_threshold <= 2:
            raise ValueError("identity_margin_threshold must be between zero and two")
        if self.minimum_observations < 1:
            raise ValueError("minimum_observations must be at least one")

    def with_overrides(self, **overrides: object) -> InferenceConfig:
        values = {key: value for key, value in overrides.items() if value is not None}
        return replace(self, **values)

settings = InferenceConfig()
