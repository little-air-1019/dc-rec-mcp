// The real facade: composes MeetingRecorder (recording lifecycle) and
// RecordingExporter (cook -> per-speaker .ogg + manifest) into the four MCP
// tool results. No MCP/JSON concerns here; no Eris here either — the live
// Discord adapter is injected (NotImplementedCraigAdapter until the e2e lands).

import { DcRecError } from '../domain/errors';
import type { MeetingRecording, RecordingRef, Track } from '../domain/meeting';
import type {
  ExportRecordingInput,
  ExportRecordingResult,
  StartRecordingInput,
  StartRecordingResult,
  StatusRecordingInput,
  StatusRecordingResult,
  StopRecordingInput,
  StopRecordingResult
} from '../domain/tool-io';
import type { RecordingExporter } from '../export/recordingExporter';
import type { MeetingRecorder } from '../recorder/meetingRecorder';
import type { FileMeetingStateStore } from '../state/fileStore';
import type { MeetingRecorderFacade } from './recorderPort';

export interface RealFacadeDeps {
  recorder: MeetingRecorder;
  exporter: RecordingExporter;
  store: FileMeetingStateStore;
}

function refFromStatus(input: StatusRecordingInput): RecordingRef {
  return {
    ...(input.recordingId !== undefined ? { recordingId: input.recordingId } : {}),
    ...(input.guildId !== undefined ? { guildId: input.guildId } : {})
  };
}

function refFromStop(input: StopRecordingInput): RecordingRef {
  return {
    ...(input.recordingId !== undefined ? { recordingId: input.recordingId } : {}),
    ...(input.guildId !== undefined ? { guildId: input.guildId } : {})
  };
}

export class RealMeetingRecorderFacade implements MeetingRecorderFacade {
  private readonly recorder: MeetingRecorder;
  private readonly exporter: RecordingExporter;
  private readonly store: FileMeetingStateStore;

  constructor(deps: RealFacadeDeps) {
    this.recorder = deps.recorder;
    this.exporter = deps.exporter;
    this.store = deps.store;
  }

  async start(input: StartRecordingInput): Promise<StartRecordingResult> {
    const { recording, statusPath } = await this.recorder.start(input);
    return {
      recordingId: recording.recordingId,
      state: 'recording',
      type: recording.type,
      date: recording.date,
      ...(recording.title !== undefined ? { title: recording.title } : {}),
      startedAt: recording.startedAt ?? '',
      statusPath
    };
  }

  async status(input: StatusRecordingInput): Promise<StatusRecordingResult> {
    const found = await this.store.get(refFromStatus(input));
    if (!found) {
      // Status is a poll; an unknown recording is reported as idle rather than
      // erroring, so callers can poll before/after lifecycle transitions.
      return { state: 'idle', tracksSoFar: [] };
    }
    return {
      recordingId: found.recordingId,
      state: found.state,
      type: found.type,
      date: found.date,
      ...(found.title !== undefined ? { title: found.title } : {}),
      ...(found.startedAt !== undefined ? { startedAt: found.startedAt } : {}),
      ...(found.endedAt !== undefined ? { endedAt: found.endedAt } : {}),
      tracksSoFar: [],
      ...(found.lastError !== undefined ? { lastError: found.lastError } : {})
    };
  }

  async stop(input: StopRecordingInput): Promise<StopRecordingResult> {
    const finalized = await this.recorder.stop(refFromStop(input));
    const exported = await this.exporter.export(finalized);
    return this.toStopResult(finalized, exported.rawAudioDir, exported.manifestPath, exported.tracks);
  }

  async export(input: ExportRecordingInput): Promise<ExportRecordingResult> {
    // First version supports the default per-speaker Ogg Opus directory export
    // (plan "Recommended first version"). Other formats/modes are typed-rejected
    // until added.
    if (input.format !== 'ogg-opus') {
      throw new DcRecError('invalid_export_format', `unsupported export format: ${input.format} (only ogg-opus is implemented)`, {
        recordingId: input.recordingId
      });
    }
    if (input.mode !== 'multitrack') {
      throw new DcRecError('invalid_export_mode', `unsupported export mode: ${input.mode} (only multitrack is implemented)`, {
        recordingId: input.recordingId
      });
    }

    const found = await this.store.get({ recordingId: input.recordingId });
    if (!found) {
      throw new DcRecError('recording_not_found', `recording ${input.recordingId} not found`, { recordingId: input.recordingId });
    }
    const exported = await this.exporter.export(found);
    return {
      recordingId: input.recordingId,
      format: 'ogg-opus',
      container: 'directory',
      mode: 'multitrack',
      outputPath: exported.rawAudioDir,
      tracks: exported.tracks.map((t, i) => ({
        trackNo: i + 1,
        userId: t.userId,
        username: t.username,
        displayName: t.displayName,
        filePath: t.path
      }))
    };
  }

  private toStopResult(rec: MeetingRecording, rawAudioDir: string, manifestPath: string, tracks: Track[]): StopRecordingResult {
    return {
      recordingId: rec.recordingId,
      status: 'finalized',
      type: rec.type,
      date: rec.date,
      ...(rec.title !== undefined ? { title: rec.title } : {}),
      guildId: rec.guildId,
      voiceChannelId: rec.voiceChannelId,
      textChannelId: rec.textChannelId,
      requestedByUserId: rec.requestedByUserId,
      startedAt: rec.startedAt ?? '',
      endedAt: rec.endedAt ?? '',
      rawAudioDir,
      tracks,
      manifestPath
    };
  }
}
