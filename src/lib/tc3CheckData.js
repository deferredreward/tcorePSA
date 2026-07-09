// tC3 checkData file builder — the pure, node-testable core of the tC3
// sync-back (write) pipeline. Kept in its own module (no store / network / DOM
// imports) so scripts/test-tc3.mjs can drive it directly in node, exactly like
// tc4.js is the pure core that scripts/test-tc4.mjs drives. The orchestration
// (pull → merge → push against Door43) lives in src/lib/tc3Sync.js.
//
// tC3 on-disk write contract (verified against a real tc_version 8 project,
// git.door43.org/deferredreward/en_rnb_oba_book — see src/lib/tc3.js for the
// read side and src/lib/tc3.test.js for the fixture):
//   .apps/translationCore/checkData/<category>/<book>/<ch>/<v>/<ISO>.json
//     category ∈ selections | comments | reminders | invalidated
//   Filenames encode the modifiedTimestamp with colons → underscores
//     (e.g. 2026-07-08T19_29_48.018Z.json); JSON is compact.
//   Per-category payloads:
//     selections  {contextId, selections:[{text,occurrence,occurrences}],
//                  nothingToSelect, gatewayLanguageCode, gatewayLanguageQuote,
//                  username, modifiedTimestamp}
//     comments    {contextId, text, modifiedTimestamp}
//     reminders   {contextId, enabled, modifiedTimestamp}
//     invalidated {contextId, invalidated, modifiedTimestamp}
//
// WRITE MODEL = append-only. Each changed decision writes a NEW timestamped
// file per changed category; existing history is never rewritten or deleted
// (newest file per (identity, category) wins on load). We never emit
// <book>.usfm, the chapter JSON (<book>/N.json), or the regenerable
// .apps/translationCore/index/ groupData cache (tC desktop rebuilds it on open).
//
// contextId is RECONSTRUCTED from the pinned check definitions (like tc4.js's
// recordFromCheck), because the stored check-state drops it on import. This is
// faithful: the project is pinned to the same resource version it was checked
// against, so checkId/quote/occurrence/reference match what tC3 first wrote.
// glQuote / gatewayLanguageQuote are display caches we don't recompute — emitted
// empty; untouched remote records keep their originals (they are never rewritten).

import { strToU8 } from 'fflate';
import { quoteToArray, normalizeQuote } from './tc4.js';

const CHECKDATA = '.apps/translationCore/checkData';

const jsonBytes = (obj) => strToU8(JSON.stringify(obj)); // compact — matches tC3's fs.outputJson

// "1:1" -> {chapterStr:"1", verseStr:"1"}; "1:9-10" -> {"1","9-10"} (spans stay strings)
function splitRef(reference) {
  const i = reference.indexOf(':');
  return { chapterStr: reference.slice(0, i), verseStr: reference.slice(i + 1) };
}

// filename timestamp: only colons become underscores; the millisecond period stays
const fileStamp = (iso) => iso.replace(/:/g, '_');

function checkDataPath(category, book, chapterStr, verseStr, iso) {
  return `${CHECKDATA}/${category}/${book}/${chapterStr}/${verseStr}/${fileStamp(iso)}.json`;
}

// "git.door43.org/unfoldingWord/en_tn" -> "en"; "…/es-419_tw" -> "es-419".
// The GL code sits before the last underscore of the repo name (resource suffix).
function glFromPin(pin) {
  const seg = String(pin?.repoPath || '').split('/').pop() || '';
  const i = seg.lastIndexOf('_');
  return i > 0 ? seg.slice(0, i) : 'en';
}

// Rebuild the tC3 contextId for a check (occurrence-full, tool-qualified).
// tN quote is a [{word,occurrence}] array; tW quote is the OrigWords string.
function contextIdFromCheck(check, book) {
  const { chapterStr, verseStr } = splitRef(check.reference);
  const isTn = check.tool === 'tn';
  return {
    checkId: check.checkId,
    occurrenceNote: isTn ? check.note || '' : '',
    reference: {
      bookId: book,
      chapter: Number(chapterStr),
      verse: /^\d+$/.test(verseStr) ? Number(verseStr) : verseStr,
    },
    tool: isTn ? 'translationNotes' : 'translationWords',
    groupId: check.groupId,
    quote: isTn ? quoteToArray(check.quote) : normalizeQuote(check.quote),
    quoteString: normalizeQuote(check.quote),
    glQuote: '',
    occurrence: Number(check.occurrence),
  };
}

