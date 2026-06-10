"use client";

import { extractFrames } from "./frameExtract";
import { probeAll, byShortest } from "./videoMeta";
import type { SegmentPlan, RenderPlan, ClosingPlan } from "./render";
import {
  BEAT_SECONDS,
  type Beat,
  type PickedFile,
  type ClipMatch,
  type ProgressUpdate,
} from "./types";

/**
 * Orchestrates the AI-driven clip selection hierarchy described in the spec:
 *   1. Filename matching (LLM, via /api/match-clips)
 *   2. Prefer shorter clips (local duration probing)
 *   3. Visual AI scanning fallback (frame extraction + /api/vision-scan)
 * Produces a fully-resolved RenderPlan for the render engine.
 */

type Progress = (u: ProgressUpdate) => void;

// A clip is "short enough" if it doesn't dwarf the beat length. Longer clips go
// through the vision fallback so we cut the most relevant window.
const SHORT_CLIP_MAX = BEAT_SECONDS * 2.5; // ~10s

export async function buildRenderPlan(args: {
  sourceVideos: PickedFile[];
  musicTracks: PickedFile[];
  closingFile: File | null;
  beats: Beat[];
  apiKey: string;
  onProgress: Progress;
}): Promise<RenderPlan> {
  const { sourceVideos, musicTracks, closingFile, beats, apiKey, onProgress } = args;

  onProgress({ percent: 1, label: "Reading source clip metadata…", level: "info" });
  const probed = await probeAll(sourceVideos);

  // --- STEP 1: filename matching via LLM ---
  onProgress({ percent: 3, label: "Matching clips to script via AI (filenames)…", level: "info" });
  let matches: ClipMatch[] = [];
  try {
    const res = await fetch("/api/match-clips", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        apiKey,
        filenames: probed.map((p) => p.name),
        beats,
      }),
    });
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      throw new Error(e.error || `match-clips failed (${res.status})`);
    }
    matches = (await res.json()).matches as ClipMatch[];
  } catch (err: any) {
    onProgress({
      percent: 4,
      label: `Filename matching failed (${err.message}); falling back to order/shortest.`,
      level: "warn",
    });
    matches = beats.map((_, i) => ({
      beat: i + 1,
      candidates: [],
      filename: null,
      confidence: 0,
      reason: "",
    }));
  }

  const byName = new Map(probed.map((p) => [p.name, p]));
  const usedNames = new Set<string>();
  const segments: SegmentPlan[] = [];

  for (let i = 0; i < beats.length; i++) {
    const beat = beats[i];
    const match = matches.find((m) => m.beat === i + 1);
    const pct = 6 + (i / beats.length) * 30;

    // --- STEP 2: among the LLM's ranked candidates for this beat, prefer the
    // SHORTEST one that hasn't been used yet (probed durations decide). This is
    // the spec's "sort the matched files by duration, use the shortest first".
    const candidateNames = match?.candidates?.length
      ? match.candidates
      : match?.filename
      ? [match.filename]
      : [];
    const candidateFiles = candidateNames
      .map((n) => byName.get(n))
      .filter((p): p is PickedFile => !!p);

    let chosen: PickedFile | undefined =
      candidateFiles.filter((p) => !usedNames.has(p.name)).sort(byShortest)[0] ??
      candidateFiles.sort(byShortest)[0];

    if (chosen) {
      onProgress({
        percent: pct,
        label: `Beat ${i + 1}: matched "${chosen.name}" — shortest of ${
          candidateFiles.length
        } candidate(s), ${(chosen.duration ?? 0).toFixed(1)}s (${Math.round(
          (match!.confidence || 0) * 100
        )}%)`,
        level: "ok",
      });
    } else {
      // No usable candidate → fall back to the shortest unused clip overall.
      const fallback = [...probed]
        .filter((p) => !usedNames.has(p.name))
        .sort(byShortest)[0];
      chosen = fallback ?? [...probed].sort(byShortest)[0];
      onProgress({
        percent: pct,
        label: `Beat ${i + 1}: no filename match — using shortest clip "${chosen?.name}"`,
        level: "warn",
      });
    }

    if (!chosen) {
      throw new Error("No source videos available to build the reel.");
    }
    usedNames.add(chosen.name);

    const dur = chosen.duration ?? 0;
    let start = 0;

    // --- STEP 3: visual scanning fallback for longer clips ---
    if (dur > SHORT_CLIP_MAX) {
      try {
        onProgress({
          percent: pct + 1,
          label: `Beat ${i + 1}: clip is ${dur.toFixed(
            1
          )}s — scanning frames with Vision AI…`,
          level: "info",
        });
        const frames = await extractFrames(chosen.file, { fps: 1, maxFrames: 30 });
        const res = await fetch("/api/vision-scan", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            apiKey,
            header: beat.header,
            subtext: beat.subtext,
            segmentSeconds: BEAT_SECONDS,
            frames,
          }),
        });
        if (res.ok) {
          const { start: s, reason } = await res.json();
          start = Math.max(0, Math.min(Number(s) || 0, Math.max(0, dur - BEAT_SECONDS)));
          onProgress({
            percent: pct + 2,
            label: `Beat ${i + 1}: Vision picked t=${start.toFixed(1)}s ${
              reason ? `(${reason})` : ""
            }`,
            level: "ok",
          });
        } else {
          throw new Error(`vision-scan ${res.status}`);
        }
      } catch (err: any) {
        // Fall back to a sensible interior segment.
        start = Math.max(0, Math.min((dur - BEAT_SECONDS) / 2, dur - BEAT_SECONDS));
        onProgress({
          percent: pct + 2,
          label: `Beat ${i + 1}: vision scan unavailable (${err.message}) — using middle segment`,
          level: "warn",
        });
      }
    }

    // Every beat is rendered at exactly BEAT_SECONDS. If the chosen clip can't
    // supply that much from `start`, render.ts pads the last frame (tpad) so the
    // segment — and therefore the final reel — stays exactly the right length.
    segments.push({
      beatIndex: i + 1,
      file: chosen.file,
      start,
      duration: BEAT_SECONDS,
      header: beat.header,
      subtext: beat.subtext,
    });
  }

  // --- Closing plan (7th beat) ---
  const closing: ClosingPlan = closingFile
    ? { kind: "file", file: closingFile, isImage: /^image\//.test(closingFile.type) }
    : { kind: "generated" };

  // --- Music: pick the shortest track >= 30s if available, else the longest ---
  let music: File | null = null;
  if (musicTracks.length > 0) {
    const probedMusic = await probeAll(musicTracks);
    const enough = probedMusic.filter((m) => (m.duration ?? 0) >= 30).sort(byShortest);
    const pick = enough[0] ?? [...probedMusic].sort((a, b) => (b.duration ?? 0) - (a.duration ?? 0))[0];
    music = pick?.file ?? musicTracks[0].file;
    onProgress({ percent: 37, label: `Selected music track "${pick?.name}"`, level: "ok" });
  }

  return { segments, closing, music };
}
