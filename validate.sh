#!/usr/bin/env bash
#
# validate.sh — grounded gate ladder for the dc-rec-mcp build loop.
#
# This is the *validator* in your loop: the deterministic oracle that decides
# whether the MCP is "made", instead of letting a model self-grade.
#
#   - Runs gates cheapest-first, fails fast.
#   - Prints the RAW output of whatever failed (that text is your Observation —
#     feed it straight back to Claude on the next iteration).
#   - Exit 0 = all applicable gates green. Non-zero = stop and feed back.
#
# Run the whole ladder:        ./validate.sh
# Stop after a given gate:     ./validate.sh --until smoke     (typecheck|tests|smoke|all)
# Treat SKIPs as failures:     ./validate.sh --strict          (use once you reach Slice 5)
#
# Gates 5 (cross-model review) and 6 (real Discord e2e) are intentionally NOT
# here — review is interpretive, and real audio is non-deterministic. Run those
# by hand after this script is green.

set -uo pipefail

# ---------------------------------------------------------------------------
# CONFIG — edit these to match the repo. Defaults assume TS + pnpm + vitest.
# ---------------------------------------------------------------------------
PKG="pnpm"                                  # pnpm | npm | yarn
TYPECHECK_CMD="$PKG exec tsc --noEmit"
LINT_CMD="$PKG run lint"                     # set to "" to skip linting
TEST_CMD="$PKG exec vitest run --reporter=dot"
BUILD_CMD="$PKG run build"                   # must produce $SERVER_ENTRY
SERVER_ENTRY="dist/index.js"                # built MCP stdio entry point
COOK_SRC_DIR="cook"                         # dir holding oggcorrect.c etc.
INSPECTOR="npx --yes @modelcontextprotocol/inspector"
EXPECTED_TOOLS=("start_recording" "stop_recording" "status_recording" "export_recording")
# Boot mode that injects a FakeMeetingRecorder so the smoke test needs no
# Discord token and stays deterministic. You must implement this boot path.
export DC_REC_TEST_MODE="${DC_REC_TEST_MODE:-fake}"
# ---------------------------------------------------------------------------

UNTIL="all"
STRICT=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --until) UNTIL="$2"; shift 2 ;;
    --strict) STRICT=1; shift ;;
    *) echo "unknown arg: $1"; exit 2 ;;
  esac
done

pass() { printf '  \033[32mPASS\033[0m  %s\n' "$1"; }
fail() { printf '  \033[31mFAIL\033[0m  %s\n' "$1"; }
skip() {
  if [[ $STRICT -eq 1 ]]; then fail "$1 (skipped, but --strict)"; return 1; fi
  printf '  \033[33mSKIP\033[0m  %s\n' "$1"; return 0
}
hr() { printf '%s\n' "----------------------------------------------------------------"; }

# Run a command; on failure, dump its raw output (your Observation) and bail.
gate() {
  local name="$1"; shift
  local out rc
  out="$("$@" 2>&1)"; rc=$?
  if [[ $rc -eq 0 ]]; then pass "$name"; return 0; fi
  fail "$name"; hr; echo "$out"; hr
  echo ">> gate '$name' failed (exit $rc). This output is the feedback for the next iteration." >&2
  exit 1
}

echo "== dc-rec-mcp gate ladder =="

# --- Gate 1: native cook build -------------------------------------------
# Only matters once the cook/*.c files are in the fork. Skip gracefully before then.
if compgen -G "$COOK_SRC_DIR/*.c" > /dev/null; then
  gate "1. native cook build" bash -c "
    set -e
    cd '$COOK_SRC_DIR'
    for src in oggcorrect oggtracks oggduration; do
      [[ -f \$src.c ]] && cc -O2 -o \$src \$src.c
    done
  "
else
  skip "1. native cook build (no $COOK_SRC_DIR/*.c yet)" || exit 1
fi

# --- Gate 2: typecheck + lint --------------------------------------------
gate "2a. typecheck" bash -c "$TYPECHECK_CMD"
[[ -n "$LINT_CMD" ]] && gate "2b. lint" bash -c "$LINT_CMD"
[[ "$UNTIL" == "typecheck" ]] && { echo "stopping after typecheck"; exit 0; }

# --- Gate 3: unit + adapter tests (the bulk of the oracle) ---------------
gate "3. unit + adapter tests" bash -c "$TEST_CMD"
[[ "$UNTIL" == "tests" ]] && { echo "stopping after tests"; exit 0; }

# --- Gate 4: MCP protocol smoke test -------------------------------------
# Boots the server (fake recorder) and checks it speaks MCP: tools/list shows
# the four tools, and one tools/call round-trips without crashing.
if [[ ! -f "$SERVER_ENTRY" ]]; then
  gate "4-pre. build server" bash -c "$BUILD_CMD"
fi

if [[ -f "$SERVER_ENTRY" ]]; then
  TOOLS_JSON="$($INSPECTOR --cli node "$SERVER_ENTRY" --method tools/list 2>&1)"
  rc=$?
  if [[ $rc -ne 0 ]]; then
    fail "4. mcp smoke (tools/list)"; hr; echo "$TOOLS_JSON"; hr; exit 1
  fi
  missing=()
  for t in "${EXPECTED_TOOLS[@]}"; do
    grep -q "\"$t\"" <<< "$TOOLS_JSON" || missing+=("$t")
  done
  if [[ ${#missing[@]} -gt 0 ]]; then
    fail "4. mcp smoke (missing tools: ${missing[*]})"; hr; echo "$TOOLS_JSON"; hr; exit 1
  fi
  pass "4a. tools/list exposes all expected tools"

  # One representative call. With a fake recorder this must return JSON, not throw.
  gate "4b. tools/call round-trip" bash -c "
    $INSPECTOR --cli node '$SERVER_ENTRY' \
      --method tools/call --tool-name start_recording \
      --tool-arg guildId=g1 \
      --tool-arg voiceChannelId=v1 \
      --tool-arg requesterUserId=u1 \
      --tool-arg textChannelId=t1 \
      --tool-arg type=stand-up \
      --tool-arg date=2026-06-29
  "
else
  skip "4. mcp smoke (no $SERVER_ENTRY yet — pre-Slice 5)" || exit 1
fi

echo
echo "== all applicable gates green =="
echo "Next (outside this loop): /codex:review + Claude review, then the manual"
echo "Discord e2e checklist (plan line 845)."
