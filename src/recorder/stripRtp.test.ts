// Unit test for the pure RTP-extension stripping used by ErisCraigAdapter.
// stripRtpExtension lives in its own eris-free module (rtp.ts), so this test
// never loads the Discord client.

import { describe, expect, it } from 'vitest';

import { stripRtpExtension } from './rtp';

describe('stripRtpExtension', () => {
  it('returns the buffer unchanged when there is no 0xbe 0xde extension', () => {
    const opus = Buffer.from([0x01, 0x02, 0x03, 0x04, 0x05]);
    expect(stripRtpExtension(opus).equals(opus)).toBe(true);
  });

  it('strips a one-entry RTP header extension and trailing padding', () => {
    // 0xbe 0xde | length=1 (one ext entry) | entry: id/len byte 0x00 => subLen 2
    // -> header bytes: be de 00 01 [00 xx] then zero padding, then opus.
    const buf = Buffer.from([0xbe, 0xde, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0xaa, 0xbb, 0xcc]);
    const out = stripRtpExtension(buf);
    // Everything up to the first non-zero opus byte is removed.
    expect(out.equals(Buffer.from([0xaa, 0xbb, 0xcc]))).toBe(true);
  });

  it('does not over-read a short buffer', () => {
    const buf = Buffer.from([0xbe, 0xde]);
    // length <= 4 guard: returned unchanged.
    expect(stripRtpExtension(buf).equals(buf)).toBe(true);
  });
});
