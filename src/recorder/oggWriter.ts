// Minimal multitrack OGG writer for dc-rec-mcp.
//
// Ported and trimmed from Craig's writer.ts (read-only reference): only the
// raw Ogg-Opus path is kept — no webapp, notes, FLAC, VAD, or reward logic.
// It produces the file contract cook.sh / cook/oggtracks read:
//
//   <base>.header1  — per track: OPUS_HEADERS[0], granule 0, packet 0, BOS
//   <base>.header2  — per track: OPUS_HEADERS[1], packet 1
//   <base>.data     — per opus packet: the data packet (packetNo), then an
//                     empty timestamp packet (packetNo+1); packetNo += 2
//   <base>.users    — JSON fragment: "0":{} then one ,"<track>":{...} per user
//
// One OGG stream number per track. Discord opus is 48 kHz stereo.

import { createWriteStream, type WriteStream } from 'node:fs';

import OggEncoder, { BOS } from './ogg';

/** OpusHead / OpusTags, copied byte-for-byte from Craig (48 kHz, 2ch). */
export const OPUS_HEADERS: [Buffer, Buffer] = [
  Buffer.from([0x4f, 0x70, 0x75, 0x73, 0x48, 0x65, 0x61, 0x64, 0x01, 0x02, 0x00, 0x0f, 0x80, 0xbb, 0x00, 0x00, 0x00, 0x00, 0x00]),
  Buffer.from([
    0x4f, 0x70, 0x75, 0x73, 0x54, 0x61, 0x67, 0x73, 0x09, 0x00, 0x00, 0x00, 0x6e, 0x6f, 0x64, 0x65, 0x2d, 0x6f, 0x70, 0x75, 0x73, 0x00, 0x00, 0x00,
    0x00, 0xff
  ])
];

const EMPTY_BUFFER = Buffer.alloc(0);

/** Metadata stored per track in <base>.users. */
export interface OggWriterUser {
  id: string;
  username: string;
  discriminator: string;
  globalName?: string | null;
}

/** One captured opus packet plus its timing (mirrors Craig's Chunk). */
export interface OggChunk {
  data: Buffer;
  /** Discord packet timestamp (48 kHz samples). */
  timestamp: number;
  /** Monotonic packet time used as the data page granule. */
  time: number;
}

export class OggWriter {
  private readonly dataEncoder: OggEncoder;
  private readonly headerEncoder1: OggEncoder;
  private readonly headerEncoder2: OggEncoder;
  private readonly usersStream: WriteStream;
  private readonly streams: WriteStream[];
  private closed = false;

  /** @param base absolute path base, e.g. `<runtimeDir>/raw/<recordingId>.ogg` */
  constructor(base: string) {
    const data = createWriteStream(`${base}.data`);
    const h1 = createWriteStream(`${base}.header1`);
    const h2 = createWriteStream(`${base}.header2`);
    this.usersStream = createWriteStream(`${base}.users`);
    this.dataEncoder = new OggEncoder(data);
    this.headerEncoder1 = new OggEncoder(h1);
    this.headerEncoder2 = new OggEncoder(h2);
    this.streams = [data, h1, h2, this.usersStream];
    // Track 0 is a placeholder (matches Craig's getUsers expectations).
    this.usersStream.write('"0":{}\n');
  }

  /** Write the two Opus header pages for a newly-seen track. */
  writeUserHeader(trackNo: number): void {
    this.headerEncoder1.write(0, trackNo, 0, OPUS_HEADERS[0], BOS);
    this.headerEncoder2.write(0, trackNo, 1, OPUS_HEADERS[1]);
  }

  /** Append a track's user metadata line to <base>.users. */
  writeUser(trackNo: number, user: OggWriterUser): void {
    this.usersStream.write(`,"${trackNo}":${JSON.stringify(user)}\n`);
  }

  /**
   * Write one opus packet for a track: the data packet at `packetNo`, then an
   * empty timestamp-reference packet at `packetNo + 1`. Caller advances its
   * packet counter by 2.
   */
  writeChunk(trackNo: number, packetNo: number, chunk: OggChunk, opus: Buffer): void {
    this.dataEncoder.write(chunk.time, trackNo, packetNo, opus);
    this.dataEncoder.write(chunk.timestamp ? chunk.timestamp : 0, trackNo, packetNo + 1, EMPTY_BUFFER);
  }

  /** Flush and close all streams. Resolves once every stream has finished. */
  async end(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await Promise.all(
      this.streams.map(
        (s) =>
          new Promise<void>((resolve, reject) => {
            s.on('error', reject);
            s.end(resolve);
          })
      )
    );
  }
}
