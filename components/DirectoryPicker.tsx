"use client";

import { useRef, useState } from "react";
import { dragHasFiles, filesFromDataTransfer } from "@/lib/dropFiles";
import type { PickedFile } from "@/lib/types";

/**
 * Web-compatible directory picker using <input webkitdirectory>. Filters the
 * selected folder down to the accepted media types and reports them upward.
 *
 * Renders as a compact row rather than a large dashed rectangle — the row is
 * itself the drop target, so dragging a folder in works without spending a
 * hundred pixels of height advertising it. <input webkitdirectory> handles the
 * browse path; webkitGetAsEntry() handles the drop path.
 */

// `webkitdirectory` isn't in the standard React types — declare it.
declare module "react" {
  interface InputHTMLAttributes<T> {
    webkitdirectory?: string;
    directory?: string;
  }
}

const ICONS = {
  video: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="1.5" y="3.5" width="9" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
      <path d="M11 7l3.5-2v6L11 9V7z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
    </svg>
  ),
  audio: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M6 12V3.5l7-1.2V11" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
      <circle cx="4.4" cy="12" r="1.9" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="11.4" cy="10.8" r="1.9" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  ),
};

export default function DirectoryPicker({
  label,
  hint,
  accept,
  files,
  onPick,
}: {
  label: string;
  hint: string;
  /** "video" or "audio" — used to filter by MIME type. */
  accept: "video" | "audio";
  files: PickedFile[];
  onPick: (files: PickedFile[]) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dropping, setDropping] = useState(false);

  const keep = (f: File) =>
    accept === "video"
      ? f.type.startsWith("video/") || /\.(mp4|mov|webm|m4v|avi|mkv)$/i.test(f.name)
      : f.type.startsWith("audio/") || /\.(mp3|wav|m4a|aac|ogg|flac)$/i.test(f.name);

  const take = (all: File[]) =>
    onPick(all.filter(keep).map((file) => ({ file, name: file.name })));

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    take(Array.from(e.target.files ?? []));
  };

  const handleDrop = async (e: React.DragEvent) => {
    if (!dragHasFiles(e)) return;
    e.preventDefault();
    setDropping(false);
    take(await filesFromDataTransfer(e.dataTransfer));
  };

  const chosen = files.length > 0;
  const totalMb = chosen
    ? files.reduce((n, f) => n + f.file.size, 0) / (1024 * 1024)
    : 0;

  return (
    <div>
      <button
        type="button"
        className={`picker${chosen ? " filled" : ""}${dropping ? " dropping" : ""}`}
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
        onDrop={handleDrop}
      >
        <span className="glyph">{ICONS[accept]}</span>
        <span className="body">
          <span className="t">{label}</span>
          <span className="s">
            {chosen
              ? `${files.length} file${files.length === 1 ? "" : "s"} · ${
                  totalMb >= 1024 ? `${(totalMb / 1024).toFixed(1)} GB` : `${Math.round(totalMb)} MB`
                }`
              : dropping
              ? "Drop the folder here"
              : hint}
          </span>
        </span>
        <span className="s" style={{ flex: "none" }}>
          {chosen ? "Change" : "Drop or browse"}
        </span>
        <input
          ref={inputRef}
          type="file"
          webkitdirectory=""
          directory=""
          multiple
          style={{ display: "none" }}
          onChange={handleChange}
        />
      </button>

      {chosen && (
        <div className="chips">
          {files.slice(0, 10).map((f) => (
            <span className="chip" key={f.name} title={f.name}>
              {f.name}
            </span>
          ))}
          {files.length > 10 && <span className="chip">+{files.length - 10}</span>}
        </div>
      )}
    </div>
  );
}
