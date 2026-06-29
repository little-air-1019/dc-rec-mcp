// MeetingRecorder — the deep internal module.
//
// All recording behavior lives here, behind a small interface. It takes its
// store and Craig adapter as injected dependencies so tests use fakes and never
// touch Discord (CLAUDE.md "the seam"). The MCP adapter (Slice 5) is a thin
// layer over this; it must not contain voice-lifecycle logic.
//
// Active-recording scope: ONE active recording per guild (decided 2026-06-29,
// plan open question #3). Different guilds may record concurrently.

import { randomBytes } from 'node:crypto';

import { DcRecError } from '../domain/errors';
import type { MeetingRecording, MeetingRecordingState, RecordingRef } from '../domain/meeting';
import type { StartRecordingInput } from '../domain/tool-io';
import type { CraigRecordingAdapter } from './craigPort';
import type { FileMeetingStateStore } from '../state/fileStore';

/** States in which a recording still occupies its guild. */
const ACTIVE_STATES: readonly MeetingRecordingState[] = ['idle', 'connecting', 'recording', 'stopping'] as const;

function isActive(state: MeetingRecordingState): boolean {
  return ACTIVE_STATES.includes(state);
}

const ID_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

/** Generate a 12-char id within the store's safe charset (^[A-Za-z0-9_-]). */
function generateRecordingId(): string {
  const bytes = randomBytes(12);
  let id = '';
  for (let i = 0; i < bytes.length; i++) {
    id += ID_ALPHABET[bytes[i]! % ID_ALPHABET.length];
  }
  return id;
}

export interface MeetingRecorderDeps {
  store: FileMeetingStateStore;
  craig: CraigRecordingAdapter;
  /** Clock seam so tests get deterministic timestamps. Defaults to wall clock. */
  now?: () => Date;
  /** Id generator seam so tests can force collisions/values. Defaults to crypto. */
  generateId?: () => string;
}

/** What start() resolves with — the persisted recording plus its state-file path. */
export interface StartedRecording {
  recording: MeetingRecording;
  statusPath: string;
}

export class MeetingRecorder {
  private readonly store: FileMeetingStateStore;
  private readonly craig: CraigRecordingAdapter;
  private readonly now: () => Date;
  private readonly generateId: () => string;

  constructor(deps: MeetingRecorderDeps) {
    this.store = deps.store;
    this.craig = deps.craig;
    this.now = deps.now ?? (() => new Date());
    this.generateId = deps.generateId ?? generateRecordingId;
  }

  /**
   * Start a recording. Returns after Craig has reached the recording state.
   * Throws `already_recording` if the guild already has an active recording.
   */
  async start(input: StartRecordingInput): Promise<StartedRecording> {
    // Per-guild guard: refuse if this guild already has an active recording.
    const existing = await this.store.get({ guildId: input.guildId });
    if (existing && isActive(existing.state)) {
      throw new DcRecError('already_recording', `guild ${input.guildId} already has an active recording`, {
        guildId: input.guildId,
        recordingId: existing.recordingId
      });
    }

    const recordingId = input.recordingId ?? this.generateId();
    const startedAt = this.now().toISOString();

    // Persist as `connecting` first so status/recovery can see the attempt.
    // store.create validates recordingId (charset + traversal) and maps a
    // duplicate id to already_recording.
    const base: MeetingRecording = {
      recordingId,
      guildId: input.guildId,
      voiceChannelId: input.voiceChannelId,
      textChannelId: input.textChannelId,
      requestedByUserId: input.requesterUserId,
      type: input.type,
      date: input.date,
      ...(input.title !== undefined ? { title: input.title } : {}),
      state: 'connecting',
      startedAt
    };
    await this.store.create(base);

    let craigResult;
    try {
      craigResult = await this.craig.start({
        recordingId,
        guildId: input.guildId,
        voiceChannelId: input.voiceChannelId,
        textChannelId: input.textChannelId,
        requestedByUserId: input.requesterUserId,
        type: input.type,
        date: input.date,
        ...(input.title !== undefined ? { title: input.title } : {})
      });
    } catch (err) {
      // Connection failed: mark errored so the guild is freed and status shows why.
      await this.store.update(recordingId, {
        state: 'errored',
        lastError: err instanceof Error ? err.message : String(err)
      });
      throw err;
    }

    const recording = await this.store.update(recordingId, {
      state: 'recording',
      rawCraigRecordingBase: craigResult.rawCraigRecordingBase
    });

    return { recording, statusPath: this.store.stateFilePath(recordingId) };
  }

  /**
   * Stop an active recording and wait for Craig's writer to finalize. Returns
   * the finalized recording. (Export into the canonical audio dir + manifest is
   * Slice 4; the MCP `stop_recording` result is composed in the adapter.)
   *
   * Throws `recording_not_found` when the ref resolves to nothing, or
   * `recording_not_active` when the resolved recording is already terminal.
   */
  async stop(ref: RecordingRef): Promise<MeetingRecording> {
    const current = await this.resolve(ref);
    if (!isActive(current.state)) {
      throw new DcRecError('recording_not_active', `recording ${current.recordingId} is not active (state: ${current.state})`, {
        recordingId: current.recordingId
      });
    }

    await this.store.update(current.recordingId, { state: 'stopping' });

    // craig.stop resolves only after the writer is fully finalized.
    await this.craig.stop(current.recordingId);

    return this.store.update(current.recordingId, {
      state: 'finalized',
      endedAt: this.now().toISOString()
    });
  }

  /** Resolve a ref to a recording or throw `recording_not_found`. */
  private async resolve(ref: RecordingRef): Promise<MeetingRecording> {
    const found = await this.store.get(ref);
    if (!found) {
      throw new DcRecError('recording_not_found', 'no recording matches the given reference', {
        ...(ref.recordingId !== undefined ? { recordingId: ref.recordingId } : {}),
        ...(ref.guildId !== undefined ? { guildId: ref.guildId } : {})
      });
    }
    return found;
  }
}
