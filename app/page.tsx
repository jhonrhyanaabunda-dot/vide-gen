"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import DirectoryPicker from "@/components/DirectoryPicker";
import ClosingFrameSelector from "@/components/ClosingFrameSelector";
import ApiKeyInput from "@/components/ApiKeyInput";
import ScriptInput from "@/components/ScriptInput";
import ClosingSlide from "@/components/ClosingSlide";
import ProgressPanel, { type LogLine } from "@/components/ProgressPanel";
import { buildRenderPlan } from "@/lib/selection";
import { renderReel, triggerDownload } from "@/lib/render";
import { renderReelOnServer } from "@/lib/serverRender";
import {
  checkBackendHealth,
  isBackendConfigured,
  type BackendHealth,
} from "@/lib/backend";
import { isCrossOriginIsolated } from "@/lib/ffmpeg";
import { NUM_BEATS, type Beat, type PickedFile, type ProgressUpdate } from "@/lib/types";

const emptyBeats: Beat[] = Array.from({ length: NUM_BEATS }, () => ({ header: "", subtext: "" }));

/**
 * Which engine renders the reel.
 *  - "auto"    prefer the MoviePy service when it's configured and healthy,
 *              otherwise render in the browser (the original behaviour)
 *  - "server"  force the MoviePy service
 *  - "browser" force FFmpeg.wasm, exactly as before the backend existed
 */
type RenderMode = "auto" | "server" | "browser";

