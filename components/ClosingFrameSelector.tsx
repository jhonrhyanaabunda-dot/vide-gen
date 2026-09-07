"use client";

import { useRef, useState } from "react";
import { dragHasFiles } from "@/lib/dropFiles";

/**
 * Optional closing-frame uploader (image OR video). Renders just the row; the
 * thumbnail of the generated fallback slide is placed by the page alongside the
 * whole asset stack, so a tall preview can't leave dead space next to one row.
 */
export default function ClosingFrameSelector({
  file,
  onPick,
}: {
  file: File | null;
  onPick: (file: File | null) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dropping, setDropping] = useState(false);

  return (
    <div>
      <button
        type="button"
        className={`picker${file ? " filled" : ""}${dropping ? " dropping" : ""}`}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          if (!dragHasFiles(e)) return;
          e.preventDefault();
          setDropping(true);
        }}
        onDragLeave={(e) => {
          if (e.currentTarget.contains(e.relatedTarget as Node)) return;
          setDropping(false);
        }}
        onDrop={(e) => {
          if (!dragHasFiles(e)) return;
          e.preventDefault();
          setDropping(false);
          const f = e.dataTransfer.files?.[0];
          if (f) onPick(f);
        }}
      >
        <span className="glyph">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <rect x="2" y="2.5" width="12" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
            <path
              d="M2 10.5l3.2-3 2.4 2.2L10.4 7 14 10.2"
              stroke="currentColor"
              strokeWidth="1.3"
              strokeLinejoin="round"
            />
          </svg>
        </span>
        <span className="body">
          <span className="t">Closing frame</span>
          <span className="s">
            {file
              ? file.name
              : dropping
              ? "Drop the image or video here"
              : "Optional — drop or upload, else generated slide"}
          </span>
        </span>
        <span className="s" style={{ flex: "none" }}>
          {file ? "Change" : "Drop or upload"}
        </span>
        <input
          ref={inputRef}
          type="file"
          accept="image/*,video/*"
          style={{ display: "none" }}
          onChange={(e) => onPick(e.target.files?.[0] ?? null)}
        />
      </button>

      {file && (
        <button
          className="btn-ghost"
          style={{ marginTop: 6 }}
          onClick={() => {
            onPick(null);
            if (inputRef.current) inputRef.current.value = "";
          }}
        >
          Remove, use generated slide
        </button>
      )}
    </div>
  );
}
