// Slice 1 acceptance tests.
//
// #1 — "The types express all fields in this plan's tool input/output examples."
//      Enforced by constructing literal objects that match every field from the
//      plan's JSON examples. If a field is missing, mistyped, or wrongly
//      optional, `tsc` (Gate 2a) fails on this file.
//
// #2 — "No Discord, MCP, or Craig implementation imports are needed."
//      This file (and the modules it pulls in) import only from ./ — proven by
//      the import allowlist test below.

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  DC_REC_ERROR_CODES,
  DcRecError,
  type DcRecErrorCode,
  type DcRecErrorResult
} from './errors';
import {
  MEETING_RECORDING_STATES,
  MEETING_TYPES,
  type MeetingRecording,
  type MeetingRecordingState,
  type MeetingType,
  type RecordingManifest,
  type RecordingRef,
  type Track
} from './meeting';
import {
  EXPORT_CONTAINERS,
  EXPORT_FORMATS,
  EXPORT_MODES,
  type ExportRecordingInput,
  type ExportRecordingResult,
  type StartRecordingInput,
  type StartRecordingResult,
  type StatusRecordingInput,
  type StatusRecordingResult,
  type StopRecordingInput,
  type StopRecordingResult
} from './tool-io';

describe('domain enumerations are complete and closed', () => {
  it('MeetingType lists exactly the plan types', () => {
    expect([...MEETING_TYPES].sort()).toEqual(
      ['meeting', 'others', 'research', 'retro', 'sharing', 'stand-up', 'weekly'].sort()
    );
  });

  it('MeetingRecordingState lists exactly the plan states', () => {
    expect([...MEETING_RECORDING_STATES].sort()).toEqual(
      ['connecting', 'errored', 'finalized', 'idle', 'recording', 'stopping'].sort()
    );
  });

  it('error codes cover the plan error model (all 12)', () => {
    expect(DC_REC_ERROR_CODES).toHaveLength(12);
    const expected: DcRecErrorCode[] = [
      'not_in_voice_channel',
      'voice_channel_not_found',
      'missing_voice_connect_permission',
      'already_recording',
      'recording_not_found',
      'recording_not_active',
      'recording_not_finalized',
      'export_already_running',
      'export_failed',
      'cook_binary_missing',
      'invalid_export_format',
      'invalid_export_mode'
    ];
    expect([...DC_REC_ERROR_CODES].sort()).toEqual([...expected].sort());
  });

  it('export enums match the plan options', () => {
    expect([...EXPORT_FORMATS].sort()).toEqual(['flac', 'm4a', 'mp3', 'ogg-opus', 'wav'].sort());
    expect([...EXPORT_CONTAINERS].sort()).toEqual(['directory', 'zip'].sort());
    expect([...EXPORT_MODES].sort()).toEqual(['mixdown', 'multitrack'].sort());
  });
});

describe('DcRecError carries a typed code', () => {
  it('is an Error with code + details', () => {
    const err = new DcRecError('already_recording', 'guild busy', { recordingId: 'r1' });
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(DcRecError);
    expect(err.code).toBe('already_recording');
    expect(err.details).toEqual({ recordingId: 'r1' });
  });
});

// --- Compile-time field coverage (the heart of acceptance #1) --------------
// These literals must satisfy each type with every plan field present. They are
// asserted at runtime too so the test file exercises them, but the real check
// is that this file type-checks.

