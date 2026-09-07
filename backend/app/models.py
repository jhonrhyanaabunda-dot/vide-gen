"""Request/response schemas.

These mirror `lib/types.ts` and `lib/render.ts` on the frontend one-for-one, so
a RenderPlan built by the existing browser code can be posted here unchanged
(field names are deliberately camelCase to match the TypeScript side).
"""

from typing import List, Optional

from pydantic import BaseModel, Field

# Kept in sync with lib/types.ts.
TOTAL_DURATION = 30.0
NUM_BEATS = 6
OUT_W = 1080
OUT_H = 1920
FPS = 30
BEAT_SECONDS = 4.0
CLOSING_SECONDS = TOTAL_DURATION - BEAT_SECONDS * NUM_BEATS  # 6.0


class SegmentSpec(BaseModel):
    """One of the 6 beats. Mirrors SegmentPlan in lib/render.ts."""

    beatIndex: int
    # Key into the uploaded files map, not a path. Source clips are uploaded
    # once and referenced by name, so a clip reused across beats is sent once.
    clip: str
    start: float = 0.0
    duration: float = BEAT_SECONDS
    header: str = ""
    subtext: str = ""
    # Key of a pre-rendered RGBA overlay PNG. The browser rasterises these on a
    # canvas with the real Sora font, so uploading them keeps the server output
    # pixel-identical to the browser output. When absent the server draws its
    # own with Pillow (see app/overlays.py).
    overlay: Optional[str] = None


class ClosingSpec(BaseModel):
    """The 7th segment. Mirrors ClosingPlan in lib/render.ts."""

    kind: str = Field(default="generated", pattern="^(file|generated)$")
    file: Optional[str] = None
    isImage: bool = False


class RenderRequest(BaseModel):
    segments: List[SegmentSpec]
    closing: ClosingSpec = ClosingSpec()
    music: Optional[str] = None

    totalDuration: float = TOTAL_DURATION
    outW: int = OUT_W
    outH: int = OUT_H
    fps: int = FPS
    closingSeconds: float = CLOSING_SECONDS

    filename: str = "dealership-reel.mp4"


class LogLine(BaseModel):
    percent: float
    label: str
    level: str = "info"


class JobStatus(BaseModel):
    """Shape consumed by lib/serverRender.ts; `percent`/`label`/`level` match
    ProgressUpdate in lib/types.ts so the existing ProgressPanel renders it."""

    jobId: str
    status: str  # queued | running | done | error
    percent: float
    label: str
    error: Optional[str] = None
    logs: List[LogLine] = []
    downloadUrl: Optional[str] = None
