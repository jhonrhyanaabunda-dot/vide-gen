"use client";

import { makeBeatOverlay, makeClosingSlide } from "./overlay";
import { BACKEND_URL, BACKEND_API_KEY, authHeaders } from "./backend";
import type { RenderPlan } from "./render";
import {
  OUT_W,
  OUT_H,
  FPS,
  TOTAL_DURATION,
  CLOSING_SECONDS,
  type ProgressUpdate,
} from "./types";

/**
 * Server-side rendering path: hand the RenderPlan and its assets to the MoviePy
 * service, follow progress, download the finished MP4.
 *
 * Drop-in replacement for renderReel() in lib/render.ts — same arguments, same
 * `{ url, blob }` result — so app/page.tsx can pick either engine at runtime.
 *
 * Text overlays are still rasterised here in the browser, on a canvas with the
 * live Sora webfont, and uploaded as PNGs. That's what keeps the server output
 * pixel-identical to the browser output instead of two renderers drifting.
 */

type Progress = (u: ProgressUpdate) => void;

// Progress budget for the client's view of a server render.
const P_PREP_END = 8;      // rasterising overlays
const P_UPLOAD_END = 20;   // pushing bytes
const P_SERVER_END = 97;   // the render itself
// remainder: downloading the result

type ServerStatus = {
  jobId: string;
  status: "queued" | "running" | "done" | "error";
  percent: number;
  label: string;
  error?: string | null;
  downloadUrl?: string | null;
};

export async function renderReelOnServer(
  plan: RenderPlan,
  onProgress: Progress
): Promise<{ url: string; blob: Blob }> {
  if (!BACKEND_URL) {
    throw new Error("No render backend configured (NEXT_PUBLIC_RENDER_BACKEND_URL).");
  }

  const log = (label: string, percent: number, level: ProgressUpdate["level"] = "info") =>
    onProgress({ label, percent, level });

  log("Preparing assets for the render service…", 2);

  const form = new FormData();

  // --- Source clips: upload each distinct file once, reference it by key. A
  // clip reused across several beats must not be sent twice.
  const clipKeys = new Map<File, string>();
  const keyForClip = (file: File): string => {
    let key = clipKeys.get(file);
    if (!key) {
      key = `clip_${clipKeys.size}`;
      clipKeys.set(file, key);
      form.append(key, file, file.name);
    }
    return key;
  };

  // --- Beat segments + their overlays.
  const segments = [];
  for (let i = 0; i < plan.segments.length; i++) {
    const seg = plan.segments[i];
    log(
      `Rendering caption ${i + 1}/${plan.segments.length}…`,
      2 + (P_PREP_END - 2) * (i / Math.max(1, plan.segments.length))
    );
    const overlayKey = `overlay_${i}`;
    const png = await makeBeatOverlay(seg.beatIndex, seg.header, seg.subtext);
    form.append(overlayKey, new Blob([toArrayBuffer(png)], { type: "image/png" }), `${overlayKey}.png`);

    segments.push({
      beatIndex: seg.beatIndex,
      clip: keyForClip(seg.file),
      start: seg.start,
      duration: seg.duration,
      header: seg.header,
      subtext: seg.subtext,
      overlay: overlayKey,
    });
  }

  // --- Closing frame. When the user supplied nothing we rasterise the same
  // generated slide the browser path uses and send it as an image, so both
  // engines produce the identical closing card.
  let closing: { kind: "file" | "generated"; file?: string; isImage: boolean };
  if (plan.closing.kind === "file") {
    form.append("closing", plan.closing.file, plan.closing.file.name);
    closing = { kind: "file", file: "closing", isImage: plan.closing.isImage };
  } else {
    const slide = await makeClosingSlide();
    form.append("closing", new Blob([toArrayBuffer(slide)], { type: "image/png" }), "closing.png");
    closing = { kind: "file", file: "closing", isImage: true };
  }

  // --- Music.
  let music: string | null = null;
  if (plan.music) {
    form.append("music", plan.music, plan.music.name);
    music = "music";
  }

  form.append(
    "plan",
    JSON.stringify({
      segments,
      closing,
      music,
      totalDuration: TOTAL_DURATION,
      outW: OUT_W,
      outH: OUT_H,
      fps: FPS,
      closingSeconds: CLOSING_SECONDS,
      filename: "dealership-reel.mp4",
    })
  );

  // --- Upload. XHR rather than fetch: it reports upload progress, and these
  // payloads are large enough that a silent bar would look like a hang.
  log("Uploading footage to the render service…", P_PREP_END);
  const { jobId } = await uploadWithProgress(form, (frac) => {
    log(
      `Uploading footage — ${Math.round(frac * 100)}%`,
      P_PREP_END + (P_UPLOAD_END - P_PREP_END) * frac
    );
  });

  log("Upload complete — queued for rendering", P_UPLOAD_END, "ok");

  // --- Follow the job.
  const final = await followJob(jobId, (s) => {
    const mapped = P_UPLOAD_END + (P_SERVER_END - P_UPLOAD_END) * (s.percent / 100);
    log(s.label || "Rendering…", mapped);
  });

  if (final.status === "error") {
    throw new Error(final.error || "The render service reported a failure.");
  }

  // --- Fetch the MP4.
  log("Downloading finished reel…", P_SERVER_END + 1);
  const res = await fetch(`${BACKEND_URL}/api/render/${jobId}/result`, {
    headers: authHeaders(),
  });
  if (!res.ok) {
    throw new Error(`Could not download the rendered reel (${res.status}).`);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);

  log("Done! Download starting…", 100, "ok");
  return { url, blob };
}

