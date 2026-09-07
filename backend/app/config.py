"""Environment-driven settings for the render service.

Everything here has a working default so `uvicorn app.main:app` runs with no
env file at all; production overrides come from the platform's env vars.
"""

import os
from pathlib import Path
from typing import List


def _int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name) or default)
    except ValueError:
        return default


def _csv(name: str, default: str) -> List[str]:
    return [v.strip() for v in (os.environ.get(name) or default).split(",") if v.strip()]


class Settings:
    # --- HTTP ---------------------------------------------------------------
    # Browser uploads go straight from the page to this service (never through
    # Vercel, whose 4.5 MB request-body cap would reject real footage), so CORS
    # has to name the frontend origins explicitly. "*" is the dev default.
    allowed_origins: List[str] = _csv("ALLOWED_ORIGINS", "*")
    port: int = _int("PORT", 8000)

    # --- Storage ------------------------------------------------------------
    work_dir: Path = Path(os.environ.get("WORK_DIR") or "/tmp/reel-studio")
    # Total bytes accepted for one render request (all clips + music + closing).
    max_upload_mb: int = _int("MAX_UPLOAD_MB", 1024)
    # Finished jobs (and their temp files) are reaped this long after they end.
    job_ttl_seconds: int = _int("JOB_TTL_SECONDS", 3600)

    # --- Rendering ----------------------------------------------------------
    # MoviePy renders are CPU-bound and blocking. More than one at a time on a
    # small container just makes both slower and risks the OOM killer.
    max_concurrent_renders: int = _int("MAX_CONCURRENT_RENDERS", 1)
    # 0 lets ffmpeg pick (== nproc). Set explicitly on shared/limited CPUs.
    ffmpeg_threads: int = _int("FFMPEG_THREADS", 0)
    # The browser path uses "ultrafast" because wasm is slow; a real CPU can
    # afford "veryfast" for a meaningfully smaller file at the same speed.
    ffmpeg_preset: str = os.environ.get("FFMPEG_PRESET") or "veryfast"
    video_bitrate: str = os.environ.get("VIDEO_BITRATE") or "6M"
    audio_bitrate: str = os.environ.get("AUDIO_BITRATE") or "192k"

    # How a music track shorter than the reel is stretched to fit:
    #   "silence" — pad with silence (matches the browser's ffmpeg `apad`)
    #   "loop"    — repeat the track
    music_pad_mode: str = (os.environ.get("MUSIC_PAD_MODE") or "silence").lower()

    # --- Auth (optional) ----------------------------------------------------
    # If set, callers must send `X-API-Key: <value>`. Leave empty to run open,
    # which is fine behind a private network but not on a public URL.
    api_key: str = os.environ.get("RENDER_API_KEY") or ""

    @property
    def max_upload_bytes(self) -> int:
        return self.max_upload_mb * 1024 * 1024


settings = Settings()
