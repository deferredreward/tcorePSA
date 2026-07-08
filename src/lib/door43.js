import { get, set } from 'idb-keyval';
import { usfmFileNumber, isNewTestament } from './books';

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

// The aligned en_ULT for a book — the target (English) text we gloss quotes into.
export function fetchUltUsfm(bookCode) {
  const fileNum = usfmFileNumber(bookCode);
  if (!fileNum) return Promise.reject(new Error(`Unknown book code: ${bookCode}`));
  return fetchCached(`${BASE}/en_ult/raw/branch/master/${fileNum}-${bookCode}.usfm`);
}

// The original-language text for a book (UHB Hebrew for OT, UGNT Greek for NT).
// tN/tW quotes are original-language, so this is the source book quotes match against.
export function fetchOlUsfm(bookCode) {
  const fileNum = usfmFileNumber(bookCode);
  if (!fileNum) return Promise.reject(new Error(`Unknown book code: ${bookCode}`));
  const repo = isNewTestament(bookCode) ? 'el-x-koine_ugnt' : 'hbo_uhb';
  return fetchCached(`${BASE}/${repo}/raw/branch/master/${fileNum}-${bookCode}.usfm`);
}
