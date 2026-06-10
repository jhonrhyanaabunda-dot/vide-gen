"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import DirectoryPicker from "@/components/DirectoryPicker";
import ClosingFrameSelector from "@/components/ClosingFrameSelector";
import ApiKeyInput from "@/components/ApiKeyInput";
import ScriptInput from "@/components/ScriptInput";
import ProgressPanel, { type LogLine } from "@/components/ProgressPanel";
import { buildRenderPlan } from "@/lib/selection";
import { renderReel, triggerDownload } from "@/lib/render";
import { isCrossOriginIsolated } from "@/lib/ffmpeg";
import { NUM_BEATS, type Beat, type PickedFile, type ProgressUpdate } from "@/lib/types";

const emptyBeats: Beat[] = Array.from({ length: NUM_BEATS }, () => ({ header: "", subtext: "" }));

export default function Page() {
  const [sourceVideos, setSourceVideos] = useState<PickedFile[]>([]);
  const [musicTracks, setMusicTracks] = useState<PickedFile[]>([]);
  const [closingFile, setClosingFile] = useState<File | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [beats, setBeats] = useState<Beat[]>(emptyBeats);

  const [rendering, setRendering] = useState(false);
  const [percent, setPercent] = useState(0);
  const [label, setLabel] = useState("");
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [resultUrl, setResultUrl] = useState<string | null>(null);

  // Cross-origin isolation can only be read in the browser; defer to after mount
  // so server and client render the same markup (avoids hydration mismatch).
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const coiWarning = mounted && !isCrossOriginIsolated();

  const logId = useMemo(() => ({ n: 0 }), []);
  const pushProgress = useCallback(
    (u: ProgressUpdate) => {
      setPercent(u.percent);
      setLabel(u.label);
      setLogs((prev) => [...prev, { ...u, id: logId.n++ }]);
    },
    [logId]
  );

  const validate = (): string | null => {
    if (!apiKey.trim()) return "Please enter your Gemini API key.";
    if (sourceVideos.length === 0) return "Select a Source Videos folder — it appears empty.";
    const filledBeats = beats.filter((b) => b.header.trim()).length;
    if (filledBeats < NUM_BEATS)
      return `All ${NUM_BEATS} beats need a Header Text (you've filled ${filledBeats}).`;
    if (!isCrossOriginIsolated())
      return "This page isn't cross-origin isolated, so FFmpeg.wasm can't run. Make sure the COOP/COEP headers from next.config.js are active (they are on Vercel and on `next dev`).";
    return null;
  };

  const handleRender = async () => {
    setError(null);
    setResultUrl(null);
    const v = validate();
    if (v) {
      setError(v);
      return;
    }

    setRendering(true);
    setLogs([]);
    setPercent(0);
    try {
      const plan = await buildRenderPlan({
        sourceVideos,
        musicTracks,
        closingFile,
        beats,
        apiKey,
        onProgress: pushProgress,
      });

      const { url } = await renderReel(plan, pushProgress);
      setResultUrl(url);
      triggerDownload(url, "dealership-reel.mp4");
    } catch (err: any) {
      const msg = String(err?.message || err);
      setError(msg);
      pushProgress({ percent, label: `Render failed: ${msg}`, level: "err" });
    } finally {
      setRendering(false);
    }
  };

  return (
    <main className="shell">
      <section className="hero" id="workflow">
        <span className="eyebrow">Automotive Reel Studio</span>
        <h1>
          Raw clips in. <span className="accent">30-second Reels out.</span>
        </h1>
        <p>
          Point at your footage and music folders, drop in a 6-beat script, and the
          studio uses AI to pick the best clips, cut them to a vertical 9:16 Reel,
          burn in on-brand captions, sync your music, and cap it with your dealership
          CTA — rendered entirely in your browser.
        </p>
      </section>

      {/* 1. Assets */}
      <section className="card">
        <div className="card-head">
          <span className="card-num">1</span>
          <h3>Select your asset folders</h3>
        </div>
        <p className="card-sub">
          Folders stay on your machine — only filenames (and, when needed, low-res
          frames) are sent to the AI.
        </p>
        <div className="grid-2">
          <DirectoryPicker
            label="Source Videos Folder"
            hint="Raw dealership clips (.mp4, .mov, .webm…)"
            accept="video"
            files={sourceVideos}
            onPick={setSourceVideos}
          />
          <DirectoryPicker
            label="Music Folder"
            hint="Background tracks (.mp3, .wav, .m4a…)"
            accept="audio"
            files={musicTracks}
            onPick={setMusicTracks}
          />
        </div>
      </section>

      {/* 2. API key */}
      <section className="card">
        <div className="card-head">
          <span className="card-num">2</span>
          <h3>Connect AI for smart clip selection</h3>
        </div>
        <p className="card-sub">
          Powers filename matching and vision scanning. Runs on Google Gemini —
          the free tier is plenty for this.
        </p>
        <ApiKeyInput value={apiKey} onChange={setApiKey} />
      </section>

      {/* 3. Script */}
      <section className="card" id="script">
        <div className="card-head">
          <span className="card-num">3</span>
          <h3>Write your 6-beat script</h3>
        </div>
        <p className="card-sub">
          Exactly six beats. Each becomes ~4 seconds of the Reel with its caption
          burned in. A 7th closing beat is added automatically.
        </p>
        <ScriptInput beats={beats} onChange={setBeats} />
      </section>

      {/* 4. Closing frame */}
      <section className="card">
        <div className="card-head">
          <span className="card-num">4</span>
          <h3>Closing frame (7th beat)</h3>
        </div>
        <p className="card-sub">Your call-to-action. Upload one, or use the generated slide.</p>
        <ClosingFrameSelector file={closingFile} onPick={setClosingFile} />
      </section>

      {/* 5. Render */}
      <section className="card" id="render">
        <div className="card-head">
          <span className="card-num">5</span>
          <h3>Render &amp; download</h3>
        </div>
        <p className="card-sub">
          Everything is processed locally with FFmpeg.wasm. The .mp4 downloads
          automatically when finished.
        </p>

        {error && <div className="alert alert-error">{error}</div>}

        <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
          <button className="btn btn-primary" disabled={rendering} onClick={handleRender}>
            {rendering ? "Rendering…" : "▶ Render Video"}
          </button>
          <span className="badge">9:16 · 30s · 1080×1920</span>
          {coiWarning && (
            <span className="badge" style={{ borderColor: "var(--error)", color: "#ffb4b4", background: "rgba(239,68,68,0.1)" }}>
              ⚠ Not cross-origin isolated
            </span>
          )}
        </div>

        {(rendering || logs.length > 0) && (
          <ProgressPanel percent={percent} label={label} logs={logs} />
        )}

        {resultUrl && (
          <div style={{ marginTop: 24 }}>
            <div className="alert alert-ok">Reel ready — your download should have started.</div>
            <div className="preview">
              <video src={resultUrl} controls playsInline />
              <div>
                <button className="btn btn-primary" onClick={() => triggerDownload(resultUrl!)}>
                  ⤓ Download again
                </button>
              </div>
            </div>
          </div>
        )}
      </section>

      <footer style={{ textAlign: "center", color: "var(--medium-gray)", fontSize: 12, marginTop: 40 }}>
        Built with Next.js · FFmpeg.wasm · rendered 100% client-side.
      </footer>
    </main>
  );
}
