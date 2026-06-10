"use client";

import type { PickedFile } from "./types";

/**
 * STEP 2 — probe video duration locally in the browser using a hidden <video>.
 * No bytes leave the machine; we only read metadata to sort by length and to
 * decide "shortest clip first".
 */

export function probeDuration(file: File): Promise<number> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement("video");
    v.preload = "metadata";
    v.muted = true;
    const cleanup = () => URL.revokeObjectURL(url);
    v.onloadedmetadata = () => {
      const d = isFinite(v.duration) ? v.duration : 0;
      cleanup();
      resolve(d);
    };
    v.onerror = () => {
      cleanup();
      resolve(0); // unreadable → treat as 0 so it sorts but won't be preferred wrongly
    };
    v.src = url;
  });
}

/** Probe every file, returning a new array with durations filled in. */
export async function probeAll(files: PickedFile[]): Promise<PickedFile[]> {
  const out: PickedFile[] = [];
  for (const f of files) {
    const duration = await probeDuration(f.file);
    out.push({ ...f, duration });
  }
  return out;
}

/** Sort ascending by duration (shortest first), unknowns last. */
export function byShortest(a: PickedFile, b: PickedFile): number {
  const da = a.duration ?? Infinity;
  const db = b.duration ?? Infinity;
  return da - db;
}
