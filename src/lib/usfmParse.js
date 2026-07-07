import usfm from 'usfm-js';

// Flatten usfm-js verseObjects (incl. alignment milestones) to plain text
function flattenVerseObjects(verseObjects) {
  let text = '';
  for (const obj of verseObjects || []) {
    if (obj.type === 'word' || obj.tag === 'w') {
      text += obj.text || '';
    } else if (obj.children) {
      text += flattenVerseObjects(obj.children);
    } else if (obj.type === 'text' || typeof obj.text === 'string') {
      text += obj.text || '';
    }
  }
  return text;
}

function headerValue(headers, tag) {
  if (!headers) return null;
  if (Array.isArray(headers)) {
    const h = headers.find((h) => h.tag === tag);
    return h ? h.content : null;
  }
  return headers[tag] || null;
}

// Parse a USFM string into { bookCode, bookName, chapters: {ch: {vs: text}} }
export function parseUsfm(usfmText) {
  const json = usfm.toJSON(usfmText);
  const idLine = headerValue(json.headers, 'id') || '';
  const bookCode = idLine.trim().split(/\s+/)[0]?.toUpperCase() || null;
  const bookName =
    headerValue(json.headers, 'h') ||
    headerValue(json.headers, 'toc2') ||
    headerValue(json.headers, 'toc1') ||
    bookCode;

  const chapters = {};
  for (const [chNum, chData] of Object.entries(json.chapters || {})) {
    if (!/^\d+$/.test(chNum)) continue;
    const verses = {};
    for (const [vsNum, vsData] of Object.entries(chData)) {
      if (!/^\d+(-\d+)?$/.test(vsNum)) continue;
      const text = flattenVerseObjects(vsData.verseObjects)
        .replace(/\s+/g, ' ')
        .trim();
      if (text) verses[vsNum] = text;
    }
    if (Object.keys(verses).length) chapters[chNum] = verses;
  }
  return { bookCode, bookName, chapters };
}
