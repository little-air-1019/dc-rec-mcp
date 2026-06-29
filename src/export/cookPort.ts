// The cook port: runs Craig's cook.sh and yields per-speaker .ogg entries.
//
// RecordingExporter depends on this interface, not on cook.sh or `unzip`
// directly. The real adapter (Slice 5 boot) runs `cook.sh <id> copy zip`,
// captures the zip, and extracts it via the system `unzip`. Tests inject a fake
// that returns pre-extracted entries, so the gate needs neither cook nor unzip.

/** One extracted per-speaker file from a cook `copy`/`zip` run. */
export interface CookedTrackFile {
  /**
   * The entry name cook produced, of the form `NN-<userinfo>.ogg` (or
   * `NN.ogg` when the user was unknown). The leading NN is the Craig track
   * number, which the exporter joins against `.ogg.users`.
   */
  entryName: string;
  /** Absolute path to the extracted file on local disk. */
  filePath: string;
}

export interface CookRequest {
  /** Craig recording id (names the `.ogg.*` raw files). */
  recordingId: string;
}

export interface CookResult {
  /** Per-speaker files, one per recorded track. */
  tracks: CookedTrackFile[];
  /** Absolute path to the working dir holding the extracted files (caller cleans up). */
  workingDir: string;
}

/**
 * Thrown by a CookRunner when the cook process itself fails. The exporter maps
 * this to a typed `export_failed` with the diagnostic detail attached.
 */
export class CookProcessError extends Error {
  readonly exitCode: number | null;
  readonly stderrTail: string;

  constructor(message: string, exitCode: number | null, stderrTail: string) {
    super(message);
    this.name = 'CookProcessError';
    this.exitCode = exitCode;
    this.stderrTail = stderrTail;
    Object.setPrototypeOf(this, CookProcessError.prototype);
  }
}

/** Runs cook for one recording and returns extracted per-speaker .ogg files. */
export interface CookRunner {
  run(req: CookRequest): Promise<CookResult>;
}
