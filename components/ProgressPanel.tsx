"use client";

import type { ProgressUpdate } from "@/lib/types";

export type LogLine = ProgressUpdate & { id: number };

/**
 * Detailed progress display: a brand-emerald progress bar plus a scrolling,
 * color-coded log — essential feedback for long client-side renders.
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
    <div className="progress-wrap">
      <div className="progress-track">
        <div className="progress-fill" style={{ width: `${Math.min(100, Math.max(0, percent))}%` }} />
      </div>
      <div className="progress-meta">
        <span>{label}</span>
        <span>{Math.round(percent)}%</span>
      </div>
      {logs.length > 0 && (
        <div className="log">
          {logs.map((l) => (
            <div key={l.id} className={l.level === "ok" ? "ok" : l.level === "warn" ? "warn" : l.level === "err" ? "err" : ""}>
              {l.level === "ok" ? "✓ " : l.level === "warn" ? "! " : l.level === "err" ? "✗ " : "› "}
              {l.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
