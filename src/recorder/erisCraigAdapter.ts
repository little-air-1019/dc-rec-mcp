// Live Discord voice-receive adapter implementing CraigRecordingAdapter.
//
// This is the ONLY file that imports `eris`. It is constructed only at real
// boot (never in fake mode / CI), so importing eris here is side-effect free
// for the gate (verified: eris's top-level requires don't open sockets or
// register process handlers; crypto/UDP happen in the VoiceConnection
// constructor / READY handler).
//
// Behavior mirrors Craig's recorder for the parts that matter to multitrack
// capture:
//   - join with opusOnly so we store raw opus (no decode), exactly what the
//     OggWriter + cook.sh expect;
//   - receive('opus') gives (data, userID, timestamp); DROP packets whose
//     userID is undefined (SSRC not yet mapped to a user — eris emits these
//     before the SPEAKING event);
//   - strip a leading 0xbe 0xde RTP header extension before storing;
//   - assign one OGG track number per distinct user, writing headers + user
//     metadata the first time we see them.
//
// The live connection cannot be exercised by the automated gate; its real
// behavior is verified by the human-run two-speaker Discord e2e.

import type { Client, VoiceConnection, VoiceDataStream } from 'eris';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

import { DcRecError } from '../domain/errors';
import type { CraigRecordingAdapter, CraigStartContext, CraigStartResult } from './craigPort';
import type { DiscordLifecycle } from './discordLifecycle';
import { OggWriter, type OggChunk } from './oggWriter';
import { stripRtpExtension } from './rtp';

interface ActiveRecording {
  recordingId: string;
  guildId: string;
  channelId: string;
  writer: OggWriter;
  connection: VoiceConnection;
  stream: VoiceDataStream;
  /** userId -> track number (1-based). */
  trackByUser: Map<string, number>;
  /** userId -> next packet number (starts at 2, +2 per packet). */
  packetByUser: Map<string, number>;
  nextTrack: number;
  startHrtime: bigint;
}

export interface ErisCraigAdapterDeps {
  client: Client;
  /** Gateway lifecycle; start() awaits ensureReady() before joining voice. */
  lifecycle: DiscordLifecycle;
  /** Absolute dir for raw Craig files: `<runtimeDir>/raw`. */
  rawDir: string;
}

export class ErisCraigAdapter implements CraigRecordingAdapter {
  private readonly client: Client;
  private readonly lifecycle: DiscordLifecycle;
  private readonly rawDir: string;
  /** One active recording per recordingId (MeetingRecorder enforces per-guild). */
  private readonly active = new Map<string, ActiveRecording>();

  constructor(deps: ErisCraigAdapterDeps) {
    this.client = deps.client;
    this.lifecycle = deps.lifecycle;
    this.rawDir = deps.rawDir;
  }

  async start(ctx: CraigStartContext): Promise<CraigStartResult> {
    // The gateway connects in the background at boot; make sure it's ready
    // before we try to join voice (joinVoiceChannel needs the ready shard).
    await this.lifecycle.ensureReady();

    await mkdir(this.rawDir, { recursive: true });
    const base = path.join(this.rawDir, `${ctx.recordingId}.ogg`);
    const writer = new OggWriter(base);

    let connection: VoiceConnection;
    try {
      connection = await this.client.joinVoiceChannel(ctx.voiceChannelId, { opusOnly: true, selfMute: true, selfDeaf: false });
    } catch (err) {
      await writer.end().catch(() => undefined);
      throw new DcRecError('voice_channel_not_found', `failed to join voice channel ${ctx.voiceChannelId}: ${err instanceof Error ? err.message : String(err)}`, {
        guildId: ctx.guildId
      });
    }

    const stream = connection.receive('opus');
    const rec: ActiveRecording = {
      recordingId: ctx.recordingId,
      guildId: ctx.guildId,
      channelId: ctx.voiceChannelId,
      writer,
      connection,
      stream,
      trackByUser: new Map(),
      packetByUser: new Map(),
      nextTrack: 1,
      startHrtime: process.hrtime.bigint()
    };
    this.active.set(ctx.recordingId, rec);

    stream.on('data', (data: Buffer, userID: string, timestamp: number) => {
      this.onData(rec, data, userID, timestamp);
    });

    return { rawCraigRecordingBase: base };
  }

  async stop(recordingId: string): Promise<void> {
    const rec = this.active.get(recordingId);
    if (!rec) {
      throw new DcRecError('recording_not_found', `no active live recording ${recordingId}`, { recordingId });
    }
    this.active.delete(recordingId);

    rec.stream.removeAllListeners('data');
    try {
      this.client.leaveVoiceChannel(rec.channelId);
    } catch {
      // Best effort: if we're already disconnected, still finalize the writer.
    }
    // Finalize the raw files so cook.sh can read a complete recording.
    await rec.writer.end();
  }

  private onData(rec: ActiveRecording, data: Buffer, userID: string, timestamp: number): void {
    // Drop early packets whose SSRC hasn't been mapped to a user yet.
    if (!userID) return;

    const opus = stripRtpExtension(data);

    let track = rec.trackByUser.get(userID);
    if (track === undefined) {
      track = rec.nextTrack++;
      rec.trackByUser.set(userID, track);
      rec.packetByUser.set(userID, 2);
      rec.writer.writeUserHeader(track);
      rec.writer.writeUser(track, this.userMeta(userID));
    }

    const packetNo = rec.packetByUser.get(userID) ?? 2;
    const time = Number(process.hrtime.bigint() - rec.startHrtime) / 1e6; // ms since start
    const chunk: OggChunk = { data: opus, timestamp, time: Math.round(time) };
    rec.writer.writeChunk(track, packetNo, chunk, opus);
    rec.packetByUser.set(userID, packetNo + 2);
  }

  /** Resolve user metadata from the client cache (best effort). */
  private userMeta(userID: string) {
    const user = this.client.users.get(userID);
    return {
      id: userID,
      username: user?.username ?? 'Unknown',
      discriminator: user?.discriminator ?? '0',
      ...(user?.globalName !== undefined ? { globalName: user.globalName } : {})
    };
  }
}
