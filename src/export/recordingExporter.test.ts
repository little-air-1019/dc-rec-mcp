// Slice 4 acceptance tests for RecordingExporter.
//
// Acceptance:
//  - Export refuses non-finalized recordings.
//  - Export produces stable local paths.
//  - Manifest track entries match Craig user track metadata.
//  - Failed cook.sh runs produce export_failed with diagnostic detail.

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DcRecError } from '../domain/errors';
import type { MeetingRecording, RecordingManifest } from '../domain/meeting';
import { CookProcessError } from './cookPort';
import { FakeCookRunner } from './fakeCook';
import { RecordingExporter } from './recordingExporter';

const USERS_TEXT = [
  '"0":{}',
  ',"1":{"id":"123","username":"air","discriminator":"0","name":"Air"}',
  ',"2":{"id":"456","username":"bee","discriminator":"0","name":"Bee"}'
].join('\n');

function finalizedRecording(over: Partial<MeetingRecording> = {}): MeetingRecording {
  return {
    recordingId: 'rec1',
    guildId: 'g1',
    voiceChannelId: 'v1',
    textChannelId: 't1',
    requestedByUserId: 'u1',
    type: 'stand-up',
    date: '2026-06-29',
    state: 'finalized',
    startedAt: '2026-06-29T10:00:00.000Z',
    endedAt: '2026-06-29T10:30:00.000Z',
    ...over
  };
}

let outputRoot: string;
let runtimeDir: string;

function writeUsersFile(recordingId: string, text = USERS_TEXT): string {
  const p = path.join(runtimeDir, `${recordingId}.ogg.users`);
  writeFileSync(p, text);
  return p;
}

function makeExporter(cook: FakeCookRunner) {
  return new RecordingExporter({
    cook,
    outputRoot,
    usersFilePathFor: (rec) => path.join(runtimeDir, `${rec.recordingId}.ogg.users`)
  });
}

beforeEach(() => {
  outputRoot = mkdtempSync(path.join(tmpdir(), 'dc-rec-out-'));
  runtimeDir = mkdtempSync(path.join(tmpdir(), 'dc-rec-rt-'));
});

afterEach(() => {
  rmSync(outputRoot, { recursive: true, force: true });
  rmSync(runtimeDir, { recursive: true, force: true });
});

describe('refusing non-finalized recordings', () => {
  it.each(['idle', 'connecting', 'recording', 'stopping', 'errored'] as const)('throws recording_not_finalized for state %s', async (state) => {
    writeUsersFile('rec1');
    const exporter = makeExporter(new FakeCookRunner({ entryNames: ['1-123-Air.ogg'] }));
    await expect(exporter.export(finalizedRecording({ state }))).rejects.toMatchObject({
      code: 'recording_not_finalized'
    });
  });
});

