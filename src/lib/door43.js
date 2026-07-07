import { get, set } from 'idb-keyval';

const BASE = 'https://git.door43.org/unfoldingWord';

// Network-first with IndexedDB fallback so resources keep working offline
// (the service worker also caches these in production builds)
async function fetchCached(url) {
  const key = `url:${url}`;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    const text = await res.text();
    set(key, text).catch(() => {});
    return text;
  } catch (err) {
    const cached = await get(key);
    if (cached != null) return cached;
    throw err;
  }
}

export function fetchTnTsv(bookCode) {
  return fetchCached(`${BASE}/en_tn/raw/branch/master/tn_${bookCode}.tsv`);
}

export function fetchTwlTsv(bookCode) {
  return fetchCached(`${BASE}/en_twl/raw/branch/master/twl_${bookCode}.tsv`);
}

// rcLink like rc://*/tw/dict/bible/kt/faith -> bible/kt/faith.md
export function fetchTwArticle(rcLink) {
  const m = rcLink.match(/rc:\/\/[^/]+\/tw\/dict\/(.+)$/);
  if (!m) return Promise.reject(new Error(`Bad tW link: ${rcLink}`));
  return fetchCached(`${BASE}/en_tw/raw/branch/master/${m[1]}.md`);
}

// translationAcademy article for a tN check type, e.g. figs-metaphor
export function fetchTaTitle(slug) {
  return fetchCached(`${BASE}/en_ta/raw/branch/master/translate/${slug}/title.md`);
}

export function fetchTaArticle(slug) {
  return fetchCached(`${BASE}/en_ta/raw/branch/master/translate/${slug}/01.md`);
}

export function fetchSampleUsfm(fileNum, bookCode) {
  return fetchCached(`${BASE}/en_ult/raw/branch/master/${fileNum}-${bookCode}.usfm`);
}
