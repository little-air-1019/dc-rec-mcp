// Slice 2 acceptance tests for the file-based state store.
//
// Acceptance:
//  - A finalized recording can be recovered after process restart by
//    recordingId OR guildId.
//  - Tests cover create, update, lookup, and missing-recording cases.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DcRecError } from '../domain/errors';
import type { MeetingRecording } from '../domain/meeting';
import { FileMeetingStateStore } from './fileStore';

function makeRecording(over: Partial<MeetingRecording> = {}): MeetingRecording {
  return {
    recordingId: 'r1',
    guildId: 'g1',
    voiceChannelId: 'v1',
    textChannelId: 't1',
    requestedByUserId: 'u1',
    type: 'stand-up',
    date: '2026-06-29',
    state: 'recording',
    startedAt: '2026-06-29T10:00:00.000Z',
    ...over
  };
}

let runtimeDir: string;
let store: FileMeetingStateStore;

beforeEach(() => {
  runtimeDir = mkdtempSync(path.join(tmpdir(), 'dc-rec-state-'));
  store = new FileMeetingStateStore(runtimeDir);
});

afterEach(() => {
  rmSync(runtimeDir, { recursive: true, force: true });
});

describe('construction', () => {
  it('rejects a non-absolute runtimeDir', () => {
    expect(() => new FileMeetingStateStore('relative/path')).toThrow(/absolute/);
  });
});

describe('create', () => {
  it('persists a recording and returns it', async () => {
    const rec = makeRecording();
    const created = await store.create(rec);
    expect(created).toEqual(rec);
    expect(await store.get({ recordingId: 'r1' })).toEqual(rec);
  });

  it('rejects a duplicate recordingId with already_recording', async () => {
    await store.create(makeRecording());
    await expect(store.create(makeRecording())).rejects.toMatchObject({
      code: 'already_recording'
    });
  });
});

describe('update', () => {
  it('applies a partial patch and persists it', async () => {
    await store.create(makeRecording());
    const updated = await store.update('r1', {
      state: 'finalized',
      endedAt: '2026-06-29T10:30:00.000Z',
      rawAudioDir: '/abs/raw audio/2026-06-29'
    });
    expect(updated.state).toBe('finalized');
    expect(updated.endedAt).toBe('2026-06-29T10:30:00.000Z');
    // Untouched fields survive.
    expect(updated.guildId).toBe('g1');
    expect(await store.get({ recordingId: 'r1' })).toEqual(updated);
  });

  it('cannot change the recordingId via patch', async () => {
    await store.create(makeRecording());
    // @ts-expect-error recordingId is intentionally not part of the patch type
    const updated = await store.update('r1', { recordingId: 'hacked', state: 'stopping' });
    expect(updated.recordingId).toBe('r1');
  });

  it('throws recording_not_found for an unknown id', async () => {
    await expect(store.update('nope', { state: 'errored' })).rejects.toBeInstanceOf(DcRecError);
    await expect(store.update('nope', { state: 'errored' })).rejects.toMatchObject({
      code: 'recording_not_found'
    });
  });
});

describe('lookup', () => {
  it('returns null for a missing recordingId', async () => {
    expect(await store.get({ recordingId: 'missing' })).toBeNull();
  });

  it('returns null for a missing guildId', async () => {
    expect(await store.get({ guildId: 'no-such-guild' })).toBeNull();
  });

  it('returns null for an empty ref', async () => {
    expect(await store.get({})).toBeNull();
  });

  it('finds the active recording by guildId', async () => {
    await store.create(makeRecording({ recordingId: 'r1', state: 'recording' }));
    const found = await store.get({ guildId: 'g1' });
    expect(found?.recordingId).toBe('r1');
  });

  it('prefers the active recording over a finalized one in the same guild', async () => {
    await store.create(makeRecording({ recordingId: 'old', state: 'finalized', startedAt: '2026-06-29T09:00:00.000Z' }));
    await store.create(makeRecording({ recordingId: 'live', state: 'recording', startedAt: '2026-06-29T10:00:00.000Z' }));
    const found = await store.get({ guildId: 'g1' });
    expect(found?.recordingId).toBe('live');
  });

  it('lists all persisted recordings', async () => {
    await store.create(makeRecording({ recordingId: 'r1' }));
    await store.create(makeRecording({ recordingId: 'r2', guildId: 'g2' }));
    const all = await store.list();
    expect(all.map((r) => r.recordingId).sort()).toEqual(['r1', 'r2']);
  });
});

describe('restart recovery', () => {
  it('recovers a finalized recording by recordingId after a fresh store instance', async () => {
    await store.create(makeRecording({ recordingId: 'r1' }));
    await store.update('r1', { state: 'finalized', endedAt: '2026-06-29T10:30:00.000Z' });

    // Simulate process restart: brand-new store over the same runtime dir.
    const reopened = new FileMeetingStateStore(runtimeDir);
    const recovered = await reopened.get({ recordingId: 'r1' });
    expect(recovered?.state).toBe('finalized');
    expect(recovered?.endedAt).toBe('2026-06-29T10:30:00.000Z');
  });

  it('recovers a finalized recording by guildId after a fresh store instance', async () => {
    await store.create(makeRecording({ recordingId: 'r1', guildId: 'g1' }));
    await store.update('r1', { state: 'finalized' });

    const reopened = new FileMeetingStateStore(runtimeDir);
    const recovered = await reopened.get({ guildId: 'g1' });
    expect(recovered?.recordingId).toBe('r1');
    expect(recovered?.state).toBe('finalized');
  });
});
