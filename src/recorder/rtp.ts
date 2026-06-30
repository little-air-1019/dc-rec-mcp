// Pure RTP helpers used by the live voice adapter. Kept dependency-free (no
// eris import) so the logic is testable without loading the Discord client.

/**
 * Discord may prepend an RTP header extension (starts with 0xbe 0xde). Strip it
 * so we store pure opus, matching Craig's encodeChunk.
 */
export function stripRtpExtension(buffer: Buffer): Buffer {
  if (buffer.length > 4 && buffer[0] === 0xbe && buffer[1] === 0xde) {
    const rtpHLen = buffer.readUInt16BE(2);
    let off = 4;
    for (let rhs = 0; rhs < rtpHLen && off < buffer.length; rhs++) {
      const byte = buffer[off];
      if (byte === undefined) break;
      const subLen = (byte & 0x0f) + 2;
      off += subLen;
    }
    while (off < buffer.length && buffer[off] === 0) off++;
    if (off >= buffer.length) off = buffer.length;
    return buffer.subarray(off);
  }
  return buffer;
}
