"""HTTP surface for the MoviePy render service.

Endpoints
---------
GET  /health                        liveness + capability probe
POST /api/render                    multipart upload -> {jobId}
GET  /api/render/{id}               poll job status
GET  /api/render/{id}/events        Server-Sent Events progress stream
GET  /api/render/{id}/result        download the finished MP4
DELETE /api/render/{id}             cancel/cleanup

The browser uploads straight here rather than through Vercel: Vercel caps
request bodies at 4.5 MB, which no real dealership clip fits inside.
"""

import asyncio
import json
import os
import re
import shutil
from pathlib import Path
from typing import Dict, Optional

from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse

from .config import settings
from .jobs import DONE, ERROR, store
from .models import JobStatus, RenderRequest
from .overlays import active_face, fonts_available
from .render import render_reel

app = FastAPI(
    title="Reel Studio Render Service",
    description="MoviePy-backed 9:16 reel renderer for the Reel Studio frontend.",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,
    allow_credentials=False,
    allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
    allow_headers=["*"],
    expose_headers=["Content-Disposition"],
)


@app.middleware("http")
async def cross_origin_resource_policy(request: Request, call_next):
    """The frontend page is cross-origin isolated (COEP: require-corp) so that
    FFmpeg.wasm can use SharedArrayBuffer. Responses it pulls from another
    origin need CORP, or the browser drops them before JS ever sees them."""
    response = await call_next(request)
    response.headers.setdefault("Cross-Origin-Resource-Policy", "cross-origin")
    return response


def _check_auth(provided: Optional[str]) -> None:
    if settings.api_key and provided != settings.api_key:
        raise HTTPException(status_code=401, detail="Invalid or missing X-API-Key.")


@app.on_event("startup")
async def _startup() -> None:
    settings.work_dir.mkdir(parents=True, exist_ok=True)

    async def reaper() -> None:
        while True:
            await asyncio.sleep(300)
            try:
                store.reap()
            except Exception:  # noqa: BLE001 - housekeeping must never kill the app
                pass

    asyncio.create_task(reaper())


@app.get("/health")
async def health() -> dict:
    """Reports whether the pieces a render needs are actually present, so a
    misconfigured container fails loudly at deploy instead of mid-render."""
    try:
        import imageio_ffmpeg

        ffmpeg_path = imageio_ffmpeg.get_ffmpeg_exe()
        ffmpeg_ok = bool(ffmpeg_path) and os.path.exists(ffmpeg_path)
    except Exception as exc:  # noqa: BLE001
        ffmpeg_path, ffmpeg_ok = str(exc), False

    try:
        from moviepy import __version__ as moviepy_version
    except Exception as exc:  # noqa: BLE001
        moviepy_version = f"unavailable: {exc}"

    return {
        "status": "ok" if ffmpeg_ok else "degraded",
        # Identity markers. A Funnel or reverse proxy pointed at the wrong
        # local port will still answer 200 with somebody else's JSON, so the
        # client checks these before trusting the endpoint as a renderer.
        "service": "reel-render",
        "engine": "moviepy",
        "moviepy": moviepy_version,
        "ffmpeg": ffmpeg_path if ffmpeg_ok else None,
        "ffmpegAvailable": ffmpeg_ok,
        # Name the face rather than asserting "a font is present": DejaVu
        # satisfies that and would misreport a container that never got Sora.
        # Either way this only affects server-drawn overlays — the frontend
        # uploads canvas-rendered ones.
        "font": active_face(),
        "maxUploadMb": settings.max_upload_mb,
        "concurrency": settings.max_concurrent_renders,
        "authRequired": bool(settings.api_key),
    }


