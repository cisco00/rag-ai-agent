"""
schema_cache.py — Redis-backed schema summary cache.

Why this module exists
──────────────────────
The original cache was a plain dict in api.py.  That breaks in two ways once
you scale past a single process:

  1. A Railway restart cold-starts every worker — every first request to each
     org must re-introspect the database, blocking the LLM call for 1-3 s.
  2. Two Railway replicas each carry a separate cache that diverges silently.
     Invalidating after a config change only fixes one replica.

This module replaces that dict with Redis so the cache is:
  • Shared across all API replicas and the background worker process
  • Persistent across restarts (Redis RDB/AOF)
  • TTL-controlled server-side (no client-side timer thread needed)
  • Safely invalidatable with a single key delete from any process

Fallback behaviour
──────────────────
If REDIS_URL is not configured (local dev, free Railway tier without Redis),
the module transparently falls back to the original in-process dict with a
threading.Lock.  No code change required by callers — just set REDIS_URL in
the Railway environment to get distributed caching.

Cache key design
────────────────
Keys are  schema:<sha256(connection_string)>  — the connection string (which
contains credentials) never appears as a Redis key or log entry.

TTL
───
Default 600 s (10 min), overridable via SCHEMA_CACHE_TTL env var.
Invalidation via invalidate_schema_cache() deletes the key immediately;
the next call to get_cached_schema_summary() rebuilds it.
"""

from __future__ import annotations

import hashlib
import os
import threading
import time
import logging
from typing import Optional, TYPE_CHECKING

if TYPE_CHECKING:
    pass  # avoid circular import; DatabaseManager imported lazily

logger = logging.getLogger(__name__)

# ── Configuration ─────────────────────────────────────────────────────────────

REDIS_URL: Optional[str] = os.getenv("REDIS_URL")          # e.g. redis://default:pw@host:6379
SCHEMA_CACHE_TTL: int    = int(os.getenv("SCHEMA_CACHE_TTL", "600"))  # seconds
_KEY_PREFIX = "schema:"

# ── Redis client (lazy singleton) ─────────────────────────────────────────────

_redis_client      = None
_redis_init_lock   = threading.Lock()
_redis_available   = False   # set to True once a successful ping returns


def _get_redis():
    """
    Return a connected Redis client, or None if Redis is unavailable.
    Initialised once; subsequent calls return the cached client.
    """
    global _redis_client, _redis_available

    if _redis_client is not None:
        return _redis_client if _redis_available else None

    if not REDIS_URL:
        return None

    with _redis_init_lock:
        if _redis_client is not None:           # double-checked
            return _redis_client if _redis_available else None
        try:
            import redis                        # type: ignore
            client = redis.Redis.from_url(
                REDIS_URL,
                decode_responses=True,          # all values are strings
                socket_connect_timeout=2,
                socket_timeout=2,
                retry_on_timeout=True,
            )
            client.ping()
            _redis_client  = client
            _redis_available = True
            logger.info("Schema cache: Redis connected (%s)", REDIS_URL.split("@")[-1])
        except Exception as exc:
            logger.warning(
                "Schema cache: Redis unavailable (%s) — falling back to in-process dict", exc
            )
            _redis_available = False
    return _redis_client if _redis_available else None


# ── In-process fallback ───────────────────────────────────────────────────────
#
# Stores  {cache_key: {"summary": str, "expires_at": float}}
# No background sweep — entries are evicted lazily on next read.

_local_cache: dict  = {}
_local_lock         = threading.Lock()


# ── Public helpers ────────────────────────────────────────────────────────────

def _cache_key(connection_string: str) -> str:
    return _KEY_PREFIX + hashlib.sha256(connection_string.encode()).hexdigest()


