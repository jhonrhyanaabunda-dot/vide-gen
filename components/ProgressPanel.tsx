"use client";

import type { ProgressUpdate } from "@/lib/types";

export type LogLine = ProgressUpdate & { id: number };

/**
 * Progress readout for a render: a thin meter, the current step, and the
 * scrolling log. The log matters more than it looks — a render runs for
 * minutes, and the step names are how you tell a slow render from a stuck one.
 */
export default function ProgressPanel({
  percent,
  label,
  logs,
}: {
  percent: number;
  label: string;
  logs: LogLine[];
}) {
  return (
    <div style={{ marginTop: 14 }}>
      <div className="meter">
        <div
          className="meter-fill"
          style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
        />
      </div>
      <div className="meter-meta">
        <span className="lbl">{label}</span>
        <span className="pct">{Math.round(percent)}%</span>
      </div>

      {logs.length > 0 && (
        <div className="console">
          {logs.map((l) => (
            <div
              key={l.id}
              className={
                l.level === "ok" ? "ok" : l.level === "warn" ? "warn" : l.level === "err" ? "err" : ""
              }
            >
              <span className="g">
                {l.level === "ok" ? "+" : l.level === "warn" ? "!" : l.level === "err" ? "x" : "-"}
              </span>
              <span>{l.label}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
