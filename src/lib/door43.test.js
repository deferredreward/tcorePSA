// URL construction for the pinned Door43 fetches. The subtle one is fetchTwlTsv:
// the translationWords pin names the `_tw` articles repo, but the TWL list files
// live in `_twl` — the fetch targets the derived list repo, falling back to
// en_twl master when that GL owner ships no `_twl`.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('idb-keyval', () => ({ get: async () => null, set: async () => {} }));

const { fetchTwlTsv, fetchTnTsv } = await import('./door43');

let urls;
// mock fetch that 200s every URL unless its path matches a "missing" pattern
const mockFetch = (missing = null) =>
  vi.fn(async (url) => {
    urls.push(url);
    if (missing && missing.test(url)) return { ok: false, status: 404 };
    return { ok: true, text: async () => 'tsv' };
  });

beforeEach(() => {
  urls = [];
  global.fetch = mockFetch();
});

describe('fetchTwlTsv URL construction', () => {
  it('derives the _twl list repo from a GL that ships one, honoring the version tag', async () => {
    // es-419_gl publishes es-419_twl (verified on Door43); pin names the _tw pair
    await fetchTwlTsv('OBA', { repoPath: 'git.door43.org/es-419_gl/es-419_tw', version: 'v10' });
    expect(urls[0]).toBe('https://git.door43.org/es-419_gl/es-419_twl/raw/tag/v10/twl_OBA.tsv');
  });

  it('English tW pin (en_tw master) resolves to en_twl master — not en_tw', async () => {
    await fetchTwlTsv('OBA', { repoPath: 'git.door43.org/unfoldingWord/en_tw', version: 'master' });
    expect(urls[0]).toBe('https://git.door43.org/unfoldingWord/en_twl/raw/branch/master/twl_OBA.tsv');
  });

  it('falls back to en_twl master when the GL owner ships no _twl (e.g. Door43-Catalog/es-419)', async () => {
    // Door43-Catalog has es-419_tw but no es-419_twl — the derived fetch 404s
    global.fetch = mockFetch(/es-419_twl/);
    await fetchTwlTsv('OBA', { repoPath: 'git.door43.org/Door43-Catalog/es-419_tw', version: 'v10' });
    expect(urls[0]).toBe('https://git.door43.org/Door43-Catalog/es-419_twl/raw/tag/v10/twl_OBA.tsv');
    expect(urls[1]).toBe('https://git.door43.org/unfoldingWord/en_twl/raw/branch/master/twl_OBA.tsv');
  });

  it('falls back to en_twl master when unpinned', async () => {
    await fetchTwlTsv('OBA');
    expect(urls[0]).toBe('https://git.door43.org/unfoldingWord/en_twl/raw/branch/master/twl_OBA.tsv');
  });
});

describe('fetchTnTsv URL construction', () => {
  it('honors a non-en tN pin (repo used verbatim, version tag)', async () => {
    await fetchTnTsv('OBA', { repoPath: 'git.door43.org/unfoldingWord/en_tn', version: 'v88' });
    expect(urls[0]).toBe('https://git.door43.org/unfoldingWord/en_tn/raw/tag/v88/tn_OBA.tsv');
  });
});
