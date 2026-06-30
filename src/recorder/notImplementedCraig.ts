// A CraigRecordingAdapter placeholder for real (non-fake) mode.
//
// The live Eris voice connection that wraps Craig's Recording class is not yet
// built — its only meaningful verification is the human-run two-speaker Discord
// e2e (CLAUDE.md: NOT inside the automated loop). Until that lands, real-mode
// start/stop fail loudly and honestly rather than silently or with a misleading
// code. Export/status of an already-finalized recording do NOT go through this
// adapter, so they remain usable in real mode.

import { DcRecError } from '../domain/errors';
import type { CraigRecordingAdapter, CraigStartContext } from './craigPort';

const MESSAGE =
  'The live Discord (Eris) recording adapter is not implemented yet. ' +
  'Recording start/stop require a real voice connection, verified via the manual ' +
  'two-speaker Discord e2e. Until then, only export/status of finalized recordings are available in real mode.';

export class NotImplementedCraigAdapter implements CraigRecordingAdapter {
  async start(_ctx: CraigStartContext): Promise<never> {
    throw new DcRecError('recording_not_active', MESSAGE);
  }

  async stop(_recordingId: string): Promise<never> {
    throw new DcRecError('recording_not_active', MESSAGE);
  }
}
