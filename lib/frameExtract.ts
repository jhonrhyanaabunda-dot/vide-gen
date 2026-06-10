"use client";

/**
 * STEP 3 helper — extract ~1 frame/second from a clip using a hidden <video>
 * + <canvas>, entirely in the browser. Returns base64 JPEG data URLs tagged with
 * their timestamps, ready to POST to the vision API.
 */

export type ExtractedFrame = { t: number; dataUrl: string };

export async function extractFrames(
  file: File,
  opts: { fps?: number; maxFrames?: number; width?: number } = {}
): Promise<ExtractedFrame[]> {
  const fps = opts.fps ?? 1;
  const maxFrames = opts.maxFrames ?? 30;
  const targetW = opts.width ?? 320;

  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.preload = "auto";
  video.muted = true;
  video.crossOrigin = "anonymous";
  video.src = url;

  const frames: ExtractedFrame[] = [];

  try {
    await new Promise<void>((res, rej) => {
      video.onloadedmetadata = () => res();
      video.onerror = () => rej(new Error("Could not load video for frame extraction"));
    });

    const duration = isFinite(video.duration) ? video.duration : 0;
    if (duration <= 0) return [];

    const ratio = video.videoHeight / Math.max(1, video.videoWidth);
    const canvas = document.createElement("canvas");
    canvas.width = targetW;
    canvas.height = Math.round(targetW * ratio) || Math.round((targetW * 9) / 16);
    const ctx = canvas.getContext("2d")!;

    const step = 1 / fps;
    const timestamps: number[] = [];
    for (let t = 0; t < duration && timestamps.length < maxFrames; t += step) {
      timestamps.push(Number(t.toFixed(2)));
    }

    for (const t of timestamps) {
      await seek(video, t);
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      frames.push({ t, dataUrl: canvas.toDataURL("image/jpeg", 0.6) });
    }
  } finally {
    URL.revokeObjectURL(url);
  }

  return frames;
}

function seek(video: HTMLVideoElement, t: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const onSeeked = () => {
      video.removeEventListener("seeked", onSeeked);
      video.removeEventListener("error", onErr);
      resolve();
    };
    const onErr = () => {
      video.removeEventListener("seeked", onSeeked);
      video.removeEventListener("error", onErr);
      reject(new Error("seek failed"));
    };
    video.addEventListener("seeked", onSeeked);
    video.addEventListener("error", onErr);
    video.currentTime = Math.min(t, Math.max(0, video.duration - 0.05));
  });
}
