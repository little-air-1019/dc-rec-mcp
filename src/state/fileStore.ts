// File-based JSON state store.
//
// Layout (plan "State Persistence"):
//   <runtimeDir>/sessions/<recordingId>/state.json
//
// Each recording is its own directory so an active recorder can also drop a
// recorder.log alongside it. Guild lookup scans session dirs rather than
// keeping a separate index, so there is no second source of truth to corrupt
// on a crash.

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import type { MeetingRecording, MeetingRecordingState, RecordingRef } from '../domain/meeting';
import { DcRecError } from '../domain/errors';
import type { MeetingRecordingPatch, MeetingStateStore } from './store';

/** States in which a recording still belongs to a guild for active-lookup purposes. */
const ACTIVE_STATES: readonly MeetingRecordingState[] = ['idle', 'connecting', 'recording', 'stopping'] as const;

function isActive(state: MeetingRecordingState): boolean {
  return ACTIVE_STATES.includes(state);
}

/**
 * A recordingId becomes a directory name under sessions/, so it must be a
 * single safe path segment. recordingId may be caller-supplied (the plan's
 * start_recording input), so reject anything that could escape sessionsDir:
 * path separators, traversal segments, NUL, or empty/whitespace. Allow only a
 * conservative id charset.
 */
const SAFE_RECORDING_ID = /^[A-Za-z0-9_-]{1,128}$/;

function assertSafeRecordingId(recordingId: string): void {
  if (!SAFE_RECORDING_ID.test(recordingId)) {
    throw new DcRecError('recording_not_found', `invalid recordingId: ${JSON.stringify(recordingId)}`, { recordingId });
  }
}

export class FileMeetingStateStore implements MeetingStateStore {
  private readonly sessionsDir: string;

  /**
   * @param runtimeDir absolute path to `dc-rec-runtime`. Created on demand.
   */
  constructor(runtimeDir: string) {
    if (!path.isAbsolute(runtimeDir)) {
      throw new Error(`runtimeDir must be an absolute path, got: ${runtimeDir}`);
    }
    this.sessionsDir = path.join(runtimeDir, 'sessions');
  }

  /**
   * Absolute path to a recording's state file. Public so callers can surface
   * `statusPath`. Validates the id first so a caller-supplied value can never
   * traverse outside sessionsDir; as defence in depth, also asserts the joined
   * path stays under sessionsDir.
   */
  stateFilePath(recordingId: string): string {
    assertSafeRecordingId(recordingId);
    const dir = path.join(this.sessionsDir, recordingId);
    const resolved = path.resolve(dir);
    const root = path.resolve(this.sessionsDir);
    if (resolved !== path.join(root, recordingId) || !resolved.startsWith(root + path.sep)) {
      throw new DcRecError('recording_not_found', `invalid recordingId: ${JSON.stringify(recordingId)}`, { recordingId });
    }
    return path.join(dir, 'state.json');
  }

  async create(recording: MeetingRecording): Promise<MeetingRecording> {
    // stateFilePath validates recording.recordingId and guarantees the path
    // stays under sessionsDir before we mkdir/write anything.
    const file = this.stateFilePath(recording.recordingId);
    const dir = path.dirname(file);
    mkdirSync(dir, { recursive: true });
    // Exclusive create: fail if a state file already exists for this id.
    try {
      writeFileSync(file, this.serialize(recording), { encoding: 'utf8', flag: 'wx' });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
        throw new DcRecError('already_recording', `recording ${recording.recordingId} already exists`, {
          recordingId: recording.recordingId
        });
      }
      throw err;
    }
    return recording;
  }

  async get(ref: RecordingRef): Promise<MeetingRecording | null> {
    if (ref.recordingId) {
      return this.readById(ref.recordingId);
    }
    if (ref.guildId) {
      // Prefer the guild's active recording; fall back to the most recently
      // started one so a finalized recording is still recoverable by guild.
      const matches = (await this.list()).filter((r) => r.guildId === ref.guildId);
      if (matches.length === 0) return null;
      const active = matches.find((r) => isActive(r.state));
      if (active) return active;
      return matches.sort((a, b) => (b.startedAt ?? '').localeCompare(a.startedAt ?? ''))[0] ?? null;
    }
    return null;
  }

  async update(recordingId: string, patch: MeetingRecordingPatch): Promise<MeetingRecording> {
    const current = this.readById(recordingId);
    if (!current) {
      throw new DcRecError('recording_not_found', `recording ${recordingId} not found`, { recordingId });
    }
    // recordingId is the key — never let a patch change it.
    const next: MeetingRecording = { ...current, ...patch, recordingId };
    writeFileSync(this.stateFilePath(recordingId), this.serialize(next), 'utf8');
    return next;
  }

  async list(): Promise<MeetingRecording[]> {
    let ids: string[];
    try {
      ids = readdirSync(this.sessionsDir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw err;
    }
    const out: MeetingRecording[] = [];
    for (const id of ids) {
      const rec = this.readById(id);
      if (rec) out.push(rec);
    }
    return out;
  }

  private readById(recordingId: string): MeetingRecording | null {
    try {
      const raw = readFileSync(this.stateFilePath(recordingId), 'utf8');
      return JSON.parse(raw) as MeetingRecording;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
  }

  private serialize(recording: MeetingRecording): string {
    return `${JSON.stringify(recording, null, 2)}\n`;
  }
}
