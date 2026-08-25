from __future__ import annotations

import json
import shutil
import threading
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from app.config import EnrollmentConfig, InferenceConfig
from app.logging_util import log_event, rss_mb
from app.recognition.gallery import IMAGE_EXTENSIONS, EnrollmentGallery, load_gallery

LIST_PAGE_SIZE = 100
REQUEST_TIMEOUT_SECONDS = 30.0


class EnrollmentSourceError(RuntimeError):
    pass


@dataclass(frozen=True)
class GalleryRefresh:
    source: str
    identities: int
    images: int
    warnings: list[str]


_cache_lock = threading.Lock()
_synced_dir: Path | None = None
_gallery_cache: dict[tuple[str, str, str], EnrollmentGallery] = {}


def _storage_request(
    config: EnrollmentConfig, url: str, payload: dict[str, Any] | None = None
) -> bytes:
    headers = {
        "apikey": config.supabase_service_role_key,
        "authorization": f"Bearer {config.supabase_service_role_key}",
    }
    body: bytes | None = None
    if payload is not None:
        body = json.dumps(payload).encode("utf-8")
        headers["content-type"] = "application/json"

    request = urllib.request.Request(
        url,
        data=body,
        headers=headers,
        method="GET" if body is None else "POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=REQUEST_TIMEOUT_SECONDS) as response:
            return response.read()
    except urllib.error.HTTPError as error:
        if error.code in (401, 403):
            raise EnrollmentSourceError(
                "Supabase Storage rejected the service-role credentials"
            ) from error
        if error.code == 404:
            raise EnrollmentSourceError(
                f"Supabase Storage bucket or object not found: {config.supabase_bucket}"
            ) from error
        raise EnrollmentSourceError(
            f"Supabase Storage request failed with HTTP {error.code}"
        ) from error
    except (urllib.error.URLError, TimeoutError, OSError) as error:
        raise EnrollmentSourceError(f"Unable to reach Supabase Storage: {error}") from error


def _list_entries(config: EnrollmentConfig, prefix: str) -> list[dict[str, Any]]:
    url = f"{config.supabase_url}/storage/v1/object/list/{config.supabase_bucket}"
    entries: list[dict[str, Any]] = []
    offset = 0
    while True:
        raw = _storage_request(
            config,
            url,
            {"prefix": prefix, "limit": LIST_PAGE_SIZE, "offset": offset},
        )
        try:
            page = json.loads(raw)
        except json.JSONDecodeError as error:
            raise EnrollmentSourceError(
                "Supabase Storage returned an unreadable listing"
            ) from error
        if not isinstance(page, list):
            raise EnrollmentSourceError(
                "Supabase Storage returned an unexpected listing payload"
            )
        entries.extend(item for item in page if isinstance(item, dict))
        if len(page) < LIST_PAGE_SIZE:
            return entries
        offset += LIST_PAGE_SIZE


def _is_safe_component(value: object) -> bool:
    return (
        isinstance(value, str)
        and bool(value)
        and value not in {".", ".."}
        and "/" not in value
        and "\\" not in value
    )


def _identity_prefixes(config: EnrollmentConfig) -> list[str]:
    identities = set()
    for entry in _list_entries(config, ""):
        if entry.get("id") is not None:
            continue
        name = entry.get("name")
        folder = name.rstrip("/") if isinstance(name, str) else name
        if _is_safe_component(folder):
            identities.add(str(folder))
    return sorted(identities)


def _image_names(config: EnrollmentConfig, identity: str) -> list[str]:
    return sorted(
        str(entry["name"])
        for entry in _list_entries(config, f"{identity}/")
        if entry.get("id") is not None
        and _is_safe_component(entry.get("name"))
        and Path(str(entry["name"])).suffix.lower() in IMAGE_EXTENSIONS
    )


def _download(config: EnrollmentConfig, object_path: str) -> bytes:
    quoted = urllib.parse.quote(object_path)
    url = f"{config.supabase_url}/storage/v1/object/{config.supabase_bucket}/{quoted}"
    return _storage_request(config, url)


def _sync(config: EnrollmentConfig) -> tuple[Path, int, int]:
    target = config.resolved_cache_dir()
    staging = target.parent / f"{target.name}.partial"
    shutil.rmtree(staging, ignore_errors=True)
    log_event(
        "gallery_sync_begin",
        bucket=config.supabase_bucket,
        rss_mb=rss_mb(),
    )

    identities = 0
    images = 0
    try:
        for identity in _identity_prefixes(config):
            names = _image_names(config, identity)
            if not names:
                continue
            identities += 1
            for name in names:
                content = _download(config, f"{identity}/{name}")
                if not content:
                    continue
                destination = staging / identity / name
                destination.parent.mkdir(parents=True, exist_ok=True)
                destination.write_bytes(content)
                images += 1

        if images == 0:
            raise EnrollmentSourceError(
                f"Supabase Storage bucket '{config.supabase_bucket}' contains no enrollment images"
            )

        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.rmtree(target, ignore_errors=True)
        staging.replace(target)
    finally:
        shutil.rmtree(staging, ignore_errors=True)

    log_event(
        "gallery_sync_complete",
        identities=identities,
        images=images,
        rss_mb=rss_mb(),
    )
    return target, identities, images


def _cache_key(directory: Path, config: InferenceConfig) -> tuple[str, str, str]:
    return (str(directory), config.model_name, config.provider)


def load_enrollment_gallery(
    analysis: Any,
    requested_dir: Path,
    config: InferenceConfig,
    enrollment_config: EnrollmentConfig,
) -> EnrollmentGallery:
    global _synced_dir

    if enrollment_config.source == "local":
        log_event("gallery_load_local", path_exists=requested_dir.is_dir())
        return load_gallery(analysis, requested_dir)

    with _cache_lock:
        if _synced_dir is None:
            _synced_dir, _, _ = _sync(enrollment_config)

        key = _cache_key(_synced_dir, config)
        gallery = _gallery_cache.get(key)
        if gallery is None:
            log_event("gallery_embeddings_build_begin", rss_mb=rss_mb())
            gallery = load_gallery(analysis, _synced_dir)
            _gallery_cache[key] = gallery
            log_event(
                "gallery_embeddings_build_complete",
                identities=len(gallery.embeddings),
                accepted_images=gallery.accepted_images,
                rss_mb=rss_mb(),
            )
        else:
            log_event("gallery_cache_hit", identities=len(gallery.embeddings))
        return gallery


def refresh_enrollment_gallery(enrollment_config: EnrollmentConfig) -> GalleryRefresh:
    global _synced_dir

    if enrollment_config.source == "local":
        with _cache_lock:
            _gallery_cache.clear()
        return GalleryRefresh(
            source=enrollment_config.source,
            identities=0,
            images=0,
            warnings=[
                "ENROLLMENT_SOURCE=local reads the enrollment directory on every request; "
                "there is no cached gallery to refresh."
            ],
        )

    with _cache_lock:
        directory, identities, images = _sync(enrollment_config)
        _synced_dir = directory
        _gallery_cache.clear()
    return GalleryRefresh(
        source=enrollment_config.source,
        identities=identities,
        images=images,
        warnings=[],
    )