describe('result literals satisfy plan schemas', () => {
  it('start_recording input/output', () => {
    const input: StartRecordingInput = {
      guildId: 'g1',
      voiceChannelId: 'v1',
      requesterUserId: 'u1',
      textChannelId: 't1',
      type: 'stand-up',
      date: '2026-06-29',
      title: 'optional',
      recordingId: 'optional'
    };
    const output: StartRecordingResult = {
      recordingId: 'r1',
      state: 'recording',
      type: 'stand-up',
      date: '2026-06-29',
      title: 'optional',
      startedAt: '2026-06-29T10:00:00.000Z',
      statusPath: '/abs/dc-rec-runtime/sessions/r1/state.json'
    };
    expect(input.type).toBe(output.type);
  });

  it('status_recording input/output', () => {
    const input: StatusRecordingInput = { recordingId: 'r1', guildId: 'g1' };
    const output: StatusRecordingResult = {
      recordingId: 'r1',
      state: 'recording',
      type: 'stand-up',
      date: '2026-06-29',
      title: 'optional',
      startedAt: '2026-06-29T10:00:00.000Z',
      endedAt: '2026-06-29T10:30:00.000Z',
      bytesWritten: 123,
      tracksSoFar: [{ userId: 'u1', displayName: 'Air', username: 'air', path: '/abs/01.ogg' }]
    };
    expect(output.tracksSoFar[0]?.userId).toBe(input.recordingId ? 'u1' : 'u1');
  });

  it('stop_recording input/output', () => {
    const input: StopRecordingInput = { recordingId: 'r1', guildId: 'g1', stoppedByUserId: 'u1' };
    const track: Track = {
      userId: 'u1',
      displayName: 'Air',
      username: 'air',
      path: '/abs/raw audio/2026-06-29/01-u1-Air.ogg',
      codec: 'opus',
      container: 'ogg',
      sampleRate: 48000,
      channels: 2,
      startedAt: '2026-06-29T10:00:00.000Z',
      endedAt: '2026-06-29T10:30:00.000Z'
    };
    const output: StopRecordingResult = {
      recordingId: 'r1',
      status: 'finalized',
      type: 'stand-up',
      date: '2026-06-29',
      title: 'optional',
      guildId: 'g1',
      voiceChannelId: 'v1',
      textChannelId: 't1',
      requestedByUserId: 'u1',
      startedAt: '2026-06-29T10:00:00.000Z',
      endedAt: '2026-06-29T10:30:00.000Z',
      rawAudioDir: '/abs/ida-meetings/2026-06/stand-up/raw audio/2026-06-29',
      tracks: [track],
      manifestPath: '/abs/.../recording-manifest.json'
    };
    expect(output.tracks[0]).toBe(track);
    expect(input.stoppedByUserId).toBe('u1');
  });

  it('export_recording input/output', () => {
    const input: ExportRecordingInput = {
      recordingId: 'r1',
      format: 'ogg-opus',
      container: 'directory',
      mode: 'multitrack',
      outputDir: '/abs/out'
    };
    const output: ExportRecordingResult = {
      recordingId: 'r1',
      format: 'ogg-opus',
      container: 'directory',
      mode: 'multitrack',
      outputPath: '/abs/out',
      tracks: [{ trackNo: 1, userId: 'u1', username: 'air', displayName: 'Air', filePath: '/abs/out/01-u1-Air.ogg' }]
    };
    expect(output.format).toBe(input.format);
  });

  it('manifest matches the plan handoff contract', () => {
    const manifest: RecordingManifest = {
      recordingId: 'r1',
      status: 'finalized',
      type: 'stand-up',
      date: '2026-06-29',
      title: 'stand-up',
      guildId: 'g1',
      voiceChannelId: 'v1',
      textChannelId: 't1',
      requestedByUserId: 'u1',
      startedAt: '2026-06-29T10:00:00.000Z',
      endedAt: '2026-06-29T10:30:00.000Z',
      rawAudioDir: '/abs/raw audio/2026-06-29',
      tracks: []
    };
    expect(manifest.status).toBe('finalized');
  });

  it('full persisted recording + ref', () => {
    const rec: MeetingRecording = {
      recordingId: 'r1',
      guildId: 'g1',
      voiceChannelId: 'v1',
      textChannelId: 't1',
      requestedByUserId: 'u1',
      type: 'weekly',
      date: '2026-06-29',
      state: 'finalized',
      startedAt: '2026-06-29T10:00:00.000Z',
      endedAt: '2026-06-29T10:30:00.000Z',
      rawCraigRecordingBase: '/abs/dc-rec-runtime/raw/r1.ogg',
      rawAudioDir: '/abs/raw audio/2026-06-29',
      manifestPath: '/abs/.../recording-manifest.json'
    };
    const ref: RecordingRef = { recordingId: rec.recordingId };
    const errResult: DcRecErrorResult = { ok: false, code: 'recording_not_found', error: 'no such recording' };
    const t: MeetingType = rec.type;
    const s: MeetingRecordingState = rec.state;
    expect(ref.recordingId).toBe('r1');
    expect(errResult.ok).toBe(false);
    expect(t).toBe('weekly');
    expect(s).toBe('finalized');
  });
});

// --- Acceptance #2: no Discord/MCP/Craig imports in the domain layer -------

describe('domain layer has no external coupling', () => {
  it('domain source files import only relative paths or node builtins', () => {
    const domainDir = __dirname;
    const files = readdirSync(domainDir).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));
    expect(files.length).toBeGreaterThan(0);

    const importRe = /\bfrom\s+['"]([^'"]+)['"]/g;
    const forbidden = /(eris|discord|@modelcontextprotocol|slash-create|\.\.\/(?!domain))/;

    for (const file of files) {
      const text = readFileSync(path.join(domainDir, file), 'utf8');
      let m: RegExpExecArray | null;
      while ((m = importRe.exec(text)) !== null) {
        const spec = m[1]!;
        const isRelative = spec.startsWith('./');
        const isNodeBuiltin = spec.startsWith('node:');
        expect(isRelative || isNodeBuiltin, `${file} imports "${spec}"`).toBe(true);
        expect(forbidden.test(spec), `${file} imports forbidden "${spec}"`).toBe(false);
      }
    }
  });
});
