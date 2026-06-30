// dc-rec-mcp stdio entry point.
//
// Loads .env (for standalone runs), builds the runtime, brings the MCP server
// online immediately over stdio, then connects the Discord gateway in the
// background (so an on-demand MCP client never waits on the gateway). The
// validate.sh smoke gate runs this with DC_REC_TEST_MODE=fake (no lifecycle).

import 'dotenv/config';

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { buildRuntime } from './mcp/boot';
import { buildServer } from './mcp/server';

async function main(): Promise<void> {
  const runtime = buildRuntime(process.env);
  const server = buildServer(runtime.facade);

  // MCP online first — don't block tool availability on the Discord gateway.
  await server.connect(new StdioServerTransport());

  // Warm up the gateway in the background; start_recording awaits readiness.
  runtime.lifecycle?.connect().catch((err) => {
    // eslint-disable-next-line no-console
    console.error('dc-rec-mcp: Discord gateway connect failed:', err instanceof Error ? err.message : err);
  });
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('dc-rec-mcp failed to start:', err instanceof Error ? err.message : err);
  process.exit(1);
});
