"""Server-side overlay rasterisation — a Pillow port of lib/overlay.ts.

The browser draws these overlays on a <canvas> with the real Sora webfont and
uploads the PNGs, which is what the frontend does by default and which keeps
server output pixel-identical to browser output.

This module is the fallback for when no overlay is uploaded (a direct API
caller, or a browser where the font failed to load). Geometry, colours and the
draw order are kept line-for-line with the canvas version so the two renderers
don't drift.
"""

import os
from pathlib import Path
from typing import List, Optional, Tuple

from PIL import Image, ImageDraw, ImageFilter, ImageFont

# --- palette (mirrors lib/overlay.ts) --------------------------------------
EMERALD = (29, 185, 84)
CHARCOAL = (44, 48, 56)
WHITE = (255, 255, 255)
MEDIUM_GRAY = (199, 204, 212)
DARK_NAVY = (11, 13, 15)
STONE_GRAY = (138, 145, 156)

FONT_DIR = Path(os.environ.get("FONT_DIR") or Path(__file__).resolve().parent.parent / "fonts")

# Sora weight -> candidate filenames in FONT_DIR.
_WEIGHT_FILES = {
    900: ["Sora-Black.ttf", "Sora-ExtraBold.ttf", "Sora-Bold.ttf"],
    700: ["Sora-Bold.ttf", "Sora-SemiBold.ttf"],
    600: ["Sora-SemiBold.ttf", "Sora-Bold.ttf"],
    500: ["Sora-Medium.ttf", "Sora-Regular.ttf"],
    400: ["Sora-Regular.ttf", "Sora-Light.ttf"],
}

# Absolute paths to a shape-compatible grotesque when Sora isn't installed.
# The container gets DejaVu from fonts-dejavu-core; the macOS and Windows
# entries are so a developer running `uvicorn` locally sees real type too.
_FALLBACK_PATHS = {
    "heavy": [
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
        "/System/Library/Fonts/Supplemental/Arial Black.ttf",
        "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
        "/Library/Fonts/Arial Bold.ttf",
        "C:/Windows/Fonts/ariblk.ttf",
    ],
    "bold": [
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
        "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
        "/Library/Fonts/Arial Bold.ttf",
        "C:/Windows/Fonts/arialbd.ttf",
    ],
    "regular": [
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
        "/System/Library/Fonts/Supplemental/Arial.ttf",
        "/Library/Fonts/Arial.ttf",
        "C:/Windows/Fonts/arial.ttf",
    ],
}


def _fallback_class(weight: int) -> str:
    if weight >= 800:
        return "heavy"
    return "bold" if weight >= 600 else "regular"


_font_cache: dict = {}
# True once any lookup had to use Pillow's built-in face, which is a different
# design at a different scale — worth surfacing on /health.
_using_builtin_face = False


def load_font(weight: int, size: int) -> ImageFont.FreeTypeFont:
    """Best available face for a CSS-ish weight, cached per (weight, size)."""
    key = (weight, size)
    if key in _font_cache:
        return _font_cache[key]

    font: Optional[ImageFont.FreeTypeFont] = None

    # Google ships Sora as a single variable font. Preferred when present: one
    # file covers every weight, and the axis is set numerically.
    variable = FONT_DIR / "Sora[wght].ttf"
    if variable.is_file():
        try:
            font = ImageFont.truetype(str(variable), size)
            font.set_variation_by_axes([float(weight)])
        except (OSError, AttributeError):
            # Pillow built without FreeType variation support - fall through to
            # the static faces rather than rendering every weight identically.
            font = None

    if font is None:
        candidates: List[Path] = [FONT_DIR / n for n in _WEIGHT_FILES.get(weight, [])]
        candidates += [Path(p) for p in _FALLBACK_PATHS[_fallback_class(weight)]]
        for path in candidates:
            try:
                if path.is_file():
                    font = ImageFont.truetype(str(path), size)
                    break
            except OSError:
                continue

    if font is None:
        # Pillow's built-in face. Passing `size` matters: the no-arg form
        # returns a fixed ~10px bitmap font that silently ignores every size we
        # ask for, which renders the captions unreadably small.
        global _using_builtin_face
        _using_builtin_face = True
        try:
            font = ImageFont.load_default(size=size)
        except TypeError:  # Pillow < 10.1 has no size parameter
            font = ImageFont.load_default()

    _font_cache[key] = font
    return font


