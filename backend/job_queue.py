"""
job_queue.py — Async job queue for long-running analytics queries.

Architecture
────────────
No Redis or Celery required — runs entirely in-process using asyncio.

  POST /query/async   → enqueues job, returns {job_id} immediately (< 5ms)
  GET  /query/status/{job_id} → returns {status, result, progress}

Jobs move through these states:
  queued → running → done | failed | timeout

The worker pool (default 3 concurrent workers) pulls from an asyncio.Queue
and runs AnalyticsAgent.run_query in a thread-pool executor so the async
event loop is never blocked.

Persistence
───────────
Jobs are held in memory (JOB_STORE dict).  On Railway, this is fine — the
process is long-lived and clients poll within a few minutes.  For multi-
replica deployments, swap JOB_STORE with a Redis-backed implementation
(just replace _get and _set below).

Timeout
───────
Jobs that exceed JOB_TIMEOUT_SECONDS are cancelled and marked "timeout".
The cleanup task sweeps completed jobs older than JOB_TTL_SECONDS.
"""

import asyncio
import secrets
import time
import traceback
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Callable, Dict, Optional

from logging_config import get_logger

logger = get_logger(__name__)

# ─────────────────────────────────────────────────────────────────────────────
# Configuration
# ─────────────────────────────────────────────────────────────────────────────

JOB_TIMEOUT_SECONDS = 300    # 5 min hard timeout per job
JOB_TTL_SECONDS     = 3600   # completed jobs kept for 1 hr then swept
WORKER_CONCURRENCY  = 3      # max simultaneous agent runs
CLEANUP_INTERVAL    = 300    # sweep orphaned jobs every 5 min


# ─────────────────────────────────────────────────────────────────────────────
# Job model
# ─────────────────────────────────────────────────────────────────────────────

class JobStatus(str, Enum):
    QUEUED  = "queued"
    RUNNING = "running"
    DONE    = "done"
    FAILED  = "failed"
    TIMEOUT = "timeout"


@dataclass
class Job:
    job_id:      str
    org_id:      int
    query:       str
    status:      JobStatus           = JobStatus.QUEUED
    queued_at:   float               = field(default_factory=time.time)
    started_at:  Optional[float]     = None
    finished_at: Optional[float]     = None
    result:      Optional[Dict]      = None
    error:       Optional[str]       = None
    progress:    str                 = "Queued — waiting for a worker"
    # Internal: the asyncio.Task so we can cancel on timeout
    _task:       Any                 = field(default=None, repr=False, compare=False)

    def to_response(self) -> Dict:
        """Safe dict for the HTTP response — never exposes internal fields."""
        elapsed = None
        if self.started_at:
            end = self.finished_at or time.time()
            elapsed = round(end - self.started_at, 1)
        return {
            "job_id":      self.job_id,
            "status":      self.status.value,
            "progress":    self.progress,
            "result":      self.result,
            "error":       self.error,
            "queued_at":   self.queued_at,
            "started_at":  self.started_at,
            "finished_at": self.finished_at,
            "elapsed_s":   elapsed,
        }


# ─────────────────────────────────────────────────────────────────────────────
# In-process store (swap with Redis client for multi-replica)
# ─────────────────────────────────────────────────────────────────────────────

JOB_STORE: Dict[str, Job] = {}
_store_lock = asyncio.Lock()


async def _get(job_id: str) -> Optional[Job]:
    async with _store_lock:
        return JOB_STORE.get(job_id)


async def _set(job: Job) -> None:
    async with _store_lock:
        JOB_STORE[job.job_id] = job


async def _delete(job_id: str) -> None:
    async with _store_lock:
        JOB_STORE.pop(job_id, None)


# ─────────────────────────────────────────────────────────────────────────────
# Queue and worker pool
# ─────────────────────────────────────────────────────────────────────────────

_queue: asyncio.Queue = asyncio.Queue()
_workers: list = []
_cleanup_task: Optional[asyncio.Task] = None


async def enqueue(
    org_id:      int,
    query:       str,
    run_fn:      Callable,   # async or sync callable: run_fn() → dict
) -> str:
    """
    Add a job to the queue.

    Args:
        org_id : The org this job belongs to (for auth checks on /status)
        query  : The natural-language query string (for display only)
        run_fn : Zero-argument callable that performs the work and returns
                 a dict compatible with QueryResponse (text, visualization, …)

    Returns:
        job_id string — return this to the client immediately.
    """
    job_id = secrets.token_hex(12)
    job    = Job(job_id=job_id, org_id=org_id, query=query)
    await _set(job)
    await _queue.put((job_id, run_fn))
    logger.info(f"Job {job_id} enqueued (org={org_id}, query={query[:60]})")
    return job_id


