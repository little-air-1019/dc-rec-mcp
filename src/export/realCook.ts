// Real CookRunner: runs Craig's cook.sh and extracts per-speaker .ogg files.
//
// Strategy (open question #1): `cook.sh <id> copy zip` produces a zip of
// NN-<user>.ogg tracks streamed to stdout; we capture it, extract with the
// system `unzip`, and hand the entries to RecordingExporter. cook.sh is left
// untouched. Discord is not involved here, so this is unit-testable with a
// stub cook.sh + a real zip.

import { spawn } from 'node:child_process';
import { access, copyFile, mkdir, mkdtemp, readdir, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { DcRecError } from '../domain/errors';
import { CookProcessError, type CookRequest, type CookResult, type CookRunner } from './cookPort';

const STDERR_TAIL_LIMIT = 4000;

/** The raw Craig files cook.sh reads for a recording (from its own rec/ dir). */
const RAW_EXTS = ['data', 'header1', 'header2'] as const;

export interface RealCookOptions {
  /** Absolute path to cook.sh (DC_REC_COOK_PATH). */
  cookScriptPath: string;
  /**
   * Absolute dir holding the bot's raw Craig files (`<id>.ogg.{data,header1,
   * header2,...}`), i.e. DC_REC_RUNTIME_DIR/raw. cook.sh hard-cds to
   * `<dirname(cook.sh)>/rec` and reads `<id>.ogg.*` from there, so the runner
   * bridges the raw files into that rec/ dir before invoking cook.
   */
  rawDir: string;
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
  private readonly rawDir: string;
  private readonly recDir: string;
  private readonly unzipBin: string;
  private readonly tmpRoot: string;
  private readonly timeoutMs: number;

  constructor(opts: RealCookOptions) {
    if (!path.isAbsolute(opts.cookScriptPath)) {
      throw new Error(`cookScriptPath must be absolute, got: ${opts.cookScriptPath}`);
    }
    if (!path.isAbsolute(opts.rawDir)) {
      throw new Error(`rawDir must be absolute, got: ${opts.rawDir}`);
    }
    this.cookScriptPath = opts.cookScriptPath;
    this.rawDir = opts.rawDir;
    // cook.sh does `cd "$(dirname cook.sh)/rec"` and reads <id>.ogg.* there.
    this.recDir = path.join(path.dirname(opts.cookScriptPath), 'rec');
    this.unzipBin = opts.unzipBin ?? 'unzip';
    this.tmpRoot = opts.tmpRoot ?? tmpdir();
    this.timeoutMs = opts.timeoutMs ?? 4 * 60 * 60 * 1000;
  }

  /**
   * Bridge the bot's raw files into cook's rec/ dir so `cook.sh <id>` finds
   * them. Prefer symlinks (cheap; cook only reads + flocks them); fall back to
   * a copy if the filesystem rejects symlinks. Returns the staged paths to
   * clean up afterwards.
   */
  private async stageRawFiles(recordingId: string): Promise<string[]> {
    await mkdir(this.recDir, { recursive: true });
    const staged: string[] = [];
    for (const ext of RAW_EXTS) {
      const src = path.join(this.rawDir, `${recordingId}.ogg.${ext}`);
      const dest = path.join(this.recDir, `${recordingId}.ogg.${ext}`);
      try {
        await access(src, fsConstants.R_OK);
      } catch {
        throw new DcRecError('export_failed', `raw recording file missing: ${src}`, { recordingId });
      }
      // Replace any stale staged file first.
      await unlink(dest).catch(() => undefined);
      try {
        await symlink(src, dest);
      } catch {
        await copyFile(src, dest);
      }
      staged.push(dest);
    }
    return staged;
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

    // Bridge the bot's raw files into cook's rec/ dir so `cook.sh <id>` finds
    // them, then clean the staged files up regardless of outcome.
    const staged = await this.stageRawFiles(req.recordingId);
    try {
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
    } catch (err) {
      // On failure, clean the working dir too (success path leaves it for the
      // exporter, which cleans it up).
      await rm(workingDir, { recursive: true, force: true }).catch(() => undefined);
      throw err;
    } finally {
      await Promise.all(staged.map((p) => unlink(p).catch(() => undefined)));
    }
  }
}