def fonts_available() -> bool:
    """True when a real scalable face was found on disk (used by /health).

    Deliberately not an isinstance check: modern Pillow returns a FreeTypeFont
    for its built-in face too, so that would report success even when no
    installed font was located at all.
    """
    load_font(900, 84)
    load_font(400, 40)
    return not _using_builtin_face


# --- drawing helpers --------------------------------------------------------
def _wrap(draw: ImageDraw.ImageDraw, text: str, font, max_width: int) -> List[str]:
    """Greedy word wrap — same algorithm as wrap() in lib/overlay.ts."""
    words = [w for w in text.split() if w]
    lines: List[str] = []
    line = ""
    for w in words:
        test = f"{line} {w}" if line else w
        if draw.textlength(test, font=font) > max_width and line:
            lines.append(line)
            line = w
        else:
            line = test
    if line:
        lines.append(line)
    return lines


def _vertical_scrim(size: Tuple[int, int], top: int) -> Image.Image:
    """The bottom gradient scrim: rgba(11,13,15) 0 -> .55 at 60% -> .92 at base."""
    w, h = size
    layer = Image.new("RGBA", size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    span = max(1, h - top)
    for y in range(top, h):
        p = (y - top) / span
        if p <= 0.6:
            alpha = (p / 0.6) * 0.55
        else:
            alpha = 0.55 + ((p - 0.6) / 0.4) * (0.92 - 0.55)
        draw.line([(0, y), (w, y)], fill=DARK_NAVY + (int(alpha * 255),))
    return layer


def _rounded_rect(draw: ImageDraw.ImageDraw, box, radius: int, **kw) -> None:
    x1, y1, x2, y2 = box
    radius = int(min(radius, (x2 - x1) / 2, (y2 - y1) / 2))
    draw.rounded_rectangle([x1, y1, x2, y2], radius=radius, **kw)


def _fill_translucent(base: Image.Image, box, radius: int, rgba) -> None:
    """Paint a semi-transparent rounded rect ONTO `base`.

    ImageDraw writes pixels rather than blending them, so drawing an RGBA fill
    straight onto the image replaces the alpha channel instead of tinting what
    is underneath - a 4%-white panel came out as a solid white block. Compositing
    through a scratch layer is what actually blends it.
    """
    layer = Image.new("RGBA", base.size, (0, 0, 0, 0))
    _rounded_rect(ImageDraw.Draw(layer), box, radius, fill=rgba)
    base.alpha_composite(layer)


def _text_with_shadow(
    base: Image.Image, xy, text, font, fill, *, blur=9, offset_y=4, opacity=0.6
) -> None:
    """Approximates the canvas shadowBlur/shadowOffsetY on the header text."""
    x, y = xy
    shadow = Image.new("RGBA", base.size, (0, 0, 0, 0))
    ImageDraw.Draw(shadow).text(
        (x, y + offset_y), text, font=font, fill=(0, 0, 0, int(255 * opacity)), anchor="ls"
    )
    base.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(blur)))
    ImageDraw.Draw(base).text((x, y), text, font=font, fill=fill + (255,), anchor="ls")


# --- public API -------------------------------------------------------------
def make_beat_overlay(
    beat_index: int, header: str, subtext: str, out_w: int, out_h: int
) -> Image.Image:
    """Transparent lower-third overlay for one beat. Port of makeBeatOverlay()."""
    img = Image.new("RGBA", (out_w, out_h), (0, 0, 0, 0))
    img.alpha_composite(_vertical_scrim((out_w, out_h), int(out_h * 0.45)))
    draw = ImageDraw.Draw(img)

    margin_x = 96
    max_width = out_w - margin_x * 2

    # Emerald "BEAT n" pill.
    pill_text = f"BEAT {beat_index}"
    pill_font = load_font(700, 30)
    pill_w = int(draw.textlength(pill_text, font=pill_font)) + 48
    pill_h = 56
    cursor_y = out_h - 560
    _rounded_rect(draw, (margin_x, cursor_y, margin_x + pill_w, cursor_y + pill_h), 28,
                  fill=EMERALD + (255,))
    draw.text((margin_x + 24, cursor_y + pill_h / 2 + 1), pill_text,
              font=pill_font, fill=WHITE + (255,), anchor="lm")

    # Header — heavy, all caps, drop shadow.
    cursor_y += pill_h + 56
    header_font = load_font(900, 84)
    for line in _wrap(draw, (header or "").upper(), header_font, max_width):
        _text_with_shadow(img, (margin_x, cursor_y), line, header_font, WHITE)
        cursor_y += 96
    draw = ImageDraw.Draw(img)  # re-bind: alpha_composite replaced the pixels

    # Emerald rule.
    cursor_y += 8
    draw.rectangle([margin_x, cursor_y, margin_x + 120, cursor_y + 6], fill=EMERALD + (255,))
    cursor_y += 44

    # Subtext.
    sub_font = load_font(500, 46)
    for line in _wrap(draw, subtext or "", sub_font, max_width):
        draw.text((margin_x, cursor_y), line, font=sub_font,
                  fill=MEDIUM_GRAY + (255,), anchor="ls")
        cursor_y += 60

    return img