async def get_job(job_id: str) -> Optional[Job]:
    """Fetch a job by ID. Returns None if not found."""
    return await _get(job_id)


# ─────────────────────────────────────────────────────────────────────────────
# Worker
# ─────────────────────────────────────────────────────────────────────────────

async def _worker(worker_id: int) -> None:
    """Pulls jobs from the queue and executes them with a timeout."""
    logger.info(f"Job worker-{worker_id} started")

    while True:
        try:
            job_id, run_fn = await _queue.get()
            job = await _get(job_id)
            if job is None:
                logger.warning(f"Worker-{worker_id}: job {job_id} vanished from store")
                _queue.task_done()
                continue

            # Mark running
            job.status     = JobStatus.RUNNING
            job.started_at = time.time()
            job.progress   = "Running — agent is processing your query…"
            await _set(job)

            logger.info(f"Worker-{worker_id} executing job {job_id}")

            try:
                # run_fn may be a regular (blocking) function — run in thread-pool
                loop   = asyncio.get_event_loop()
                result = await asyncio.wait_for(
                    loop.run_in_executor(None, run_fn),
                    timeout=JOB_TIMEOUT_SECONDS,
                )
                job.status      = JobStatus.DONE
                job.result      = result
                job.progress    = "Done"
                job.finished_at = time.time()
                logger.info(f"Job {job_id} completed in {job.finished_at - job.started_at:.1f}s")

            except asyncio.TimeoutError:
                job.status      = JobStatus.TIMEOUT
                job.error       = f"Query exceeded the {JOB_TIMEOUT_SECONDS}s timeout."
                job.progress    = "Timed out"
                job.finished_at = time.time()
                logger.warning(f"Job {job_id} timed out after {JOB_TIMEOUT_SECONDS}s")

            except Exception as exc:
                job.status      = JobStatus.FAILED
                job.error       = str(exc)
                job.progress    = "Failed"
                job.finished_at = time.time()
                logger.error(f"Job {job_id} failed: {exc}\n{traceback.format_exc()}")

            await _set(job)
            _queue.task_done()

        except asyncio.CancelledError:
            logger.info(f"Worker-{worker_id} shutting down")
            break
        except Exception as exc:
            logger.error(f"Worker-{worker_id} unexpected error: {exc}", exc_info=True)


# ─────────────────────────────────────────────────────────────────────────────
# Cleanup sweep
# ─────────────────────────────────────────────────────────────────────────────

async def _cleanup_loop() -> None:
    """Periodically removes old completed/failed/timeout jobs from the store."""
    while True:
        try:
            await asyncio.sleep(CLEANUP_INTERVAL)
            cutoff = time.time() - JOB_TTL_SECONDS
            to_delete = []
            async with _store_lock:
                for jid, job in list(JOB_STORE.items()):
                    if (
                        job.status in (JobStatus.DONE, JobStatus.FAILED, JobStatus.TIMEOUT)
                        and (job.finished_at or 0) < cutoff
                    ):
                        to_delete.append(jid)
            for jid in to_delete:
                await _delete(jid)
            if to_delete:
                logger.info(f"Cleaned up {len(to_delete)} expired job(s)")
        except asyncio.CancelledError:
            break
        except Exception as exc:
            logger.error(f"Cleanup error: {exc}", exc_info=True)


# ─────────────────────────────────────────────────────────────────────────────
# Lifecycle — call from FastAPI lifespan
# ─────────────────────────────────────────────────────────────────────────────

async def start_job_queue(concurrency: int = WORKER_CONCURRENCY) -> None:
    """Spin up worker tasks. Call once from the FastAPI lifespan startup."""
    global _workers, _cleanup_task
    for i in range(concurrency):
        task = asyncio.create_task(_worker(i), name=f"job-worker-{i}")
        _workers.append(task)
    _cleanup_task = asyncio.create_task(_cleanup_loop(), name="job-cleanup")
    logger.info(f"Job queue started with {concurrency} worker(s)")


async def stop_job_queue() -> None:
    """Cancel all worker tasks. Call from the FastAPI lifespan shutdown."""
    global _workers, _cleanup_task
    for task in _workers:
        task.cancel()
    if _cleanup_task:
        _cleanup_task.cancel()
    await asyncio.gather(*_workers, _cleanup_task, return_exceptions=True)
    _workers.clear()
    _cleanup_task = None
    logger.info("Job queue stopped")