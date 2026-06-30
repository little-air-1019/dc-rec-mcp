import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { manifestPath, rawAudioDir, sanitizeForFilename, trackFileName } from './outputPaths';

describe('rawAudioDir', () => {
  it('builds the canonical <YYYY-MM>/<type>/raw audio/<date> path', () => {
    expect(rawAudioDir('/out', 'stand-up', '2026-06-29')).toBe(path.join('/out', '2026-06', 'stand-up', 'raw audio', '2026-06-29'));
  });

  it('rejects a non-absolute output root', () => {
    expect(() => rawAudioDir('out', 'stand-up', '2026-06-29')).toThrow(/absolute/);
  });

  it('rejects a malformed date', () => {
    expect(() => rawAudioDir('/out', 'stand-up', '2026/06/29')).toThrow(/YYYY-MM-DD/);
  });

  it('is stable: same inputs -> same path', () => {
    expect(rawAudioDir('/out', 'weekly', '2026-01-02')).toBe(rawAudioDir('/out', 'weekly', '2026-01-02'));
  });
});

describe('manifestPath', () => {
  it('puts recording-manifest.json inside the dir', () => {
    expect(manifestPath('/out/2026-06/stand-up/raw audio/2026-06-29')).toBe('/out/2026-06/stand-up/raw audio/2026-06-29/recording-manifest.json');
  });
});

describe('sanitizeForFilename', () => {
  it('preserves spaces and unicode', () => {
    expect(sanitizeForFilename('Air Bud 日本語')).toBe('Air Bud 日本語');
  });

  it('strips path separators', () => {
    expect(sanitizeForFilename('a/b\\c')).toBe('a b c');
  });

  it('strips leading dots so no hidden/traversal names', () => {
    expect(sanitizeForFilename('..')).toBe('unknown');
    expect(sanitizeForFilename('.hidden')).toBe('hidden');
  });

  it('collapses to "unknown" when nothing usable remains', () => {
    expect(sanitizeForFilename('   ')).toBe('unknown');
    expect(sanitizeForFilename('')).toBe('unknown');
  });

  it('removes control characters', () => {
    const withControls = `a${String.fromCharCode(0)}b${String.fromCharCode(7)}c`;
    expect(sanitizeForFilename(withControls)).toBe('a b c');
  });
});

describe('trackFileName', () => {
  it('zero-pads the ordinal and joins userId + displayName', () => {
    expect(trackFileName(1, '123', 'Air')).toBe('01-123-Air.ogg');
    expect(trackFileName(12, '456', 'Bee Bee')).toBe('12-456-Bee Bee.ogg');
  });

  it('never lets a malicious display name escape the filename', () => {
    const name = trackFileName(1, '123', '../../etc/passwd');
    expect(name).toBe('01-123-etc passwd.ogg');
    expect(name).not.toContain('/');
    expect(name).not.toContain('..');
  });
});
