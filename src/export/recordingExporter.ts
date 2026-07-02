// RecordingExporter — turns a finalized Craig recording into the canonical
// per-speaker .ogg directory + recording-manifest.json (the Dasher handoff).
//
// Flow (open question #1 decision: cook.sh zip -> extract -> rename):
//   1. Refuse non-finalized recordings.
//   2. Run cook via the injected CookRunner -> extracted NN-<user>.ogg files.
//   3. Join each NN entry to `.ogg.users` track metadata.
//   4. Copy/rename into <outputRoot>/<YYYY-MM>/<type>/raw audio/<date>/ as
//      01-<userId>-<displayName>.ogg.
//   5. Write recording-manifest.json and return paths + track metadata.
//
// cook.sh / unzip live behind CookRunner; this module is pure orchestration and
// fully testable with a fake.

import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { DcRecError } from '../domain/errors';
import type { MeetingRecording, RecordingManifest, Track } from '../domain/meeting';
import type { CookRunner } from './cookPort';
import { CookProcessError } from './cookPort';
import { manifestPath as manifestPathFor, rawAudioDir as rawAudioDirFor, trackFileName } from './outputPaths';
import { parseUsersFile, type CraigTrackUser } from './usersFile';

export interface RecordingExporterDeps {
  cook: CookRunner;
  /** Absolute DC_REC_OUTPUT_ROOT. */
  outputRoot: string;
  /**
   * Resolve the `.ogg.users` file path for a recording. Injected so the module
   * doesn't hardcode Craig's runtime dir layout.
   */
  usersFilePathFor: (recording: MeetingRecording) => string;
}

export interface ExportedRecording {
  rawAudioDir: string;
  manifestPath: string;
  tracks: Track[];
}

/** Leading `NN` of a cook entry name like `1-123-Air.ogg` -> 1. */
function entryTrackNo(entryName: string): number | null {
  const m = /^(\d+)/.exec(entryName);
  return m ? Number(m[1]) : null;
}

export class RecordingExporter {
  private readonly cook: CookRunner;
  private readonly outputRoot: string;
  private readonly usersFilePathFor: (recording: MeetingRecording) => string;

  constructor(deps: RecordingExporterDeps) {
    if (!path.isAbsolute(deps.outputRoot)) {
      throw new Error(`outputRoot must be absolute, got: ${deps.outputRoot}`);
    }
    this.cook = deps.cook;
    this.outputRoot = deps.outputRoot;
    this.usersFilePathFor = deps.usersFilePathFor;
  }

  /**
   * Export a finalized recording. Throws `recording_not_finalized` for any
   * other state, and `export_failed` (with diagnostic detail) when cook fails.
   */
  async export(recording: MeetingRecording): Promise<ExportedRecording> {
    if (recording.state !== 'finalized') {
      throw new DcRecError('recording_not_finalized', `recording ${recording.recordingId} is not finalized (state: ${recording.state})`, {
        recordingId: recording.recordingId
      });
    }

    const users = this.readUsers(recording);
    const outDir = rawAudioDirFor(this.outputRoot, recording.type, recording.date);
    if (users.length === 0) {
      mkdirSync(outDir, { recursive: true });
      const manifest = this.buildManifest(recording, outDir, []);
      const manifestFile = manifestPathFor(outDir);
      writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
      return { rawAudioDir: outDir, manifestPath: manifestFile, tracks: [] };
    }
    const usersByTrack = new Map<number, CraigTrackUser>(users.map((u) => [u.trackNo, u]));

    let cooked;
    try {
      cooked = await this.cook.run({ recordingId: recording.recordingId });
    } catch (err) {
      if (err instanceof CookProcessError) {
        throw new DcRecError('export_failed', `cook failed for ${recording.recordingId}: ${err.message}`, {
          recordingId: recording.recordingId,
          exitCode: err.exitCode ?? -1,
          stderrTail: err.stderrTail
        });
      }
      throw new DcRecError('export_failed', `export failed for ${recording.recordingId}: ${err instanceof Error ? err.message : String(err)}`, {
        recordingId: recording.recordingId
      });
    }

    try {
      mkdirSync(outDir, { recursive: true });

      // Stable ordering: by Craig track number ascending, so ordinal NN is
      // deterministic across re-exports.
      const ordered = [...cooked.tracks].sort((a, b) => (entryTrackNo(a.entryName) ?? 0) - (entryTrackNo(b.entryName) ?? 0));

      const tracks: Track[] = [];
      let ordinal = 0;
      for (const file of ordered) {
        const trackNo = entryTrackNo(file.entryName);
        if (trackNo === null) {
          throw new DcRecError('export_failed', `cook produced an unrecognized entry name: ${file.entryName}`, {
            recordingId: recording.recordingId
          });
        }
        const user = usersByTrack.get(trackNo);
        const userId = user?.userId ?? `track${trackNo}`;
        const username = user?.username ?? 'unknown';
        const displayName = user?.displayName ?? username;

        ordinal += 1;
        const fileName = trackFileName(ordinal, userId, displayName);
        const destPath = path.join(outDir, fileName);
        copyFileSync(file.filePath, destPath);

        tracks.push({
          userId,
          displayName,
          username,
          path: destPath,
          codec: 'opus',
          container: 'ogg',
          sampleRate: 48000,
          channels: 2
        });
      }

      const manifest = this.buildManifest(recording, outDir, tracks);
      const manifestFile = manifestPathFor(outDir);
      writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

      return { rawAudioDir: outDir, manifestPath: manifestFile, tracks };
    } finally {
      // Clean up cook's working dir regardless of success.
      rmSync(cooked.workingDir, { recursive: true, force: true });
    }
  }

  private readUsers(recording: MeetingRecording): CraigTrackUser[] {
    const usersPath = this.usersFilePathFor(recording);
    let text: string;
    try {
      text = readFileSync(usersPath, 'utf8');
    } catch (err) {
      throw new DcRecError('export_failed', `could not read users file for ${recording.recordingId}: ${err instanceof Error ? err.message : String(err)}`, {
        recordingId: recording.recordingId
      });
    }
    return parseUsersFile(text);
  }

  private buildManifest(recording: MeetingRecording, outDir: string, tracks: Track[]): RecordingManifest {
    if (!recording.startedAt || !recording.endedAt) {
      throw new DcRecError('export_failed', `finalized recording ${recording.recordingId} is missing start/end timestamps`, {
        recordingId: recording.recordingId
      });
    }
    return {
      recordingId: recording.recordingId,
      status: 'finalized',
      type: recording.type,
      date: recording.date,
      ...(recording.title !== undefined ? { title: recording.title } : {}),
      guildId: recording.guildId,
      voiceChannelId: recording.voiceChannelId,
      textChannelId: recording.textChannelId,
      requestedByUserId: recording.requestedByUserId,
      startedAt: recording.startedAt,
      endedAt: recording.endedAt,
      rawAudioDir: outDir,
      tracks
    };
  }
}