@app.post("/api/render")
async def create_render(request: Request, x_api_key: Optional[str] = Header(default=None)):
    """Accept the plan plus its assets and queue a render.

    multipart/form-data:
      plan   - JSON matching RenderRequest
      <key>  - one file part per asset; `plan` refers to assets by these keys,
               so a clip reused across several beats is only uploaded once.
    """
    _check_auth(x_api_key)

    form = await request.form(max_files=200, max_fields=200)
    raw_plan = form.get("plan")
    if not raw_plan or not isinstance(raw_plan, str):
        raise HTTPException(status_code=400, detail="Missing 'plan' field.")
    try:
        req = RenderRequest.model_validate(json.loads(raw_plan))
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail=f"'plan' is not valid JSON: {exc}")
    except Exception as exc:  # noqa: BLE001 - pydantic validation error
        raise HTTPException(status_code=422, detail=f"Invalid plan: {exc}")

    if not req.segments:
        raise HTTPException(status_code=400, detail="Plan contains no segments.")

    job = store.create(filename=req.filename)
    assets_dir = job.workdir / "assets"
    assets_dir.mkdir(parents=True, exist_ok=True)

    files: Dict[str, Path] = {}
    total_bytes = 0
    try:
        for key, value in form.multi_items():
            if key == "plan" or not hasattr(value, "read"):
                continue
            # Name the file after the form field, never the client-supplied
            # filename, which can carry traversal segments. Keep just the
            # extension from it (validated) so ffmpeg and imageio can pick a
            # demuxer by suffix instead of relying on content sniffing.
            suffix = Path(getattr(value, "filename", "") or "").suffix.lower()
            if not re.fullmatch(r"\.[a-z0-9]{1,5}", suffix):
                suffix = ""
            dest = assets_dir / f"{len(files):04d}_{Path(str(key)).name}{suffix}"
            with dest.open("wb") as out:
                while chunk := await value.read(1024 * 1024):
                    total_bytes += len(chunk)
                    if total_bytes > settings.max_upload_bytes:
                        raise HTTPException(
                            status_code=413,
                            detail=(
                                f"Upload exceeds {settings.max_upload_mb} MB. "
                                "Raise MAX_UPLOAD_MB or send fewer/smaller clips."
                            ),
                        )
                    out.write(chunk)
            files[str(key)] = dest
    except Exception:
        shutil.rmtree(job.workdir, ignore_errors=True)
        raise

    missing = [s.clip for s in req.segments if s.clip not in files]
    if missing:
        shutil.rmtree(job.workdir, ignore_errors=True)
        raise HTTPException(
            status_code=400,
            detail=f"Plan references assets that were not uploaded: {sorted(set(missing))}",
        )

    def progress(percent: float, label: str, level: str = "info") -> None:
        store.update(job.id, percent=percent, label=label, level=level)

    def work() -> None:
        out_path = render_reel(req, files, job.workdir, progress)
        store.update(job.id, status=DONE, percent=100, label="Done! Reel ready.",
                     level="ok", result=out_path)
        # The finished MP4 is all we still need; drop the source uploads now
        # rather than holding gigabytes until the TTL reaper runs.
        shutil.rmtree(assets_dir, ignore_errors=True)

    store.submit(job, work)
    return JSONResponse(
        status_code=202,
        content={"jobId": job.id, "statusUrl": f"/api/render/{job.id}"},
    )


def _status(job) -> JobStatus:
    return JobStatus(
        jobId=job.id,
        status=job.status,
        percent=job.percent,
        label=job.label,
        error=job.error,
        logs=job.logs,
        downloadUrl=f"/api/render/{job.id}/result" if job.status == DONE else None,
    )


@app.get("/api/render/{job_id}", response_model=JobStatus)
async def get_status(job_id: str, x_api_key: Optional[str] = Header(default=None)):
    _check_auth(x_api_key)
    job = store.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Unknown job (it may have expired).")
    return _status(job)


@app.get("/api/render/{job_id}/events")
async def stream_events(job_id: str, x_api_key: Optional[str] = Header(default=None)):
    """SSE progress. Emits only when the job actually changes, so an idle
    encode doesn't spam the client with identical frames."""
    _check_auth(x_api_key)
    if not store.get(job_id):
        raise HTTPException(status_code=404, detail="Unknown job (it may have expired).")

    async def events():
        last_revision = -1
        while True:
            job = store.get(job_id)
            if job is None:
                yield 'event: error\ndata: {"error":"job expired"}\n\n'
                return
            if job.revision != last_revision:
                last_revision = job.revision
                yield f"data: {_status(job).model_dump_json()}\n\n"
            if job.status in (DONE, ERROR):
                return
            await asyncio.sleep(0.4)

    return StreamingResponse(
        events(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",  # don't let a proxy buffer the stream
        },
    )


@app.get("/api/render/{job_id}/result")
async def get_result(job_id: str, x_api_key: Optional[str] = Header(default=None)):
    _check_auth(x_api_key)
    job = store.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Unknown job (it may have expired).")
    if job.status == ERROR:
        raise HTTPException(status_code=500, detail=job.error or "Render failed.")
    if job.status != DONE or not job.result or not job.result.is_file():
        raise HTTPException(status_code=409, detail=f"Job is {job.status}, not ready.")
    return FileResponse(
        path=job.result,
        media_type="video/mp4",
        filename=job.filename,
        headers={"Cross-Origin-Resource-Policy": "cross-origin"},
    )


@app.delete("/api/render/{job_id}")
async def delete_job(job_id: str, x_api_key: Optional[str] = Header(default=None)):
    _check_auth(x_api_key)
    job = store.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Unknown job.")
    shutil.rmtree(job.workdir, ignore_errors=True)
    store.update(job_id, status=ERROR, label="Cancelled by client", level="warn",
                 error="cancelled")
    return {"ok": True}
