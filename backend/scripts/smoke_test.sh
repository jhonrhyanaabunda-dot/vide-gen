#!/usr/bin/env bash
# End-to-end check against a running render service.
#
#   ./scripts/smoke_test.sh [BASE_URL]
#
# Generates throwaway footage with the bundled ffmpeg, renders a full 30s reel,
# and asserts the output is 1080x1920 / 30.0s. Use it to verify a fresh deploy.
set -euo pipefail

BASE="${1:-http://127.0.0.1:8000}"

# curl with the optional shared secret attached. A function rather than an
# array because expanding an empty array under `set -u` is an error on the
# bash 3.2 that ships with macOS.
curl_auth() {
  if [ -n "${RENDER_API_KEY:-}" ]; then
    curl -H "X-API-Key: ${RENDER_API_KEY}" "$@"
  else
    curl "$@"
  fi
}

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

PY="${PYTHON:-python3}"
FFMPEG="$("$PY" -c 'import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())')"

echo "→ health"
curl_auth -fsS "$BASE/health"
echo

echo "→ generating test assets"
"$FFMPEG" -y -v error -f lavfi -i "testsrc=size=1920x1080:rate=30:duration=8"  -pix_fmt yuv420p "$TMP/wide.mp4"
"$FFMPEG" -y -v error -f lavfi -i "smptebars=size=640x480:rate=25:duration=3"  -pix_fmt yuv420p "$TMP/short.mp4"
"$FFMPEG" -y -v error -f lavfi -i "sine=frequency=440:duration=20" -c:a libmp3lame "$TMP/music.mp3"

cat > "$TMP/plan.json" <<'JSON'
{
  "segments": [
    {"beatIndex":1,"clip":"clip_0","start":0,"duration":4,"header":"Certified inventory","subtext":"Over 200 vehicles ready today"},
    {"beatIndex":2,"clip":"clip_1","start":0,"duration":4,"header":"Interiors that impress","subtext":"Detailed before every handover"},
    {"beatIndex":3,"clip":"clip_0","start":4,"duration":4,"header":"Book your test drive","subtext":"Same-day appointments"},
    {"beatIndex":4,"clip":"clip_1","start":1,"duration":4,"header":"Trade-in made simple","subtext":"Instant valuation on the lot"},
    {"beatIndex":5,"clip":"clip_0","start":6,"duration":4,"header":"Financing on your terms","subtext":"Approvals in minutes"},
    {"beatIndex":6,"clip":"clip_1","start":0,"duration":4,"header":"Drive away happy","subtext":"Full service warranty"}
  ],
  "closing": {"kind":"generated","isImage":false},
  "music": "music",
  "totalDuration": 30, "outW": 1080, "outH": 1920, "fps": 30, "closingSeconds": 6,
  "filename": "smoke-test.mp4"
}
JSON

echo "→ submitting render"
JOB="$(curl_auth -fsS -X POST "$BASE/api/render" \
  -F "plan=<$TMP/plan.json" \
  -F "clip_0=@$TMP/wide.mp4" \
  -F "clip_1=@$TMP/short.mp4" \
  -F "music=@$TMP/music.mp3" | "$PY" -c 'import sys,json;print(json.load(sys.stdin)["jobId"])')"
echo "  job $JOB"

echo "→ waiting"
for _ in $(seq 1 300); do
  STATE="$(curl_auth -fsS "$BASE/api/render/$JOB" \
    | "$PY" -c 'import sys,json;d=json.load(sys.stdin);print(d["status"],int(d["percent"]),d["label"])')"
  echo "  $STATE"
  case "$STATE" in
    done*)  break ;;
    error*) echo "RENDER FAILED"; exit 1 ;;
  esac
  sleep 2
done

echo "→ downloading"
curl_auth -fsS -o "$TMP/out.mp4" "$BASE/api/render/$JOB/result"

PROBE="$("$FFMPEG" -hide_banner -i "$TMP/out.mp4" 2>&1 || true)"
echo "$PROBE" | grep -E "Duration|Stream"

echo "$PROBE" | grep -q "1080x1920"      || { echo "FAIL: not 1080x1920"; exit 1; }
echo "$PROBE" | grep -q "Duration: 00:00:30" || { echo "FAIL: not 30s";      exit 1; }
echo "$PROBE" | grep -q "Audio: aac"     || { echo "FAIL: no audio track";   exit 1; }

echo "✓ smoke test passed — 1080x1920, 30s, with audio"