export default function Page() {
  const [sourceVideos, setSourceVideos] = useState<PickedFile[]>([]);
  const [musicTracks, setMusicTracks] = useState<PickedFile[]>([]);
  const [closingFile, setClosingFile] = useState<File | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [beats, setBeats] = useState<Beat[]>(emptyBeats);

  const [renderMode, setRenderMode] = useState<RenderMode>("auto");
  const [health, setHealth] = useState<BackendHealth | null>(null);

  const [rendering, setRendering] = useState(false);
  const [percent, setPercent] = useState(0);
  const [label, setLabel] = useState("");
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [resultUrl, setResultUrl] = useState<string | null>(null);

  // Cross-origin isolation can only be read in the browser; defer to after mount
  // so server and client render the same markup (avoids hydration mismatch).
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
    if (!isBackendConfigured()) return;
    let cancelled = false;
    // A failed probe is not an error: it just means we stay on the browser
    // renderer, which needs no backend at all.
    checkBackendHealth().then((h) => {
      if (!cancelled) setHealth(h);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const coiWarning = mounted && !isCrossOriginIsolated();
  const backendUp = !!health && health.ffmpegAvailable;
  const engine: "server" | "browser" =
    renderMode === "server" ? "server" : renderMode === "browser" ? "browser" : backendUp ? "server" : "browser";

  const filledBeats = beats.filter((b) => b.header.trim()).length;

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
    if (!apiKey.trim()) return "Add your Gemini API key.";
    if (sourceVideos.length === 0) return "Choose a source videos folder — none selected.";
    if (filledBeats < NUM_BEATS)
      return `All ${NUM_BEATS} beats need a header (${filledBeats} filled).`;
    if (engine === "server" && !isBackendConfigured())
      return "Server rendering is selected but NEXT_PUBLIC_RENDER_BACKEND_URL isn't set. Switch to Browser, or configure the render service.";
    // FFmpeg.wasm needs SharedArrayBuffer; the MoviePy service does not.
    if (engine === "browser" && !isCrossOriginIsolated())
      return "This page isn't cross-origin isolated, so FFmpeg.wasm can't run. Make sure the COOP/COEP headers from next.config.js are active (they are on Vercel and on `next dev`).";
    return null;
  };

  // Shown under the button so the user knows what's missing before clicking,
  // rather than discovering it as an error afterwards.
  const blocker = mounted && !rendering ? validate() : null;

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

      let url: string;
      if (engine === "server") {
        try {
          ({ url } = await renderReelOnServer(plan, pushProgress));
        } catch (serverErr: any) {
          // In "auto" we chose the server on the client's behalf, so a service
          // failure shouldn't cost the user their render — drop back to the
          // browser engine when it's actually usable.
          if (renderMode !== "auto" || !isCrossOriginIsolated()) throw serverErr;
          pushProgress({
            percent: 5,
            label: `Render service failed (${serverErr?.message || serverErr}) — retrying in your browser…`,
            level: "warn",
          });
          ({ url } = await renderReel(plan, pushProgress));
        }
      } else {
        ({ url } = await renderReel(plan, pushProgress));
      }
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

  const enginePill = () => {
    if (!mounted) return null;
    if (engine === "server") {
      return (
        <span className="pill" title={health?.ffmpeg ?? undefined}>
          <span className="dot dot-live" />
          MoviePy {health?.moviepy}
        </span>
      );
    }
    return (
      <span className="pill">
        <span className={coiWarning ? "dot dot-err" : "dot dot-live"} />
        {coiWarning ? "Not isolated" : "In-browser"}
      </span>
    );
  };

  return (
    <>
      <header className="topbar">
        <div className="brand">
          <span className="mark">R</span>
          Reel Studio
        </div>
        <div className="topbar-right">
          <span className="spec">1080×1920 · 30s</span>
          {enginePill()}
        </div>
      </header>

      <main className="workspace">
        {/* ---------------- Work column ---------------- */}
        <div className="col-main">
          <section>
            <div className="section-head">
              <h2>Assets</h2>
              <span className="rule" />
              {sourceVideos.length > 0 && (
                <span className="count done">{sourceVideos.length} clips</span>
              )}
            </div>
            <div className="panel assets">
              <div className="picker-stack">
                <DirectoryPicker
                  label="Source videos"
                  hint="Raw dealership clips — mp4, mov, webm"
                  accept="video"
                  files={sourceVideos}
                  onPick={setSourceVideos}
                />
                <DirectoryPicker
                  label="Music"
                  hint="Background tracks — mp3, wav, m4a"
                  accept="audio"
                  files={musicTracks}
                  onPick={setMusicTracks}
                />
                <ClosingFrameSelector file={closingFile} onPick={setClosingFile} />
              </div>
              {!closingFile && (
                <figure className="slide-frame">
                  <ClosingSlide />
                  <figcaption>closing slide</figcaption>
                </figure>
              )}
            </div>
          </section>

          <section>
            <div className="section-head">
              <h2>Script</h2>
              <span className="rule" />
              <span className={filledBeats === NUM_BEATS ? "count done" : "count"}>
                {filledBeats} / {NUM_BEATS} beats
              </span>
            </div>
            <ScriptInput beats={beats} onChange={setBeats} />
            <p className="hint" style={{ marginTop: 10 }}>
              Each beat becomes ~4s with its caption burned in — e.g. “0% APR THIS
              WEEK” / “on all 2024 models”. A 7th closing beat is appended
              automatically.
            </p>
          </section>
        </div>

        {/* ---------------- Action rail ---------------- */}
        <aside className="rail">
          <div className="panel">
            <div className="panel-title">Gemini key</div>
            <ApiKeyInput value={apiKey} onChange={setApiKey} />
          </div>

          <div className="panel">
            <div className="panel-title">Render</div>

            <div className="segmented" role="group" aria-label="Render engine">
              {(["auto", "server", "browser"] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  aria-pressed={renderMode === mode}
                  disabled={rendering || (mode === "server" && !isBackendConfigured())}
                  title={
                    mode === "server" && !isBackendConfigured()
                      ? "Set NEXT_PUBLIC_RENDER_BACKEND_URL to enable the MoviePy service"
                      : undefined
                  }
                  onClick={() => setRenderMode(mode)}
                >
                  {mode === "auto" ? "Auto" : mode === "server" ? "Server" : "Browser"}
                </button>
              ))}
            </div>

            <button
              className="btn btn-primary btn-lg"
              style={{ marginTop: 12 }}
              disabled={rendering || !!blocker}
              onClick={handleRender}
            >
              {rendering ? "Rendering…" : "Render video"}
            </button>

            {blocker && !error && (
              <p className="hint" style={{ marginTop: 9 }}>
                {blocker}
              </p>
            )}

            {error && (
              <div className="alert alert-error" style={{ marginTop: 10 }}>
                {error}
              </div>
            )}

            {(rendering || logs.length > 0) && (
              <ProgressPanel percent={percent} label={label} logs={logs} />
            )}
          </div>

          {resultUrl && (
            <div className="panel result">
              <div className="panel-title">Result</div>
              <video src={resultUrl} controls playsInline />
              <button
                className="btn btn-quiet"
                style={{ width: "100%", marginTop: 10 }}
                onClick={() => triggerDownload(resultUrl)}
              >
                Download again
              </button>
            </div>
          )}
        </aside>
      </main>
    </>
  );
}
