"""The MoviePy render pipeline — the server-side twin of lib/render.ts.

Produces the identical artefact the browser produces: a 1080x1920, 30 fps,
30-second H.264 reel made of six 4-second captioned beats plus a 6-second
closing frame, with the selected music track faded in and out over the top.

Where the browser shells out to FFmpeg.wasm filtergraphs, this composes MoviePy
clip objects and encodes once at the end. The observable output is the same;
the ordering, durations, padding behaviour and audio treatment below are all
matched deliberately to lib/render.ts.
"""

import math
from pathlib import Path
from typing import Callable, Dict, List, Optional

import numpy as np
from moviepy import (
    AudioFileClip,
    CompositeAudioClip,
    CompositeVideoClip,
    ImageClip,
    VideoFileClip,
    afx,
    concatenate_videoclips,
    vfx,
)
from proglog import ProgressBarLogger

from .config import settings
from .models import RenderRequest
from .overlays import make_beat_overlay, make_closing_slide

Progress = Callable[..., None]


def _moviepy_version() -> str:
    try:
        from moviepy import __version__

        return __version__
    except Exception:  # noqa: BLE001 - never let a version lookup fail a render
        return "unknown"

# Progress budget. Building clips is lazy and quick; the single encode at the
# end is where the minutes go, so it owns most of the bar.
P_PREPARE_START, P_PREPARE_END = 5.0, 30.0
P_CLOSING_END = 35.0
P_AUDIO_END = 40.0
P_ENCODE_START, P_ENCODE_END = 40.0, 98.0


class _EncodeLogger(ProgressBarLogger):
    """Bridges MoviePy's proglog bars onto the job's progress callback.

    write_videofile runs two passes and names their bars differently:
    "chunk" while it renders the audio track (Clip.iter_chunks) and
    "frame_index" while it writes video frames (Clip.iter_frames). Each owns a
    slice of the band so the percentage only ever moves forward.
    """

    # The audio pass is short next to 900 video frames; give it 8% of the band.
    AUDIO_SHARE = 0.08
    _BARS = {"chunk": (0.0, AUDIO_SHARE), "frame_index": (AUDIO_SHARE, 1.0)}

    def __init__(self, progress: Progress, lo: float, hi: float):
        super().__init__()
        self._progress = progress
        self._lo, self._hi = lo, hi
        self._last_pct = -1.0

    def bars_callback(self, bar, attr, value, old_value=None):
        if attr != "index" or bar not in self._BARS:
            return
        total = (self.bars.get(bar) or {}).get("total") or 0
        if not total:
            return
        frac = min(1.0, value / total)
        share_lo, share_hi = self._BARS[bar]
        span = self._hi - self._lo
        pct = self._lo + span * (share_lo + (share_hi - share_lo) * frac)
        # Throttle: one update per whole percent, not one per frame.
        if pct - self._last_pct < 1.0:
            return
        self._last_pct = pct
        stage = "audio" if bar == "chunk" else "video"
        self._progress(pct, f"Encoding MP4 ({stage}) — {int(frac * 100)}%")


def _cover(clip, out_w: int, out_h: int):
    """Scale-to-fill then centre-crop to exactly out_w x out_h.

    Equivalent of the browser's
    `scale=W:H:force_original_aspect_ratio=increase,crop=W:H`.
    """
    src_w, src_h = clip.size
    if not src_w or not src_h:
        return clip
    factor = max(out_w / src_w, out_h / src_h)
    new_w = max(out_w, int(math.ceil(src_w * factor)))
    new_h = max(out_h, int(math.ceil(src_h * factor)))
    clip = clip.with_effects([vfx.Resize(new_size=(new_w, new_h))])
    return clip.with_effects(
        [vfx.Crop(x1=(new_w - out_w) // 2, y1=(new_h - out_h) // 2,
                  width=out_w, height=out_h)]
    )


def _pad_to(clip, duration: float, fps: int):
    """Guarantee an exact duration by freezing the final frame if the source is
    short — the browser gets this from `tpad=stop_mode=clone`."""
    have = clip.duration or 0.0
    if have >= duration - 1e-3:
        return clip.subclipped(0, duration)
    last_frame = clip.get_frame(max(0.0, have - 1.0 / max(fps, 1)))
    tail = ImageClip(last_frame, duration=duration - have).with_fps(fps)
    return concatenate_videoclips([clip, tail], method="chain").with_duration(duration)


def _overlay_clip(png_path: Optional[Path], seg, out_w, out_h, duration, fps):
    """Prefer the browser-rendered overlay (real Sora font, pixel-identical to
    the client path); fall back to drawing it here with Pillow."""
    if png_path is not None and png_path.is_file():
        clip = ImageClip(str(png_path), transparent=True)
    else:
        img = make_beat_overlay(seg.beatIndex, seg.header, seg.subtext, out_w, out_h)
        clip = ImageClip(np.array(img), transparent=True)
    return clip.with_duration(duration).with_position((0, 0)).with_fps(fps)


