// Slice 5 acceptance tests for the MCP adapter.
//
// Acceptance:
//  - Each tool delegates to the MeetingRecorder facade.
//  - The adapter contains no Eris voice lifecycle (checked by import allowlist).
//  - Tool responses are JSON-safe and match the plan's schema.

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DcRecError } from '../domain/errors';
import type {
  ExportRecordingInput,
  StartRecordingInput,
  StatusRecordingInput,
  StopRecordingInput
} from '../domain/tool-io';
import { FakeMeetingRecorder } from './fakeFacade';
import type { MeetingRecorderFacade } from './recorderPort';
import { buildServer } from './server';

async function connect(facade: MeetingRecorderFacade) {
  const server = buildServer(facade);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return { client, server };
}

let client: Client;

beforeEach(async () => {
  ({ client } = await connect(new FakeMeetingRecorder()));
});

afterEach(async () => {
  await client.close();
});

describe('tools/list', () => {
  it('exposes exactly the four planned tools', async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(['export_recording', 'start_recording', 'status_recording', 'stop_recording']);
  });
});

describe('tool round-trips return JSON-safe, schema-matching results', () => {
  it('start_recording', async () => {
    const res = await client.callTool({
      name: 'start_recording',
      arguments: { guildId: 'g1', voiceChannelId: 'v1', requesterUserId: 'u1', textChannelId: 't1', type: 'stand-up', date: '2026-06-29' }
    });
    expect(res.isError).toBeFalsy();
    const sc = res.structuredContent as Record<string, unknown>;
    expect(sc.state).toBe('recording');
    expect(sc.recordingId).toBeTypeOf('string');
    expect(sc.startedAt).toBeTypeOf('string');
    // content text is the same JSON.
    const text = (res.content as Array<{ type: string; text: string }>)[0];
    expect(JSON.parse(text!.text)).toEqual(sc);
  });

  it('stop_recording returns the finalized manifest shape', async () => {
    const res = await client.callTool({ name: 'stop_recording', arguments: { recordingId: 'r1' } });
    const sc = res.structuredContent as Record<string, unknown>;
    expect(sc.status).toBe('finalized');
    expect(Array.isArray(sc.tracks)).toBe(true);
    expect(sc.manifestPath).toBeTypeOf('string');
    expect(sc.rawAudioDir).toBeTypeOf('string');
  });

  it('status_recording', async () => {
    const res = await client.callTool({ name: 'status_recording', arguments: { recordingId: 'r1' } });
    const sc = res.structuredContent as Record<string, unknown>;
    expect(sc.state).toBeTypeOf('string');
    expect(Array.isArray(sc.tracksSoFar)).toBe(true);
  });

  it('export_recording', async () => {
    const res = await client.callTool({
      name: 'export_recording',
      arguments: { recordingId: 'r1', format: 'ogg-opus', container: 'directory', mode: 'multitrack' }
    });
    const sc = res.structuredContent as Record<string, unknown>;
    expect(sc.format).toBe('ogg-opus');
    expect(Array.isArray(sc.tracks)).toBe(true);
  });

  it('rejects invalid input via the schema (bad meeting type)', async () => {
    // The SDK surfaces input-validation failures as an isError result (with the
    // zod message), not a thrown exception.
    const res = await client.callTool({
      name: 'start_recording',
      arguments: { guildId: 'g1', voiceChannelId: 'v1', requesterUserId: 'u1', textChannelId: 't1', type: 'party', date: '2026-06-29' }
    });
    expect(res.isError).toBe(true);
    const text = (res.content as Array<{ type: string; text: string }>)[0]!.text;
    expect(text).toMatch(/validation|Invalid/i);
  });
});

