# dc-rec-mcp

A Discord voice-channel recording MCP server. It exposes tools to start, stop,
finalize, and export local multitrack meeting recordings, reusing Craig's proven
recording + cook pipeline. An external caller (Dasher) handles transcription,
summary, Discord replies, and Git publishing.

**`docs/dc-rec-mcp-plan.md` is the source of truth.** Read it before any change.
This file tells you *how to work*; the plan tells you *what to build*.

## Scope

This repo owns: joining a voice channel, per-speaker recording, finalization,
local Ogg Opus export, status, and the `recording-manifest.json` handoff.

This repo does NOT own (do not implement, configure, or reason about): Dasher
internals, transcription, summarization, Discord reply logic, Git publishing,
or Craig's public-service features (download web app, dashboard, OAuth,
cloud-drive upload, Patreon, public URLs). Treat the upstream Craig files listed
in the plan as **read-only reference**, not as the integration point.

## Commands

```bash
pnpm install              # install deps
pnpm exec tsc --noEmit    # typecheck
pnpm run lint             # lint
pnpm exec vitest run      # unit + adapter tests
pnpm run build            # build -> dist/index.js
./validate.sh             # full gate ladder (THE validator — see Workflow)
./validate.sh --until tests   # tight inner loop while iterating one slice
```

`./validate.sh` is the deterministic oracle. Its exit code decides whether work
is done — never your own judgement that the code "looks correct."

## Architecture (the seam)

Two seams, deliberately:

- **`MeetingRecorder`** — the internal module. Takes its Discord, Craig, and
  export dependencies as *injected adapters* so tests use fakes. All recording
  behavior lives here. It is directly testable without speaking MCP JSON.
- **MCP adapter** — a thin layer over `MeetingRecorder`. It registers tools,
  validates input, and maps typed results/errors. It MUST NOT contain Eris
  voice-lifecycle or cook logic.

Runtime dirs: Craig raw files under `dc-rec-runtime/`; finalized audio under the
configured `DC_REC_OUTPUT_ROOT` (`<YYYY-MM>/<type>/raw audio/<YYYY-MM-DD>/`).

Provide a `DC_REC_TEST_MODE=fake` boot path that injects a `FakeMeetingRecorder`,
so the MCP smoke gate runs with no Discord token. Build this early.

## MCP SDK — pinned

Use the official **`@modelcontextprotocol/sdk`** (the stable v1 line). Use the
high-level `McpServer` + `registerTool` API with `StdioServerTransport`.

- Do NOT hand-roll JSON-RPC, and do NOT use `mcp-framework`, `FastMCP`, or any
  other wrapper.
- Do NOT use the deprecated `.tool()` / `.prompt()` / `.resource()` signatures —
  they were removed. Use `registerTool`.
- The SDK API has changed since your training. **Read the current SDK README
  before writing the adapter** rather than coding the API from memory.

## Workflow — build one slice at a time

This is a supervised, per-slice loop. The plan's "Implementation Slices" 1–6
each have explicit Acceptance criteria — those are your done-conditions.

1. Pick the lowest unfinished slice. Re-read its Deliverables + Acceptance.
2. Make the smallest change toward one acceptance bullet.
3. Run `./validate.sh`. If red, read the raw output and fix; do not proceed.
4. Repeat until every acceptance bullet for the slice passes.
5. Commit (one commit per green gate; conventional-commit messages).
6. **End of slice only:** run a self-review against the plan, then ask the human
   to run `/codex:review`. Resolve blocking findings before the next slice.
7. Move to the next slice.

Keep a running note (in the PR description or a scratch file) of: current slice,
which acceptance bullets remain, the last gate that failed, and attempt count.

## Hard rules (YOU MUST follow these)

- **Never weaken, skip, or delete a test, assertion, or gate to make
  `validate.sh` pass.** A green bar earned by lowering the bar is a defect.
- **STOP and ask the human** at any of the plan's three open questions — do not
  guess:
  1. Can Craig's cook/raw helpers emit per-speaker `.ogg` with the desired
     filenames directly, or is an internal ZIP/extract/rename step needed?
  2. Dedicated Discord token vs deployment-provided token?
  3. One active recording per guild vs one globally?
- **Do not fabricate "done."** The following are human-run and are NOT inside
  this loop: creating the Discord bot/token, the real-fixture export check, and
  the manual two-speaker Discord end-to-end (plan's "Manual end-to-end
  verification"). Never simulate these or claim them as passing.
- Never put tokens, IDs, or secrets in code or commits. The human supplies
  `DC_REC_DISCORD_TOKEN` via env.
- If blocked or `validate.sh` fails the same way repeatedly, stop and report —
  do not loop indefinitely.

## Definition of done (per the plan's Completion Criteria)

Slices 1–5 green under `./validate.sh`, the manifest contract matches the plan's
schema, typed errors cover the plan's error model, and the caller handoff is
documented. Real-meeting verification is a separate, human-run step.
