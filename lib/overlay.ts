"use client";

import { OUT_W, OUT_H } from "./types";

/**
 * Canvas-based overlay generation. We render text (and the fallback closing
 * slide) to a 1080x1920 canvas and hand FFmpeg a PNG, rather than relying on
 * FFmpeg's drawtext (which needs a bundled font file in wasm). This gives us
 * pixel-perfect control matching DESIGN.md and reliable Sora rendering.
 */

const EMERALD = "#1DB954";
const CHARCOAL = "#2C3038";
const WHITE = "#FFFFFF";
const MEDIUM_GRAY = "#C7CCD4";

async function ensureSora() {
  // Make sure Sora is available before measuring/drawing text.
  try {
    if ((document as any).fonts?.load) {
      await Promise.all([
        (document as any).fonts.load('900 80px "Sora"'),
        (document as any).fonts.load('600 44px "Sora"'),
        (document as any).fonts.load('700 40px "Sora"'),
      ]);
      await (document as any).fonts.ready;
    }
  } catch {
    /* fall back to system sans-serif */
  }
}

function newCanvas(): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement("canvas");
  canvas.width = OUT_W;
  canvas.height = OUT_H;
  const ctx = canvas.getContext("2d")!;
  return { canvas, ctx };
}

function canvasToBytes(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(async (blob) => {
      if (!blob) return reject(new Error("canvas toBlob failed"));
      resolve(new Uint8Array(await blob.arrayBuffer()));
    }, "image/png");
  });
}

/** Wrap text to a max width, returning lines. */
function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = w;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * Transparent overlay for a single beat: bold all-caps header + subtext in the
 * lower third, over a subtle gradient scrim so it reads on any footage.
 */
export async function makeBeatOverlay(
  beatIndex: number,
  header: string,
  subtext: string
): Promise<Uint8Array> {
  await ensureSora();
  const { canvas, ctx } = newCanvas();

  // Bottom scrim for legibility (DESIGN.md: white text on dark for contrast).
  const grad = ctx.createLinearGradient(0, OUT_H * 0.45, 0, OUT_H);
  grad.addColorStop(0, "rgba(11,13,15,0)");
  grad.addColorStop(0.6, "rgba(11,13,15,0.55)");
  grad.addColorStop(1, "rgba(11,13,15,0.92)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, OUT_H * 0.45, OUT_W, OUT_H * 0.55);

  const marginX = 96;
  const maxWidth = OUT_W - marginX * 2;

  // Emerald beat pill (badge).
  const pillText = `BEAT ${beatIndex}`;
  ctx.font = '700 30px "Sora", sans-serif';
  const pillW = ctx.measureText(pillText).width + 48;
  const pillH = 56;
  const pillX = marginX;
  let cursorY = OUT_H - 560;
  roundRect(ctx, pillX, cursorY, pillW, pillH, 28);
  ctx.fillStyle = EMERALD;
  ctx.fill();
  ctx.fillStyle = WHITE;
  ctx.textBaseline = "middle";
  ctx.fillText(pillText, pillX + 24, cursorY + pillH / 2 + 1);
  ctx.textBaseline = "alphabetic";

  // Header — heavy 900 weight, all caps.
  cursorY += pillH + 56;
  ctx.font = '900 84px "Sora", sans-serif';
  ctx.fillStyle = WHITE;
  ctx.shadowColor = "rgba(0,0,0,0.6)";
  ctx.shadowBlur = 18;
  ctx.shadowOffsetY = 4;
  const headerLines = wrap(ctx, (header || "").toUpperCase(), maxWidth);
  for (const line of headerLines) {
    ctx.fillText(line, marginX, cursorY);
    cursorY += 96;
  }
  ctx.shadowColor = "transparent";
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;

  // Emerald rule.
  cursorY += 8;
  ctx.fillStyle = EMERALD;
  ctx.fillRect(marginX, cursorY, 120, 6);
  cursorY += 44;

  // Subtext — lighter weight, readable.
  ctx.font = '500 46px "Sora", sans-serif';
  ctx.fillStyle = MEDIUM_GRAY;
  const subLines = wrap(ctx, subtext || "", maxWidth);
  for (const line of subLines) {
    ctx.fillText(line, marginX, cursorY);
    cursorY += 60;
  }

  return canvasToBytes(canvas);
}

/**
 * Fully-opaque closing slide (7th beat) used when the user does NOT upload a
 * closing file. Brand placeholders for logo, dealership name, and contact info.
 */
export async function makeClosingSlide(): Promise<Uint8Array> {
  await ensureSora();
  const { canvas, ctx } = newCanvas();

  // Dark navy background.
  ctx.fillStyle = "#0B0D0F";
  ctx.fillRect(0, 0, OUT_W, OUT_H);

  // Soft emerald radial glow.
  const glow = ctx.createRadialGradient(OUT_W / 2, OUT_H * 0.4, 80, OUT_W / 2, OUT_H * 0.4, 900);
  glow.addColorStop(0, "rgba(29,185,84,0.22)");
  glow.addColorStop(1, "rgba(29,185,84,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, OUT_W, OUT_H);

  const cx = OUT_W / 2;
  ctx.textAlign = "center";

  // Logo placeholder box.
  const boxW = 420;
  const boxH = 420;
  const boxX = cx - boxW / 2;
  const boxY = OUT_H * 0.22;
  roundRect(ctx, boxX, boxY, boxW, boxH, 24);
  ctx.fillStyle = "rgba(255,255,255,0.04)";
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.setLineDash([14, 12]);
  ctx.strokeStyle = EMERALD;
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.font = '700 36px "Sora", sans-serif';
  ctx.fillStyle = "#8A919C";
  ctx.fillText("[ DEALERSHIP", cx, boxY + boxH / 2 - 8);
  ctx.fillText("LOGO HERE ]", cx, boxY + boxH / 2 + 40);

  // Dealership name.
  let y = boxY + boxH + 130;
  ctx.font = '900 78px "Sora", sans-serif';
  ctx.fillStyle = WHITE;
  ctx.fillText("[ DEALERSHIP NAME ]", cx, y);

  // Emerald CTA pill.
  y += 80;
  const ctaText = "BOOK A STRATEGY CALL";
  ctx.font = '600 38px "Sora", sans-serif';
  const ctaW = ctx.measureText(ctaText).width + 96;
  const ctaH = 96;
  roundRect(ctx, cx - ctaW / 2, y, ctaW, ctaH, 48);
  ctx.fillStyle = EMERALD;
  ctx.shadowColor = "rgba(29,185,84,0.4)";
  ctx.shadowBlur = 40;
  ctx.shadowOffsetY = 8;
  ctx.fill();
  ctx.shadowColor = "transparent";
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;
  ctx.fillStyle = CHARCOAL;
  ctx.textBaseline = "middle";
  ctx.fillText(ctaText, cx, y + ctaH / 2 + 2);
  ctx.textBaseline = "alphabetic";

  // Contact info.
  y += ctaH + 110;
  ctx.font = '400 40px "Sora", sans-serif';
  ctx.fillStyle = "#C7CCD4";
  ctx.fillText("[ Phone · Website · Address ]", cx, y);

  ctx.textAlign = "left";
  return canvasToBytes(canvas);
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}
