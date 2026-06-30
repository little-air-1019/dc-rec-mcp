// Tests for RealMeetingRecorderFacade — the compose path of MeetingRecorder +
// RecordingExporter, exercised with a fake Craig adapter and a fake cook runner
// (no Discord, no cook.sh). Proves start/status/stop/export assemble the plan's
// result shapes end-to-end.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { RecordingExporter } from '../export/recordingExporter';
import { FakeCookRunner } from '../export/fakeCook';
import { MeetingRecorder } from '../recorder/meetingRecorder';
import { FakeCraigRecordingAdapter } from '../recorder/fakeCraig';
import { FileMeetingStateStore } from '../state/fileStore';
import { RealMeetingRecorderFacade } from './realFacade';

const USERS_TEXT = '"0":{}\n,"1":{"id":"123","username":"air","discriminator":"0","globalName":"Air"}';

let runtimeDir: string;
let outputRoot: string;
let store: FileMeetingStateStore;
let facade: RealMeetingRecorderFacade;

function writeUsersFile(recordingId: string): void {
  writeFileSync(path.join(runtimeDir, 'raw', `${recordingId}.ogg.users`), USERS_TEXT);
}

beforeEach(() => {
  runtimeDir = mkdtempSync(path.join(tmpdir(), 'dc-rec-rf-rt-'));
  outputRoot = mkdtempSync(path.join(tmpdir(), 'dc-rec-rf-out-'));
  // The exporter reads <runtimeDir>/raw/<id>.ogg.users
  mkdirSync(path.join(runtimeDir, 'raw'), { recursive: true });

  store = new FileMeetingStateStore(runtimeDir);
  const craig = new FakeCraigRecordingAdapter();
  const recorder = new MeetingRecorder({ store, craig, generateId: () => 'rec1', now: () => new Date('2026-06-29T10:00:00.000Z') });
  const cook = new FakeCookRunner({ entryNames: ['1-123-Air.ogg'] });
  const exporter = new RecordingExporter({
    cook,
    outputRoot,
    usersFilePathFor: (rec) => path.join(runtimeDir, 'raw', `${rec.recordingId}.ogg.users`)
  });
  facade = new RealMeetingRecorderFacade({ recorder, exporter, store });
});

afterEach(() => {
  rmSync(runtimeDir, { recursive: true, force: true });
  rmSync(outputRoot, { recursive: true, force: true });
});

function startArgs() {
  return {
    guildId: 'g1',
    voiceChannelId: 'v1',
    requesterUserId: 'u1',
    textChannelId: 't1',
    type: 'stand-up' as const,
    date: '2026-06-29'
  };
}

describe('start', () => {
  it('returns a StartRecordingResult after reaching recording state', async () => {
    const res = await facade.start(startArgs());
    expect(res).toMatchObject({ recordingId: 'rec1', state: 'recording', type: 'stand-up', date: '2026-06-29' });
    expect(res.statusPath).toBe(store.stateFilePath('rec1'));
  });
});

describe('status', () => {
  it('reports idle for an unknown recording', async () => {
    expect(await facade.status({ recordingId: 'ghost' })).toEqual({ state: 'idle', tracksSoFar: [] });
  });

  it('reflects the current state of a known recording', async () => {
    await facade.start(startArgs());
    const res = await facade.status({ recordingId: 'rec1' });
    expect(res).toMatchObject({ recordingId: 'rec1', state: 'recording', type: 'stand-up' });
  });
});

describe('stop', () => {
  it('finalizes then exports, assembling the StopRecordingResult', async () => {
    await facade.start(startArgs());
    writeUsersFile('rec1');

    const res = await facade.stop({ recordingId: 'rec1' });
    expect(res.status).toBe('finalized');
    expect(res.recordingId).toBe('rec1');
    expect(res.guildId).toBe('g1');
    expect(res.endedAt).toBe('2026-06-29T10:00:00.000Z');
    expect(res.tracks).toHaveLength(1);
    expect(res.tracks[0]).toMatchObject({ userId: '123', displayName: 'Air', codec: 'opus', container: 'ogg' });
    expect(res.rawAudioDir).toContain(path.join('2026-06', 'stand-up', 'raw audio', '2026-06-29'));
    expect(res.manifestPath.endsWith('recording-manifest.json')).toBe(true);
  });
});

describe('export', () => {
  it('re-exports a finalized recording as ogg-opus/directory/multitrack', async () => {
    await facade.start(startArgs());
    writeUsersFile('rec1');
    await facade.stop({ recordingId: 'rec1' });

    const res = await facade.export({ recordingId: 'rec1', format: 'ogg-opus', container: 'directory', mode: 'multitrack' });
    expect(res).toMatchObject({ recordingId: 'rec1', format: 'ogg-opus', container: 'directory', mode: 'multitrack' });
    expect(res.tracks[0]).toMatchObject({ trackNo: 1, userId: '123', username: 'air', displayName: 'Air' });
  });

  it('rejects unsupported formats with invalid_export_format', async () => {
    await expect(facade.export({ recordingId: 'rec1', format: 'mp3', container: 'directory', mode: 'multitrack' })).rejects.toMatchObject({
      code: 'invalid_export_format'
    });
  });

  it('rejects unsupported containers with invalid_export_format', async () => {
    await expect(facade.export({ recordingId: 'rec1', format: 'ogg-opus', container: 'zip', mode: 'multitrack' })).rejects.toMatchObject({
      code: 'invalid_export_format'
    });
  });

  it('rejects unsupported modes with invalid_export_mode', async () => {
    await expect(facade.export({ recordingId: 'rec1', format: 'ogg-opus', container: 'directory', mode: 'mixdown' })).rejects.toMatchObject({
      code: 'invalid_export_mode'
    });
  });

  it('rejects an unknown recording with recording_not_found', async () => {
    await expect(facade.export({ recordingId: 'ghost', format: 'ogg-opus', container: 'directory', mode: 'multitrack' })).rejects.toMatchObject({
      code: 'recording_not_found'
    });
  });
});
