# Reel Studio — MoviePy Render Service

The server-side render backend for the Reel Studio frontend. It takes a render
plan plus the raw assets and returns the finished **1080×1920, 30 s, H.264**
reel, using [MoviePy](https://github.com/Zulko/moviepy) instead of the
browser's FFmpeg.wasm.

---

## Why this isn't a Vercel function

MoviePy can't run in Vercel's serverless Python runtime, for four independent
reasons:

| Vercel limit | What a render needs |
|---|---|
| 250 MB unzipped bundle | `imageio-ffmpeg` (~80 MB ffmpeg binary) + OpenCV + NumPy |
| 4.5 MB request body | dealership clips are tens to hundreds of MB |
| 300 s max duration | a 900-frame 1080×1920 encode runs for minutes |
| no persistent disk | MoviePy shells out to ffmpeg against real files |

So this is a **container**, deployed anywhere that runs one, and the browser
uploads to it directly. The Next.js frontend stays on Vercel; only rendering
moved. `/api/match-clips` and `/api/vision-scan` also stay on Vercel — they're
small JSON calls to Gemini and suit serverless fine.

---

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/health` | liveness + capability probe (ffmpeg present, font present, limits) |
| `POST` | `/api/render` | multipart upload of plan + assets → `202 {jobId}` |
| `GET` | `/api/render/{id}` | poll job status/progress/logs |
| `GET` | `/api/render/{id}/events` | same, as a Server-Sent Events stream |
| `GET` | `/api/render/{id}/result` | download the finished MP4 |
| `DELETE` | `/api/render/{id}` | cancel and delete the job's files |

### `POST /api/render`

`multipart/form-data` with:

- **`plan`** — JSON matching `RenderRequest` in [`app/models.py`](app/models.py).
- **one file part per asset** — the field *name* is the key `plan` refers to.
  A clip reused across several beats is uploaded once and referenced twice.

```jsonc
{
  "segments": [
    { "beatIndex": 1, "clip": "clip_0", "start": 0, "duration": 4,
      "header": "Certified inventory", "subtext": "Over 200 vehicles ready today",
      "overlay": "overlay_0" }
    // ...6 total
  ],
  "closing": { "kind": "file", "file": "closing", "isImage": true },
  "music": "music",
  "totalDuration": 30, "outW": 1080, "outH": 1920, "fps": 30, "closingSeconds": 6,
  "filename": "dealership-reel.mp4"
}
```

`overlay` is optional. The frontend rasterises captions on a `<canvas>` with the
live Sora webfont and uploads the PNGs, which is what keeps server output
**pixel-identical** to browser output. When it's absent the service draws the
overlay itself with Pillow ([`app/overlays.py`](app/overlays.py), a port of
`lib/overlay.ts`).

---

## Run it

### Docker (recommended)

```bash
cd backend
docker compose up --build          # http://localhost:8000
```

### Directly

```bash
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

No system ffmpeg needed — `imageio-ffmpeg` ships its own binary.

### Verify a deployment

```bash
./scripts/smoke_test.sh https://your-service.example.com
```

Generates throwaway footage, renders a full reel, and asserts the output is
1080×1920 / 30.0 s / has audio.

---

## Configuration

See [`.env.example`](.env.example). The ones that matter:

| Variable | Default | Notes |
|---|---|---|
| `ALLOWED_ORIGINS` | `*` | **Set this in production** — comma-separated frontend origins |
| `WORK_DIR` | `/tmp/reel-studio` | job scratch space; needs room for uploads + output |
| `MAX_UPLOAD_MB` | `1024` | total bytes per render request |
| `JOB_TTL_SECONDS` | `3600` | how long a finished job's files survive |
| `MAX_CONCURRENT_RENDERS` | `1` | renders are CPU-bound; raise only with cores to spare |
| `FFMPEG_PRESET` | `veryfast` | x264 speed/size trade-off |
| `MUSIC_PAD_MODE` | `silence` | `silence` matches the browser renderer; `loop` repeats the track |
| `RENDER_API_KEY` | *(empty)* | when set, callers must send `X-API-Key` |

### About `RENDER_API_KEY`

The browser uploads **directly** to this service (Vercel's 4.5 MB body cap makes
proxying impossible), so the key travels in the client bundle as
`NEXT_PUBLIC_RENDER_API_KEY` and is visible to anyone who opens devtools. Treat
it as a speed bump that keeps casual traffic off your renderer — **not** as
authentication. For real access control, put the service on a private network,
behind SSO, or issue short-lived tokens from a Next.js route.

---

## Deploying

Any container host works. Point `NEXT_PUBLIC_RENDER_BACKEND_URL` at the result
and add your frontend origin to `ALLOWED_ORIGINS`.

- **Railway / Render / Fly.io** — point at `backend/`, the Dockerfile is
  detected automatically. Set the env vars from the table above.
- **Cloud Run** — `gcloud run deploy --source backend --memory 4Gi --cpu 2
  --timeout 900`. Raise the request timeout: uploads of real footage are slow.
- **A VM** — `docker compose up -d` behind nginx/Caddy for TLS.

Sizing: **2 vCPU / 4 GB** renders a 30 s reel in roughly one to three minutes.
Give the container a real CPU limit — one render will happily consume every core
it's offered.

Scaling past one replica means replacing two things: the in-process job table in
[`app/jobs.py`](app/jobs.py) (→ Redis) and `WORK_DIR` (→ shared or object
storage). Everything else is already stateless.

---

## How the pipeline maps to the browser one

[`app/render.py`](app/render.py) is a deliberate twin of `lib/render.ts` — the
same durations, padding and audio behaviour, so both engines produce the same
artefact:

| Step | Browser (FFmpeg.wasm) | Server (MoviePy) |
|---|---|---|
| Scale + crop to 9:16 | `scale=…force_original_aspect_ratio=increase,crop` | `vfx.Resize` + `vfx.Crop`, centred |
| Short clip → exact 4 s | `tpad=stop_mode=clone` | freeze last frame, `concatenate_videoclips` |
| Caption | canvas PNG via `overlay` filter | same canvas PNG via `CompositeVideoClip` |
| Stitch | concat demuxer, stream copy | `concatenate_videoclips(method="chain")` |
| Short music track | `apad` then `atrim` | `CompositeAudioClip` padded to 30 s |
| Fades | `afade` in 0.6 s / out 1.2 s | `afx.AudioFadeIn/AudioFadeOut`, same values |
| Encode | libx264, baseline, yuv420p | libx264, baseline, yuv420p, `+faststart` |