/** POST the multipart body, surfacing upload progress. Resolves the job id. */
function uploadWithProgress(
  form: FormData,
  onFraction: (f: number) => void
): Promise<{ jobId: string }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${BACKEND_URL}/api/render`);
    if (BACKEND_API_KEY) xhr.setRequestHeader("X-API-Key", BACKEND_API_KEY);

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onFraction(e.loaded / e.total);
    };
    xhr.onload = () => {
      let body: any = {};
      try {
        body = JSON.parse(xhr.responseText || "{}");
      } catch {
        /* non-JSON error page */
      }
      if (xhr.status >= 200 && xhr.status < 300 && body.jobId) {
        resolve({ jobId: body.jobId });
      } else {
        reject(
          new Error(
            body.detail || body.error || `Render service rejected the upload (${xhr.status}).`
          )
        );
      }
    };
    xhr.onerror = () =>
      reject(
        new Error(
          "Could not reach the render service. Check NEXT_PUBLIC_RENDER_BACKEND_URL " +
            "and that ALLOWED_ORIGINS on the service includes this site."
        )
      );
    xhr.ontimeout = () => reject(new Error("Upload to the render service timed out."));
    xhr.send(form);
  });
}

/**
 * Track a job to completion. Prefers the SSE stream; falls back to polling.
 * EventSource can't set headers, so an API-key deployment always polls.
 */
async function followJob(
  jobId: string,
  onUpdate: (s: ServerStatus) => void
): Promise<ServerStatus> {
  if (!BACKEND_API_KEY && typeof EventSource !== "undefined") {
    try {
      return await streamJob(jobId, onUpdate);
    } catch {
      // Proxy buffering, a dropped connection, etc. Polling still works.
    }
  }
  return pollJob(jobId, onUpdate);
}

function streamJob(jobId: string, onUpdate: (s: ServerStatus) => void): Promise<ServerStatus> {
  return new Promise((resolve, reject) => {
    const es = new EventSource(`${BACKEND_URL}/api/render/${jobId}/events`);
    let last: ServerStatus | null = null;
    let settled = false;

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      es.close();
      fn();
    };

    es.onmessage = (ev) => {
      try {
        const s = JSON.parse(ev.data) as ServerStatus;
        last = s;
        onUpdate(s);
        if (s.status === "done" || s.status === "error") finish(() => resolve(s));
      } catch {
        /* ignore a malformed frame and wait for the next */
      }
    };
    es.onerror = () =>
      finish(() =>
        last && (last.status === "done" || last.status === "error")
          ? resolve(last)
          : reject(new Error("progress stream interrupted"))
      );
  });
}

async function pollJob(
  jobId: string,
  onUpdate: (s: ServerStatus) => void
): Promise<ServerStatus> {
  // Renders run for minutes; sub-second polling would add nothing but load.
  const INTERVAL_MS = 1000;
  let consecutiveFailures = 0;

  for (;;) {
    await sleep(INTERVAL_MS);
    try {
      const res = await fetch(`${BACKEND_URL}/api/render/${jobId}`, {
        headers: authHeaders(),
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`status ${res.status}`);
      const s = (await res.json()) as ServerStatus;
      consecutiveFailures = 0;
      onUpdate(s);
      if (s.status === "done" || s.status === "error") return s;
    } catch (err) {
      // Tolerate a blip; give up if the service is genuinely gone.
      if (++consecutiveFailures >= 10) {
        throw new Error("Lost contact with the render service while rendering.");
      }
    }
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Copy into a standalone ArrayBuffer so BlobPart typing is satisfied. */
function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}
