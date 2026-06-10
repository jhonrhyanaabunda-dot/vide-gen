"use client";

import { useRef } from "react";
import ClosingSlide from "./ClosingSlide";

/**
 * Optional closing-frame uploader (image OR video). When nothing is chosen we
 * preview the generated React placeholder slide so the user sees the fallback.
 */
export default function ClosingFrameSelector({
  file,
  onPick,
}: {
  file: File | null;
  onPick: (file: File | null) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div>
      <label className="field-label">Closing Frame (optional)</label>
      <div className="preview" style={{ alignItems: "stretch" }}>
        <div style={{ flex: 1, minWidth: 240 }}>
          <div className="dropzone" onClick={() => inputRef.current?.click()}>
            <div className="dz-title">
              {file ? `🎬 ${file.name}` : "Click to upload an image or video"}
            </div>
            <div className="dz-hint">
              {file
                ? "This will be used as the final 7th-beat clip."
                : "If left empty, a branded placeholder slide is generated automatically."}
            </div>
            <input
              ref={inputRef}
              type="file"
              accept="image/*,video/*"
              style={{ display: "none" }}
              onChange={(e) => onPick(e.target.files?.[0] ?? null)}
            />
          </div>
          {file && (
            <button
              className="btn-ghost"
              style={{ marginTop: 10 }}
              onClick={() => {
                onPick(null);
                if (inputRef.current) inputRef.current.value = "";
              }}
            >
              Remove & use generated slide
            </button>
          )}
        </div>

        {!file && (
          <div>
            <div
              style={{
                fontSize: 11,
                color: "var(--medium-gray)",
                marginBottom: 8,
                letterSpacing: "0.04em",
                textTransform: "uppercase",
              }}
            >
              Generated fallback preview
            </div>
            <ClosingSlide />
          </div>
        )}
      </div>
    </div>
  );
}
