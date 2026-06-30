import { describe, expect, it } from 'vitest';

import { parseUsersFile } from './usersFile';

// Mirrors what Craig's writer.ts emits: leading `"0":{}` placeholder, then one
// `,"<trackNo>":{...}` per track.
const SAMPLE = [
  '"0":{}',
  ',"1":{"id":"123","username":"air","discriminator":"0","name":"Air"}',
  ',"2":{"id":"456","username":"bee","discriminator":"0"}'
].join('\n');

describe('parseUsersFile', () => {
  it('parses tracks and drops the empty placeholder', () => {
    const users = parseUsersFile(SAMPLE);
    expect(users).toEqual([
      { trackNo: 1, userId: '123', username: 'air', discriminator: '0', displayName: 'Air' },
      { trackNo: 2, userId: '456', username: 'bee', discriminator: '0' }
    ]);
  });

  it('sorts by track number ascending regardless of file order', () => {
    const text = ['"0":{}', ',"3":{"id":"c","username":"cee","discriminator":"0"}', ',"1":{"id":"a","username":"ay","discriminator":"0"}'].join('\n');
    expect(parseUsersFile(text).map((u) => u.trackNo)).toEqual([1, 3]);
  });

  it('returns an empty list when there are no real users', () => {
    expect(parseUsersFile('"0":{}')).toEqual([]);
  });

  it('reads displayName from globalName (what Craig\'s bot writer emits)', () => {
    const text = '"0":{}\n,"1":{"id":"123","username":"air","discriminator":"0","globalName":"Air Display","bot":false}';
    expect(parseUsersFile(text)[0]).toMatchObject({ userId: '123', username: 'air', displayName: 'Air Display' });
  });

  it('prefers globalName over name when both are present', () => {
    const text = '"0":{}\n,"1":{"id":"1","username":"u","discriminator":"0","globalName":"Global","name":"Legacy"}';
    expect(parseUsersFile(text)[0]?.displayName).toBe('Global');
  });

  it('falls back to name when globalName is absent', () => {
    const text = '"0":{}\n,"1":{"id":"1","username":"u","discriminator":"0","name":"Legacy"}';
    expect(parseUsersFile(text)[0]?.displayName).toBe('Legacy');
  });

  it('ignores a null globalName (leaving displayName undefined)', () => {
    const text = '"0":{}\n,"1":{"id":"1","username":"u","discriminator":"0","globalName":null}';
    expect(parseUsersFile(text)[0]?.displayName).toBeUndefined();
  });
});
