// Parser for Craig's `{recordingId}.ogg.users` file.
//
// Craig's writer emits this as a JSON *fragment*, one line per track:
//
//   "0":{}
//   ,"1":{"id":"123","username":"air","discriminator":"0","name":"Air"}
//   ,"2":{ ... }
//
// i.e. the file content wrapped in `{ ... }` is a JSON object keyed by track
// number. Track 0 is a placeholder. This mirrors apps/download/.../recording.ts
// getUsers(), kept as read-only reference. Pure: node builtins only.

/** A user as stored in `.ogg.users`. Fields beyond these may exist and are ignored. */
export interface CraigTrackUser {
  /** Track number (the object key; also the NN prefix cook uses for filenames). */
  trackNo: number;
  /** Discord user id. */
  userId: string;
  username: string;
  discriminator: string;
  /** Discord global/display name when present (`name` in the raw file). */
  displayName?: string;
}

interface RawUser {
  id?: string;
  username?: string;
  discriminator?: string;
  /**
   * Discord display name. Craig's bot writer serializes the whole RecordingUser
   * (recording.ts), so the file carries `globalName` (the modern display name).
   * Older/download-side data used `name`; we accept either, preferring
   * globalName.
   */
  globalName?: string | null;
  name?: string;
}

/**
 * Parse `.ogg.users` text into track users, sorted by track number ascending.
 * Empty track entries (notably the leading `"0":{}`) are dropped, matching
 * Craig's `getUsers` which filters objects with no keys.
 */
export function parseUsersFile(text: string): CraigTrackUser[] {
  const obj = JSON.parse(`{${text}}`) as Record<string, RawUser>;

  const users: CraigTrackUser[] = [];
  for (const [key, raw] of Object.entries(obj)) {
    if (!raw || Object.keys(raw).length === 0) continue; // drop "0":{} and any empty entry
    const trackNo = Number(key);
    if (!Number.isInteger(trackNo)) continue;
    // Prefer globalName (what Craig's bot writer emits), then name (older /
    // download-side shape). Ignore null/empty so the exporter's username
    // fallback still applies.
    const displayName = raw.globalName || raw.name || undefined;
    users.push({
      trackNo,
      userId: raw.id ?? '',
      username: raw.username ?? '',
      discriminator: raw.discriminator ?? '',
      ...(displayName !== undefined ? { displayName } : {})
    });
  }

  users.sort((a, b) => a.trackNo - b.trackNo);
  return users;
}
