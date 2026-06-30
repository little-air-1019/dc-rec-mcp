// Tests for RealCookRunner.
//
// We don't depend on a real cook.sh, zip, or unzip. Instead we point the runner
// at tiny stub scripts: a stub "cook.sh" that writes a fake zip to stdout, and a
// stub "unzip" that materializes .ogg entries into the -d dir. This exercises
// the spawn/capture/extract/cleanup orchestration and error mapping
// deterministically on any host (no live Discord, no archive tooling).

import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DcRecError } from '../domain/errors';
import { RealCookRunner } from './realCook';

let dir: string;

function writeScript(name: string, body: string): string {
  const p = path.join(dir, name);
  writeFileSync(p, body, { mode: 0o755 });
  chmodSync(p, 0o755);
  return p;
}

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'dc-rec-realcook-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('assertReady', () => {
  it('throws cook_binary_missing when cook.sh is absent', async () => {
    const runner = new RealCookRunner({ cookScriptPath: path.join(dir, 'nope.sh') });
    await expect(runner.assertReady()).rejects.toMatchObject({ code: 'cook_binary_missing' });
  });

  it('rejects a non-absolute cook path at construction', () => {
    expect(() => new RealCookRunner({ cookScriptPath: 'cook.sh' })).toThrow(/absolute/);
  });
});

describe('run', () => {
  it('runs cook + unzip and returns sorted .ogg entries, then cleans up', async () => {
    const cook = writeScript('cook.sh', '#!/bin/sh\n# emit a fake zip payload to stdout\nprintf "FAKEZIP"\n');
    // Stub unzip: args are `-o -q <zip> -d <extractDir>`; create two .ogg files.
    const unzip = writeScript(
      'unzip.sh',
      [
        '#!/bin/sh',
        'd=""',
        'while [ $# -gt 0 ]; do',
        '  case "$1" in',
        '    -d) d="$2"; shift 2 ;;',
        '    *) shift ;;',
        '  esac',
        'done',
        'mkdir -p "$d"',
        'printf opus > "$d/2-456-Bee.ogg"',
        'printf opus > "$d/1-123-Air.ogg"'
      ].join('\n') + '\n'
    );

    const runner = new RealCookRunner({ cookScriptPath: cook, unzipBin: unzip, tmpRoot: dir });
    const result = await runner.run({ recordingId: 'rec1' });

    expect(result.tracks.map((t) => t.entryName)).toEqual(['1-123-Air.ogg', '2-456-Bee.ogg']);
    for (const t of result.tracks) expect(existsSync(t.filePath)).toBe(true);
    expect(result.workingDir.startsWith(dir)).toBe(true);
  });

  it('maps a non-zero cook exit to CookProcessError with stderr tail', async () => {
    const cook = writeScript('cook.sh', '#!/bin/sh\necho "oggtracks: bad header" >&2\nexit 3\n');
    const unzip = writeScript('unzip.sh', '#!/bin/sh\nexit 0\n');
    const runner = new RealCookRunner({ cookScriptPath: cook, unzipBin: unzip, tmpRoot: dir });

    await expect(runner.run({ recordingId: 'rec1' })).rejects.toMatchObject({
      name: 'CookProcessError',
      exitCode: 3
    });
    await expect(runner.run({ recordingId: 'rec1' })).rejects.toMatchObject({
      stderrTail: expect.stringContaining('bad header')
    });
  });

  it('maps a missing unzip binary to cook_binary_missing', async () => {
    const cook = writeScript('cook.sh', '#!/bin/sh\nprintf "FAKEZIP"\n');
    const runner = new RealCookRunner({
      cookScriptPath: cook,
      unzipBin: path.join(dir, 'no-such-unzip'),
      tmpRoot: dir
    });
    await expect(runner.run({ recordingId: 'rec1' })).rejects.toBeInstanceOf(DcRecError);
    await expect(runner.run({ recordingId: 'rec1' })).rejects.toMatchObject({ code: 'cook_binary_missing' });
  });
});
