"use client";

/**
 * Configuration + health probing for the MoviePy render backend.
 *
 * The backend is optional. With NEXT_PUBLIC_RENDER_BACKEND_URL unset the app
 * behaves exactly as it always has — everything renders in the browser with
 * FFmpeg.wasm. When it is set and reachable, rendering moves server-side.
 */

// NEXT_PUBLIC_* values are inlined at build time, so these must be referenced
// as full literals — a computed `process.env[name]` would be undefined.
export const BACKEND_URL = (process.env.NEXT_PUBLIC_RENDER_BACKEND_URL || "").replace(/\/+$/, "");

/**
 * Optional shared secret matching RENDER_API_KEY on the service.
 *
 * Because the browser uploads directly to the backend (Vercel's 4.5 MB body
 * cap makes proxying impossible), anything the browser needs to send is
 * visible to whoever opens devtools. Treat this as a speed bump that keeps
 * casual traffic off your renderer, not as a secret. For real access control,
 * put the service behind SSO/a private network, or issue short-lived tokens
 * from a Next.js route.
 */
export const BACKEND_API_KEY = process.env.NEXT_PUBLIC_RENDER_API_KEY || "";

export type BackendHealth = {
  status: "ok" | "degraded";
  /** Identity markers — see checkBackendHealth(). */
  service?: string;
  engine?: string;
  moviepy: string;
  ffmpeg: string | null;
  ffmpegAvailable: boolean;
  /**
   * Which typeface the service would use for overlays it draws itself. Only
   * relevant to direct API callers — this frontend uploads canvas-rendered
   * overlays, so the reel's captions use the real Sora webfont regardless.
   */
  font?: {
    face: string;
    path: string | null;
    isBrandFont: boolean;
    usable: boolean;
  };
  maxUploadMb: number;
  concurrency: number;
  authRequired: boolean;
};

export function isBackendConfigured(): boolean {
  return BACKEND_URL.length > 0;
}

export function authHeaders(): Record<string, string> {
  return BACKEND_API_KEY ? { "X-API-Key": BACKEND_API_KEY } : {};
}

/** Probe the service. Resolves null when it's unset, down, or unreachable. */
export async function checkBackendHealth(timeoutMs = 5000): Promise<BackendHealth | null> {
  if (!isBackendConfigured()) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${BACKEND_URL}/health`, {
      signal: ctrl.signal,
      headers: authHeaders(),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as BackendHealth;

    // Confirm this is actually the render service. A tunnel or reverse proxy
    // aimed at the wrong local port answers 200 with some other app's JSON,
    // and without this we'd happily upload footage to it. Refusing here makes
    // the app fall back to browser rendering instead.
    // The service demands a key but we have none to send. /health is
    // unauthenticated, so without this check the app would look connected and
    // then fail every render with a 401 — the worst kind of "working".
    if (body?.authRequired && !BACKEND_API_KEY) {
      console.warn(
        `[reel-studio] ${BACKEND_URL} requires an API key but ` +
          `NEXT_PUBLIC_RENDER_API_KEY is not set in this build. Renders would ` +
          `be rejected with 401, so the browser renderer will be used instead.`
      );
      return null;
    }

    if (body?.service !== "reel-render" || body?.engine !== "moviepy") {
      console.warn(
        `[reel-studio] ${BACKEND_URL} responded, but is not the MoviePy render ` +
          `service (service=${body?.service ?? "?"}, engine=${body?.engine ?? "?"}). ` +
          `Ignoring it and using the browser renderer.`
      );
      return null;
    }
    return body;
  } catch {
    // Unreachable, CORS-blocked, or timed out — the caller falls back to the
    // browser renderer rather than failing the whole app.
    return null;
  } finally {
    clearTimeout(timer);
  }
}
