"""In-process job store for renders.

A render is CPU-bound and takes minutes, so it can't happen inside the request.
Jobs run on a small thread pool and the client polls (or streams) progress.

Deliberately in-memory: one container, one job table. If you scale past a
single replica, swap `_JOBS` for Redis and `work_dir` for object storage —
those are the only two things holding state.
"""

import shutil
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Dict, List, Optional

from .config import settings

QUEUED, RUNNING, DONE, ERROR = "queued", "running", "done", "error"


@dataclass
class Job:
    id: str
    workdir: Path
    status: str = QUEUED
    percent: float = 0.0
    label: str = "Queued"
    error: Optional[str] = None
    result: Optional[Path] = None
    filename: str = "dealership-reel.mp4"
    logs: List[dict] = field(default_factory=list)
    created_at: float = field(default_factory=time.time)
    finished_at: Optional[float] = None
    # Bumped on every mutation so the SSE stream can send only real changes
    # instead of re-emitting identical frames every tick.
    revision: int = 0


class JobStore:
    def __init__(self) -> None:
        self._jobs: Dict[str, Job] = {}
        self._lock = threading.Lock()
        self._pool = ThreadPoolExecutor(
            max_workers=max(1, settings.max_concurrent_renders),
            thread_name_prefix="render",
        )

    # --- lifecycle ----------------------------------------------------------
    def create(self, filename: str = "dealership-reel.mp4") -> Job:
        job_id = uuid.uuid4().hex
        workdir = settings.work_dir / job_id
        workdir.mkdir(parents=True, exist_ok=True)
        job = Job(id=job_id, workdir=workdir, filename=filename)
        with self._lock:
            self._jobs[job_id] = job
        return job

    def get(self, job_id: str) -> Optional[Job]:
        with self._lock:
            return self._jobs.get(job_id)

    def submit(self, job: Job, fn: Callable[[], None]) -> None:
        """Queue the render. Exceptions are captured onto the job, never raised
        into the pool where they'd be swallowed."""

        def runner() -> None:
            self.update(job.id, status=RUNNING, label="Starting render…", percent=1)
            try:
                fn()
            except Exception as exc:  # noqa: BLE001 - surfaced to the client
                self.update(
                    job.id,
                    status=ERROR,
                    error=f"{type(exc).__name__}: {exc}",
                    label=f"Render failed: {exc}",
                    level="err",
                )
            finally:
                current = self.get(job.id)
                if current and current.finished_at is None and current.status in (DONE, ERROR):
                    with self._lock:
                        current.finished_at = time.time()

        self._pool.submit(runner)

    # --- mutation -----------------------------------------------------------
    def update(
        self,
        job_id: str,
        *,
        status: Optional[str] = None,
        percent: Optional[float] = None,
        label: Optional[str] = None,
        level: str = "info",
        error: Optional[str] = None,
        result: Optional[Path] = None,
        log: bool = True,
    ) -> None:
        with self._lock:
            job = self._jobs.get(job_id)
            if not job:
                return
            if status is not None:
                job.status = status
                if status in (DONE, ERROR):
                    job.finished_at = time.time()
            if percent is not None:
                # Never let progress jump backwards; ffmpeg's own callbacks can
                # restart at 0 for each pass and that reads as a stall.
                job.percent = max(job.percent, min(100.0, float(percent)))
            if label is not None:
                job.label = label
                if log:
                    job.logs.append(
                        {"percent": job.percent, "label": label, "level": level}
                    )
            if error is not None:
                job.error = error
            if result is not None:
                job.result = result
            job.revision += 1

    # --- housekeeping -------------------------------------------------------
    def reap(self) -> int:
        """Delete finished jobs past their TTL along with their temp files."""
        cutoff = time.time() - settings.job_ttl_seconds
        removed = 0
        with self._lock:
            stale = [
                j
                for j in self._jobs.values()
                if j.finished_at is not None and j.finished_at < cutoff
            ]
            for job in stale:
                self._jobs.pop(job.id, None)
        for job in stale:
            shutil.rmtree(job.workdir, ignore_errors=True)
            removed += 1
        return removed


store = JobStore()
