"""
update_checker.py — Periodic version checker for on-premise deployments.

Fetches the latest release version from a configurable URL (default: GitHub raw
VERSION file) and compares it to the local VERSION. Results are cached in memory
and exposed via a simple getter for the admin router.

Environment variables
─────────────────────
UPDATE_CHECK_ENABLED          true | false  (default true)
UPDATE_CHECK_URL              URL returning the latest version string
UPDATE_CHECK_INTERVAL_HOURS   Hours between checks (default 6)
CHANGELOG_URL                 URL to the project CHANGELOG
GITHUB_TOKEN                  Optional token for private repo access
"""

import os
import logging
import asyncio
from datetime import datetime, timezone
from typing import Optional

import httpx

logger = logging.getLogger(__name__)

# ── Configuration ────────────────────────────────────────────────────────────

_PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_VERSION_FILE = os.path.join(_PROJECT_ROOT, "VERSION")

UPDATE_CHECK_ENABLED: bool = os.getenv("UPDATE_CHECK_ENABLED", "true").lower() in ("true", "1", "yes")
UPDATE_CHECK_URL: str = os.getenv(
    "UPDATE_CHECK_URL",
    "https://raw.githubusercontent.com/cisco00/rag-ai-agent/main/VERSION",
)
UPDATE_CHECK_INTERVAL_HOURS: int = int(os.getenv("UPDATE_CHECK_INTERVAL_HOURS", "6"))
CHANGELOG_URL: str = os.getenv(
    "CHANGELOG_URL",
    "https://github.com/cisco00/rag-ai-agent/blob/main/CHANGELOG.md",
)
_GITHUB_TOKEN: Optional[str] = os.getenv("GITHUB_TOKEN")

# ── In-memory cache ─────────────────────────────────────────────────────────

_update_status: dict = {
    "update_available": False,
    "current_version": None,
    "latest_version": None,
    "changelog_url": CHANGELOG_URL,
    "checked_at": None,
    "update_command": "bash update.sh",
    "error": None,
    "dismissed_version": None,
}


def _read_local_version() -> str:
    """Read the VERSION file from the project root."""
    try:
        with open(_VERSION_FILE, "r") as f:
            return f.read().strip()
    except FileNotFoundError:
        logger.warning(f"[UpdateChecker] VERSION file not found at {_VERSION_FILE}")
        return "0.0.0"


def _compare_versions(current: str, latest: str) -> bool:
    """
    Return True if `latest` is strictly newer than `current`.
    Uses simple tuple comparison on version segments.
    """
    try:
        def _parse(v: str) -> tuple:
            return tuple(int(x) for x in v.strip().split("."))
        return _parse(latest) > _parse(current)
    except (ValueError, AttributeError):
        logger.warning(f"[UpdateChecker] Could not compare versions: {current!r} vs {latest!r}")
        return False


async def check_for_updates() -> dict:
    """
    Fetch the latest version from the remote URL and update the in-memory cache.
    Safe to call repeatedly — errors are logged but never raised.
    """
    if not UPDATE_CHECK_ENABLED:
        logger.debug("[UpdateChecker] Disabled via UPDATE_CHECK_ENABLED=false")
        return _update_status

    current = _read_local_version()
    _update_status["current_version"] = current

    headers = {"Accept": "text/plain"}
    if _GITHUB_TOKEN:
        headers["Authorization"] = f"token {_GITHUB_TOKEN}"

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(UPDATE_CHECK_URL, headers=headers, follow_redirects=True)
            resp.raise_for_status()
            latest = resp.text.strip()

        _update_status["latest_version"] = latest
        _update_status["update_available"] = _compare_versions(current, latest)
        _update_status["checked_at"] = datetime.now(timezone.utc).isoformat()
        _update_status["error"] = None

        if _update_status["update_available"]:
            logger.info(
                f"[UpdateChecker] Update available: {current} → {latest}"
            )
        else:
            logger.debug(f"[UpdateChecker] Up to date ({current})")

    except httpx.HTTPStatusError as e:
        _update_status["error"] = f"HTTP {e.response.status_code}"
        _update_status["checked_at"] = datetime.now(timezone.utc).isoformat()
        logger.warning(f"[UpdateChecker] HTTP error fetching version: {e}")
    except Exception as e:
        _update_status["error"] = str(e)
        _update_status["checked_at"] = datetime.now(timezone.utc).isoformat()
        logger.warning(f"[UpdateChecker] Failed to check for updates: {e}")

    return _update_status


def get_update_status() -> dict:
    """Return the cached update status (never blocks)."""
    # Ensure current_version is always populated
    if not _update_status["current_version"]:
        _update_status["current_version"] = _read_local_version()
    return dict(_update_status)


def dismiss_version(version: str) -> None:
    """Mark a version as dismissed so the banner doesn't reappear until a newer one is detected."""
    _update_status["dismissed_version"] = version
    logger.info(f"[UpdateChecker] Dismissed update notification for version {version}")


def get_current_version() -> str:
    """Return the local VERSION string."""
    return _read_local_version()
