// dc-rec-mcp stdio entry point.
//
// Builds the facade for the current environment, wires it into the MCP server,
// and serves over stdio. The validate.sh smoke gate runs this with
// DC_REC_TEST_MODE=fake.

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { buildFacade } from './mcp/boot';
import { buildServer } from './mcp/server';

async function main(): Promise<void> {
  const facade = buildFacade(process.env);
  const server = buildServer(facade);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('dc-rec-mcp failed to start:', err instanceof Error ? err.message : err);
  process.exit(1);
});
