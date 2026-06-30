// Tests for the ported multitrack OGG writer.
//
// These prove the byte-level output matches what cook.sh/oggtracks read:
// OggS magic, per-track stream numbers, BOS on the first header page, and the
// data layout (each opus packet -> a data page + an empty timestamp page). We
// parse the files back with a minimal OggS page reader rather than trusting the
// writer blindly.

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { OggWriter, OPUS_HEADERS } from './oggWriter';

interface OggPage {
  flags: number;
  granulePos: number;
  streamNo: number;
  packetNo: number;
  body: Buffer;
}

/** Parse a concatenation of OggS pages (enough of the spec for our own output). */
function parseOggPages(buf: Buffer): OggPage[] {
  const pages: OggPage[] = [];
  let off = 0;
  while (off + 27 <= buf.length) {
    expect(buf.toString('latin1', off, off + 4)).toBe('OggS');
    const flags = buf.readUInt8(off + 5);
    const granulePos = buf.readUIntLE(off + 6, 6);
    const streamNo = buf.readUInt32LE(off + 14);
    const packetNo = buf.readUInt32LE(off + 18);
    const segCount = buf.readUInt8(off + 26);
    const segTable = buf.subarray(off + 27, off + 27 + segCount);
    let bodyLen = 0;
    for (const s of segTable) bodyLen += s;
    const bodyStart = off + 27 + segCount;
    pages.push({ flags, granulePos, streamNo, packetNo, body: buf.subarray(bodyStart, bodyStart + bodyLen) });
    off = bodyStart + bodyLen;
  }
  return pages;
}

let dir: string;
let base: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'dc-rec-oggw-'));
  base = path.join(dir, 'rec1.ogg');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function read(ext: string): Buffer {
  return readFileSync(`${base}.${ext}`);
}

describe('OggWriter', () => {
  it('writes OpusHead/OpusTags header pages per track with BOS on header1', async () => {
    const w = new OggWriter(base);
    w.writeUserHeader(1);
    w.writeUser(1, { id: '123', username: 'air', discriminator: '0', globalName: 'Air' });
    w.writeUserHeader(2);
    w.writeUser(2, { id: '456', username: 'bee', discriminator: '0' });
    await w.end();

    const h1 = parseOggPages(read('header1'));
    const h2 = parseOggPages(read('header2'));

    expect(h1.map((p) => p.streamNo)).toEqual([1, 2]);
    // BOS flag (2) set on each track's first header page.
    expect(h1.every((p) => (p.flags & 2) === 2)).toBe(true);
    // header1 body is OpusHead, header2 body is OpusTags.
    expect(h1[0]!.body.equals(OPUS_HEADERS[0])).toBe(true);
    expect(h2[0]!.body.equals(OPUS_HEADERS[1])).toBe(true);
    expect(h2.map((p) => p.streamNo)).toEqual([1, 2]);
  });

  it('writes each opus packet as a data page + an empty timestamp page', async () => {
    const w = new OggWriter(base);
    w.writeUserHeader(1);
    const opusA = Buffer.from([0xaa, 0xbb, 0xcc]);
    const opusB = Buffer.from([0xdd, 0xee]);
    w.writeChunk(1, 2, { data: opusA, timestamp: 960, time: 10 }, opusA);
    w.writeChunk(1, 4, { data: opusB, timestamp: 1920, time: 20 }, opusB);
    await w.end();

    const data = parseOggPages(read('data'));
    // 2 packets -> 4 pages (data, ts, data, ts) at packetNos 2,3,4,5.
    expect(data.map((p) => p.packetNo)).toEqual([2, 3, 4, 5]);
    expect(data.every((p) => p.streamNo === 1)).toBe(true);
    // Data pages carry the opus bytes; timestamp pages are empty.
    expect(data[0]!.body.equals(opusA)).toBe(true);
    expect(data[1]!.body.length).toBe(0);
    expect(data[2]!.body.equals(opusB)).toBe(true);
    expect(data[3]!.body.length).toBe(0);
    // Data page granule is the chunk time; timestamp page granule is the ts.
    expect(data[0]!.granulePos).toBe(10);
    expect(data[1]!.granulePos).toBe(960);
  });

  it('produces a .users file parseable as the {<fragment>} JSON cook expects', async () => {
    const w = new OggWriter(base);
    w.writeUser(1, { id: '123', username: 'air', discriminator: '0', globalName: 'Air' });
    w.writeUser(2, { id: '456', username: 'bee', discriminator: '0' });
    await w.end();

    const text = read('users').toString('utf8');
    const parsed = JSON.parse(`{${text}}`) as Record<string, { id?: string; globalName?: string }>;
    expect(parsed['0']).toEqual({});
    expect(parsed['1']).toMatchObject({ id: '123', globalName: 'Air' });
    expect(parsed['2']).toMatchObject({ id: '456' });
  });
});