describe('delegation + typed errors', () => {
  it('each tool delegates to the facade method', async () => {
    const facade: MeetingRecorderFacade = new FakeMeetingRecorder();
    const startSpy = vi.spyOn(facade, 'start');
    const statusSpy = vi.spyOn(facade, 'status');
    const stopSpy = vi.spyOn(facade, 'stop');
    const exportSpy = vi.spyOn(facade, 'export');

    const { client: c } = await connect(facade);
    await c.callTool({
      name: 'start_recording',
      arguments: { guildId: 'g1', voiceChannelId: 'v1', requesterUserId: 'u1', textChannelId: 't1', type: 'weekly', date: '2026-06-29' }
    });
    await c.callTool({ name: 'status_recording', arguments: { recordingId: 'r1' } });
    await c.callTool({ name: 'stop_recording', arguments: { recordingId: 'r1' } });
    await c.callTool({ name: 'export_recording', arguments: { recordingId: 'r1', format: 'flac', container: 'zip', mode: 'mixdown' } });

    expect(startSpy).toHaveBeenCalledOnce();
    expect((startSpy.mock.calls[0]![0] as StartRecordingInput).type).toBe('weekly');
    expect(statusSpy).toHaveBeenCalledOnce();
    expect((statusSpy.mock.calls[0]![0] as StatusRecordingInput).recordingId).toBe('r1');
    expect(stopSpy).toHaveBeenCalledOnce();
    expect((stopSpy.mock.calls[0]![0] as StopRecordingInput).recordingId).toBe('r1');
    expect(exportSpy).toHaveBeenCalledOnce();
    expect((exportSpy.mock.calls[0]![0] as ExportRecordingInput).format).toBe('flac');
    await c.close();
  });

  it('maps a DcRecError to an isError result with the typed code', async () => {
    const facade: MeetingRecorderFacade = new FakeMeetingRecorder();
    vi.spyOn(facade, 'stop').mockRejectedValue(new DcRecError('recording_not_active', 'not active', { recordingId: 'r1' }));
    const { client: c } = await connect(facade);

    const res = await c.callTool({ name: 'stop_recording', arguments: { recordingId: 'r1' } });
    expect(res.isError).toBe(true);
    const sc = res.structuredContent as Record<string, unknown>;
    expect(sc.ok).toBe(false);
    expect(sc.code).toBe('recording_not_active');
    expect(sc.details).toEqual({ recordingId: 'r1' });
    await c.close();
  });
});

describe('adapter has no Eris voice-lifecycle coupling', () => {
  // Slice 5 acceptance: the MCP *adapter* (tool registration + result/error
  // mapping + the facade contract) must contain no Eris voice-lifecycle. boot.ts
  // is the composition root — it is *expected* to wire the real Eris stack
  // together, so it is excluded here. The voice lifecycle itself lives in
  // src/recorder/{erisCraigAdapter,discordLifecycle}.ts, not in these files.
  it('no adapter file imports eris or Craig recorder internals', () => {
    const dir = __dirname;
    const adapterFiles = readdirSync(dir).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts') && f !== 'boot.ts');
    const forbidden = /(^eris$|discord|recorder\/recording|modules\/recorder|erisCraigAdapter)/;
    for (const file of adapterFiles) {
      const text = readFileSync(path.join(dir, file), 'utf8');
      const importRe = /\bfrom\s+['"]([^'"]+)['"]/g;
      let m: RegExpExecArray | null;
      while ((m = importRe.exec(text)) !== null) {
        expect(forbidden.test(m[1]!), `${file} imports forbidden "${m[1]}"`).toBe(false);
      }
    }
  });

  it('boot.ts wires Eris only through the recorder modules, never inline voice logic', () => {
    // Guard the exclusion above: boot may import the recorder wiring modules,
    // but must not itself import eris directly or reach into Craig internals.
    const text = readFileSync(path.join(__dirname, 'boot.ts'), 'utf8');
    const importRe = /\bfrom\s+['"]([^'"]+)['"]/g;
    let m: RegExpExecArray | null;
    const bad = /(^eris$|modules\/recorder|recorder\/recording)/;
    while ((m = importRe.exec(text)) !== null) {
      expect(bad.test(m[1]!), `boot.ts imports forbidden "${m[1]}"`).toBe(false);
    }
  });
});
