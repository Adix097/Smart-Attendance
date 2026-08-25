from __future__ import annotations

import json
import logging
import sys
from typing import Any

_logger = logging.getLogger("smart-attendance.ai")
if not _logger.handlers:
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(logging.Formatter("%(message)s"))
    _logger.addHandler(handler)
    _logger.setLevel(logging.INFO)


def rss_mb() -> float | None:
    """Best-effort resident memory (MiB). Available on Linux (Render); None elsewhere."""
    try:
        with open("/proc/self/status", encoding="utf-8") as handle:
            for line in handle:
                if line.startswith("VmRSS:"):
                    return round(int(line.split()[1]) / 1024.0, 1)
    except (OSError, ValueError, IndexError):
        return None
    return None


def log_event(event: str, **fields: Any) -> None:
    """Structured one-line JSON logs. Never pass video bytes or secrets here."""
    payload = {"event": event, **fields}
    _logger.info(json.dumps(payload, default=str))
