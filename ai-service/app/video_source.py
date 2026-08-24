from __future__ import annotations

import base64
import binascii
import contextlib
import tempfile
import uuid
from collections.abc import Iterator
from pathlib import Path

SUPPORTED_VIDEO_EXTENSIONS = {".mp4", ".webm", ".mov", ".avi"}


@contextlib.contextmanager
def resolved_video(
    video_path: str | None,
    video_filename: str | None,
    video_data_base64: str | None,
) -> Iterator[Path]:
    """Yields a readable video path, materializing an upload when one was sent.

    The backend and this service run as separate deployments with separate
    filesystems, so a caller-supplied path is only usable when both run on the
    same host. Uploads are written to this service's own temporary directory and
    removed afterwards.
    """
    if video_data_base64:
        temporary = _write_upload(video_filename or "", video_data_base64)
        try:
            yield temporary
        finally:
            temporary.unlink(missing_ok=True)
        return

    if video_path:
        yield Path(video_path)
        return

    if video_filename:
        raise ValueError("Uploaded video is empty")
    raise ValueError("No video source was provided")


def _write_upload(filename: str, data_base64: str) -> Path:
    if not filename:
        raise ValueError("An uploaded video requires video_filename")
    extension = Path(filename).suffix.lower()
    if extension not in SUPPORTED_VIDEO_EXTENSIONS:
        raise ValueError(f"Unsupported video format: {extension or filename}")

    try:
        content = base64.b64decode(data_base64, validate=True)
    except (binascii.Error, ValueError) as error:
        raise ValueError("Uploaded video is not valid base64 data") from error
    if not content:
        raise ValueError("Uploaded video is empty")

    destination = Path(tempfile.gettempdir()) / f"smart-attendance-{uuid.uuid4()}{extension}"
    destination.write_bytes(content)
    return destination
