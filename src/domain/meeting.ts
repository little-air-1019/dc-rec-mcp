// Core domain types for dc-rec-mcp.
//
// These are deliberately framework-free: nothing here imports Discord, MCP, or
// Craig implementation code. They are the shared vocabulary that the
// MeetingRecorder module, the state store, and the MCP adapter all speak.
// (Slice 1 acceptance #2: usable with no Discord/MCP/Craig imports.)

/** Meeting categories the caller may select. Mirrors the plan's `type` enum. */
export type MeetingType = 'stand-up' | 'weekly' | 'research' | 'meeting' | 'sharing' | 'retro' | 'others';

export const MEETING_TYPES: readonly MeetingType[] = [
  'stand-up',
  'weekly',
  'research',
  'meeting',
  'sharing',
  'retro',
  'others'
] as const;

/**
 * Lifecycle state of a single recording. Matches the `state` values in the
 * plan's `status_recording` output.
 */
export type MeetingRecordingState = 'idle' | 'connecting' | 'recording' | 'stopping' | 'finalized' | 'errored';

export const MEETING_RECORDING_STATES: readonly MeetingRecordingState[] = [
  'idle',
  'connecting',
  'recording',
  'stopping',
  'finalized',
  'errored'
] as const;

/**
 * A reference to a recording. The plan allows lookup by either `recordingId`
 * or `guildId` (e.g. status_recording / stop_recording inputs), so both are
 * optional here — the resolver decides which to use.
 */
export interface RecordingRef {
  recordingId?: string;
  guildId?: string;
}

/**
 * The request context the caller supplies when starting a recording. These are
 * the fields named in the External Dasher Contract and `start_recording` input.
 */
export interface MeetingRequestContext {
  guildId: string;
  voiceChannelId: string;
  textChannelId: string;
  requestedByUserId: string;
  type: MeetingType;
  /** Meeting date in `YYYY-MM-DD`. */
  date: string;
  title?: string;
}

/**
 * Per-speaker track metadata, as written into `recording-manifest.json` and
 * returned by `stop_recording`. `startedAt`/`endedAt` are optional because the
 * recorder may not always have precise per-track boundaries.
 */
export interface Track {
  userId: string;
  displayName: string;
  username: string;
  /** Absolute local path to the finalized per-speaker file. */
  path: string;
  codec: 'opus';
  container: 'ogg';
  sampleRate: number;
  channels: number;
  startedAt?: string;
  endedAt?: string;
}

/**
 * The full persisted state of a meeting recording. This is the superset the
 * state store keeps (plan "State Persistence") — every other result type is a
 * JSON-safe projection of this.
 */
export interface MeetingRecording {
  recordingId: string;
  guildId: string;
  voiceChannelId: string;
  textChannelId: string;
  requestedByUserId: string;
  type: MeetingType;
  date: string;
  title?: string;
  state: MeetingRecordingState;
  startedAt?: string;
  endedAt?: string;
  /** Craig raw recording file base, e.g. `<runtimeDir>/raw/<recordingId>.ogg`. */
  rawCraigRecordingBase?: string;
  /** Absolute path to the finalized per-speaker audio directory. */
  rawAudioDir?: string;
  /** Absolute path to `recording-manifest.json`. */
  manifestPath?: string;
  lastError?: string;
}

/**
 * The stable handoff contract written to `recording-manifest.json` and the
 * canonical output destination for a finalized recording.
 */
export interface RecordingManifest {
  recordingId: string;
  status: 'finalized';
  type: MeetingType;
  date: string;
  title?: string;
  guildId: string;
  voiceChannelId: string;
  textChannelId: string;
  requestedByUserId: string;
  startedAt: string;
  endedAt: string;
  rawAudioDir: string;
  tracks: Track[];
}
