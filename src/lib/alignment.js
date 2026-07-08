import usfm from 'usfm-js';

// Parse an aligned ULT/GLT USFM into a per-verse index of alignment entries:
// { [chapter]: { [verse]: [{ w, occ, eng }] } }
// where w = original-language word (zaln x-content), occ = its occurrence in the
// verse, and eng = the gateway-language (English) words aligned to it, in order.
export function parseAlignments(usfmText) {
  const json = usfm.toJSON(usfmText);
  const chapters = {};
  for (const [chNum, chData] of Object.entries(json.chapters || {})) {
    if (!/^\d+$/.test(chNum)) continue;
    const verses = {};
    for (const [vsNum, vsData] of Object.entries(chData)) {
      if (!/^\d+(-\d+)?$/.test(vsNum)) continue;
      const aligns = flattenAligns(vsData.verseObjects);
      if (aligns.length) verses[vsNum] = aligns;
    }
    if (Object.keys(verses).length) chapters[chNum] = verses;
  }
  return { chapters };
}

// Walk verseObjects, attributing each English \w word to the innermost enclosing
// alignment (\zaln) milestone so nested many-to-one alignments are preserved.
function flattenAligns(verseObjects) {
  const out = [];
  (function walk(objs, stack) {
    for (const o of objs || []) {
      if (o.tag === 'zaln') {
        const entry = { w: o.content, occ: Number(o.occurrence) || 1, eng: [] };
        out.push(entry);
        walk(o.children, [...stack, entry]);
      } else if (o.tag === 'w' || o.type === 'word') {
        if (stack.length) stack[stack.length - 1].eng.push(o.text || '');
      } else if (o.children) {
        walk(o.children, stack);
      }
    }
  })(verseObjects, []);
  return out;
}

// Verse lookup tolerating bridged keys like "4-5" (mirrors getVerseText)
export function getVerseAligns(index, chapter, verse) {
  const ch = index?.chapters?.[chapter];
  if (!ch) return null;
  if (ch[verse]) return ch[verse];
  for (const key of Object.keys(ch)) {
    const m = /^(\d+)-(\d+)$/.exec(key);
    if (m && verse >= Number(m[1]) && verse <= Number(m[2])) return ch[key];
  }
  return null;
}

// Normalize an original-language word for matching: NFC, drop Hebrew cantillation
// accents (which differ between tN quotes and the ULT), and strip zero-width
// joiners/spaces. Vowel points are kept.
const norm = (s) =>
  (s || '').normalize('NFC').replace(/[֑-֯​‌‍⁠﻿]/g, '');

// Split a quote span into original word tokens (on whitespace and maqqef/hyphens)
const MAQQEF = /[־‐-―-]/;
const quoteTokens = (span) =>
  span
    .split(/\s+/)
    .flatMap((w) => w.split(MAQQEF))
    .map(norm)
    .filter(Boolean);

// Produce the gateway-language (English) gloss of an original-language quote by
// finding the run of alignment entries whose words match, and collecting their
// aligned English words. Discontiguous quotes ("a & b") gloss each part, joined
// with an ellipsis. Returns null if the quote can't be matched.
export function glossQuote(aligns, quote, occurrence = 1) {
  if (!aligns || !quote) return null;
  const normed = aligns.map((a) => ({ ...a, n: norm(a.w) }));
  const parts = quote
    .split(/\s*&\s*/)
    .map((p) => p.replace(/[…]/g, ' ').trim())
    .filter(Boolean);
  if (!parts.length) return null;

  const out = [];
  for (const part of parts) {
    const toks = quoteTokens(part);
    if (!toks.length) return null;
    // Collect every contiguous match, then pick the requested occurrence
    const starts = [];
    for (let i = 0; i + toks.length <= normed.length; i++) {
      if (toks.every((t, k) => normed[i + k].n === t)) starts.push(i);
    }
    if (!starts.length) return null;
    const start = starts[Math.min(occurrence - 1, starts.length - 1)];
    const eng = normed
      .slice(start, start + toks.length)
      .flatMap((a) => a.eng)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!eng) return null;
    out.push(eng);
  }
  return out.join(' … ');
}
