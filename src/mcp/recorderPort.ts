// The facade the MCP adapter speaks to.
//
// The adapter (server.ts) depends only on this interface — it validates input,
// calls a facade method, and maps the result/error to MCP. All recording and
// export behavior lives behind here (MeetingRecorder + RecordingExporter for
// the real facade; canned values for the fake). The adapter therefore contains
// no Eris voice-lifecycle or cook logic (Slice 5 acceptance).

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

export interface MeetingRecorderFacade {
  start(input: StartRecordingInput): Promise<StartRecordingResult>;
  status(input: StatusRecordingInput): Promise<StatusRecordingResult>;
  stop(input: StopRecordingInput): Promise<StopRecordingResult>;
  export(input: ExportRecordingInput): Promise<ExportRecordingResult>;
}
