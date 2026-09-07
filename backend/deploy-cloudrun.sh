#!/usr/bin/env bash
#
# Deploy the MoviePy render service to Cloud Run.
#
#   ./deploy-cloudrun.sh PROJECT_ID [REGION]
#
# Builds with Cloud Build (native amd64 — no slow local cross-build) and
# deploys. Prints the service URL to put in NEXT_PUBLIC_RENDER_BACKEND_URL.
set -euo pipefail

PROJECT="${1:?Usage: ./deploy-cloudrun.sh PROJECT_ID [REGION]}"
REGION="${2:-us-central1}"
SERVICE="reel-render"

# Origins allowed to upload. Uploads go browser -> service directly (Vercel's
# 4.5 MB body cap makes proxying impossible), so CORS must name the frontend.
ALLOWED_ORIGINS="${ALLOWED_ORIGINS:-https://vide-gen-beige.vercel.app,http://localhost:3000}"

# Cloud Run's container filesystem is IN-MEMORY: every uploaded byte counts
# against the memory limit. Budget = uploads + ffmpeg/MoviePy working set +
# the output file. 8Gi comfortably covers a 2 GB upload; drop MAX_UPLOAD_MB
# with the memory if you size down.
MEMORY="${MEMORY:-8Gi}"
CPU="${CPU:-4}"
MAX_UPLOAD_MB="${MAX_UPLOAD_MB:-2048}"

echo "→ deploying $SERVICE to $PROJECT / $REGION"

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
  --max-instances 3 \
  --timeout 3600 \
  --concurrency 1 \
  --no-cpu-throttling \
  --set-env-vars "ALLOWED_ORIGINS=${ALLOWED_ORIGINS},MAX_UPLOAD_MB=${MAX_UPLOAD_MB},MAX_CONCURRENT_RENDERS=1,FFMPEG_PRESET=veryfast,WORK_DIR=/tmp/reel-studio,JOB_TTL_SECONDS=1800"

URL="$(gcloud run services describe "$SERVICE" --project "$PROJECT" --region "$REGION" --format='value(status.url)')"

cat <<MSG

✓ deployed: $URL

  Verify:   ./scripts/smoke_test.sh "$URL"
  Then set on Vercel and redeploy:
            NEXT_PUBLIC_RENDER_BACKEND_URL=$URL

MSG
