#!/usr/bin/env bash
#
# Deploy the MoviePy render service to Cloud Run.
#
#   ./deploy-cloudrun.sh PROJECT_ID [REGION]           # free-tier config (default)
#   BILLING=instance ./deploy-cloudrun.sh PROJECT_ID   # robust config, always billed
#
# Builds with Cloud Build (native amd64 — no slow local cross-build) and
# deploys. Prints the service URL for NEXT_PUBLIC_RENDER_BACKEND_URL.
set -euo pipefail

PROJECT="${1:?Usage: ./deploy-cloudrun.sh PROJECT_ID [REGION]}"
REGION="${2:-us-central1}"
SERVICE="reel-render"

# Origins allowed to upload. Uploads go browser -> service directly (Vercel's
# 4.5 MB body cap makes proxying impossible), so CORS must name the frontend.
ALLOWED_ORIGINS="${ALLOWED_ORIGINS:-https://vide-gen-beige.vercel.app,http://localhost:3000}"

# --- billing mode ----------------------------------------------------------
# request  (default): CPU allocated only while a request is in flight. This is
#          the ONLY mode Cloud Run's monthly free tier applies to. It works
#          here because the browser holds the /events SSE stream open for the
#          whole render, which keeps a request in flight and therefore keeps
#          the CPU allocated. If that stream drops, the client falls back to
#          1s polling and the render will crawl — see README.
# instance: CPU always allocated (--no-cpu-throttling). Immune to the above,
#          but billed for the instance's whole lifetime and NOT free-tier
#          eligible.
BILLING="${BILLING:-request}"

if [ "$BILLING" = "instance" ]; then
  CPU_FLAG="--no-cpu-throttling"
  MEMORY="${MEMORY:-8Gi}"; CPU="${CPU:-4}"; MAX_UPLOAD_MB="${MAX_UPLOAD_MB:-2048}"
else
  CPU_FLAG="--cpu-throttling"
  # Smaller footprint stretches the free tier much further: the allowance is
  # 180k GiB-seconds/month, so 2Gi buys ~4x the render-minutes that 8Gi does.
  # The container filesystem is in-memory, so MAX_UPLOAD_MB must stay well
  # under MEMORY — uploads, ffmpeg's working set and the output all live in RAM.
  MEMORY="${MEMORY:-2Gi}"; CPU="${CPU:-2}"; MAX_UPLOAD_MB="${MAX_UPLOAD_MB:-512}"
fi

echo "→ deploying $SERVICE to $PROJECT / $REGION  (billing: $BILLING, ${CPU} vCPU / ${MEMORY})"

gcloud run deploy "$SERVICE" \
  --project "$PROJECT" \
  --region "$REGION" \
  --source . \
  --platform managed \
  --allow-unauthenticated \
  --port 8080 \
  --memory "$MEMORY" \
  --cpu "$CPU" \
  --min-instances 0 \
  --max-instances 1 \
  --timeout 3600 \
  --concurrency 4 \
  $CPU_FLAG \
  --set-env-vars "ALLOWED_ORIGINS=${ALLOWED_ORIGINS},MAX_UPLOAD_MB=${MAX_UPLOAD_MB},MAX_CONCURRENT_RENDERS=1,FFMPEG_PRESET=veryfast,WORK_DIR=/tmp/reel-studio,JOB_TTL_SECONDS=1800"

URL="$(gcloud run services describe "$SERVICE" --project "$PROJECT" --region "$REGION" --format='value(status.url)')"

cat <<MSG

✓ deployed: $URL

  Verify:   ./scripts/smoke_test.sh "$URL"
  Then set on Vercel and redeploy:
            NEXT_PUBLIC_RENDER_BACKEND_URL=$URL

MSG
