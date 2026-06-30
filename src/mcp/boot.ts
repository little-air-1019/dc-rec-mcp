// Boot selection: build the runtime (facade + optional Discord lifecycle) for
// the current environment.
//
//   DC_REC_TEST_MODE=fake  -> FakeMeetingRecorder, no Discord (what the
//                             validate.sh MCP smoke gate runs).
//   otherwise              -> RealMeetingRecorderFacade wired with the state
//                             store, RealCookRunner, and a live ErisCraigAdapter.
//                             buildRuntime stays SYNCHRONOUS and never touches
//                             the network: it constructs the Eris client but
//                             does not connect it. index.ts connects the gateway
//                             in the background after the MCP server is online;
//                             ErisCraigAdapter.start awaits lifecycle.ensureReady.
//
// Discord deps come through a factory seam so tests inject a fake client +
// lifecycle and assert wiring without a real connection.

import { accessSync, constants as fsConstants } from 'node:fs';
import path from 'node:path';

import { DcRecError } from '../domain/errors';
import { RecordingExporter } from '../export/recordingExporter';
import { RealCookRunner } from '../export/realCook';
import { ErisCraigAdapter } from '../recorder/erisCraigAdapter';
import { createErisDepsFactory, type DiscordDepsFactory, type DiscordLifecycle } from '../recorder/discordLifecycle';
import { MeetingRecorder } from '../recorder/meetingRecorder';
import { FileMeetingStateStore } from '../state/fileStore';
import { FakeMeetingRecorder } from './fakeFacade';
import { RealMeetingRecorderFacade } from './realFacade';
import type { MeetingRecorderFacade } from './recorderPort';

export interface BootEnv {
  DC_REC_TEST_MODE?: string;
  // Dedicated token (open question #2). The local .env uses Craig's names, so
  // accept both DC_REC_DISCORD_* and the plain DISCORD_* forms.
  DC_REC_DISCORD_TOKEN?: string;
  DISCORD_BOT_TOKEN?: string;
  DC_REC_RUNTIME_DIR?: string;
  DC_REC_OUTPUT_ROOT?: string;
  DC_REC_COOK_PATH?: string;
}

export interface Runtime {
  facade: MeetingRecorderFacade;
  /** Present only in real mode; index.ts connects this in the background. */
  lifecycle?: DiscordLifecycle;
}

function requireAbsolute(name: string, value: string | undefined): string {
  if (!value) throw new DcRecError('recording_not_found', `${name} is required in non-fake mode`);
  if (!path.isAbsolute(value)) throw new DcRecError('recording_not_found', `${name} must be an absolute path, got: ${value}`);
  return value;
}

/**
 * Build the runtime. Synchronous and network-free: in real mode it constructs
 * (but does not connect) the Discord client.
 */
export function buildRuntime(env: BootEnv = process.env, depsFactory: DiscordDepsFactory = createErisDepsFactory()): Runtime {
  if (env.DC_REC_TEST_MODE === 'fake') {
    return { facade: new FakeMeetingRecorder() };
  }

  const token = env.DC_REC_DISCORD_TOKEN ?? env.DISCORD_BOT_TOKEN;
  if (!token) {
    throw new DcRecError('recording_not_found', 'DC_REC_DISCORD_TOKEN (or DISCORD_BOT_TOKEN) is required in non-fake mode');
  }
  const runtimeDir = requireAbsolute('DC_REC_RUNTIME_DIR', env.DC_REC_RUNTIME_DIR);
  const outputRoot = requireAbsolute('DC_REC_OUTPUT_ROOT', env.DC_REC_OUTPUT_ROOT);
  if (!env.DC_REC_COOK_PATH) {
    throw new DcRecError('cook_binary_missing', 'DC_REC_COOK_PATH is required in non-fake mode');
  }
  const cookScriptPath = requireAbsolute('DC_REC_COOK_PATH', env.DC_REC_COOK_PATH);
  // Startup diagnostic: cook.sh must exist and be executable (plan config rule).
  try {
    accessSync(cookScriptPath, fsConstants.X_OK);
  } catch {
    throw new DcRecError('cook_binary_missing', `cook.sh not found or not executable at ${cookScriptPath}`);
  }

  const rawDir = path.join(runtimeDir, 'raw');
  const store = new FileMeetingStateStore(runtimeDir);

  const client = depsFactory.createClient(token);
  const lifecycle = depsFactory.createLifecycle(client);
  const craig = new ErisCraigAdapter({ client, lifecycle, rawDir });

  const recorder = new MeetingRecorder({ store, craig });
  const cook = new RealCookRunner({ cookScriptPath, rawDir });
  const exporter = new RecordingExporter({
    cook,
    outputRoot,
    usersFilePathFor: (rec) => path.join(rawDir, `${rec.recordingId}.ogg.users`)
  });

  return { facade: new RealMeetingRecorderFacade({ recorder, exporter, store }), lifecycle };
}

/** Back-compat wrapper: just the facade. */
export function buildFacade(env: BootEnv = process.env, depsFactory?: DiscordDepsFactory): MeetingRecorderFacade {
  return buildRuntime(env, depsFactory).facade;
}
