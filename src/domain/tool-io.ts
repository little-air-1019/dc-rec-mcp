// JSON-safe input/output types for the four MCP tools.
//
// These mirror the plan's "MCP Tool Interface" JSON examples field-for-field.
// They are the contract the MCP adapter validates against; nothing here imports
// Discord, MCP, or Craig code (Slice 1 acceptance #2).

import type { MeetingRecordingState, MeetingType, Track } from './meeting';

// --- start_recording -------------------------------------------------------

export interface StartRecordingInput {
  guildId: string;
  voiceChannelId: string;
  requesterUserId: string;
  textChannelId: string;
  type: MeetingType;
  /** `YYYY-MM-DD`. */
  date: string;
  title?: string;
  /** Caller-supplied id; recorder generates one when omitted. */
  recordingId?: string;
}

export interface StartRecordingResult {
  recordingId: string;
  state: 'recording';
  type: MeetingType;
  date: string;
  title?: string;
  /** ISO timestamp. */
  startedAt: string;
  /** Absolute local path to the session state file. */
  statusPath: string;
}

// --- status_recording ------------------------------------------------------

export interface StatusRecordingInput {
  recordingId?: string;
  guildId?: string;
}

/** A track seen so far during an in-progress recording; paths may be absent. */
export interface StatusTrack {
  userId: string;
  displayName?: string;
  username?: string;
  path?: string;
}

export interface StatusRecordingResult {
  recordingId?: string;
  state: MeetingRecordingState;
  type?: MeetingType;
  /** `YYYY-MM-DD`. */
  date?: string;
  title?: string;
  /** ISO timestamp. */
  startedAt?: string;
  /** ISO timestamp. */
  endedAt?: string;
  bytesWritten?: number;
  tracksSoFar: StatusTrack[];
  lastError?: string;
}

// --- stop_recording --------------------------------------------------------

export interface StopRecordingInput {
  recordingId?: string;
  guildId?: string;
  stoppedByUserId?: string;
}

export interface StopRecordingResult {
  recordingId: string;
  status: 'finalized';
  type: MeetingType;
  date: string;
  title?: string;
  guildId: string;
  voiceChannelId: string;
  textChannelId: string;
  requestedByUserId: string;
  /** ISO timestamp. */
  startedAt: string;
  /** ISO timestamp. */
  endedAt: string;
  rawAudioDir: string;
  tracks: Track[];
  manifestPath: string;
}

// --- export_recording ------------------------------------------------------

export type ExportFormat = 'ogg-opus' | 'flac' | 'wav' | 'mp3' | 'm4a';
export const EXPORT_FORMATS: readonly ExportFormat[] = ['ogg-opus', 'flac', 'wav', 'mp3', 'm4a'] as const;

export type ExportContainer = 'directory' | 'zip';
export const EXPORT_CONTAINERS: readonly ExportContainer[] = ['directory', 'zip'] as const;

export type ExportMode = 'multitrack' | 'mixdown';
export const EXPORT_MODES: readonly ExportMode[] = ['multitrack', 'mixdown'] as const;

export interface ExportRecordingInput {
  recordingId: string;
  format: ExportFormat;
  container: ExportContainer;
  mode: ExportMode;
  outputDir?: string;
}

/** Per-track entry in an export result (plan's `export_recording` output). */
export interface ExportTrack {
  trackNo: number;
  userId: string;
  username: string;
  displayName?: string;
  filePath: string;
}

export interface ExportRecordingResult {
  recordingId: string;
  format: ExportFormat;
  container: ExportContainer;
  mode: ExportMode;
  outputPath: string;
  tracks: ExportTrack[];
}
