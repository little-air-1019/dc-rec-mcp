// Discord client lifecycle, kept separate from sync DI so boot.ts stays
// network-free and testable. The real implementation wraps an Eris client; a
// factory seam lets boot inject a fake in tests.
//
// Connect strategy (per design): the MCP server goes online first, then the
// gateway connects in the background; ErisCraigAdapter.start awaits
// ensureReady() before joining voice.

import Eris, { type Client } from 'eris';

export interface DiscordLifecycle {
  /** Open the gateway and resolve once the client is ready. Idempotent. */
  connect(): Promise<void>;
  /** Await the in-flight/last connect, starting one if none has begun. */
  ensureReady(): Promise<void>;
  /** Close the gateway. */
  disconnect(): Promise<void>;
  readonly ready: boolean;
}

/** Factory seam so boot/tests can supply a fake client + lifecycle. */
export interface DiscordDepsFactory {
  createClient(token: string): Client;
  createLifecycle(client: Client): DiscordLifecycle;
}

export class ErisDiscordLifecycle implements DiscordLifecycle {
  private connectPromise: Promise<void> | null = null;
  private _ready = false;

  constructor(private readonly client: Client) {}

  get ready(): boolean {
    return this._ready;
  }

  connect(): Promise<void> {
    if (this.connectPromise) return this.connectPromise;
    this.connectPromise = new Promise<void>((resolve, reject) => {
      const onReady = () => {
        this._ready = true;
        this.client.removeListener('error', onError);
        resolve();
      };
      const onError = (err: Error) => {
        this.client.removeListener('ready', onReady);
        reject(err);
      };
      this.client.once('ready', onReady);
      this.client.once('error', onError);
      this.client.connect().catch(reject);
    });
    return this.connectPromise;
  }

  ensureReady(): Promise<void> {
    return this.connect();
  }

  async disconnect(): Promise<void> {
    this.client.disconnect({ reconnect: false });
    this._ready = false;
    this.connectPromise = null;
  }
}

/** Default factory: real Eris client + lifecycle. Imported only at real boot. */
export function createErisDepsFactory(): DiscordDepsFactory {
  return {
    createClient(token: string): Client {
      // eris is side-effect-free at import time (no sockets/handlers until the
      // VoiceConnection constructor / connect()), so a static import is safe.
      // dysnomia (CraigChat fork) puts intents under `gateway`, not top-level.
      // guilds + guildVoiceStates are what a record-only bot needs.
      return new Eris.Client(token, {
        gateway: { intents: ['guilds', 'guildVoiceStates'] },
        restMode: true
      });
    },
    createLifecycle(client: Client): DiscordLifecycle {
      return new ErisDiscordLifecycle(client);
    }
  };
}
