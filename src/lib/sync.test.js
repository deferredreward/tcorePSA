import { describe, it, expect } from 'vitest';
import { mergeStates, gitBlobSha } from './sync';
import { parseRepoRef, toBase64 } from './dcs';

describe('mergeStates (LWW by modifiedAt)', () => {
  const s = (modifiedAt, comment = '') => ({ selections: [], comment, reminder: false, nothingToSelect: true, modifiedAt });

  it('takes remote-only states', () => {
    const { merged, pulled } = mergeStates({}, { a: s('2026-01-01T00:00:00Z') });
    expect(merged.a.modifiedAt).toBe('2026-01-01T00:00:00Z');
    expect(pulled).toBe(1);
  });

  it('newer remote wins, older remote loses', () => {
    const local = { a: s('2026-01-02T00:00:00Z', 'local'), b: s('2026-01-01T00:00:00Z', 'local') };
    const remote = { a: s('2026-01-01T00:00:00Z', 'remote'), b: s('2026-01-03T00:00:00Z', 'remote') };
    const { merged, pulled } = mergeStates(local, remote);
    expect(merged.a.comment).toBe('local');
    expect(merged.b.comment).toBe('remote');
    expect(pulled).toBe(1);
  });

  it('keeps local work against an untimestamped remote record', () => {
    const { merged, pulled } = mergeStates(
      { a: s('2026-01-01T00:00:00Z', 'local') },
      { a: s(undefined, 'remote') },
    );
    expect(merged.a.comment).toBe('local');
    expect(pulled).toBe(0);
  });

  it('local without timestamp yields to a timestamped remote', () => {
    const { merged } = mergeStates({ a: s(undefined, 'local') }, { a: s('2026-01-01T00:00:00Z', 'remote') });
    expect(merged.a.comment).toBe('remote');
  });

  it('identical states count as no pull', () => {
    const both = s('2026-01-01T00:00:00Z');
    const { pulled } = mergeStates({ a: both }, { a: { ...both } });
    expect(pulled).toBe(0);
  });
});

describe('gitBlobSha', () => {
  // known git blob hashes: `git hash-object` of empty and "hello\n"
  it('matches git hash-object for the empty blob', async () => {
    expect(await gitBlobSha(new Uint8Array(0))).toBe('e69de29bb2d1d6434b8b29ae775ad8c2e48c5391');
  });
  it('matches git hash-object for "hello\\n"', async () => {
    expect(await gitBlobSha(new TextEncoder().encode('hello\n'))).toBe(
      'ce013625030ba8dba906f756967f9e9ca394464a',
    );
  });
});

describe('parseRepoRef', () => {
  it.each([
    ['owner/repo', 'owner', 'repo'],
    ['https://git.door43.org/benjamin/tit_checks', 'benjamin', 'tit_checks'],
    ['https://git.door43.org/benjamin/tit_checks.git', 'benjamin', 'tit_checks'],
    ['git.door43.org/benjamin/tit_checks/', 'benjamin', 'tit_checks'],
    ['https://door43.org/u/benjamin/tit_checks', 'benjamin', 'tit_checks'],
    ['https://git.door43.org/u/benjamin/tit_checks', 'benjamin', 'tit_checks'],
  ])('%s -> %s/%s', (input, owner, repo) => {
    expect(parseRepoRef(input)).toEqual({ owner, repo });
  });

  it('rejects inputs without owner/repo', () => {
    expect(parseRepoRef('just-a-repo')).toBeNull();
    expect(parseRepoRef('')).toBeNull();
  });
});

describe('toBase64', () => {
  it('round-trips bytes through atob', () => {
    const bytes = new Uint8Array(70000).map((_, i) => i % 251);
    const decoded = Uint8Array.from(atob(toBase64(bytes)), (c) => c.charCodeAt(0));
    expect(decoded).toEqual(bytes);
  });
});