// INVARIANT I-2: occurrence/occurrences persist as integers
const normSelections = (arr) =>
  (arr || []).map((s) => ({ text: s.text, occurrence: Number(s.occurrence), occurrences: Number(s.occurrences) }));

const sameSelections = (a, b) =>
  JSON.stringify(normSelections(a?.selections)) === JSON.stringify(normSelections(b?.selections));

// Build the tC3 checkData files for every LOCAL decision that differs from what
// the remote already records — the append-only diff. `remoteStates` are the
// decisions seeded from the pulled repo (empty on a repo with no checkData yet);
// comparing against them is what stops an unchanged decision being re-appended on
// every sync. `checks` is {tn:[...], tw:[...]} from the pinned TSVs; `states` is
// keyed by check.id (`<tool>-<ref>-<checkId>`), matching seedStatesFromDecisions.
// Returns {path: Uint8Array}. Pure (no store/network) so the node test drives it.
export function buildTc3CheckDataFiles({ book, checks, states, remoteStates = {}, username = '', pins = null, fallbackTimestamp }) {
  const files = {};
  const used = new Set();
  const bookLc = String(book).toLowerCase();
  const glFor = (tool) => glFromPin(tool === 'tn' ? pins?.translationNotes : pins?.translationWords);

  for (const check of [...(checks.tn || []), ...(checks.tw || [])]) {
    const ls = states[check.id];
    if (!ls) continue;
    const rs = remoteStates[check.id];
    const iso = ls.modifiedAt || fallbackTimestamp;
    if (!iso) continue; // a write with no timestamp can't be named or ordered — skip
    const { chapterStr, verseStr } = splitRef(check.reference);
    const contextId = contextIdFromCheck(check, bookLc);

    // append one timestamped file, bumping the millisecond if two checks in the
    // same verse+category share a modifiedAt (keeps the filename a valid stamp)
    const emit = (category, fields) => {
      let stamp = iso;
      let path = checkDataPath(category, bookLc, chapterStr, verseStr, stamp);
      for (let bump = 1; used.has(path); bump++) {
        stamp = new Date(Date.parse(iso) + bump).toISOString();
        path = checkDataPath(category, bookLc, chapterStr, verseStr, stamp);
      }
      used.add(path);
      files[path] = jsonBytes({ contextId, ...fields, modifiedTimestamp: stamp });
    };

    // Emit a selections file when the decision changed AND either side is/was
    // decided. The "was decided" case is a CLEAR: the user un-selected a check
    // that the remote still records as done — tC3 un-sets it by writing an
    // empty-selections file (newest-wins), so suppressing it would leave the
    // verse stuck "done" on the remote. Both-undecided never emits (no change).
    const decided = (s) => !!((s?.selections && s.selections.length) || s?.nothingToSelect);
    const selectionsChanged = !sameSelections(ls, rs) || !!ls.nothingToSelect !== !!rs?.nothingToSelect;
    if (selectionsChanged && (decided(ls) || decided(rs))) {
      emit('selections', {
        selections: normSelections(ls.selections),
        nothingToSelect: !!ls.nothingToSelect,
        gatewayLanguageCode: glFor(check.tool),
        gatewayLanguageQuote: '',
        username,
      });
    }
    if ((ls.comment || '') !== (rs?.comment || '')) {
      emit('comments', { text: ls.comment || '' });
    }
    if (!!ls.reminder !== !!rs?.reminder) {
      emit('reminders', { enabled: !!ls.reminder });
    }
    if (!!ls.invalidated !== !!rs?.invalidated) {
      emit('invalidated', { invalidated: !!ls.invalidated });
    }
  }
  return files;
}
