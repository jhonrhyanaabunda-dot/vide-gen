# Reel Studio — Dealership Reel Generator

Automatically build **30-second, vertical 9:16 Reels** for a car dealership. The
app uses AI to pick the best source clips for a 6-beat script, cuts them, burns
in on-brand captions, syncs background music, appends a closing CTA, and exports
an `.mp4`.

Rendering runs on either of two interchangeable engines:

- **MoviePy render service** (`backend/`) — a container that does the video work
  on a real CPU. Used when it's configured and healthy.
- **FFmpeg.wasm in the browser** — the original zero-infrastructure path. Used
  when no backend is configured, and as an automatic fallback if the service is
  unreachable.

Both produce the same artefact, and you can force either from the dashboard.

Styled with the **A3 Brands design system** (Sora type, `#1DB954` emerald,
charcoal/dark-navy surfaces) from `DESIGN.md`.

---

## How it works (architecture)

```
Browser                              Vercel (AI only — fast, no timeouts)
─────────────────────────────        ────────────────────────────────────
• Folder pickers                     • /api/match-clips  → LLM filename match
• Probe durations (<video>)          • /api/vision-scan  → Gemini frame analysis
• Extract frames      ──frames──▶
• Render captions (<canvas>)
        │
        ├── engine: browser ──▶ FFmpeg.wasm cut/crop/stitch/mux
        │
        └── engine: server ───▶ MoviePy render service (container)
                                 ────────────────────────────────
                                 POST /api/render   (clips + overlays + plan)
                                 GET  /api/render/{id}         ← progress
                                 GET  /api/render/{id}/result  → .mp4
```

Two stateless Vercel routes forward prompts and frames to **Google Gemini** (via
its OpenAI-compatible endpoint) and return JSON. The free Gemini tier is plenty
for this workload (~1 text call + a few vision calls per reel).

**Why rendering isn't a Vercel function:** MoviePy needs an ffmpeg binary
(~80 MB), OpenCV and NumPy, and a 900-frame 1080×1920 encode runs for minutes —
against Vercel's 250 MB bundle, 4.5 MB request-body and 300 s function limits.
So the render service is a container and the browser uploads to it **directly**,
never through Vercel. See [`backend/README.md`](backend/README.md).

**Privacy note:** on the browser engine no video ever leaves the machine. On the
server engine the clips a beat actually uses are uploaded to your render service
(and deleted as soon as the render finishes). Filenames and low-res frames still
go to Gemini in both cases.

### Smart clip-selection hierarchy
1. **Filename matching (primary)** — filenames + script headers are sent to
   Gemini (`/api/match-clips`), which returns a ranked list of relevant clips per
   beat.
2. **Prefer shorter clips** — durations are probed locally; among each beat's
   ranked candidates the **shortest unused** clip wins; if none fit, it falls
   back to the shortest unused clip overall.
3. **Vision scanning (fallback)** — for clips longer than ~10s, the browser
   extracts ~1 frame/sec and asks Gemini vision (`/api/vision-scan`) for the
   timestamp window that matches the beat, then FFmpeg.wasm cuts exactly that.

### The 7th beat (closing frame)
- **File uploaded** → used as the final clip (image is held for 6s; video is cut to 6s).
- **Nothing uploaded** → a branded placeholder slide is generated on canvas
  (`[Dealership Logo]`, `[Dealership Name]`, CTA pill, `[Contact Info]`).

---

## File structure

```
.
├── app/
│   ├── layout.tsx                  # Shell + nav (Sora font, A3 styling)
│   ├── page.tsx                    # The dashboard (orchestrates everything)
│   ├── globals.css                 # Design-system CSS (tokens, components)
│   └── api/
│       ├── match-clips/route.ts    # STEP 1: LLM filename → beat matching
│       └── vision-scan/route.ts    # STEP 3: Gemini vision timestamp matching
├── components/
│   ├── DirectoryPicker.tsx         # webkitdirectory folder selector
│   ├── ClosingFrameSelector.tsx    # optional closing file uploader + preview
│   ├── ClosingSlide.tsx            # React preview of the generated 7th beat
│   ├── ApiKeyInput.tsx             # masked key field, persisted to localStorage
│   ├── ScriptInput.tsx             # strict 6-beat (header + subtext) form
│   └── ProgressPanel.tsx           # detailed progress bar + color-coded log
├── lib/
│   ├── design.ts                   # design tokens (DESIGN.md)
│   ├── types.ts                    # shared types + constants (durations, dims)
│   ├── ffmpeg.ts                   # FFmpeg.wasm singleton loader
│   ├── videoMeta.ts                # duration probing + "shortest first" sort
│   ├── frameExtract.ts             # 1fps frame extraction (video+canvas)
│   ├── overlay.ts                  # canvas → PNG caption & closing-slide overlays
│   ├── selection.ts                # the AI selection orchestrator → RenderPlan
│   ├── render.ts                   # the FFmpeg.wasm render pipeline (browser)
│   ├── backend.ts                  # render-service config + health probe
│   └── serverRender.ts             # uploads the plan, follows progress, downloads
├── backend/                        # MoviePy render service (container)
│   ├── app/
│   │   ├── main.py                 # FastAPI: /health, /api/render, progress, result
│   │   ├── render.py               # the MoviePy pipeline (twin of lib/render.ts)
│   │   ├── overlays.py             # Pillow overlays (port of lib/overlay.ts)
│   │   ├── jobs.py                 # in-process job store + render thread pool
│   │   ├── models.py               # schemas mirroring lib/types.ts
│   │   └── config.py               # env-driven settings
│   ├── scripts/smoke_test.sh       # renders a real reel against a deployment
│   ├── Dockerfile
│   ├── docker-compose.yml
│   └── README.md                   # service docs, endpoints, deploy targets
├── next.config.js                  # COOP/COEP headers (required for FFmpeg.wasm)
├── package.json
└── .env.example
```

