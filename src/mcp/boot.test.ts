// Tests for buildFacade() environment selection.

import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildFacade } from './boot';
import { FakeMeetingRecorder } from './fakeFacade';
import { RealMeetingRecorderFacade } from './realFacade';

let runtimeDir: string;
let outputRoot: string;
let cookPath: string;

beforeEach(() => {
  runtimeDir = mkdtempSync(path.join(tmpdir(), 'dc-rec-boot-rt-'));
  outputRoot = mkdtempSync(path.join(tmpdir(), 'dc-rec-boot-out-'));
  // An executable stub cook.sh so real-mode boot's executability check passes.
  cookPath = path.join(runtimeDir, 'cook.sh');
  writeFileSync(cookPath, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  chmodSync(cookPath, 0o755);
});

afterEach(() => {
  rmSync(runtimeDir, { recursive: true, force: true });
  rmSync(outputRoot, { recursive: true, force: true });
});

function realEnv(over: Record<string, string | undefined> = {}) {
  return {
    DC_REC_DISCORD_TOKEN: 'token',
    DC_REC_RUNTIME_DIR: runtimeDir,
    DC_REC_OUTPUT_ROOT: outputRoot,
    DC_REC_COOK_PATH: cookPath,
    ...over
  };
}

describe('fake mode', () => {
  it('returns a FakeMeetingRecorder', () => {
    expect(buildFacade({ DC_REC_TEST_MODE: 'fake' })).toBeInstanceOf(FakeMeetingRecorder);
  });
});

describe('real mode', () => {
  it('builds a real facade when all config is present', () => {
    expect(buildFacade(realEnv())).toBeInstanceOf(RealMeetingRecorderFacade);
  });

  it('requires DC_REC_DISCORD_TOKEN', () => {
    expect(() => buildFacade(realEnv({ DC_REC_DISCORD_TOKEN: undefined }))).toThrow(/DC_REC_DISCORD_TOKEN/);
  });

  it('requires DC_REC_COOK_PATH with cook_binary_missing', () => {
    try {
      buildFacade(realEnv({ DC_REC_COOK_PATH: undefined }));
      throw new Error('should have thrown');
    } catch (e) {
      expect((e as { code?: string }).code).toBe('cook_binary_missing');
    }
  });

  it('fails boot with cook_binary_missing when cook.sh is a typo / not executable', () => {
    try {
      buildFacade(realEnv({ DC_REC_COOK_PATH: path.join(runtimeDir, 'does-not-exist.sh') }));
      throw new Error('should have thrown');
    } catch (e) {
      expect((e as { code?: string }).code).toBe('cook_binary_missing');
    }
  });

  it('requires absolute runtime/output paths', () => {
    expect(() => buildFacade(realEnv({ DC_REC_RUNTIME_DIR: 'relative' }))).toThrow(/absolute/);
    expect(() => buildFacade(realEnv({ DC_REC_OUTPUT_ROOT: 'relative' }))).toThrow(/absolute/);
  });

  it('real-mode start fails loudly (live Eris adapter not wired)', async () => {
    const facade = buildFacade(realEnv());
    await expect(
      facade.start({ guildId: 'g1', voiceChannelId: 'v1', requesterUserId: 'u1', textChannelId: 't1', type: 'stand-up', date: '2026-06-29' })
    ).rejects.toMatchObject({ code: 'recording_not_active' });
  });
});
