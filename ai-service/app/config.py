from __future__ import annotations

import os
import tempfile
from dataclasses import dataclass, replace
from pathlib import Path

from dotenv import load_dotenv

PROJECT_ROOT = Path(__file__).resolve().parent.parent
load_dotenv(PROJECT_ROOT / ".env", override=False)

ENROLLMENT_SOURCES = ("local", "supabase")


def _str_env(name: str, default: str = "") -> str:
    return (os.getenv(name) or default).strip()


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

@dataclass(frozen=True)
class EnrollmentConfig:
    source: str = _str_env("ENROLLMENT_SOURCE", "local").lower()
    supabase_url: str = _str_env("SUPABASE_URL").rstrip("/")
    supabase_service_role_key: str = _str_env("SUPABASE_SERVICE_ROLE_KEY")
    supabase_bucket: str = _str_env("SUPABASE_STORAGE_BUCKET", "enrollment")
    cache_dir: str = _str_env("ENROLLMENT_CACHE_DIR")

    def __post_init__(self) -> None:
        if self.source not in ENROLLMENT_SOURCES:
            raise ValueError(
                f"ENROLLMENT_SOURCE must be one of {', '.join(ENROLLMENT_SOURCES)}"
            )
        if self.source != "supabase":
            return
        missing = [
            name
            for name, value in (
                ("SUPABASE_URL", self.supabase_url),
                ("SUPABASE_SERVICE_ROLE_KEY", self.supabase_service_role_key),
                ("SUPABASE_STORAGE_BUCKET", self.supabase_bucket),
            )
            if not value
        ]
        if missing:
            raise ValueError(
                f"ENROLLMENT_SOURCE=supabase requires {', '.join(missing)}"
            )

    def resolved_cache_dir(self) -> Path:
        if self.cache_dir:
            return Path(self.cache_dir)
        return Path(tempfile.gettempdir()) / "smart-attendance-enrollment"

settings = InferenceConfig()
enrollment_settings = EnrollmentConfig()
