// MCP adapter: registers the four tools over a MeetingRecorderFacade.
//
// Each tool: receives SDK-validated input, delegates to the facade, and maps
// the result to a CallToolResult. A DcRecError becomes an `isError` result
// carrying the typed { code, error, details } so the caller can map it to a
// Discord reply. No recording/export/Eris logic lives here.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { DcRecError, type DcRecErrorResult } from '../domain/errors';
import type {
  ExportRecordingInput,
  StartRecordingInput,
  StatusRecordingInput,
  StopRecordingInput
} from '../domain/tool-io';
import type { MeetingRecorderFacade } from './recorderPort';
import { exportRecordingShape, startRecordingShape, statusRecordingShape, stopRecordingShape } from './schemas';

export const SERVER_NAME = 'dc-rec-mcp';
export const SERVER_VERSION = '0.0.0';

/** A successful tool result: JSON in both human text and structured form. */
function ok(payload: unknown): CallToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(payload) }],
    structuredContent: payload as Record<string, unknown>
  };
}

/** A typed error result the caller can translate to a Discord reply. */
function err(e: unknown): CallToolResult {
  let body: DcRecErrorResult;
  if (e instanceof DcRecError) {
    body = { ok: false, code: e.code, error: e.message, ...(e.details ? { details: e.details } : {}) };
  } else {
    // Unexpected error: surface as export_failed-equivalent generic failure
    // without leaking internals beyond the message.
    body = { ok: false, code: 'recording_not_found', error: e instanceof Error ? e.message : String(e) };
  }
  return {
    content: [{ type: 'text', text: JSON.stringify(body) }],
    structuredContent: body as unknown as Record<string, unknown>,
    isError: true
  };
}

/** Build an McpServer wired to the given facade. */
export function buildServer(facade: MeetingRecorderFacade): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });

  server.registerTool(
    'start_recording',
    {
      title: 'Start recording',
      description: 'Join a Discord voice channel and start a multitrack meeting recording.',
      inputSchema: startRecordingShape
    },
    async (args) => {
      try {
        return ok(await facade.start(args as StartRecordingInput));
      } catch (e) {
        return err(e);
      }
    }
  );

  server.registerTool(
    'status_recording',
    {
      title: 'Recording status',
      description: 'Return the current state of a recording by recordingId or guildId.',
      inputSchema: statusRecordingShape
    },
    async (args) => {
      try {
        return ok(await facade.status(args as StatusRecordingInput));
      } catch (e) {
        return err(e);
      }
    }
  );

  server.registerTool(
    'stop_recording',
    {
      title: 'Stop recording',
      description: 'Stop and finalize an active recording, exporting per-speaker audio + manifest.',
      inputSchema: stopRecordingShape
    },
    async (args) => {
      try {
        return ok(await facade.stop(args as StopRecordingInput));
      } catch (e) {
        return err(e);
      }
    }
  );

  server.registerTool(
    'export_recording',
    {
      title: 'Export recording',
      description: 'Re-export a finalized recording to a local format/container.',
      inputSchema: exportRecordingShape
    },
    async (args) => {
      try {
        return ok(await facade.export(args as ExportRecordingInput));
      } catch (e) {
        return err(e);
      }
    }
  );

  return server;
}