def render_reel(
    req: RenderRequest,
    files: Dict[str, Path],
    workdir: Path,
    progress: Progress,
) -> Path:
    """Execute a RenderRequest and return the path to the finished MP4."""
    out_w, out_h, fps = req.outW, req.outH, req.fps
    total = req.totalDuration
    opened: List = []          # every clip we open, closed in the finally block
    segments: List = []

    try:
        # First line of every job's log, so the transcript itself proves which
        # engine did the work rather than leaving it to be inferred.
        progress(
            P_PREPARE_START - 1,
            f"Rendering with MoviePy {_moviepy_version()} (server-side)",
            level="ok",
        )
        # ---- 1. The six beat segments ------------------------------------
        n = max(1, len(req.segments))
        span = (P_PREPARE_END - P_PREPARE_START) / n
        for i, seg in enumerate(req.segments):
            base_pct = P_PREPARE_START + span * i
            src_path = files.get(seg.clip)
            if src_path is None:
                raise FileNotFoundError(
                    f"Beat {seg.beatIndex} references clip '{seg.clip}', which wasn't uploaded."
                )
            progress(base_pct, f'Beat {seg.beatIndex}/{n} - loading "{seg.clip}"')

            src = VideoFileClip(str(src_path))
            opened.append(src)

            # Clamp the requested window to what the clip actually has; _pad_to
            # makes up any shortfall so every beat is exactly seg.duration.
            src_dur = src.duration or 0.0
            start = max(0.0, min(seg.start, max(0.0, src_dur - 0.05)))
            take = min(seg.duration, max(0.0, src_dur - start))
            base = src.subclipped(start, start + take) if take > 0 else src
            base = base.without_audio()

            progress(base_pct + span * 0.4,
                     f"Beat {seg.beatIndex}/{n} - cropping to 9:16")
            base = _cover(base, out_w, out_h)
            base = _pad_to(base, seg.duration, fps).with_fps(fps)

            progress(base_pct + span * 0.7,
                     f"Beat {seg.beatIndex}/{n} - compositing caption")
            overlay = _overlay_clip(
                files.get(seg.overlay) if seg.overlay else None,
                seg, out_w, out_h, seg.duration, fps,
            )
            opened.append(overlay)

            composed = CompositeVideoClip([base, overlay], size=(out_w, out_h))
            composed = composed.with_duration(seg.duration).with_fps(fps)
            segments.append(composed)
            opened.append(composed)
            progress(base_pct + span, f"Beat {seg.beatIndex}/{n} - ready", level="ok")

        # ---- 2. Closing frame (7th segment) ------------------------------
        progress(P_CLOSING_END - 3, "Building closing frame…")
        closing_seconds = req.closingSeconds
        closing_path = files.get(req.closing.file) if req.closing.file else None

        if req.closing.kind == "file" and closing_path and req.closing.isImage:
            closing = ImageClip(str(closing_path)).with_duration(closing_seconds)
            closing = _cover(closing, out_w, out_h).with_fps(fps)
        elif req.closing.kind == "file" and closing_path:
            src = VideoFileClip(str(closing_path))
            opened.append(src)
            take = min(closing_seconds, src.duration or closing_seconds)
            closing = src.subclipped(0, take).without_audio()
            closing = _cover(closing, out_w, out_h)
            closing = _pad_to(closing, closing_seconds, fps).with_fps(fps)
        else:
            slide = make_closing_slide(out_w, out_h).convert("RGB")
            closing = ImageClip(np.array(slide)).with_duration(closing_seconds).with_fps(fps)

        segments.append(closing)
        opened.append(closing)
        progress(P_CLOSING_END, "Closing frame ready", level="ok")

        # ---- 3. Stitch ----------------------------------------------------
        progress(P_CLOSING_END + 2, "Stitching segments together…")
        # Every segment is already the same size and fps, so "chain" is both
        # correct and much cheaper than "compose".
        reel = concatenate_videoclips(segments, method="chain").with_fps(fps)
        opened.append(reel)
        if (reel.duration or 0) > total:
            reel = reel.subclipped(0, total)

        # ---- 4. Music -----------------------------------------------------
        music_path = files.get(req.music) if req.music else None
        if music_path is not None:
            progress(P_AUDIO_END - 3, "Adding & fading background music…")
            track = AudioFileClip(str(music_path))
            opened.append(track)
            if (track.duration or 0) > total:
                track = track.subclipped(0, total)
            elif settings.music_pad_mode == "loop":
                track = track.with_effects([afx.AudioLoop(duration=total)])
            # Default: wrapping in a composite of the reel's length leaves
            # silence after a short track — the browser's `apad` behaviour.
            audio = CompositeAudioClip([track]).with_duration(total)
            audio = audio.with_effects(
                [afx.AudioFadeIn(0.6), afx.AudioFadeOut(1.2)]
            )
            reel = reel.with_audio(audio)
            progress(P_AUDIO_END, "Music mixed", level="ok")
        else:
            progress(P_AUDIO_END, "No music selected — exporting silent reel", level="warn")

        # ---- 5. Encode ----------------------------------------------------
        out_path = workdir / "reel.mp4"
        progress(P_ENCODE_START, "Encoding MP4 (this is the slow part)…")
        reel.write_videofile(
            str(out_path),
            fps=fps,
            codec="libx264",
            audio=music_path is not None,
            audio_codec="aac",
            audio_bitrate=settings.audio_bitrate,
            bitrate=settings.video_bitrate,
            preset=settings.ffmpeg_preset,
            threads=settings.ffmpeg_threads or None,
            pixel_format="yuv420p",
            temp_audiofile=str(workdir / "temp-audio.m4a"),
            remove_temp=True,
            logger=_EncodeLogger(progress, P_ENCODE_START, P_ENCODE_END),
            # baseline/3.1 matches the browser encode for maximum device
            # compatibility; faststart lets the MP4 stream while downloading.
            ffmpeg_params=[
                "-profile:v", "baseline",
                "-level", "3.1",
                "-movflags", "+faststart",
            ],
        )
        progress(99, "Finalizing MP4…")
        return out_path

    finally:
        for clip in opened:
            try:
                clip.close()
            except Exception:  # noqa: BLE001 - cleanup must never mask the real error
                pass
