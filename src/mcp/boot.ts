// Boot selection: build the facade for the current environment.
//
//   DC_REC_TEST_MODE=fake  -> FakeMeetingRecorder (no Discord token; what the
//                             validate.sh MCP smoke gate runs).
//   otherwise              -> RealMeetingRecorderFacade wired with the real
//                             state store, exporter, and RealCookRunner. The
//                             live Discord (Eris) adapter is not built yet, so
//                             a NotImplementedCraigAdapter is injected: export
//                             and status of finalized recordings work, while
//                             start/live-stop fail loudly and honestly. Wiring
//                             the real Eris adapter is gated on the human-run
//                             two-speaker Discord e2e (CLAUDE.md).

import { accessSync, constants as fsConstants } from 'node:fs';
import path from 'node:path';

import { DcRecError } from '../domain/errors';
import { RecordingExporter } from '../export/recordingExporter';
import { RealCookRunner } from '../export/realCook';
import { MeetingRecorder } from '../recorder/meetingRecorder';
import { NotImplementedCraigAdapter } from '../recorder/notImplementedCraig';
import { FileMeetingStateStore } from '../state/fileStore';
import { FakeMeetingRecorder } from './fakeFacade';
import { RealMeetingRecorderFacade } from './realFacade';
import type { MeetingRecorderFacade } from './recorderPort';

export interface BootEnv {
  DC_REC_TEST_MODE?: string;
  DC_REC_DISCORD_TOKEN?: string;
  DC_REC_RUNTIME_DIR?: string;
  DC_REC_OUTPUT_ROOT?: string;
  DC_REC_COOK_PATH?: string;
}

function requireAbsolute(name: keyof BootEnv, value: string | undefined): string {
  if (!value) throw new DcRecError('recording_not_found', `${name} is required in non-fake mode`);
  if (!path.isAbsolute(value)) throw new DcRecError('recording_not_found', `${name} must be an absolute path, got: ${value}`);
  return value;
}

/** Build the facade for the current environment. */
export function buildFacade(env: BootEnv = process.env): MeetingRecorderFacade {
  if (env.DC_REC_TEST_MODE === 'fake') {
    return new FakeMeetingRecorder();
  }

  // Real mode. Dedicated Discord token (open question #2, resolved 2026-06-30).
  if (!env.DC_REC_DISCORD_TOKEN) {
    throw new DcRecError('recording_not_found', 'DC_REC_DISCORD_TOKEN is required in non-fake mode');
  }
  const runtimeDir = requireAbsolute('DC_REC_RUNTIME_DIR', env.DC_REC_RUNTIME_DIR);
  const outputRoot = requireAbsolute('DC_REC_OUTPUT_ROOT', env.DC_REC_OUTPUT_ROOT);
  if (!env.DC_REC_COOK_PATH) {
    throw new DcRecError('cook_binary_missing', 'DC_REC_COOK_PATH is required in non-fake mode');
  }
  const cookScriptPath = requireAbsolute('DC_REC_COOK_PATH', env.DC_REC_COOK_PATH);
  // Startup diagnostic: cook.sh must exist and be executable (plan config rule).
  try {
    accessSync(cookScriptPath, fsConstants.X_OK);
  } catch {
    throw new DcRecError('cook_binary_missing', `cook.sh not found or not executable at ${cookScriptPath}`);
  }

  const rawDir = path.join(runtimeDir, 'raw');
  const store = new FileMeetingStateStore(runtimeDir);
  // Live Discord recording is not wired yet; start/live-stop will fail loudly.
  const craig = new NotImplementedCraigAdapter();
  const recorder = new MeetingRecorder({ store, craig });
  const cook = new RealCookRunner({ cookScriptPath, rawDir });
  const exporter = new RecordingExporter({
    cook,
    outputRoot,
    usersFilePathFor: (rec) => path.join(rawDir, `${rec.recordingId}.ogg.users`)
  });

  return new RealMeetingRecorderFacade({ recorder, exporter, store });
}
