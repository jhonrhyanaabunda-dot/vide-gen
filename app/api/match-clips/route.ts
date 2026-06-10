import { NextRequest, NextResponse } from "next/server";

/**
 * STEP 1 — Filename Matching (Primary).
 *
 * Receives the list of source-video filenames + the 6 script beats and asks
 * Gemini to semantically rank the most relevant filenames for each beat's Header
 * Text. Returns an ordered candidate list per beat so the client can then apply
 * STEP 2 ("prefer the shortest matching clip") using locally-probed durations.
 *
 * Pure AI call: no video bytes touch the server (Vercel-safe, no timeouts). Uses
 * Gemini via its OpenAI-compatible endpoint, so the request shape is standard.
 *
 * Request body:
 *   { apiKey?: string, filenames: string[], beats: { header: string, subtext: string }[] }
 *
 * Response:
 *   { matches: { beat, candidates: string[], filename: string|null, confidence, reason }[] }
 */

export const runtime = "nodejs";
export const maxDuration = 30;

const GEMINI_BASE =
  "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";

type Beat = { header: string; subtext: string };

export async function POST(req: NextRequest) {
  try {
    const { apiKey, filenames, beats } = (await req.json()) as {
      apiKey?: string;
      filenames: string[];
      beats: Beat[];
    };

    const key = apiKey || process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY;
    if (!key) {
      return NextResponse.json(
        { error: "Missing API key. Add your Gemini key in the dashboard or set GEMINI_API_KEY." },
        { status: 401 }
      );
    }
    if (!Array.isArray(filenames) || filenames.length === 0) {
      return NextResponse.json({ error: "No filenames provided." }, { status: 400 });
    }
    if (!Array.isArray(beats) || beats.length === 0) {
      return NextResponse.json({ error: "No script beats provided." }, { status: 400 });
    }

    const model = process.env.GEMINI_TEXT_MODEL || "gemini-2.0-flash";

    const system =
      "You are a video editor's assistant for a car dealership. Given a list of " +
      "raw clip filenames and a 6-beat script, rank the filenames by semantic " +
      "relevance for each beat. Return the BEST matches first. Filenames may be " +
      "reused across beats only if nothing better is available. If nothing fits a " +
      "beat, return an empty candidates array so the app can fall back to visual " +
      "scanning. Respond ONLY with strict JSON.";

    const user = JSON.stringify({
      instruction:
        "For each beat return { beat, candidates, confidence (0-1), reason }. " +
        "`candidates` is an ordered array (best first) of up to 4 filenames, each " +
        "EXACTLY one of the provided filenames. Use [] when nothing is relevant.",
      filenames,
      beats: beats.map((b, i) => ({ beat: i + 1, header: b.header, subtext: b.subtext })),
    });

    const resp = await fetch(GEMINI_BASE, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });

    if (!resp.ok) {
      const detail = await resp.text();
      return NextResponse.json(
        { error: `Gemini request failed (${resp.status})`, detail },
        { status: 502 }
      );
    }

    const data = await resp.json();
    const content = data?.choices?.[0]?.message?.content ?? "{}";
    let parsed: any;
    try {
      parsed = JSON.parse(stripFences(content));
    } catch {
      return NextResponse.json({ error: "Model returned non-JSON." }, { status: 502 });
    }

    // Accept { matches: [...] } or a bare array; validate candidate filenames.
    const raw: any[] = Array.isArray(parsed) ? parsed : parsed.matches ?? [];
    const allowed = new Set(filenames);
    const matches = beats.map((_, i) => {
      const m = raw.find((x) => Number(x?.beat) === i + 1) ?? {};
      let candidates: string[] = Array.isArray(m.candidates)
        ? m.candidates.filter((c: any) => typeof c === "string" && allowed.has(c))
        : [];
      // Backward/loose compat: a single `filename` field also counts.
      if (candidates.length === 0 && typeof m.filename === "string" && allowed.has(m.filename)) {
        candidates = [m.filename];
      }
      return {
        beat: i + 1,
        candidates,
        filename: candidates[0] ?? null,
        confidence:
          typeof m.confidence === "number" ? m.confidence : candidates.length ? 0.5 : 0,
        reason: typeof m.reason === "string" ? m.reason : "",
      };
    });

    return NextResponse.json({ matches });
  } catch (err: any) {
    return NextResponse.json(
      { error: "Unexpected server error", detail: String(err?.message || err) },
      { status: 500 }
    );
  }
}

/** Some models wrap JSON in ```json fences despite response_format; strip them. */
function stripFences(s: string): string {
  return s.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();
}
