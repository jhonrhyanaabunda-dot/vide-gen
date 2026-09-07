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

## Deploying to Cloud Run (recommended)

```bash
cd backend
./deploy-cloudrun.sh YOUR_PROJECT_ID us-central1
./scripts/smoke_test.sh https://your-service-url    # verify before wiring it up
```

Then set `NEXT_PUBLIC_RENDER_BACKEND_URL` to the printed URL in Vercel and
redeploy the frontend.

Cloud Run suits this workload because it **scales to zero** — a dealership
renders a few reels a week, and an always-on 2 vCPU/4 GB container elsewhere
bills continuously for an idle box. Its request timeout also goes to 60
minutes, so no render can outrun it.

### Free tier

Cloud Run's monthly free tier (2M requests, 360k vCPU-seconds, 180k GiB-seconds)
covers this workload comfortably — at the default `2 vCPU / 2Gi`, a two-minute
render costs ~240 vCPU-s and ~240 GiB-s, so the allowance is worth hundreds of
reels a month. `deploy-cloudrun.sh` uses the free-tier-eligible configuration by
default.

Two caveats, stated plainly:

- **Google still requires a billing account with a card**, even to stay inside
  the free tier. Usage beyond it bills you.
- **The free tier only applies to request-based billing**, which means CPU is
  allocated *only while a request is in flight*. This service renders on a
  background thread, so that would normally throttle the render to a crawl. It
  works here because the browser holds the `/events` SSE stream open for the
  entire render, which keeps a request in flight. **If that stream drops**, the
  client falls back to 1-second polling and the render will slow to a stutter.
  If you hit that, redeploy with `BILLING=instance` — reliable, but billed for
  the instance's whole lifetime and not free.

I have not been able to verify the SSE-keeps-CPU-alive behaviour on real Cloud
Run infrastructure — run `scripts/smoke_test.sh` against the deployed URL and
watch whether the progress percentage advances steadily.

### Two Cloud Run specifics that will bite you silently

**1. `--no-cpu-throttling` is mandatory here.** By default Cloud Run allocates
CPU *only during request processing*. This service returns `202` immediately and
renders on a background thread, so with the default setting the render would be
throttled to near-zero CPU the moment the response is sent, and appear to hang.
`--no-cpu-throttling` switches to instance-based billing, which keeps the CPU
allocated for the instance's lifetime. Instances still scale to zero when idle,
so you pay for the render plus a short idle tail — not for a permanently running
box.

**2. The container filesystem is in-memory.** Every uploaded byte counts against
the memory limit, so memory must cover *uploads + MoviePy/ffmpeg working set +
the output file* — not just the process. The deploy script uses `8Gi` with
`MAX_UPLOAD_MB=2048`; if you size memory down, size `MAX_UPLOAD_MB` down with
it or renders will OOM partway through.

**`--max-instances 1` is required, not a cost control.** Job state lives in the
in-process table in [`app/jobs.py`](app/jobs.py) and the finished MP4 sits on
that instance's local filesystem. With more than one instance, a status poll or
the result download can land on an instance that has never heard of the job and
answer `404`. Lifting this means moving job state to Redis and `WORK_DIR` to
shared storage first.

**`--concurrency` must be greater than 1.** One rendering client holds several
concurrent requests: the SSE progress stream stays open for the whole render,
and the result download arrives while it is still open. At `--concurrency 1`
the open stream occupies the only slot and the download blocks behind it.
Actual render parallelism is capped separately by `MAX_CONCURRENT_RENDERS=1`,
which is what keeps two renders off one CPU.

### Other hosts

Any container host works; the Dockerfile is standard.

- **Fly.io / Render** — cheapest of the always-on options if you'd rather avoid
  cold starts. Fly is roughly $20–30/mo at this size, Render $25+.
- **Railway** — priced per vCPU/GB continuously, so an always-on 2 vCPU/4 GB
  service lands near $120/mo. Avoid for this workload.
- **A VM** — `docker compose up -d` behind nginx/Caddy for TLS.

### Cold starts

The image is ~650 MB, so a scaled-to-zero instance adds roughly ten to thirty
seconds to the first render. That's noise next to a render that takes minutes.
Set `--min-instances 1` to remove it, at the cost of paying for an idle
instance.

### Scaling past one instance

Two things hold state: the in-process job table in [`app/jobs.py`](app/jobs.py)
(→ Redis) and `WORK_DIR` (→ GCS or another shared store). Everything else is
already stateless.

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
