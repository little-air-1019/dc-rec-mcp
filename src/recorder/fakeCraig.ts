// A fake CraigRecordingAdapter for tests and the DC_REC_TEST_MODE=fake boot
// path. It records calls and lets a test control connect success/failure and
// observe that stop() resolution gates finalization — no Discord, no Eris.

import type { CraigRecordingAdapter, CraigStartContext, CraigStartResult } from './craigPort';

export interface FakeCraigOptions {
  /** When set, start() rejects with this error (simulates connect failure). */
  failStartWith?: Error;
  /** Base path returned from start(); defaults to a runtime-style path. */
  rawBaseFor?: (recordingId: string) => string;
  /**
   * Optional hook awaited inside stop() before it resolves. Lets a test prove
   * that finalization (state -> finalized) only happens after stop() resolves.
   */
  onStop?: (recordingId: string) => Promise<void> | void;
}

export class FakeCraigRecordingAdapter implements CraigRecordingAdapter {
  readonly startCalls: CraigStartContext[] = [];
  readonly stopCalls: string[] = [];
  /** Recording ids for which stop() has fully resolved. */
  readonly finalizedStops: string[] = [];

  constructor(private readonly opts: FakeCraigOptions = {}) {}

  async start(ctx: CraigStartContext): Promise<CraigStartResult> {
    this.startCalls.push(ctx);
    if (this.opts.failStartWith) throw this.opts.failStartWith;
    const rawCraigRecordingBase = this.opts.rawBaseFor
      ? this.opts.rawBaseFor(ctx.recordingId)
      : `/runtime/raw/${ctx.recordingId}.ogg`;
    return { rawCraigRecordingBase };
  }

  async stop(recordingId: string): Promise<void> {
    this.stopCalls.push(recordingId);
    if (this.opts.onStop) await this.opts.onStop(recordingId);
    this.finalizedStops.push(recordingId);
  }
}
