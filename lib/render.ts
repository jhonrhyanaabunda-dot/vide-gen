"use client";

import { fetchFile } from "@ffmpeg/util";
import { getFFmpeg } from "./ffmpeg";
import { makeBeatOverlay, makeClosingSlide } from "./overlay";
import {
  OUT_W,
  OUT_H,
  FPS,
  BEAT_SECONDS,
  CLOSING_SECONDS,
  TOTAL_DURATION,
  type Beat,
  type ProgressUpdate,
} from "./types";

/** A resolved instruction for one of the 6 beat segments. */
export type SegmentPlan = {
  beatIndex: number; // 1..6
  file: File;
  start: number; // seconds into the source clip
  duration: number; // seconds to take
  header: string;
  subtext: string;
};

export type ClosingPlan =
  | { kind: "file"; file: File; isImage: boolean }
  | { kind: "generated" };

export type RenderPlan = {
  segments: SegmentPlan[]; // exactly 6
  closing: ClosingPlan;
  music: File | null;
};

type Progress = (u: ProgressUpdate) => void;

const COMMON_SCALE_CROP =
  `scale=${OUT_W}:${OUT_H}:force_original_aspect_ratio=increase,` +
  `crop=${OUT_W}:${OUT_H},fps=${FPS},setsar=1`;

// Uniform encode settings so the concat demuxer can stream-copy.
const ENCODE = [
  "-c:v",
  "libx264",
  "-pix_fmt",
  "yuv420p",
  "-r",
  String(FPS),
  "-preset",
  "ultrafast",
  "-profile:v",
  "baseline",
  "-level",
  "3.1",
];

function extOf(name: string, fallback: string): string {
  const m = /\.([a-z0-9]+)$/i.exec(name);
  return m ? m[1].toLowerCase() : fallback;
}

/**
 * Execute a RenderPlan entirely in the browser and return a downloadable MP4
 * blob URL. Drives a detailed progress callback throughout.
 */
