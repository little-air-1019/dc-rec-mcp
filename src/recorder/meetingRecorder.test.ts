// Slice 3 acceptance tests for MeetingRecorder.
//
// Acceptance:
//  - Starting a recording returns after Craig reaches recording state.
//  - Stopping waits until writer finalization completes.
//  - Already-active guilds return already_recording.
//  - Missing active recordings return recording_not_found / recording_not_active.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DcRecError } from '../domain/errors';
import type { StartRecordingInput } from '../domain/tool-io';
import { FileMeetingStateStore } from '../state/fileStore';
import { FakeCraigRecordingAdapter, type FakeCraigOptions } from './fakeCraig';
import { MeetingRecorder } from './meetingRecorder';

function startInput(over: Partial<StartRecordingInput> = {}): StartRecordingInput {
  return {
    guildId: 'g1',
    voiceChannelId: 'v1',
    requesterUserId: 'u1',
    textChannelId: 't1',
    type: 'stand-up',
    date: '2026-06-29',
    ...over
  };
}

let runtimeDir: string;
let store: FileMeetingStateStore;

function makeRecorder(craigOpts: FakeCraigOptions = {}, idSeq?: string[]) {
  const craig = new FakeCraigRecordingAdapter(craigOpts);
  let i = 0;
  const recorder = new MeetingRecorder({
    store,
    craig,
    now: () => new Date('2026-06-29T10:00:00.000Z'),
    ...(idSeq ? { generateId: () => idSeq[i++ % idSeq.length]! } : {})
  });
  return { recorder, craig };
}

beforeEach(() => {
  runtimeDir = mkdtempSync(path.join(tmpdir(), 'dc-rec-mr-'));
  store = new FileMeetingStateStore(runtimeDir);
});

afterEach(() => {
  rmSync(runtimeDir, { recursive: true, force: true });
});

describe('start', () => {
  it('returns after Craig reaches recording state', async () => {
    const { recorder, craig } = makeRecorder({}, ['rec1']);
    const { recording, statusPath } = await recorder.start(startInput());

    // Craig.start was actually invoked and resolved before we got `recording`.
    expect(craig.startCalls).toHaveLength(1);
    expect(craig.startCalls[0]?.recordingId).toBe('rec1');
    expect(recording.state).toBe('recording');
    expect(recording.rawCraigRecordingBase).toBe('/runtime/raw/rec1.ogg');
    expect(recording.startedAt).toBe('2026-06-29T10:00:00.000Z');
    expect(statusPath).toBe(store.stateFilePath('rec1'));

    // Persisted state agrees.
    const persisted = await store.get({ recordingId: 'rec1' });
    expect(persisted?.state).toBe('recording');
  });

  it('honours a caller-supplied recordingId', async () => {
    const { recorder } = makeRecorder();
    const { recording } = await recorder.start(startInput({ recordingId: 'caller-id-1' }));
    expect(recording.recordingId).toBe('caller-id-1');
  });

  it('marks the recording errored and frees the guild if Craig fails to connect', async () => {
    // The fake fails the first start, then succeeds — proving the guild frees.
    let attempt = 0;
    const craig = new FakeCraigRecordingAdapter();
    const originalStart = craig.start.bind(craig);
    craig.start = async (ctx) => {
      attempt += 1;
      if (attempt === 1) throw new Error('connect timeout');
      return originalStart(ctx);
    };
    const recorder = new MeetingRecorder({ store, craig, now: () => new Date('2026-06-29T10:00:00.000Z') });

    await expect(recorder.start(startInput({ recordingId: 'rec1' }))).rejects.toThrow('connect timeout');

    const persisted = await store.get({ recordingId: 'rec1' });
    expect(persisted?.state).toBe('errored');
    expect(persisted?.lastError).toBe('connect timeout');

    // Guild is free again (rec1 is terminal `errored`): a new start succeeds.
    const { recording } = await recorder.start(startInput({ recordingId: 'rec2' }));
    expect(recording.state).toBe('recording');
  });
});

describe('already_recording guard (one active per guild)', () => {
  it('rejects a second start in the same guild with the active recordingId', async () => {
    const { recorder } = makeRecorder();
    await recorder.start(startInput({ recordingId: 'active-1' }));

    await expect(recorder.start(startInput({ recordingId: 'active-2' }))).rejects.toMatchObject({
      code: 'already_recording',
      details: { guildId: 'g1', recordingId: 'active-1' }
    });
  });

  it('allows concurrent recordings in different guilds', async () => {
    const { recorder } = makeRecorder();
    const a = await recorder.start(startInput({ guildId: 'gA', recordingId: 'a1' }));
    const b = await recorder.start(startInput({ guildId: 'gB', recordingId: 'b1' }));
    expect(a.recording.state).toBe('recording');
    expect(b.recording.state).toBe('recording');
  });

  it('frees the guild after a recording finalizes, allowing a new start', async () => {
    const { recorder } = makeRecorder();
    await recorder.start(startInput({ recordingId: 'first' }));
    await recorder.stop({ recordingId: 'first' });
    // Same guild, new recording is allowed now.
    const again = await recorder.start(startInput({ recordingId: 'second' }));
    expect(again.recording.state).toBe('recording');
  });
});

describe('stop', () => {
  it('waits until Craig writer finalization completes before marking finalized', async () => {
    const events: string[] = [];
    const { recorder, craig } = makeRecorder(
      {
        onStop: async () => {
          // Simulate writer flush taking time; record that it ran before finalize.
          events.push('writer-finalizing');
          await Promise.resolve();
          events.push('writer-finalized');
        }
      },
      ['rec1']
    );
    await recorder.start(startInput());

    const finalized = await recorder.stop({ recordingId: 'rec1' });

    // craig.stop fully resolved (writer finalized) before we observed `finalized`.
    expect(craig.stopCalls).toEqual(['rec1']);
    expect(craig.finalizedStops).toEqual(['rec1']);
    expect(events).toEqual(['writer-finalizing', 'writer-finalized']);
    expect(finalized.state).toBe('finalized');
    expect(finalized.endedAt).toBe('2026-06-29T10:00:00.000Z');
  });

  it('can stop by guildId', async () => {
    const { recorder } = makeRecorder({}, ['rec1']);
    await recorder.start(startInput({ guildId: 'gX' }));
    const finalized = await recorder.stop({ guildId: 'gX' });
    expect(finalized.recordingId).toBe('rec1');
    expect(finalized.state).toBe('finalized');
  });

  it('throws recording_not_found when nothing matches the ref', async () => {
    const { recorder } = makeRecorder();
    await expect(recorder.stop({ recordingId: 'ghost' })).rejects.toMatchObject({ code: 'recording_not_found' });
    await expect(recorder.stop({ guildId: 'no-guild' })).rejects.toBeInstanceOf(DcRecError);
  });

  it('throws recording_not_active when the recording is already finalized', async () => {
    const { recorder } = makeRecorder({}, ['rec1']);
    await recorder.start(startInput());
    await recorder.stop({ recordingId: 'rec1' });

    await expect(recorder.stop({ recordingId: 'rec1' })).rejects.toMatchObject({
      code: 'recording_not_active'
    });
  });
});
