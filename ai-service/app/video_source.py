from __future__ import annotations

import base64
import binascii
import contextlib
import tempfile
import uuid
from collections.abc import Iterator
from pathlib import Path

from app.logging_util import log_event

SUPPORTED_VIDEO_EXTENSIONS = {".mp4", ".webm", ".mov", ".avi"}
# Decode in chunks so peak RAM is not 2x the full base64 string + full binary.
_DECODE_CHUNK_CHARS = 1024 * 1024


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
            log_event("temp_video_removed", path_suffix=temporary.suffix)
        return

    if video_path:
        log_event("video_path_used", exists=Path(video_path).is_file())
        yield Path(video_path)
        return

    if video_filename:
        raise ValueError("Uploaded video is empty")
    raise ValueError("No video source was provided")


@contextlib.contextmanager
def resolved_video_bytes(
    video_filename: str,
    video_bytes: bytes,
) -> Iterator[Path]:
    """Write raw uploaded bytes to a temp file (multipart path)."""
    if not video_filename:
        raise ValueError("An uploaded video requires video_filename")
    extension = Path(video_filename).suffix.lower()
    if extension not in SUPPORTED_VIDEO_EXTENSIONS:
        raise ValueError(f"Unsupported video format: {extension or video_filename}")
    if not video_bytes:
        raise ValueError("Uploaded video is empty")

    destination = Path(tempfile.gettempdir()) / f"smart-attendance-{uuid.uuid4()}{extension}"
    destination.write_bytes(video_bytes)
    log_event(
        "temp_video_created",
        source="multipart_bytes",
        bytes=len(video_bytes),
        suffix=extension,
    )
    try:
        yield destination
    finally:
        destination.unlink(missing_ok=True)
        log_event("temp_video_removed", path_suffix=extension)


def _write_upload(filename: str, data_base64: str) -> Path:
    if not filename:
        raise ValueError("An uploaded video requires video_filename")
    extension = Path(filename).suffix.lower()
    if extension not in SUPPORTED_VIDEO_EXTENSIONS:
        raise ValueError(f"Unsupported video format: {extension or filename}")

    destination = Path(tempfile.gettempdir()) / f"smart-attendance-{uuid.uuid4()}{extension}"
    written = 0
    try:
        with destination.open("wb") as handle:
            # Base64 length must be a multiple of 4; keep a small carry between chunks.
            carry = ""
            start = 0
            length = len(data_base64)
            while start < length:
                end = min(start + _DECODE_CHUNK_CHARS, length)
                chunk = carry + data_base64[start:end]
                usable = len(chunk) - (len(chunk) % 4)
                if usable:
                    try:
                        piece = base64.b64decode(chunk[:usable], validate=True)
                    except (binascii.Error, ValueError) as error:
                        raise ValueError("Uploaded video is not valid base64 data") from error
                    handle.write(piece)
                    written += len(piece)
                carry = chunk[usable:]
                start = end
            if carry:
                try:
                    piece = base64.b64decode(carry, validate=True)
                except (binascii.Error, ValueError) as error:
                    raise ValueError("Uploaded video is not valid base64 data") from error
                handle.write(piece)
                written += len(piece)
    except Exception:
        destination.unlink(missing_ok=True)
        raise

    if written == 0:
        destination.unlink(missing_ok=True)
        raise ValueError("Uploaded video is empty")

    log_event(
        "temp_video_created",
        source="base64",
        base64_chars=len(data_base64),
        bytes=written,
        suffix=extension,
    )
    return destination