export async function renderReel(
  plan: RenderPlan,
  onProgress: Progress
): Promise<{ url: string; blob: Blob }> {
  const log = (label: string, percent: number, level: ProgressUpdate["level"] = "info") =>
    onProgress({ label, percent, level });

  log("Loading FFmpeg.wasm core…", 2);
  const ff = await getFFmpeg();

  const segmentFiles: string[] = [];
  // Progress budget: 5% load, 65% segments, 10% closing, 20% concat+audio.
  const perSegment = 65 / plan.segments.length;

  // ---- 1. Process each of the 6 beat segments ----
  for (let i = 0; i < plan.segments.length; i++) {
    const seg = plan.segments[i];
    const base = 8 + perSegment * i;
    log(`Beat ${seg.beatIndex}/6 — preparing clip "${seg.file.name}"`, base);

    const inExt = extOf(seg.file.name, "mp4");
    const inName = `src_${i}.${inExt}`;
    const overlayName = `ov_${i}.png`;
    const outName = `seg_${i}.mp4`;

    await ff.writeFile(inName, await fetchFile(seg.file));

    log(`Beat ${seg.beatIndex}/6 — rendering text overlay`, base + perSegment * 0.3);
    const overlayPng = await makeBeatOverlay(seg.beatIndex, seg.header, seg.subtext);
    await ff.writeFile(overlayName, overlayPng);

    log(`Beat ${seg.beatIndex}/6 — cutting & cropping to 9:16`, base + perSegment * 0.5);
    // -ss before -i for fast seek; trim guarantees exact duration.
    await ff.exec([
      "-ss",
      String(seg.start),
      "-t",
      String(seg.duration),
      "-i",
      inName,
      "-i",
      overlayName,
      "-filter_complex",
      // tpad clones the last frame to guarantee a full-length segment even if the
      // source has < seg.duration available from `start`; -t then caps it exactly.
      `[0:v]${COMMON_SCALE_CROP},tpad=stop_mode=clone:stop_duration=${seg.duration}[bg];` +
        `[bg][1:v]overlay=0:0:format=auto[v]`,
      "-map",
      "[v]",
      "-an",
      "-t",
      String(seg.duration),
      ...ENCODE,
      outName,
    ]);

    segmentFiles.push(outName);
    await safeDelete(ff, inName);
    await safeDelete(ff, overlayName);
    log(`Beat ${seg.beatIndex}/6 — done`, base + perSegment, "ok");
  }

  // ---- 2. Closing segment (7th beat) ----
  log("Building closing frame…", 75);
  const closingOut = "seg_closing.mp4";
  if (plan.closing.kind === "file" && plan.closing.isImage) {
    const ext = extOf(plan.closing.file.name, "png");
    const inName = `closing.${ext}`;
    await ff.writeFile(inName, await fetchFile(plan.closing.file));
    await ff.exec([
      "-loop",
      "1",
      "-t",
      String(CLOSING_SECONDS),
      "-i",
      inName,
      "-filter_complex",
      `[0:v]${COMMON_SCALE_CROP},format=yuv420p[v]`,
      "-map",
      "[v]",
      "-an",
      "-t",
      String(CLOSING_SECONDS),
      ...ENCODE,
      closingOut,
    ]);
    await safeDelete(ff, inName);
  } else if (plan.closing.kind === "file") {
    // User-supplied video as the closing frame.
    const ext = extOf(plan.closing.file.name, "mp4");
    const inName = `closing.${ext}`;
    await ff.writeFile(inName, await fetchFile(plan.closing.file));
    await ff.exec([
      "-ss",
      "0",
      "-t",
      String(CLOSING_SECONDS),
      "-i",
      inName,
      "-filter_complex",
      // Pad a short closing video to the full closing duration.
      `[0:v]${COMMON_SCALE_CROP},tpad=stop_mode=clone:stop_duration=${CLOSING_SECONDS}[v]`,
      "-map",
      "[v]",
      "-an",
      "-t",
      String(CLOSING_SECONDS),
      ...ENCODE,
      closingOut,
    ]);
    await safeDelete(ff, inName);
  } else {
    // No closing file → generated React/canvas placeholder slide.
    const slidePng = await makeClosingSlide();
    const inName = "closing_slide.png";
    await ff.writeFile(inName, slidePng);
    await ff.exec([
      "-loop",
      "1",
      "-t",
      String(CLOSING_SECONDS),
      "-i",
      inName,
      "-filter_complex",
      `[0:v]${COMMON_SCALE_CROP},format=yuv420p[v]`,
      "-map",
      "[v]",
      "-an",
      "-t",
      String(CLOSING_SECONDS),
      ...ENCODE,
      closingOut,
    ]);
    await safeDelete(ff, inName);
  }
  segmentFiles.push(closingOut);
  log("Closing frame done", 80, "ok");

  // ---- 3. Concatenate all 7 segments (stream copy) ----
  log("Stitching segments together…", 84);
  const listTxt = segmentFiles.map((f) => `file '${f}'`).join("\n");
  await ff.writeFile("concat_list.txt", new TextEncoder().encode(listTxt));
  const stitched = "stitched.mp4";
  await ff.exec([
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    "concat_list.txt",
    "-c",
    "copy",
    "-t",
    String(TOTAL_DURATION),
    stitched,
  ]);
  log("Segments stitched", 90, "ok");

  // ---- 4. Mux music (trim + fade to 30s) ----
  let finalName = stitched;
  if (plan.music) {
    log("Adding & fading background music…", 92);
    const aExt = extOf(plan.music.name, "mp3");
    const aName = `music.${aExt}`;
    await ff.writeFile(aName, await fetchFile(plan.music));
    finalName = "final.mp4";
    await ff.exec([
      "-i",
      stitched,
      "-i",
      aName,
      "-filter_complex",
      // pad short tracks, trim to 30s, fade in/out.
      `[1:a]apad,atrim=0:${TOTAL_DURATION},asetpts=PTS-STARTPTS,` +
        `afade=t=in:st=0:d=0.6,afade=t=out:st=${TOTAL_DURATION - 1.2}:d=1.2[a]`,
      "-map",
      "0:v",
      "-map",
      "[a]",
      "-c:v",
      "copy",
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      "-t",
      String(TOTAL_DURATION),
      finalName,
    ]);
    await safeDelete(ff, aName);
    log("Music mixed", 97, "ok");
  } else {
    log("No music selected — exporting silent reel", 95, "warn");
  }

  // ---- 5. Read out the result ----
  log("Finalizing MP4…", 98);
  const data = (await ff.readFile(finalName)) as Uint8Array;
  // Copy into a fresh ArrayBuffer to satisfy strict BlobPart typing.
  const buf = new Uint8Array(data.byteLength);
  buf.set(data);
  const blob = new Blob([buf], { type: "video/mp4" });
  const url = URL.createObjectURL(blob);

  // Cleanup FS.
  for (const f of segmentFiles) await safeDelete(ff, f);
  await safeDelete(ff, "concat_list.txt");
  await safeDelete(ff, stitched);
  if (finalName !== stitched) await safeDelete(ff, finalName);

  log("Done! Download starting…", 100, "ok");
  return { url, blob };
}

async function safeDelete(ff: any, name: string) {
  try {
    await ff.deleteFile(name);
  } catch {
    /* ignore */
  }
}

/** Convenience: trigger a browser download for a rendered blob URL. */
export function triggerDownload(url: string, filename = "dealership-reel.mp4") {
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** Default beat duration helper exported for the orchestrator. */
export const DEFAULT_BEAT_DURATION = BEAT_SECONDS;
