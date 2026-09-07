# syntax=docker/dockerfile:1
#
# MoviePy render service for Reel Studio.
#
# This is why the render backend can't be a Vercel function: the image carries
# an ffmpeg binary, OpenCV and NumPy, and a render occupies a full CPU for
# minutes. Deploy it anywhere that runs a container (Railway, Render, Fly.io,
# Cloud Run, a VM) and point NEXT_PUBLIC_RENDER_BACKEND_URL at it.

FROM python:3.11-slim AS base

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    WORK_DIR=/data/jobs \
    FONT_DIR=/app/fonts

# libglib2.0-0 is the one shared lib opencv-python-headless still links against;
# fonts-dejavu-core is the fallback face for server-drawn overlays.
RUN apt-get update && apt-get install -y --no-install-recommends \
        libglib2.0-0 \
        fonts-dejavu-core \
        curl \
        ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Fetch the brand font (Sora, OFL) for server-rendered overlays. Best-effort:
# the frontend normally uploads canvas-rendered overlays, and DejaVu covers the
# fallback, so a network hiccup here must not fail the build.
RUN mkdir -p /app/fonts && \
    curl -fsSL -o "/app/fonts/Sora[wght].ttf" \
      "https://github.com/google/fonts/raw/main/ofl/sora/Sora%5Bwght%5D.ttf" \
      || echo "WARN: Sora download failed; server-drawn overlays will use DejaVu."

COPY app ./app
COPY fonts ./fonts

# Pre-download the imageio-ffmpeg binary at build time so the first render
# doesn't pay for it (and so an offline runtime still works).
RUN python -c "import imageio_ffmpeg; print('ffmpeg:', imageio_ffmpeg.get_ffmpeg_exe())"

RUN useradd --create-home --uid 10001 appuser \
    && mkdir -p /data/jobs \
    && chown -R appuser:appuser /app /data
USER appuser

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=4).status==200 else 1)"

# One worker: renders are CPU-bound and the job store is in-process, so extra
# workers would each keep their own job table. Scale with MAX_CONCURRENT_RENDERS
# or more replicas behind shared storage.
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000} --workers 1 --timeout-keep-alive 75"]
