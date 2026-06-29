// Typed error model for dc-rec-mcp.
//
// The MCP adapter maps these codes to typed tool errors that the caller can
// translate into Discord replies. This module imports nothing external
// (Slice 1 acceptance #2).

/** The closed set of error codes from the plan's "Error Model". */
export type DcRecErrorCode =
  | 'not_in_voice_channel'
  | 'voice_channel_not_found'
  | 'missing_voice_connect_permission'
  | 'already_recording'
  | 'recording_not_found'
  | 'recording_not_active'
  | 'recording_not_finalized'
  | 'export_already_running'
  | 'export_failed'
  | 'cook_binary_missing'
  | 'invalid_export_format'
  | 'invalid_export_mode';

export const DC_REC_ERROR_CODES: readonly DcRecErrorCode[] = [
  'not_in_voice_channel',
  'voice_channel_not_found',
  'missing_voice_connect_permission',
  'already_recording',
  'recording_not_found',
  'recording_not_active',
  'recording_not_finalized',
  'export_already_running',
  'export_failed',
  'cook_binary_missing',
  'invalid_export_format',
  'invalid_export_mode'
] as const;

/**
 * Structured detail carried alongside an error. Free-form but JSON-safe; e.g.
 * `already_recording` returns the active `recordingId`.
 */
export interface DcRecErrorDetails {
  recordingId?: string;
  guildId?: string;
  [key: string]: string | number | boolean | undefined;
}

/**
 * A domain error with a stable, typed code. Thrown inside MeetingRecorder and
 * caught/mapped at the MCP adapter boundary — never sent to Discord directly.
 */
export class DcRecError extends Error {
  readonly code: DcRecErrorCode;
  readonly details?: DcRecErrorDetails;

  constructor(code: DcRecErrorCode, message?: string, details?: DcRecErrorDetails) {
    super(message ?? code);
    this.name = 'DcRecError';
    this.code = code;
    if (details !== undefined) this.details = details;
    // Restore prototype chain for `instanceof` after transpilation to ES2020.
    Object.setPrototypeOf(this, DcRecError.prototype);
  }
}

/** JSON-safe shape an MCP tool returns for a failed call. */
export interface DcRecErrorResult {
  ok: false;
  code: DcRecErrorCode;
  error: string;
  details?: DcRecErrorDetails;
}
