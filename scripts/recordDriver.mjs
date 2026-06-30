// Standalone start/stop driver for manual Discord e2e testing.
//
// Spawns the built dc-rec-mcp server (dist/index.js) over stdio as a REAL MCP
// client, so this exercises the actual protocol path — not an in-memory shim.
// It loads .env (token + DC_REC_* vars) and passes the environment through to
// the server child.
//
// Usage (build first: `pnpm run build`):
//
//   node scripts/recordDriver.mjs start \
//     --guild <guildId> --voice <voiceChannelId> --text <textChannelId> \
//     --user <requesterUserId> --type stand-up --date 2026-06-30 [--title "..."]
//
//   node scripts/recordDriver.mjs status --recording <id>
//   node scripts/recordDriver.mjs status --guild <guildId>
//   node scripts/recordDriver.mjs stop   --recording <id> [--user <stopperId>]
//
//   # convenience: start, hold for N seconds (people talk), then stop:
//   node scripts/recordDriver.mjs session \
//     --guild ... --voice ... --text ... --user ... --type stand-up \
//     --date 2026-06-30 --hold 30
//
// Every tool response (structuredContent) is printed as JSON. Errors print the
// typed { ok:false, code, error } the server returns.

import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_ENTRY = path.join(__dirname, '..', 'dist', 'index.js');

function parseArgs(argv) {
  const cmd = argv[0];
  const opts = {};
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const val = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[(i += 1)] : 'true';
      opts[key] = val;
    }
  }
  return { cmd, opts };
}

function need(opts, keys) {
  const missing = keys.filter((k) => opts[k] === undefined);
  if (missing.length) {
    console.error(`missing required option(s): ${missing.map((k) => '--' + k).join(', ')}`);
    process.exit(2);
  }
}

function printResult(label, res) {
  const sc = res.structuredContent ?? null;
  if (res.isError) {
    console.error(`[${label}] ERROR:`, JSON.stringify(sc ?? res.content, null, 2));
  } else {
    console.log(`[${label}] OK:`, JSON.stringify(sc, null, 2));
  }
  return { isError: !!res.isError, sc };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const { cmd, opts } = parseArgs(process.argv.slice(2));
  if (!cmd) {
    console.error('usage: node scripts/recordDriver.mjs <start|status|stop|session> [--opts]');
    process.exit(2);
  }

  // Spawn the real server over stdio, inheriting our env (token + DC_REC_*).
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [SERVER_ENTRY],
    env: process.env,
    stderr: 'inherit' // surface the server's gateway-connect logs
  });
  const client = new Client({ name: 'record-driver', version: '0.0.0' });
  await client.connect(transport);

  try {
    if (cmd === 'start' || cmd === 'session') {
      need(opts, ['guild', 'voice', 'text', 'user', 'type', 'date']);
      const startRes = await client.callTool({
        name: 'start_recording',
        arguments: {
          guildId: opts.guild,
          voiceChannelId: opts.voice,
          textChannelId: opts.text,
          requesterUserId: opts.user,
          type: opts.type,
          date: opts.date,
          ...(opts.title ? { title: opts.title } : {})
        }
      });
      const { isError, sc } = printResult('start_recording', startRes);
      if (isError) process.exitCode = 1;

      if (cmd === 'session' && !isError) {
        const holdSec = Number(opts.hold ?? 30);
        const recordingId = sc?.recordingId;
        console.error(`\n--- recording ${recordingId}; talk now. holding ${holdSec}s before stop ---\n`);
        for (let s = holdSec; s > 0; s -= 5) {
          await sleep(Math.min(5, s) * 1000);
          console.error(`  ${Math.max(0, s - 5)}s left...`);
        }
        const stopRes = await client.callTool({
          name: 'stop_recording',
          arguments: { recordingId, ...(opts.user ? { stoppedByUserId: opts.user } : {}) }
        });
        printResult('stop_recording', stopRes);
      }
    } else if (cmd === 'status') {
      const args = {};
      if (opts.recording) args.recordingId = opts.recording;
      if (opts.guild) args.guildId = opts.guild;
      printResult('status_recording', await client.callTool({ name: 'status_recording', arguments: args }));
    } else if (cmd === 'stop') {
      const args = {};
      if (opts.recording) args.recordingId = opts.recording;
      if (opts.guild) args.guildId = opts.guild;
      if (opts.user) args.stoppedByUserId = opts.user;
      printResult('stop_recording', await client.callTool({ name: 'stop_recording', arguments: args }));
    } else {
      console.error(`unknown command: ${cmd}`);
      process.exitCode = 2;
    }
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error('driver failed:', err?.message ?? err);
  process.exit(1);
});
