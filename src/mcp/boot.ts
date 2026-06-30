// Boot selection: choose the facade implementation from the environment.
//
//   DC_REC_TEST_MODE=fake  -> FakeMeetingRecorder (no Discord token; what the
//                             validate.sh MCP smoke gate runs).
//   otherwise              -> the real facade (MeetingRecorder + exporter over
//                             a dedicated Discord bot). The Eris-backed Craig
//                             adapter is deferred (post-Slice-6 hardening), so
//                             the real branch validates config and throws a
//                             clear diagnostic rather than pretending to record.

import { DcRecError } from '../domain/errors';
import type { MeetingRecorderFacade } from './recorderPort';
import { FakeMeetingRecorder } from './fakeFacade';

export interface BootEnv {
  DC_REC_TEST_MODE?: string;
  DC_REC_DISCORD_TOKEN?: string;
  DC_REC_RUNTIME_DIR?: string;
  DC_REC_OUTPUT_ROOT?: string;
  DC_REC_COOK_PATH?: string;
}

/** Build the facade for the current environment. */
export function buildFacade(env: BootEnv = process.env): MeetingRecorderFacade {
  if (env.DC_REC_TEST_MODE === 'fake') {
    return new FakeMeetingRecorder();
  }

  // Real mode. Validate the configuration the real recorder will need, with the
  // typed startup diagnostics the plan calls for. (Dedicated Discord token —
  // open question #2 resolved 2026-06-30.)
  if (!env.DC_REC_DISCORD_TOKEN) {
    throw new DcRecError('recording_not_found', 'DC_REC_DISCORD_TOKEN is required in non-fake mode');
  }
  if (!env.DC_REC_COOK_PATH) {
    throw new DcRecError('cook_binary_missing', 'DC_REC_COOK_PATH is required in non-fake mode');
  }

  // The Eris-backed Craig adapter is intentionally not wired in this slice.
  // Until it lands, fail loudly instead of returning a half-real facade.
  throw new DcRecError(
    'recording_not_found',
    'Real recorder is not wired yet. Run with DC_REC_TEST_MODE=fake, or wait for the Eris adapter (post-Slice-6).'
  );
}
