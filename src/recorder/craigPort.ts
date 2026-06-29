// The Craig recording port.
//
// MeetingRecorder depends on this interface, never on Eris or Craig's
// Recording class directly. The real adapter (Eris-backed) is wired at boot;
// tests inject a fake. This is the seam CLAUDE.md requires: "All recording
// behavior lives in MeetingRecorder ... dependencies are injected adapters."

import type { MeetingRequestContext } from '../domain/meeting';

/** What the adapter needs to start one Craig recording. */
export interface CraigStartContext extends MeetingRequestContext {
  /** The id MeetingRecorder assigned; the adapter names raw files from it. */
  recordingId: string;
}

/** What the adapter reports back once Craig has reached the recording state. */
export interface CraigStartResult {
  /**
   * Base path of Craig's raw recording files, e.g.
   * `<runtimeDir>/raw/<recordingId>.ogg` — the `.ogg.{info,header1,...}`
   * contract. The export pipeline (Slice 4) reads from here.
   */
  rawCraigRecordingBase: string;
}

/**
 * Wraps Craig's `Recording` lifecycle. Implementations hide the Eris voice
 * connection and writer details.
 */
export interface CraigRecordingAdapter {
  /**
   * Join the voice channel and begin recording. MUST resolve only after Craig
   * has reached its recording state (so MeetingRecorder.start returns after
   * recording has started, per the plan), and reject if the connection fails.
   */
  start(ctx: CraigStartContext): Promise<CraigStartResult>;

  /**
   * Stop the recording. MUST resolve only after Craig's writer is fully
   * finalized (so stop_recording can hand off complete raw files).
   */
  stop(recordingId: string): Promise<void>;
}
