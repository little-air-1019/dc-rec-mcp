// Tests for buildRuntime()/buildFacade() environment selection.
//
// Real-mode wiring is tested with an injected fake Discord deps factory so no
// network connection happens and we can assert the lifecycle is constructed but
// never connected during build.

import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Client } from 'eris';
import { buildFacade, buildRuntime } from './boot';
import type { DiscordDepsFactory, DiscordLifecycle } from '../recorder/discordLifecycle';
import { FakeMeetingRecorder } from './fakeFacade';
import { RealMeetingRecorderFacade } from './realFacade';

let runtimeDir: string;
let outputRoot: string;
let cookPath: string;

beforeEach(() => {
  runtimeDir = mkdtempSync(path.join(tmpdir(), 'dc-rec-boot-rt-'));
  outputRoot = mkdtempSync(path.join(tmpdir(), 'dc-rec-boot-out-'));
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

/** A fake Discord deps factory that never touches the network. */
function fakeFactory() {
  const connect = vi.fn().mockResolvedValue(undefined);
  const ensureReady = vi.fn().mockResolvedValue(undefined);
  const lifecycle: DiscordLifecycle = { connect, ensureReady, disconnect: vi.fn().mockResolvedValue(undefined), ready: false };
  const createClient = vi.fn().mockReturnValue({} as unknown as Client);
  const createLifecycle = vi.fn().mockReturnValue(lifecycle);
  const factory: DiscordDepsFactory = { createClient, createLifecycle };
  return { factory, lifecycle, connect, ensureReady, createClient, createLifecycle };
}

describe('fake mode', () => {
  it('returns a FakeMeetingRecorder and no lifecycle, never building a client', () => {
    const { factory, createClient } = fakeFactory();
    const rt = buildRuntime({ DC_REC_TEST_MODE: 'fake' }, factory);
    expect(rt.facade).toBeInstanceOf(FakeMeetingRecorder);
    expect(rt.lifecycle).toBeUndefined();
    expect(createClient).not.toHaveBeenCalled();
    // back-compat wrapper
    expect(buildFacade({ DC_REC_TEST_MODE: 'fake' }, factory)).toBeInstanceOf(FakeMeetingRecorder);
  });
});

describe('real mode', () => {
  it('builds a real facade + lifecycle and does NOT connect during build', () => {
    const { factory, connect, ensureReady, createClient, createLifecycle } = fakeFactory();
    const rt = buildRuntime(realEnv(), factory);
    expect(rt.facade).toBeInstanceOf(RealMeetingRecorderFacade);
    expect(rt.lifecycle).toBeDefined();
    expect(createClient).toHaveBeenCalledOnce();
    expect(createLifecycle).toHaveBeenCalledOnce();
    // Build is network-free.
    expect(connect).not.toHaveBeenCalled();
    expect(ensureReady).not.toHaveBeenCalled();
  });

  it('accepts the plain DISCORD_BOT_TOKEN name too', () => {
    const { factory } = fakeFactory();
    const env = realEnv({ DC_REC_DISCORD_TOKEN: undefined, DISCORD_BOT_TOKEN: 'tok' });
    expect(buildRuntime(env, factory).facade).toBeInstanceOf(RealMeetingRecorderFacade);
  });

  it('requires a token', () => {
    const { factory } = fakeFactory();
    expect(() => buildRuntime(realEnv({ DC_REC_DISCORD_TOKEN: undefined }), factory)).toThrow(/DISCORD/);
  });

  it('requires DC_REC_COOK_PATH with cook_binary_missing', () => {
    const { factory } = fakeFactory();
    try {
      buildRuntime(realEnv({ DC_REC_COOK_PATH: undefined }), factory);
      throw new Error('should have thrown');
    } catch (e) {
      expect((e as { code?: string }).code).toBe('cook_binary_missing');
    }
  });

  it('fails with cook_binary_missing when cook.sh is a typo / not executable', () => {
    const { factory } = fakeFactory();
    try {
      buildRuntime(realEnv({ DC_REC_COOK_PATH: path.join(runtimeDir, 'does-not-exist.sh') }), factory);
      throw new Error('should have thrown');
    } catch (e) {
      expect((e as { code?: string }).code).toBe('cook_binary_missing');
    }
  });

  it('requires absolute runtime/output paths', () => {
    const { factory } = fakeFactory();
    expect(() => buildRuntime(realEnv({ DC_REC_RUNTIME_DIR: 'relative' }), factory)).toThrow(/absolute/);
    expect(() => buildRuntime(realEnv({ DC_REC_OUTPUT_ROOT: 'relative' }), factory)).toThrow(/absolute/);
  });
});
