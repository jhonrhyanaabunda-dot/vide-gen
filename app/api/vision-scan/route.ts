import { NextRequest, NextResponse } from "next/server";

/**
 * STEP 3 — Visual AI Scanning (Fallback).
 *
 * The browser extracts ~1 frame/second from a longer clip and POSTs them here as
 * base64 data URLs along with the target beat text. We ask Gemini (multimodal,
 * via its OpenAI-compatible endpoint) which timestamp range best matches the
 * beat, then return { start, end } seconds so the client can cut that exact
 * segment with FFmpeg.wasm.
 *
 * Request body:
 *   {
 *     apiKey?: string,
 *     header: string,
 *     subtext: string,
 *     segmentSeconds: number,                 // desired clip length
 *     frames: { t: number, dataUrl: string }[]
 *   }
 *
 * Response:
 *   { start: number, end: number, reason: string }
 */

export const runtime = "nodejs";
export const maxDuration = 60;

const GEMINI_BASE =
  "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";

type Frame = { t: number; dataUrl: string };

export async function POST(req: NextRequest) {
  try {
    const { apiKey, header, subtext, segmentSeconds, frames } = (await req.json()) as {
      apiKey?: string;
      header: string;
      subtext: string;
      segmentSeconds: number;
      frames: Frame[];
    };

    const key = apiKey || process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY;
    if (!key) {
      return NextResponse.json(
        { error: "Missing API key. Add your Gemini key in the dashboard or set GEMINI_API_KEY." },
        { status: 401 }
      );
    }
    if (!Array.isArray(frames) || frames.length === 0) {
      return NextResponse.json({ error: "No frames provided." }, { status: 400 });
    }

    const model = process.env.GEMINI_VISION_MODEL || "gemini-2.0-flash";
    const want = Math.max(1, Number(segmentSeconds) || 4);

    // Cap frames we forward to keep the request light and fast.
    const sample =
      frames.length > 30
        ? frames.filter((_, i) => i % Math.ceil(frames.length / 30) === 0)
        : frames;

    const system =
      "You are a video editor. You are shown sequential frames from one clip, each " +
      "labeled with its timestamp in seconds. Find the contiguous window that best " +
      "visually matches the requested beat. Return strict JSON only.";

    const textPrompt =
      `Beat header: "${header}"\nBeat subtext: "${subtext}"\n` +
      `Desired window length: about ${want} seconds.\n` +
      `Frame timestamps available: ${sample.map((f) => f.t).join(", ")}.\n` +
      `Return JSON: { "start": <seconds>, "end": <seconds>, "reason": "<short>" } ` +
      `where end-start is approximately ${want}s and both fall within the available timestamps.`;

    const content: any[] = [{ type: "text", text: textPrompt }];
    for (const f of sample) {
      content.push({ type: "text", text: `t=${f.t}s` });
      content.push({ type: "image_url", image_url: { url: f.dataUrl } });
    }

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
          { role: "user", content },
        ],
      }),
    });

    if (!resp.ok) {
      const detail = await resp.text();
      return NextResponse.json(
        { error: `Gemini vision request failed (${resp.status})`, detail },
        { status: 502 }
      );
    }

    const data = await resp.json();
    const raw = data?.choices?.[0]?.message?.content ?? "{}";
    let parsed: any;
    try {
      parsed = JSON.parse(stripFences(raw));
    } catch {
      return NextResponse.json({ error: "Vision model returned non-JSON." }, { status: 502 });
    }

    const times = sample.map((f) => f.t);
    const minT = Math.min(...times);
    const maxT = Math.max(...times);

    let start = Number(parsed.start);
    let end = Number(parsed.end);
    if (!isFinite(start)) start = minT;
    if (!isFinite(end) || end <= start) end = start + want;

    // Clamp to available range.
    start = Math.max(minT, Math.min(start, Math.max(minT, maxT - want)));
    end = Math.min(maxT + 1, start + want);

    return NextResponse.json({
      start: Number(start.toFixed(2)),
      end: Number(end.toFixed(2)),
      reason: typeof parsed.reason === "string" ? parsed.reason : "",
    });
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
