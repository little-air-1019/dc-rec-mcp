// FakeMeetingRecorder — a facade returning canned, schema-valid results with no
// Discord, Craig, or cook involvement. Injected by the DC_REC_TEST_MODE=fake
// boot path so the MCP smoke gate round-trips without a Discord token.

import { DcRecError } from '../domain/errors';
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
import type { MeetingRecorderFacade } from './recorderPort';

const FAKE_STARTED_AT = '2026-06-29T10:00:00.000Z';
const FAKE_ENDED_AT = '2026-06-29T10:30:00.000Z';

export class FakeMeetingRecorder implements MeetingRecorderFacade {
  async start(input: StartRecordingInput): Promise<StartRecordingResult> {
    const recordingId = input.recordingId ?? 'fake-recording-1';
    return {
      recordingId,
      state: 'recording',
      type: input.type,
      date: input.date,
      ...(input.title !== undefined ? { title: input.title } : {}),
      startedAt: FAKE_STARTED_AT,
      statusPath: `/fake/dc-rec-runtime/sessions/${recordingId}/state.json`
    };
  }

  async status(input: StatusRecordingInput): Promise<StatusRecordingResult> {
    const recordingId = input.recordingId ?? 'fake-recording-1';
    return {
      recordingId,
      state: 'recording',
      type: 'stand-up',
      date: '2026-06-29',
      startedAt: FAKE_STARTED_AT,
      bytesWritten: 0,
      tracksSoFar: [{ userId: 'u1', displayName: 'Air', username: 'air' }]
    };
  }

  async stop(input: StopRecordingInput): Promise<StopRecordingResult> {
    const recordingId = input.recordingId ?? 'fake-recording-1';
    return {
      recordingId,
      status: 'finalized',
      type: 'stand-up',
      date: '2026-06-29',
      guildId: input.guildId ?? 'fake-guild',
      voiceChannelId: 'fake-voice',
      textChannelId: 'fake-text',
      requestedByUserId: 'u1',
      startedAt: FAKE_STARTED_AT,
      endedAt: FAKE_ENDED_AT,
      rawAudioDir: `/fake/ida-meetings/2026-06/stand-up/raw audio/2026-06-29`,
      tracks: [
        {
          userId: 'u1',
          displayName: 'Air',
          username: 'air',
          path: `/fake/ida-meetings/2026-06/stand-up/raw audio/2026-06-29/01-u1-Air.ogg`,
          codec: 'opus',
          container: 'ogg',
          sampleRate: 48000,
          channels: 2
        }
      ],
      manifestPath: `/fake/ida-meetings/2026-06/stand-up/raw audio/2026-06-29/recording-manifest.json`
    };
  }

  async export(input: ExportRecordingInput): Promise<ExportRecordingResult> {
    if (!input.recordingId) {
      throw new DcRecError('recording_not_found', 'fake export requires a recordingId');
    }
    return {
      recordingId: input.recordingId,
      format: input.format,
      container: input.container,
      mode: input.mode,
      outputPath: input.outputDir ?? `/fake/exports/${input.recordingId}`,
      tracks: [{ trackNo: 1, userId: 'u1', username: 'air', displayName: 'Air', filePath: `/fake/exports/${input.recordingId}/01-u1-Air.ogg` }]
    };
  }
}