def make_closing_slide(out_w: int, out_h: int) -> Image.Image:
    """Opaque generated CTA slide. Port of makeClosingSlide()."""
    img = Image.new("RGBA", (out_w, out_h), DARK_NAVY + (255,))

    # Soft emerald radial glow behind the logo box.
    glow = Image.new("RGBA", (out_w, out_h), (0, 0, 0, 0))
    gdraw = ImageDraw.Draw(glow)
    cx, cy, radius = out_w // 2, int(out_h * 0.4), 900
    steps = 60
    for i in range(steps, 0, -1):
        r = radius * i / steps
        alpha = int(0.22 * 255 * (1 - i / steps))
        gdraw.ellipse([cx - r, cy - r, cx + r, cy + r], fill=EMERALD + (alpha,))
    img.alpha_composite(glow.filter(ImageFilter.GaussianBlur(60)))
    draw = ImageDraw.Draw(img)

    # Dashed logo placeholder box.
    box_w = box_h = 420
    box_x = cx - box_w // 2
    box_y = int(out_h * 0.22)
    box = (box_x, box_y, box_x + box_w, box_y + box_h)
    _fill_translucent(img, box, 24, (255, 255, 255, 10))
    draw = ImageDraw.Draw(img)  # re-bind: alpha_composite replaced the pixels
    _dashed_rounded_rect(draw, box, 24, EMERALD + (255,), width=3, dash=14, gap=12)

    label_font = load_font(700, 36)
    draw.text((cx, box_y + box_h / 2 - 8), "[ DEALERSHIP", font=label_font,
              fill=STONE_GRAY + (255,), anchor="ms")
    draw.text((cx, box_y + box_h / 2 + 40), "LOGO HERE ]", font=label_font,
              fill=STONE_GRAY + (255,), anchor="ms")

    # Dealership name.
    y = box_y + box_h + 130
    draw.text((cx, y), "[ DEALERSHIP NAME ]", font=load_font(900, 78),
              fill=WHITE + (255,), anchor="ms")

    # Emerald CTA pill.
    y += 80
    cta_text = "BOOK A STRATEGY CALL"
    cta_font = load_font(600, 38)
    cta_w = int(draw.textlength(cta_text, font=cta_font)) + 96
    cta_h = 96
    _rounded_rect(draw, (cx - cta_w // 2, y, cx + cta_w // 2, y + cta_h), 48,
                  fill=EMERALD + (255,))
    draw.text((cx, y + cta_h / 2 + 2), cta_text, font=cta_font,
              fill=CHARCOAL + (255,), anchor="mm")

    # Contact line.
    y += cta_h + 110
    draw.text((cx, y), "[ Phone . Website . Address ]", font=load_font(400, 40),
              fill=MEDIUM_GRAY + (255,), anchor="ms")

    return img


def _dashed_rounded_rect(draw, box, radius, color, *, width, dash, gap) -> None:
    """Pillow has no setLineDash; approximate it along the straight edges."""
    x1, y1, x2, y2 = box
    step = dash + gap
    for x in range(int(x1 + radius), int(x2 - radius), step):
        draw.line([(x, y1), (min(x + dash, x2 - radius), y1)], fill=color, width=width)
        draw.line([(x, y2), (min(x + dash, x2 - radius), y2)], fill=color, width=width)
    for y in range(int(y1 + radius), int(y2 - radius), step):
        draw.line([(x1, y), (x1, min(y + dash, y2 - radius))], fill=color, width=width)
        draw.line([(x2, y), (x2, min(y + dash, y2 - radius))], fill=color, width=width)