def get_cached_schema_summary(connection_string: str) -> Optional[str]:
    """
    Return a cached schema summary string for the given connection string,
    rebuilding it (and re-caching) on a miss or TTL expiry.

    Thread-safe; safe to call from multiple async workers concurrently.
    """
    if not connection_string:
        return None

    key    = _cache_key(connection_string)
    client = _get_redis()

    # ── Try Redis ─────────────────────────────────────────────────────────
    if client:
        try:
            cached = client.get(key)
            if cached:
                logger.debug("Schema cache HIT (Redis) key=%s…", key[8:20])
                return cached
        except Exception as exc:
            logger.warning("Schema cache Redis GET failed: %s", exc)

    # ── Try local fallback ────────────────────────────────────────────────
    with _local_lock:
        entry = _local_cache.get(key)
        if entry and entry["expires_at"] > time.monotonic():
            logger.debug("Schema cache HIT (local) key=%s…", key[8:20])
            return entry["summary"]

    # ── Cache miss — build summary ────────────────────────────────────────
    logger.info("Schema cache MISS — rebuilding for key=%s…", key[8:20])
    summary = _build_schema_summary(connection_string)
    if summary is None:
        return None

    # Store in Redis
    if client:
        try:
            client.setex(key, SCHEMA_CACHE_TTL, summary)
            logger.debug("Schema cache SET (Redis) key=%s…  ttl=%ss", key[8:20], SCHEMA_CACHE_TTL)
        except Exception as exc:
            logger.warning("Schema cache Redis SET failed: %s", exc)

    # Always store in local dict as belt-and-suspenders
    with _local_lock:
        _local_cache[key] = {
            "summary":    summary,
            "expires_at": time.monotonic() + SCHEMA_CACHE_TTL,
        }

    return summary


def invalidate_schema_cache(connection_string: str) -> None:
    """
    Immediately evict the cache entry for this connection string.

    Call whenever:
      • An org updates their database connection string
      • A table is created, dropped, or renamed in an org's database
      • The file-upload database is replaced with a new CSV

    The next call to get_cached_schema_summary() will rebuild from scratch.
    """
    if not connection_string:
        return

    key    = _cache_key(connection_string)
    client = _get_redis()

    if client:
        try:
            deleted = client.delete(key)
            logger.info(
                "Schema cache INVALIDATED (Redis) key=%s… deleted=%s",
                key[8:20], deleted
            )
        except Exception as exc:
            logger.warning("Schema cache Redis DEL failed: %s", exc)

    with _local_lock:
        _local_cache.pop(key, None)

    logger.debug("Schema cache INVALIDATED (local) key=%s…", key[8:20])


def cache_stats() -> dict:
    """
    Return a dict summarising cache state — useful for a /health endpoint.

    Example return value::

        {
            "backend": "redis",
            "redis_url_host": "redis.railway.internal:6379",
            "redis_key_count": 12,
            "local_entries": 0,
            "ttl_seconds": 600
        }
    """
    client = _get_redis()
    stats: dict = {"ttl_seconds": SCHEMA_CACHE_TTL}

    if client:
        try:
            stats["backend"]         = "redis"
            stats["redis_url_host"]  = (REDIS_URL or "").split("@")[-1]
            stats["redis_key_count"] = client.dbsize()
        except Exception:
            stats["backend"] = "redis_error"
    else:
        stats["backend"] = "local_dict"

    with _local_lock:
        stats["local_entries"] = len(_local_cache)

    return stats


# ── Internal ──────────────────────────────────────────────────────────────────

def _build_schema_summary(connection_string: str) -> Optional[str]:
    """
    Introspect the database and return a human-readable schema summary.
    Each line describes one table and its columns with types.
    """
    try:
        # Import lazily to avoid circular imports at module load time
        from database import DatabaseManager  # type: ignore

        db = DatabaseManager(connection_string=connection_string)
        try:
            tables = db.list_tables()
            parts  = []
            for table in tables:
                schema = db.describe_table(table)
                cols   = ", ".join(f"{c[0]} ({c[1]})" for c in schema)
                parts.append(f"Table '{table}': {cols}")
            return "\n".join(parts)
        finally:
            db.close()
    except Exception as exc:
        logger.error("Schema cache: failed to build summary: %s", exc)
        return None
