"use client";

import { NUM_BEATS, type Beat } from "@/lib/types";

/**
 * Strict 6-beat script form. Always renders exactly NUM_BEATS rows, each with a
 * Header Text and a Short Subtext field.
 */
export default function ScriptInput({
  beats,
  onChange,
}: {
  beats: Beat[];
  onChange: (beats: Beat[]) => void;
}) {
  const update = (i: number, key: keyof Beat, val: string) => {
    const next = beats.map((b, idx) => (idx === i ? { ...b, [key]: val } : b));
    onChange(next);
  };

  return (
    <div>
      {Array.from({ length: NUM_BEATS }).map((_, i) => {
        const beat = beats[i] ?? { header: "", subtext: "" };
        return (
          <div className="beat-row" key={i}>
            <div className="beat-idx">{i + 1}</div>
            <input
              type="text"
              placeholder={`Beat ${i + 1} header (e.g. "0% APR THIS WEEK")`}
              value={beat.header}
              onChange={(e) => update(i, "header", e.target.value)}
              maxLength={48}
            />
            <input
              type="text"
              placeholder="Short subtext (e.g. on all 2024 models)"
              value={beat.subtext}
              onChange={(e) => update(i, "subtext", e.target.value)}
              maxLength={80}
            />
          </div>
        );
      })}
    </div>
  );
}
