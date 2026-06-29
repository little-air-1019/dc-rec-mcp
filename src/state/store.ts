// State-store interface for meeting recordings.
//
// MeetingRecorder depends on this interface, not a concrete adapter, so tests
// can swap in a fake or an in-memory store. The persisted unit is the
// MeetingRecording from the domain layer.

import type { MeetingRecording, RecordingRef } from '../domain/meeting';

/** Fields that may be patched on an existing recording. `recordingId` is the key and is not patchable. */
export type MeetingRecordingPatch = Partial<Omit<MeetingRecording, 'recordingId'>>;

/**
 * Persists meeting recording state so a recording can be inspected and
 * recovered across process restarts (plan "State Persistence").
 *
 * Lookups by `guildId` resolve to the guild's *active* recording — one whose
 * state is not a terminal `finalized`/`errored`. Finalized recordings remain
 * retrievable by `recordingId`.
 */
export interface MeetingStateStore {
  /** Persist a brand-new recording. Throws if `recordingId` already exists. */
  create(recording: MeetingRecording): Promise<MeetingRecording>;

  /**
   * Resolve a recording by `recordingId` (preferred) or by `guildId` (the
   * guild's active recording). Returns `null` when nothing matches.
   */
  get(ref: RecordingRef): Promise<MeetingRecording | null>;

  /**
   * Apply a partial update to an existing recording and persist it. Throws
   * `recording_not_found` (DcRecError) when the id is unknown.
   */
  update(recordingId: string, patch: MeetingRecordingPatch): Promise<MeetingRecording>;

  /** All persisted recordings, newest-known first is not guaranteed. */
  list(): Promise<MeetingRecording[]>;
}
