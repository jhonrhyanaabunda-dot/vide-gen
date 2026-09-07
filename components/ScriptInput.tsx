"use client";

import { useRef, useState } from "react";
import { parseScript, SCRIPT_ACCEPT } from "@/lib/scriptParse";
import { dragHasFiles } from "@/lib/dropFiles";
import { NUM_BEATS, type Beat } from "@/lib/types";

/**
 * Strict 6-beat script form — type it, or import it.
 *
 * Like the asset pickers, the whole table is a drop target: drag in a .txt,
 * .csv or .json, use the Import button, or just paste multi-line text. Typing
 * twelve fields by hand is fine once; it's miserable when the script already
 * exists in a doc somewhere, which it usually does.
 */
export default function ScriptInput({
  beats,
  onChange,
}: {
  beats: Beat[];
  onChange: (beats: Beat[]) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [dropping, setDropping] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const update = (i: number, key: keyof Beat, val: string) => {
    const next = beats.map((b, idx) => (idx === i ? { ...b, [key]: val } : b));
    onChange(next);
  };

  const applyText = (text: string, source: string) => {
    const parsed = parseScript(text);
    if (!parsed) {
      setNote(`Couldn't read a script out of ${source}.`);
      return;
    }
    onChange(parsed);
    const filled = parsed.filter((b) => b.header.trim()).length;
    setNote(
      filled < NUM_BEATS
        ? `Imported ${filled} of ${NUM_BEATS} beats from ${source} — fill the rest in.`
        : `Imported ${NUM_BEATS} beats from ${source}.`
    );
  };

  const readFile = async (file: File) => {
    try {
      applyText(await file.text(), file.name);
    } catch {
      setNote(`Couldn't read ${file.name}.`);
    }
  };

  const onDrop = async (e: React.DragEvent) => {
    if (!dragHasFiles(e)) return;
    e.preventDefault();
    setDropping(false);
    const file = e.dataTransfer.files?.[0];
    if (file) return readFile(file);
    // Some apps drag plain text rather than a file.
    const text = e.dataTransfer.getData("text/plain");
    if (text) applyText(text, "the dropped text");
  };

  // Paste anywhere in the table, but only when it's a real multi-beat blob —
  // otherwise pasting one word into one field would nuke the whole script.
  const onPaste = (e: React.ClipboardEvent) => {
    const text = e.clipboardData.getData("text/plain");
    if (!text || !text.includes("\n")) return;
    e.preventDefault();
    applyText(text, "the clipboard");
  };

  return (
    <div>
      <div
        className={dropping ? "beats dropping" : "beats"}
        onPaste={onPaste}
        onDragOver={(e) => {
          if (!dragHasFiles(e)) return;
          e.preventDefault();
          setDropping(true);
        }}
        onDragLeave={(e) => {
          // Ignore the events fired while moving between child rows.
          if (e.currentTarget.contains(e.relatedTarget as Node)) return;
          setDropping(false);
        }}
        onDrop={onDrop}
      >
        <div className="beats-bar">
          <span className="s">Type below, or drop a .txt / .csv / .json</span>
          <button type="button" className="btn-ghost" onClick={() => fileRef.current?.click()}>
            Import
          </button>
          <input
            ref={fileRef}
            type="file"
            accept={SCRIPT_ACCEPT}
            style={{ display: "none" }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) readFile(f);
              e.target.value = "";
            }}
          />
        </div>

        {Array.from({ length: NUM_BEATS }).map((_, i) => {
          const beat = beats[i] ?? { header: "", subtext: "" };
          const filled = beat.header.trim().length > 0;
          return (
            <div className={filled ? "beat filled" : "beat"} key={i}>
              <div className="idx">{i + 1}</div>
              <input
                className="h"
                type="text"
                aria-label={`Beat ${i + 1} header`}
                placeholder="Header"
                value={beat.header}
                onChange={(e) => update(i, "header", e.target.value)}
                maxLength={48}
                // The Gemini key field is type=password, which makes Chrome read
                // the page as a login form and offer a username into the next
                // text input. These opt-outs stop the caption fields getting
                // autofilled with an email address.
                name={`beat-${i + 1}-header`}
                autoComplete="off"
                data-1p-ignore=""
                data-lpignore="true"
                spellCheck={false}
              />
              <input
                type="text"
                aria-label={`Beat ${i + 1} subtext`}
                placeholder="Subtext"
                value={beat.subtext}
                onChange={(e) => update(i, "subtext", e.target.value)}
                maxLength={80}
                name={`beat-${i + 1}-subtext`}
                autoComplete="off"
                data-1p-ignore=""
                data-lpignore="true"
                spellCheck={false}
              />
            </div>
          );
        })}

        {dropping && <div className="drop-veil">Drop your script</div>}
      </div>

      {note && (
        <p className="hint" style={{ marginTop: 8 }}>
          {note}
        </p>
      )}
    </div>
  );
}
