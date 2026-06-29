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
});
