// Real CookRunner: runs Craig's cook.sh and extracts per-speaker .ogg files.
//
// Strategy (open question #1): `cook.sh <id> copy zip` produces a zip of
// NN-<user>.ogg tracks streamed to stdout; we capture it, extract with the
// system `unzip`, and hand the entries to RecordingExporter. cook.sh is left
// untouched. Discord is not involved here, so this is unit-testable with a
// stub cook.sh + a real zip.

import { spawn } from 'node:child_process';
import { access, mkdtemp, readdir, writeFile } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { DcRecError } from '../domain/errors';
import { CookProcessError, type CookRequest, type CookResult, type CookRunner } from './cookPort';

const STDERR_TAIL_LIMIT = 4000;

export interface RealCookOptions {
  /** Absolute path to cook.sh (DC_REC_COOK_PATH). */
  cookScriptPath: string;
  /** `unzip` binary; overridable for tests. */
  unzipBin?: string;
  /** Working-dir root; defaults to the OS temp dir. */
  tmpRoot?: string;
  /** Spawn timeout (ms) for cook + unzip. */
  timeoutMs?: number;
}

function run(cmd: string, args: string[], opts: { cwd?: string; outFile?: string; timeoutMs: number }): Promise<{ stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: opts.cwd });
    let stderr = '';
    const chunks: Buffer[] = [];
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new CookProcessError(`${path.basename(cmd)} timed out after ${opts.timeoutMs}ms`, null, stderr.slice(-STDERR_TAIL_LIMIT)));
    }, opts.timeoutMs);

    child.stdout.on('data', (d: Buffer) => {
      if (!opts.outFile) return; // discard when not capturing
      chunks.push(d);
    });
    child.stderr.on('data', (d: Buffer) => {
      stderr += d.toString('utf8');
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(new CookProcessError(`failed to spawn ${cmd}: ${err.message}`, null, stderr.slice(-STDERR_TAIL_LIMIT)));
    });
    child.on('close', async (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new CookProcessError(`${path.basename(cmd)} exited ${code}`, code, stderr.slice(-STDERR_TAIL_LIMIT)));
        return;
      }
      if (opts.outFile) {
        try {
          await writeFile(opts.outFile, Buffer.concat(chunks));
        } catch (err) {
          reject(new CookProcessError(`failed to write cook output: ${err instanceof Error ? err.message : String(err)}`, code, ''));
          return;
        }
      }
      resolve({ stderr });
    });
  });
}

export class RealCookRunner implements CookRunner {
  private readonly cookScriptPath: string;
  private readonly unzipBin: string;
  private readonly tmpRoot: string;
  private readonly timeoutMs: number;

  constructor(opts: RealCookOptions) {
    if (!path.isAbsolute(opts.cookScriptPath)) {
      throw new Error(`cookScriptPath must be absolute, got: ${opts.cookScriptPath}`);
    }
    this.cookScriptPath = opts.cookScriptPath;
    this.unzipBin = opts.unzipBin ?? 'unzip';
    this.tmpRoot = opts.tmpRoot ?? tmpdir();
    this.timeoutMs = opts.timeoutMs ?? 4 * 60 * 60 * 1000;
  }

  /** Verify cook.sh is present; throw the plan's cook_binary_missing diagnostic if not. */
  async assertReady(): Promise<void> {
    try {
      await access(this.cookScriptPath, fsConstants.X_OK);
    } catch {
      throw new DcRecError('cook_binary_missing', `cook.sh not found or not executable at ${this.cookScriptPath}`);
    }
  }

  async run(req: CookRequest): Promise<CookResult> {
    await this.assertReady();

    const workingDir = await mkdtemp(path.join(this.tmpRoot, `dc-rec-cook-${req.recordingId}-`));
    const zipPath = path.join(workingDir, `${req.recordingId}.zip`);

    // cook.sh <id> copy zip  -> per-speaker NN-<user>.ogg entries, zipped to stdout.
    await run(this.cookScriptPath, [req.recordingId, 'copy', 'zip'], { outFile: zipPath, timeoutMs: this.timeoutMs });

    // Extract into the working dir.
    const extractDir = path.join(workingDir, 'out');
    try {
      await run(this.unzipBin, ['-o', '-q', zipPath, '-d', extractDir], { timeoutMs: this.timeoutMs });
    } catch (err) {
      if (err instanceof CookProcessError && err.exitCode === null && /spawn/.test(err.message)) {
        throw new DcRecError('cook_binary_missing', `unzip is required but could not be run: ${err.message}`);
      }
      throw err;
    }

    const entryNames = (await readdir(extractDir)).filter((f) => f.endsWith('.ogg')).sort();
    const tracks = entryNames.map((entryName) => ({ entryName, filePath: path.join(extractDir, entryName) }));
    return { tracks, workingDir };
  }
}
