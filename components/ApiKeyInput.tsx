"use client";

import { useEffect, useState } from "react";

const STORAGE_KEY = "reel-studio-gemini-key";

/**
 * Gemini API key field. Masked by default, persisted to localStorage so the
 * user doesn't retype it each session. (Note: localStorage is readable by any
 * script on this origin — fine for a personal tool, not for shared machines.)
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
      <div style={{ display: "flex", gap: 6 }}>
        <input
          type={show ? "text" : "password"}
          aria-label="Gemini API key"
          placeholder="AIza…"
          value={value}
          onChange={(e) => handle(e.target.value)}
          name="gemini-api-key"
          // "new-password" (not "off", which Chrome ignores here) stops this
          // being treated as a login password — otherwise Chrome hunts for a
          // username field and autofills an email into the script captions.
          autoComplete="new-password"
          data-1p-ignore=""
          data-lpignore="true"
          spellCheck={false}
        />
        <button
          type="button"
          className="btn-ghost"
          style={{ flex: "none" }}
          onClick={() => setShow((s) => !s)}
        >
          {show ? "Hide" : "Show"}
        </button>
      </div>
      <p className="hint" style={{ marginTop: 7 }}>
        Stored in this browser only.{" "}
        <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noreferrer">
          Get a free key
        </a>
      </p>
    </div>
  );
}
