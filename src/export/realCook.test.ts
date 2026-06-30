// Tests for RealCookRunner.
//
// We don't depend on a real cook.sh, zip, or unzip. We point the runner at tiny
// stub scripts: a stub "cook.sh" (placed so its sibling rec/ dir is where raw
// files get staged) that asserts the staged raw files exist and writes a fake
// zip to stdout, and a stub "unzip" that materializes .ogg entries into -d.
// This exercises raw-file staging + spawn/capture/extract/cleanup + error
// mapping deterministically on any host (no Discord, no archive tooling).

import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DcRecError } from '../domain/errors';
import { RealCookRunner } from './realCook';

let dir: string;
let cookDir: string;
let rawDir: string;

function writeScript(name: string, body: string): string {
  const p = path.join(cookDir, name);
  writeFileSync(p, body, { mode: 0o755 });
  chmodSync(p, 0o755);
  return p;
}

function writeRawFiles(recordingId: string): void {
  for (const ext of ['data', 'header1', 'header2']) {
    writeFileSync(path.join(rawDir, `${recordingId}.ogg.${ext}`), `raw-${ext}`);
  }
}

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'dc-rec-realcook-'));
  cookDir = path.join(dir, 'cookhome');
  rawDir = path.join(dir, 'raw');
  mkdirSync(cookDir, { recursive: true });
  mkdirSync(rawDir, { recursive: true });
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('construction + assertReady', () => {
  it('throws cook_binary_missing when cook.sh is absent', async () => {
    const runner = new RealCookRunner({ cookScriptPath: path.join(cookDir, 'nope.sh'), rawDir });
    await expect(runner.assertReady()).rejects.toMatchObject({ code: 'cook_binary_missing' });
  });

  it('rejects a non-absolute cook path at construction', () => {
    expect(() => new RealCookRunner({ cookScriptPath: 'cook.sh', rawDir })).toThrow(/absolute/);
  });

  it('rejects a non-absolute rawDir at construction', () => {
    expect(() => new RealCookRunner({ cookScriptPath: path.join(cookDir, 'cook.sh'), rawDir: 'raw' })).toThrow(/absolute/);
  });
});

describe('run', () => {
  it('stages raw files into cook rec/, runs cook + unzip, returns sorted entries', async () => {
    writeRawFiles('rec1');
    // Stub cook asserts the staged raw file is visible in its rec/ cwd, then
    // emits a fake zip payload to stdout.
    const cook = writeScript(
      'cook.sh',
      [
        '#!/bin/sh',
        'set -e',
        '# mirror real cook.sh: cd to its own rec/ dir, where raw files were staged',
        'cd "$(dirname "$0")/rec"',
        'test -e "$1.ogg.data"',
        'printf FAKEZIP'
      ].join('\n') + '\n'
    );
    const unzip = writeScript(
      'unzip.sh',
      [
        '#!/bin/sh',
        'd=""',
        'while [ $# -gt 0 ]; do case "$1" in -d) d="$2"; shift 2 ;; *) shift ;; esac; done',
        'mkdir -p "$d"',
        'printf opus > "$d/2-456-Bee.ogg"',
        'printf opus > "$d/1-123-Air.ogg"'
      ].join('\n') + '\n'
    );

    const runner = new RealCookRunner({ cookScriptPath: cook, rawDir, unzipBin: unzip, tmpRoot: dir });
    const result = await runner.run({ recordingId: 'rec1' });

    expect(result.tracks.map((t) => t.entryName)).toEqual(['1-123-Air.ogg', '2-456-Bee.ogg']);
    for (const t of result.tracks) expect(existsSync(t.filePath)).toBe(true);
    // Staged raw files are cleaned out of the cook rec/ dir afterwards.
    expect(existsSync(path.join(cookDir, 'rec', 'rec1.ogg.data'))).toBe(false);
  });

  it('throws export_failed when a raw file is missing', async () => {
    // No raw files written.
    const cook = writeScript('cook.sh', '#!/bin/sh\nprintf FAKEZIP\n');
    const unzip = writeScript('unzip.sh', '#!/bin/sh\nexit 0\n');
    const runner = new RealCookRunner({ cookScriptPath: cook, rawDir, unzipBin: unzip, tmpRoot: dir });
    await expect(runner.run({ recordingId: 'rec1' })).rejects.toMatchObject({ code: 'export_failed' });
  });

  it('maps a non-zero cook exit to CookProcessError with stderr tail', async () => {
    writeRawFiles('rec1');
    const cook = writeScript('cook.sh', '#!/bin/sh\necho "oggtracks: bad header" >&2\nexit 3\n');
    const unzip = writeScript('unzip.sh', '#!/bin/sh\nexit 0\n');
    const runner = new RealCookRunner({ cookScriptPath: cook, rawDir, unzipBin: unzip, tmpRoot: dir });

    await expect(runner.run({ recordingId: 'rec1' })).rejects.toMatchObject({ name: 'CookProcessError', exitCode: 3 });
    writeRawFiles('rec1');
    await expect(runner.run({ recordingId: 'rec1' })).rejects.toMatchObject({ stderrTail: expect.stringContaining('bad header') });
  });

  it('maps a missing unzip binary to cook_binary_missing', async () => {
    writeRawFiles('rec1');
    const cook = writeScript('cook.sh', '#!/bin/sh\nprintf FAKEZIP\n');
    const runner = new RealCookRunner({ cookScriptPath: cook, rawDir, unzipBin: path.join(cookDir, 'no-such-unzip'), tmpRoot: dir });
    await expect(runner.run({ recordingId: 'rec1' })).rejects.toBeInstanceOf(DcRecError);
    writeRawFiles('rec1');
    await expect(runner.run({ recordingId: 'rec1' })).rejects.toMatchObject({ code: 'cook_binary_missing' });
  });
});