describe('successful export', () => {
  it('produces stable canonical paths and renames per speaker', async () => {
    writeUsersFile('rec1');
    const cook = new FakeCookRunner({ entryNames: ['1-123-Air.ogg', '2-456-Bee.ogg'] });
    const exporter = makeExporter(cook);

    const result = await exporter.export(finalizedRecording());

    const expectedDir = path.join(outputRoot, '2026-06', 'stand-up', 'raw audio', '2026-06-29');
    expect(result.rawAudioDir).toBe(expectedDir);
    expect(result.manifestPath).toBe(path.join(expectedDir, 'recording-manifest.json'));

    // Files exist with canonical names.
    expect(existsSync(path.join(expectedDir, '01-123-Air.ogg'))).toBe(true);
    expect(existsSync(path.join(expectedDir, '02-456-Bee.ogg'))).toBe(true);
    expect(cook.runCalls).toEqual([{ recordingId: 'rec1' }]);
  });

  it('manifest track entries match Craig user track metadata', async () => {
    writeUsersFile('rec1');
    const exporter = makeExporter(new FakeCookRunner({ entryNames: ['1-123-Air.ogg', '2-456-Bee.ogg'] }));

    const result = await exporter.export(finalizedRecording({ title: 'Daily' }));
    const manifest = JSON.parse(readFileSync(result.manifestPath, 'utf8')) as RecordingManifest;

    expect(manifest.recordingId).toBe('rec1');
    expect(manifest.status).toBe('finalized');
    expect(manifest.type).toBe('stand-up');
    expect(manifest.title).toBe('Daily');
    expect(manifest.rawAudioDir).toBe(result.rawAudioDir);
    expect(manifest.tracks).toEqual([
      {
        userId: '123',
        displayName: 'Air',
        username: 'air',
        path: path.join(result.rawAudioDir, '01-123-Air.ogg'),
        codec: 'opus',
        container: 'ogg',
        sampleRate: 48000,
        channels: 2
      },
      {
        userId: '456',
        displayName: 'Bee',
        username: 'bee',
        path: path.join(result.rawAudioDir, '02-456-Bee.ogg'),
        codec: 'opus',
        container: 'ogg',
        sampleRate: 48000,
        channels: 2
      }
    ]);
  });

  it('orders tracks by Craig track number even if cook returns them shuffled', async () => {
    writeUsersFile('rec1');
    const exporter = makeExporter(new FakeCookRunner({ entryNames: ['2-456-Bee.ogg', '1-123-Air.ogg'] }));
    const result = await exporter.export(finalizedRecording());
    expect(result.tracks.map((t) => t.userId)).toEqual(['123', '456']);
    expect(result.tracks.map((t) => path.basename(t.path))).toEqual(['01-123-Air.ogg', '02-456-Bee.ogg']);
  });

  it('writes an empty manifest without running cook when no speaker tracks were recorded', async () => {
    writeUsersFile('rec1', '"0":{}\n');
    const cook = new FakeCookRunner({ entryNames: ['1-123-Air.ogg'] });
    const exporter = makeExporter(cook);

    const result = await exporter.export(finalizedRecording({ title: 'No speakers' }));
    const manifest = JSON.parse(readFileSync(result.manifestPath, 'utf8')) as RecordingManifest;

    expect(result.tracks).toEqual([]);
    expect(manifest.tracks).toEqual([]);
    expect(manifest.title).toBe('No speakers');
    expect(cook.runCalls).toEqual([]);
  });

  it('falls back to track metadata when a cook entry has no matching user', async () => {
    writeUsersFile('rec1', '"0":{}\n,"1":{"id":"123","username":"air","discriminator":"0","name":"Air"}');
    // cook produced a track 2 with no user entry.
    const exporter = makeExporter(new FakeCookRunner({ entryNames: ['1-123-Air.ogg', '2.ogg'] }));
    const result = await exporter.export(finalizedRecording());
    expect(result.tracks[1]).toMatchObject({ userId: 'track2', username: 'unknown', displayName: 'unknown' });
  });

  it('cleans up cook working dir after export', async () => {
    writeUsersFile('rec1');
    const cook = new FakeCookRunner({ entryNames: ['1-123-Air.ogg'] });
    const exporter = makeExporter(cook);
    await exporter.export(finalizedRecording());
    expect(cook.runCalls).toHaveLength(1);
    // The fake's working dirs should be gone.
    // (No direct handle, but a second export must not collide.)
    await exporter.export(finalizedRecording({ recordingId: 'rec1' }));
  });
});

describe('cook failures', () => {
  it('maps a CookProcessError to export_failed with diagnostic detail', async () => {
    writeUsersFile('rec1');
    const cook = new FakeCookRunner({
      entryNames: [],
      failWith: new CookProcessError('cook.sh exited 1', 1, 'oggtracks: bad header\n')
    });
    const exporter = makeExporter(cook);

    await expect(exporter.export(finalizedRecording())).rejects.toMatchObject({
      code: 'export_failed',
      details: { recordingId: 'rec1', exitCode: 1, stderrTail: 'oggtracks: bad header\n' }
    });
  });

  it('maps a missing users file to export_failed', async () => {
    // No users file written.
    const exporter = makeExporter(new FakeCookRunner({ entryNames: ['1-123-Air.ogg'] }));
    await expect(exporter.export(finalizedRecording())).rejects.toBeInstanceOf(DcRecError);
    await expect(exporter.export(finalizedRecording())).rejects.toMatchObject({ code: 'export_failed' });
  });
});
