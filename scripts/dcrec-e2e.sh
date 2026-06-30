#!/usr/bin/env bash
#
# One-shot Docker e2e for dc-rec-mcp: build the Linux image (Node 22 + cook
# toolchain), then run a full start -> hold -> stop recording session inside it.
#
# Prereqs:
#   - .env in the repo root with DISCORD_BOT_TOKEN (or DC_REC_DISCORD_TOKEN).
#   - The bot is invited to your test server with View Channel + Connect.
#
# Usage:
#   scripts/dcrec-e2e.sh --guild <id> --voice <id> --text <id> --user <id> \
#     [--type stand-up] [--date YYYY-MM-DD] [--hold 30] [--title "..."] [--host-net]
#
# Output (per-speaker .ogg + recording-manifest.json) lands in ./.dc-rec-output
# on the host; raw Craig files in ./.dc-rec-runtime.

set -euo pipefail

IMAGE="dc-rec-mcp:e2e"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

TYPE="stand-up"
DATE="$(date +%F)"
HOLD="30"
TITLE=""
NET_ARGS=()
GUILD="" VOICE="" TEXT="" USER_ID=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --guild) GUILD="$2"; shift 2 ;;
    --voice) VOICE="$2"; shift 2 ;;
    --text) TEXT="$2"; shift 2 ;;
    --user) USER_ID="$2"; shift 2 ;;
    --type) TYPE="$2"; shift 2 ;;
    --date) DATE="$2"; shift 2 ;;
    --hold) HOLD="$2"; shift 2 ;;
    --title) TITLE="$2"; shift 2 ;;
    --host-net) NET_ARGS=(--network host); shift ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

for req in GUILD VOICE TEXT USER_ID; do
  if [[ -z "${!req}" ]]; then echo "missing --${req,,}" >&2; exit 2; fi
done
if [[ ! -f .env ]]; then echo ".env not found in repo root" >&2; exit 2; fi

mkdir -p .dc-rec-runtime .dc-rec-output

echo "== building $IMAGE =="
docker build -f Dockerfile.dcrec -t "$IMAGE" .

echo "== running recording session (hold ${HOLD}s) =="
docker run --rm -i --init "${NET_ARGS[@]}" \
  --env-file .env \
  -e DC_REC_RUNTIME_DIR=/data/runtime \
  -e DC_REC_OUTPUT_ROOT=/data/output \
  -e DC_REC_COOK_PATH=/app/cook.sh \
  -v "$PWD/.dc-rec-runtime:/data/runtime" \
  -v "$PWD/.dc-rec-output:/data/output" \
  "$IMAGE" \
  node scripts/recordDriver.mjs session \
    --guild "$GUILD" --voice "$VOICE" --text "$TEXT" --user "$USER_ID" \
    --type "$TYPE" --date "$DATE" --hold "$HOLD" \
    ${TITLE:+--title "$TITLE"}

echo
echo "== output (host) =="
find .dc-rec-output -type f 2>/dev/null | sed 's/^/  /' || true
echo "raw files:"
find .dc-rec-runtime/raw -type f 2>/dev/null | sed 's/^/  /' || true
