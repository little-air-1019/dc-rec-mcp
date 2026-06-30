# dc-rec-mcp

A Discord voice-channel recording **MCP server**. It exposes tools to start,
stop, finalize, and export local multitrack meeting recordings, reusing Craig's
proven recording + `cook.sh` pipeline.

`dc-rec-mcp` owns **only** local recording and export: joining a voice channel,
per-speaker recording, finalization, local Ogg Opus export, status, and the
`recording-manifest.json` handoff. An external caller (e.g. Dasher) owns
everything else.

> **Built on a fork of [Craig](https://craig.chat/).** The upstream Craig apps
> (`apps/`) and the `cook/` audio tools are kept as read-only reference and the
> export pipeline; the MCP server lives under `src/`.

## Status

The MCP server, the recorder/export domain, the state store, and the local
export pipeline are implemented and tested. The **live Discord (Eris) voice
connection is not wired yet** — recording `start`/live-`stop` in real mode fail
loudly until the manual two-speaker Discord end-to-end is done. `export` and
`status` of finalized recordings work in real mode today, and the full tool
surface works in fake mode (below).

## Configuration

Set these environment variables (the MCP process must be able to write the
runtime dir and read/write the output root):

| Variable | Required (real mode) | Meaning |
|----------|----------------------|---------|
| `DC_REC_TEST_MODE` | — | Set to `fake` to run without Discord/cook (canned responses). Omit for real mode. |
| `DC_REC_DISCORD_TOKEN` | yes | The dedicated Discord bot token for `dc-rec-mcp`. `DISCORD_BOT_TOKEN` is also accepted as a fallback. Supply via env; never commit it. |
| `DC_REC_RUNTIME_DIR` | yes (absolute) | Where Craig raw files + per-recording state live (`<dir>/raw/`, `<dir>/sessions/`). |
| `DC_REC_OUTPUT_ROOT` | yes (absolute) | Canonical finalized-audio root (`<root>/<YYYY-MM>/<type>/raw audio/<YYYY-MM-DD>/`). |
| `DC_REC_COOK_PATH` | yes (absolute) | Path to `cook.sh`. Validated as executable at startup (`cook_binary_missing` if not). |

> The recorder uses its **own** dedicated Discord bot identity. Reusing another
> bot's token is a deployment decision, not something this server assumes.

## Running

```bash
pnpm install
pnpm run build          # -> dist/index.js
node dist/index.js      # stdio MCP server

# No Discord token needed — canned responses for tool-shape testing:
DC_REC_TEST_MODE=fake node dist/index.js
```

`dc-rec-mcp` speaks MCP over **stdio** using `@modelcontextprotocol/sdk`. Any
MCP-capable caller can connect, list tools, and call them.

## How a caller uses it

The caller invokes three tools in sequence and then reads local files. It never
needs a public Craig download URL.

### 1. `start_recording`

Input:

```json
{
  "guildId": "123",
  "voiceChannelId": "456",
  "requesterUserId": "789",
  "textChannelId": "012",
  "type": "stand-up",
  "date": "2026-06-29",
  "title": "Daily stand-up"
}
```

`type` is one of `stand-up | weekly | research | meeting | sharing | retro |
others`. `title` and `recordingId` are optional (a `recordingId` is generated
when omitted). Output:

```json
{
  "recordingId": "Ab3kZ9xQ12wM",
  "state": "recording",
  "type": "stand-up",
  "date": "2026-06-29",
  "title": "Daily stand-up",
  "startedAt": "2026-06-29T10:00:00.000Z",
  "statusPath": "/abs/dc-rec-runtime/sessions/Ab3kZ9xQ12wM/state.json"
}
```

Only one active recording is allowed **per guild**; a second `start` in the
same guild returns the typed `already_recording` error with the active
`recordingId`.

### 2. `status_recording`

Poll by `recordingId` or `guildId`:

```json
{ "recordingId": "Ab3kZ9xQ12wM" }
```

Returns `state` (`idle | connecting | recording | stopping | finalized |
errored`) plus the known metadata. Unknown ids report `idle`.

### 3. `stop_recording`

```json
{ "recordingId": "Ab3kZ9xQ12wM", "stoppedByUserId": "789" }
```

Stops the recording, waits for finalization, exports per-speaker Ogg Opus into
the canonical output dir, writes `recording-manifest.json`, and returns the
finalized object (same shape as the manifest, below).

### `export_recording` (optional)

Re-export a finalized recording. The first version supports
`format: "ogg-opus"`, `container: "directory"`, `mode: "multitrack"`; other
combinations return `invalid_export_format` / `invalid_export_mode`.

### Typed errors

Every tool returns an `isError` result whose `structuredContent` is
`{ ok: false, code, error, details? }`. The caller maps `code` to a user-facing
reply. Codes: `not_in_voice_channel`, `voice_channel_not_found`,
`missing_voice_connect_permission`, `already_recording`, `recording_not_found`,
`recording_not_active`, `recording_not_finalized`, `export_already_running`,
`export_failed`, `cook_binary_missing`, `invalid_export_format`,
`invalid_export_mode`.

## Output layout

Finalized recordings land under the configured output root:

```text
<DC_REC_OUTPUT_ROOT>/
  2026-06/
    stand-up/
      raw audio/
        2026-06-29/
          01-789-Air.ogg
          02-345-Bee.ogg
          recording-manifest.json
```

Filenames are `NN-<userId>-<displayName>.ogg`, ordered by Craig track number.

### `recording-manifest.json`

This is the stable handoff contract:

```json
{
  "recordingId": "Ab3kZ9xQ12wM",
  "status": "finalized",
  "type": "stand-up",
  "date": "2026-06-29",
  "title": "Daily stand-up",
  "guildId": "123",
  "voiceChannelId": "456",
  "textChannelId": "012",
  "requestedByUserId": "789",
  "startedAt": "2026-06-29T10:00:00.000Z",
  "endedAt": "2026-06-29T10:30:00.000Z",
  "rawAudioDir": "/abs/ida-meetings/2026-06/stand-up/raw audio/2026-06-29",
  "tracks": [
    {
      "userId": "789",
      "displayName": "Air",
      "username": "air",
      "path": "/abs/ida-meetings/2026-06/stand-up/raw audio/2026-06-29/01-789-Air.ogg",
      "codec": "opus",
      "container": "ogg",
      "sampleRate": 48000,
      "channels": 2
    }
  ]
}
```

## Not in scope (the caller's responsibility)

`dc-rec-mcp` stops at "raw audio + manifest are ready on local disk." The
external caller (Dasher) owns, and `dc-rec-mcp` does **not** implement:

- Discord slash commands / meeting command routing
- passing Discord guild/channel/user context into the MCP tools
- transcription and transcript merge
- summary generation
- Discord reply / summary delivery
- optional Git commit/push

Any caller that can invoke MCP tools over stdio and read the returned local
paths can use this server; no public download URL is involved.

## Development

```bash
./validate.sh            # full gate ladder (the oracle for "done")
./validate.sh --until tests
pnpm exec vitest run
```

See [docs/dc-rec-mcp-plan.md](docs/dc-rec-mcp-plan.md) for the full design RFC.
