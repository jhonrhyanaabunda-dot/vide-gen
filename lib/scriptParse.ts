"use client";

import { NUM_BEATS, type Beat } from "./types";

/**
 * Parse a pasted or dropped script into beats.
 *
 * Deliberately forgiving about format — people keep these scripts in whatever
 * they already use, so we accept JSON, CSV/TSV, "header | subtext",
 * "header - subtext", blank-line-separated blocks, and a plain list of headers.
 */

const SEPARATORS = ["|", "\t", " — ", " – ", " -- "];

/** Strip "1. ", "1) ", "- ", "• " and similar list decoration. */
function stripBullet(s: string): string {
  return s.replace(/^\s*(?:\d+\s*[.)\]:-]\s*|[-*•]\s+)/, "").trim();
}

function clean(s: string): string {
  return stripBullet(String(s ?? "")).replace(/^["']|["']$/g, "").trim();
}

/** One CSV row → cells. Handles quoted cells containing commas. */
function csvCells(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else quoted = !quoted;
    } else if (ch === "," && !quoted) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out.map((c) => c.trim());
}

function pad(beats: Beat[]): Beat[] {
  const out = beats.slice(0, NUM_BEATS);
  while (out.length < NUM_BEATS) out.push({ header: "", subtext: "" });
  return out;
}

/**
 * Returns exactly NUM_BEATS beats, or null when nothing usable was found.
 * Never throws — bad input should show a message, not break the page.
 */
export function parseScript(raw: string): Beat[] | null {
  const text = (raw ?? "").replace(/\r\n?/g, "\n").trim();
  if (!text) return null;

  // ---- JSON -------------------------------------------------------------
  if (text.startsWith("[") || text.startsWith("{")) {
    try {
      const data = JSON.parse(text);
      const arr: any[] = Array.isArray(data) ? data : data.beats ?? data.segments ?? [];
      if (Array.isArray(arr) && arr.length) {
        const beats = arr.map((b) =>
          typeof b === "string"
            ? { header: clean(b), subtext: "" }
            : {
                header: clean(b.header ?? b.title ?? b.text ?? ""),
                subtext: clean(b.subtext ?? b.sub ?? b.subtitle ?? b.body ?? ""),
              }
        );
        if (beats.some((b) => b.header)) return pad(beats);
      }
    } catch {
      // Not valid JSON after all — fall through to the text formats.
    }
  }

  // ---- Blank-line-separated blocks (header on line 1, subtext on line 2) --
  const blocks = text.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
  if (blocks.length >= 2 && blocks.some((b) => b.includes("\n"))) {
    const beats = blocks.map((b) => {
      const [h, ...rest] = b.split("\n");
      return { header: clean(h), subtext: clean(rest.join(" ")) };
    });
    if (beats.some((x) => x.header)) return pad(beats);
  }

  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return null;

  // ---- Explicit separator ------------------------------------------------
  for (const sep of SEPARATORS) {
    if (lines.filter((l) => l.includes(sep)).length >= Math.min(2, lines.length)) {
      const beats = lines.map((l) => {
        const idx = l.indexOf(sep);
        return {
          header: clean(l.slice(0, idx)),
          subtext: clean(l.slice(idx + sep.length)),
        };
      });
      if (beats.some((b) => b.header)) return pad(beats);
    }
  }

  // ---- CSV / TSV ---------------------------------------------------------
  if (lines.filter((l) => l.includes(",")).length >= Math.min(2, lines.length)) {
    let rows = lines.map(csvCells);
    // Drop a header row like "header,subtext".
    if (
      rows.length > 1 &&
      /^(header|title|beat)$/i.test(clean(rows[0][0])) 
    ) {
      rows = rows.slice(1);
    }
    const beats = rows.map((c) => ({
      // A leading "1," index column is common in exported sheets.
      ...(c.length >= 3 && /^\d+$/.test(c[0])
        ? { header: clean(c[1]), subtext: clean(c[2]) }
        : { header: clean(c[0]), subtext: clean(c[1] ?? "") }),
    }));
    if (beats.some((b) => b.header)) return pad(beats);
  }

  // ---- Alternating header/subtext lines ----------------------------------
  if (lines.length >= NUM_BEATS * 2 - 2 && lines.length % 2 === 0) {
    const beats: Beat[] = [];
    for (let i = 0; i < lines.length; i += 2) {
      beats.push({ header: clean(lines[i]), subtext: clean(lines[i + 1]) });
    }
    if (beats.some((b) => b.header)) return pad(beats);
  }

  // ---- Plain list of headers ---------------------------------------------
  const beats = lines.map((l) => ({ header: clean(l), subtext: "" }));
  return beats.some((b) => b.header) ? pad(beats) : null;
}

/** Accepted for the script import control. */
export const SCRIPT_ACCEPT = ".txt,.csv,.tsv,.json,.md,text/plain,text/csv,application/json";
