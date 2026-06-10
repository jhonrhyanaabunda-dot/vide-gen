"use client";

import { FFmpeg } from "@ffmpeg/ffmpeg";
import { toBlobURL } from "@ffmpeg/util";

/**
 * Lazy singleton FFmpeg.wasm instance. The core is fetched from a CDN and run
 * from a Blob URL so we don't have to bundle the wasm. Requires the page to be
 * cross-origin isolated (see next.config.js COOP/COEP headers) for the
 * multithreaded core / SharedArrayBuffer.
 */

let ffmpeg: FFmpeg | null = null;
let loadPromise: Promise<FFmpeg> | null = null;

const CORE_VERSION = "0.12.6";
const BASE = `https://unpkg.com/@ffmpeg/core@${CORE_VERSION}/dist/umd`;

export async function getFFmpeg(
  onLog?: (msg: string) => void
): Promise<FFmpeg> {
  if (ffmpeg && (ffmpeg as any).loaded) return ffmpeg;
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    const instance = new FFmpeg();
    if (onLog) {
      instance.on("log", ({ message }) => onLog(message));
    }
    await instance.load({
      coreURL: await toBlobURL(`${BASE}/ffmpeg-core.js`, "text/javascript"),
      wasmURL: await toBlobURL(`${BASE}/ffmpeg-core.wasm`, "application/wasm"),
    });
    ffmpeg = instance;
    return instance;
  })();

  return loadPromise;
}

export function isCrossOriginIsolated(): boolean {
  return typeof window !== "undefined" && (window as any).crossOriginIsolated === true;
}