---

## Run locally

```bash
npm install
npm run dev        # http://localhost:3000
```

That alone gives you the full app on the browser engine — no backend required.

To use the MoviePy engine, start the service too and point the frontend at it:

```bash
cd backend && docker compose up --build     # http://localhost:8000
```

```bash
# .env.local in the project root
NEXT_PUBLIC_RENDER_BACKEND_URL=http://localhost:8000
```

Restart `npm run dev` afterwards — `NEXT_PUBLIC_*` values are inlined at build
time. The dashboard's **Render engine** control then shows `Auto → MoviePy
server` and a badge with the service's MoviePy version.

`next dev` and Vercel both serve the COOP/COEP headers from `next.config.js`,
which are required for FFmpeg.wasm. The dashboard shows a warning badge if the
page isn't cross-origin isolated.

You provide your **Gemini API key in the UI** (stored in `localStorage`). Get a
free one at https://aistudio.google.com/app/apikey. No server env var is
required, but you can optionally set one as a fallback:

```bash
cp .env.example .env.local   # optional: GEMINI_API_KEY for server-side fallback
```

---

## Deploy to Vercel

1. Push this folder to a Git repo (GitHub/GitLab/Bitbucket).
2. In Vercel: **New Project → Import** the repo. Framework auto-detects as Next.js.
3. (Optional) add `GEMINI_API_KEY`, `GEMINI_TEXT_MODEL`, `GEMINI_VISION_MODEL`
   under **Settings → Environment Variables**.
4. (Optional) add `NEXT_PUBLIC_RENDER_BACKEND_URL` pointing at your deployed
   render service — leave it unset to keep rendering in the browser.
5. **Deploy.** That's it.

The COOP/COEP headers ship via `next.config.js`, so cross-origin isolation works
on Vercel out of the box. Render work runs client-side, so the serverless
functions only ever do quick AI calls (well within limits).

Or via CLI:

```bash
npm i -g vercel
vercel        # preview
vercel --prod # production
```

### Deploy the render service (optional)

The frontend works without it. To enable server rendering, deploy `backend/` to
any container host — Railway, Render, Fly.io, Cloud Run, or a VM — then:

1. Set `ALLOWED_ORIGINS` on the service to your Vercel URL(s). Uploads go
   browser → service directly, so CORS must name the frontend origin.
2. Set `NEXT_PUBLIC_RENDER_BACKEND_URL` on Vercel to the service's HTTPS URL and
   redeploy.
3. Verify: `backend/scripts/smoke_test.sh https://your-service.example.com`

Sizing and the full env-var table are in [`backend/README.md`](backend/README.md).

---

## Usage

1. **Select folders** — Source Videos and Music (folders stay local).
2. **Enter your Gemini API key.**
3. **Write 6 beats** — Header + short subtext each.
4. **Closing frame** — upload one, or leave empty for the generated slide.
5. **Render Video** — watch the detailed progress bar; the `.mp4` auto-downloads.

Output: `1080×1920`, exactly `30s`, H.264 + AAC.

---

## Notes, limits & tuning

- **Choosing an engine:** `Auto` (default) uses the MoviePy service when it's
  configured and its `/health` check passes, otherwise the browser. If a server
  render fails mid-flight in `Auto`, it retries in the browser automatically.
  `MoviePy server` and `Browser` force one engine and report a clear error
  instead of falling back.
- **Performance:** FFmpeg.wasm uses the single-threaded core for maximum
  compatibility; a full render is typically ~1–3 min depending on the machine
  and clip count. To go faster you can switch `lib/ffmpeg.ts` to
  `@ffmpeg/core-mt` (multithreaded) — it needs the COOP/COEP headers (already
  set) and `SharedArrayBuffer`. The MoviePy service on 2 vCPU lands in a similar
  range, but it doesn't tie up the user's machine and isn't limited by wasm.
- **Timing:** 6 beats × 4s + 6s closing = 30s (see `lib/types.ts`). Adjust
  `BEAT_SECONDS` / `CLOSING_SECONDS` there.
- **Cropping:** clips are scaled with `force_original_aspect_ratio=increase`
  then center-cropped to 1080×1920 — fills the frame, never stretches.
- **Captions** are rendered on canvas (Sora, with a system-sans fallback if the
  Google Font is blocked under COEP), then composited by FFmpeg — reliable
  across browsers without bundling a font into wasm. The server engine uploads
  those same canvas PNGs, so both engines burn in identical captions. The
  service can also draw them itself with Pillow for direct API callers.
- **Error handling:** the app blocks rendering and explains the problem if the
  API key is missing, the source folder is empty, any of the 6 beat headers is
  blank, or the page isn't cross-origin isolated.
- **Browser support:** use a current Chromium-based browser or Safari/Firefox
  recent versions. `webkitdirectory` folder selection works in all modern
  desktop browsers.
```
