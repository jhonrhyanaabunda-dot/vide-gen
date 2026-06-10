"use client";

import { useEffect, useState } from "react";

const STORAGE_KEY = "reel-studio-gemini-key";

/**
 * Secure-ish Gemini API key field. Masked by default, persisted to localStorage
 * so the user doesn't retype it each session. (Note: localStorage is readable by
 * any script on this origin — fine for a personal tool, not for shared machines.)
 */
export default function ApiKeyInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const [show, setShow] = useState(false);

  // Hydrate from localStorage once on mount.
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && !value) onChange(saved);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handle = (v: string) => {
    onChange(v);
    if (v) localStorage.setItem(STORAGE_KEY, v);
    else localStorage.removeItem(STORAGE_KEY);
  };

  return (
    <div>
      <label className="field-label">Gemini API Key</label>
      <div style={{ display: "flex", gap: 8 }}>
        <input
          type={show ? "text" : "password"}
          placeholder="AIza…"
          value={value}
          onChange={(e) => handle(e.target.value)}
          autoComplete="off"
          spellCheck={false}
        />
        <button
          type="button"
          className="btn-ghost"
          style={{ whiteSpace: "nowrap" }}
          onClick={() => setShow((s) => !s)}
        >
          {show ? "Hide" : "Show"}
        </button>
      </div>
      <div className="dz-hint" style={{ marginTop: 6 }}>
        Free key from{" "}
        <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noreferrer" style={{ color: "var(--emerald)" }}>
          aistudio.google.com
        </a>
        . Used only for AI clip matching &amp; vision scanning; stored locally in
        this browser.
      </div>
    </div>
  );
}
