/** Shared types across UI and the render pipeline. */

export type Beat = {
  header: string;
  subtext: string;
};

export type PickedFile = {
  file: File;
  name: string;
  /** Duration in seconds, probed in the browser. undefined until probed. */
  duration?: number;
};

export type ClipMatch = {
  beat: number;
  /** Ordered best-first list of relevant filenames (Step 1 ranking). */
  candidates: string[];
  /** Convenience: candidates[0] (kept for backward compatibility). */
  filename: string | null;
  confidence: number;
  reason: string;
};

export type ProgressUpdate = {
  /** 0–100 overall. */
  percent: number;
  /** Human-readable phase, e.g. "Cutting beat 3/6". */
  label: string;
  /** Log line classification for styling. */
  level?: "info" | "ok" | "warn" | "err";
};

export type RenderInputs = {
  sourceVideos: PickedFile[];
  musicTracks: PickedFile[];
  closingFile: File | null;
  beats: Beat[];
  apiKey: string;
};

export const TOTAL_DURATION = 30; // seconds, final reel length
export const NUM_BEATS = 6;
export const NUM_SEGMENTS = 7; // 6 beats + 1 closing
export const OUT_W = 1080;
export const OUT_H = 1920;
export const FPS = 30;

// 6 beats + closing share 30s. Give the closing a touch more room for the CTA.
export const BEAT_SECONDS = 4; // each of the 6 beats
export const CLOSING_SECONDS = TOTAL_DURATION - BEAT_SECONDS * NUM_BEATS; // 6s
