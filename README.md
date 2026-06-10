# Reel Studio — Dealership Reel Generator

Automatically build **30-second, vertical 9:16 Reels** for a car dealership. The
app uses AI to pick the best source clips for a 6-beat script, cuts them, burns
in on-brand captions, syncs background music, appends a closing CTA, and exports
an `.mp4` — **all rendered in the browser** so it deploys cleanly on Vercel
(no server-side video work that would time out).

Styled with the **A3 Brands design system** (Sora type, `#1DB954` emerald,
charcoal/dark-navy surfaces) from `DESIGN.md`.

---

## How it works (architecture)

```
Browser (heavy lifting)                          Vercel (AI only — fast, no timeouts)
─────────────────────────────                    ────────────────────────────────────
• Folder pickers (webkitdirectory)               • /api/match-clips  → LLM filename match
• Probe clip durations (<video>)                 • /api/vision-scan  → Gemini frame analysis
• Extract frames (<video>+<canvas>)  ──frames──▶
• Render captions/closing (<canvas>)
• Cut / crop / stitch / mux  (FFmpeg.wasm)
• Auto-download final .mp4
```

The only server code is two stateless API routes that forward prompts/frames to
**Google Gemini** (via its OpenAI-compatible endpoint) and return JSON. No video
bytes ever leave the browser. The free Gemini tier is plenty for this workload
(~1 text call + a few vision calls per reel).

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
│   └── render.ts                   # the FFmpeg.wasm render pipeline
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
4. **Deploy.** That's it.

The COOP/COEP headers ship via `next.config.js`, so cross-origin isolation works
on Vercel out of the box. Render work runs client-side, so the serverless
functions only ever do quick AI calls (well within limits).

Or via CLI:

```bash
npm i -g vercel
vercel        # preview
vercel --prod # production
```

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

- **Performance:** FFmpeg.wasm uses the single-threaded core for maximum
  compatibility; a full render is typically ~1–3 min depending on the machine
  and clip count. To go faster you can switch `lib/ffmpeg.ts` to
  `@ffmpeg/core-mt` (multithreaded) — it needs the COOP/COEP headers (already
  set) and `SharedArrayBuffer`.
- **Timing:** 6 beats × 4s + 6s closing = 30s (see `lib/types.ts`). Adjust
  `BEAT_SECONDS` / `CLOSING_SECONDS` there.
- **Cropping:** clips are scaled with `force_original_aspect_ratio=increase`
  then center-cropped to 1080×1920 — fills the frame, never stretches.
- **Captions** are rendered on canvas (Sora, with a system-sans fallback if the
  Google Font is blocked under COEP), then composited by FFmpeg — reliable
  across browsers without bundling a font into wasm.
- **Error handling:** the app blocks rendering and explains the problem if the
  API key is missing, the source folder is empty, any of the 6 beat headers is
  blank, or the page isn't cross-origin isolated.
- **Browser support:** use a current Chromium-based browser or Safari/Firefox
  recent versions. `webkitdirectory` folder selection works in all modern
  desktop browsers.
```
