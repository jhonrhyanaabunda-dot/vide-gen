"use client";

import { useRef } from "react";
import type { PickedFile } from "@/lib/types";

/**
 * Web-compatible directory picker using <input webkitdirectory>. Filters the
 * selected folder down to the accepted media types and reports them upward.
 */

// `webkitdirectory` isn't in the standard React types — declare it.
declare module "react" {
  interface InputHTMLAttributes<T> {
    webkitdirectory?: string;
    directory?: string;
  }
}

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

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const all = Array.from(e.target.files ?? []);
    const filtered = all.filter((f) =>
      accept === "video"
        ? f.type.startsWith("video/") || /\.(mp4|mov|webm|m4v|avi|mkv)$/i.test(f.name)
        : f.type.startsWith("audio/") || /\.(mp3|wav|m4a|aac|ogg|flac)$/i.test(f.name)
    );
    onPick(filtered.map((file) => ({ file, name: file.name })));
  };

  return (
    <div>
      <label className="field-label">{label}</label>
      <div className="dropzone" onClick={() => inputRef.current?.click()}>
        <div className="dz-title">
          {files.length > 0 ? `📁 ${files.length} ${accept} file(s) selected` : "Click to choose a folder"}
        </div>
        <div className="dz-hint">{hint}</div>
        <input
          ref={inputRef}
          type="file"
          webkitdirectory=""
          directory=""
          multiple
          style={{ display: "none" }}
          onChange={handleChange}
        />
      </div>
      {files.length > 0 && (
        <div className="file-list">
          {files.slice(0, 12).map((f) => (
            <span className="file-chip" key={f.name}>
              {f.name}
              {f.duration != null ? ` · ${f.duration.toFixed(1)}s` : ""}
            </span>
          ))}
          {files.length > 12 && <span className="file-chip">+{files.length - 12} more</span>}
        </div>
      )}
    </div>
  );
}
