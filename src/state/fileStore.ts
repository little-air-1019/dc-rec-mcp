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

  /** Absolute path to a recording's state file. Public so callers can surface `statusPath`. */
  stateFilePath(recordingId: string): string {
    return path.join(this.sessionsDir, recordingId, 'state.json');
  }

  async create(recording: MeetingRecording): Promise<MeetingRecording> {
    const dir = path.join(this.sessionsDir, recording.recordingId);
    const file = path.join(dir, 'state.json');
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
