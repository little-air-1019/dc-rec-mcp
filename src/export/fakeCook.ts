// A fake CookRunner for tests and the DC_REC_TEST_MODE=fake boot path.
//
// It materializes a synthetic set of per-speaker .ogg files in a temp dir
// (their contents are placeholder bytes) so the exporter's extract/rename/
// manifest logic runs end-to-end without cook.sh or unzip. A failure mode
// simulates a cook process error.

import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { CookProcessError, type CookRequest, type CookResult, type CookRunner } from './cookPort';

export interface FakeCookOptions {
  /**
   * Entry names cook would have produced, e.g. `['1-123-Air.ogg', '2-456-Bee.ogg']`.
   * The exporter only relies on the leading `NN` to join with `.ogg.users`.
   */
  entryNames: string[];
  /** When set, run() throws this as a cook process failure. */
  failWith?: CookProcessError;
  /** Per-entry placeholder bytes, keyed by entryName. Defaults to the entry name. */
  contentFor?: (entryName: string) => string;
}

export class FakeCookRunner implements CookRunner {
  readonly runCalls: CookRequest[] = [];

  constructor(private readonly opts: FakeCookOptions) {}

  async run(req: CookRequest): Promise<CookResult> {
    this.runCalls.push(req);
    if (this.opts.failWith) throw this.opts.failWith;

    const workingDir = mkdtempSync(path.join(tmpdir(), `dc-rec-cook-${req.recordingId}-`));
    const tracks = this.opts.entryNames.map((entryName) => {
      const filePath = path.join(workingDir, entryName);
      const content = this.opts.contentFor ? this.opts.contentFor(entryName) : entryName;
      writeFileSync(filePath, content);
      return { entryName, filePath };
    });
    return { tracks, workingDir };
  }
}
