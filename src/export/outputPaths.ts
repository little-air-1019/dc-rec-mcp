// Canonical output path + filename construction for finalized exports.
//
// Layout (plan "Local File Layout"):
//   <outputRoot>/<YYYY-MM>/<type>/raw audio/<YYYY-MM-DD>/
//     01-<userId>-<displayName>.ogg
//     recording-manifest.json
//
// Pure: node:path only. All path math lives here so the exporter stays thin and
// the "stable local paths" acceptance is unit-testable.

import path from 'node:path';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Build the canonical raw-audio directory for a recording.
 * @param outputRoot absolute DC_REC_OUTPUT_ROOT
 * @param type meeting type (already validated by the caller)
 * @param date `YYYY-MM-DD`
 */
export function rawAudioDir(outputRoot: string, type: string, date: string): string {
  if (!path.isAbsolute(outputRoot)) {
    throw new Error(`outputRoot must be absolute, got: ${outputRoot}`);
  }
  if (!DATE_RE.test(date)) {
    throw new Error(`date must be YYYY-MM-DD, got: ${date}`);
  }
  const yearMonth = date.slice(0, 7); // YYYY-MM
  return path.join(outputRoot, yearMonth, type, 'raw audio', date);
}

/** Absolute path to the manifest inside a raw-audio dir. */
export function manifestPath(rawAudioDirPath: string): string {
  return path.join(rawAudioDirPath, 'recording-manifest.json');
}

/**
 * Sanitize a display name for use inside a filename. Per the agreed policy we
 * preserve spaces and unicode and only strip what actually breaks a path:
 * separators, NUL/control chars, and leading dots. Collapses to `unknown` if
 * nothing usable remains.
 */
export function sanitizeForFilename(name: string): string {
  const spaced = name
    .replace(/[/\\]/g, ' ') // path separators -> space
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' '); // NUL + C0/C1 control chars -> space

  // Process per whitespace token: strip leading dots from each token (kills
  // ".", "..", and hidden/traversal fragments anywhere in the name) and drop
  // tokens that become empty. Spaces and unicode are preserved.
  const tokens = spaced
    .split(/\s+/)
    .map((tok) => tok.replace(/^\.+/, ''))
    .filter((tok) => tok.length > 0);

  return tokens.join(' ') || 'unknown';
}

/**
 * Filename for one speaker track: `NN-<userId>-<displayName>.ogg`, where NN is
 * the 1-based ordinal in the export (zero-padded to 2). userId is assumed safe
 * (Discord snowflake); displayName is sanitized.
 */
export function trackFileName(ordinal: number, userId: string, displayName: string): string {
  const nn = String(ordinal).padStart(2, '0');
  const safeName = sanitizeForFilename(displayName);
  const safeUser = sanitizeForFilename(userId);
  return `${nn}-${safeUser}-${safeName}.ogg`;
}
