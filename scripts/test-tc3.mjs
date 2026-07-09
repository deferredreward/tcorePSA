// Round-trip test for the tC3 sync-back (write) pipeline — the WRITE half of
// Pipeline A (src/lib/tc3Sync.js). Mirrors scripts/test-tc4.mjs: no network,
// no IndexedDB — drives the pure file builder, then re-imports what it wrote
// through the tC3 READ path (src/lib/tc3.js) to prove a full round-trip.
// Run: npm run test:tc3
import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
import { buildTc3CheckDataFiles } from '../src/lib/tc3CheckData.js';
import { importTc3, detectProjectFormat } from '../src/lib/tc3.js';
import { seedStatesFromDecisions, isDoneState } from '../src/lib/tc4.js';

let pass = 0, fail = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail && !ok ? ' — ' + detail : ''}`);
  ok ? pass++ : fail++;
}
const deepEq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// Pinned to en_tn v88 (the release en_rnb_oba_book was checked against), so the
// row ids line up 1:1 with the app's `check.id` (`tn-<Reference>-<ID>`).
const pins = {
  translationNotes: { repoPath: 'git.door43.org/unfoldingWord/en_tn', version: 'v88' },
  translationWords: { repoPath: 'git.door43.org/unfoldingWord/en_tw', version: 'v88' },
  translationAcademy: { repoPath: 'git.door43.org/unfoldingWord/en_ta', version: 'master' },
};

// A tN and a tW check in Obadiah 1:1 (what the PWA derives from the pinned TSVs).
const tnCheck = {
  id: 'tn-1:1-jd1r', checkId: 'jd1r', tool: 'tn', chapter: 1, verse: 1, reference: '1:1',
  quote: 'לַ⁠מִּלְחָמָֽה', occurrence: 1, groupId: 'figs-abstractnouns',
  support: 'rc://*/ta/man/translate/figs-abstractnouns', note: 'War is an abstract noun.',
};
const twCheck = {
  id: 'tw-1:1-ab12', checkId: 'ab12', tool: 'tw', chapter: 1, verse: 1, reference: '1:1',
  quote: 'אֱדֹ֑ום', occurrence: 1, term: 'edom', category: 'names', groupId: 'edom',
  link: 'rc://*/tw/dict/bible/names/edom',
};
const checks = { tn: [tnCheck], tw: [twCheck] };

// A local decision the user made in the PWA on the tN check.
const states = {
  'tn-1:1-jd1r': {
    selections: [{ text: 'go whup', occurrence: 1, occurrences: 1 }],
    comment: 'double-check this rendering',
    reminder: true,
    nothingToSelect: false,
    invalidated: false,
    modifiedAt: '2026-07-08T19:29:48.018Z',
  },
};

// ---------- 1. build: one decision -> the four tC3 checkData files, correct paths ----------
const files = buildTc3CheckDataFiles({ book: 'OBA', checks, states, remoteStates: {}, username: 'deferredreward', pins });
const paths = Object.keys(files).sort();

const selPath = '.apps/translationCore/checkData/selections/oba/1/1/2026-07-08T19_29_48.018Z.json';
const comPath = '.apps/translationCore/checkData/comments/oba/1/1/2026-07-08T19_29_48.018Z.json';
const remPath = '.apps/translationCore/checkData/reminders/oba/1/1/2026-07-08T19_29_48.018Z.json';
check('build: writes into .apps/translationCore/checkData/<category>/<book>/<ch>/<v>/<ts>.json (book lowercased)',
  paths.includes(selPath) && paths.includes(comPath) && paths.includes(remPath));
check('build: filename encodes the modifiedTimestamp with colons -> underscores, ms period kept',
  /\/2026-07-08T19_29_48\.018Z\.json$/.test(selPath));
check('build: no invalidated file emitted (local matches the default false)',
  !paths.some((p) => p.includes('/invalidated/')));
check('build: no USFM / chapter-JSON / index cache touched (checkData only)',
  paths.every((p) => p.startsWith('.apps/translationCore/checkData/')));

// ---------- 2. record shape per category ----------
const sel = JSON.parse(strFromU8(files[selPath]));
check('selections payload: contextId + selections + nothingToSelect + gl + username + modifiedTimestamp',
  sel.contextId.checkId === 'jd1r' &&
  sel.contextId.tool === 'translationNotes' &&
  sel.contextId.reference.bookId === 'oba' &&
  sel.contextId.reference.chapter === 1 && sel.contextId.reference.verse === 1 &&
  sel.selections[0].text === 'go whup' &&
  sel.selections[0].occurrence === 1 && sel.selections[0].occurrences === 1 &&
  sel.nothingToSelect === false &&
  sel.gatewayLanguageCode === 'en' &&
  sel.username === 'deferredreward' &&
  sel.modifiedTimestamp === '2026-07-08T19:29:48.018Z');
check('selections payload: I-2 — occurrence/occurrences are integers',
  typeof sel.selections[0].occurrence === 'number' && typeof sel.selections[0].occurrences === 'number');
check('selections payload: tN quote is a [{word,occurrence}] array, quoteString is the string',
  Array.isArray(sel.contextId.quote) && sel.contextId.quote[0].word === 'לַ⁠מִּלְחָמָֽה' &&
  sel.contextId.quoteString === 'לַ⁠מִּלְחָמָֽה');
const com = JSON.parse(strFromU8(files[comPath]));
check('comments payload: {contextId, text, modifiedTimestamp}',
  com.text === 'double-check this rendering' && com.contextId.checkId === 'jd1r' &&
  com.modifiedTimestamp === '2026-07-08T19:29:48.018Z');
const rem = JSON.parse(strFromU8(files[remPath]));
check('reminders payload: {contextId, enabled, modifiedTimestamp}', rem.enabled === true && rem.contextId.checkId === 'jd1r');

// ---------- 3. ROUND-TRIP: written files re-import through the tC3 read path ----------
const MANIFEST = {
  project: { id: 'oba', name: 'Obadiah' },
  resource: { id: 'RNB', name: 'redneck obadiah' },
  tcInitialized: true, tc_version: 8,
  toolsSelectedGLs: { translationNotes: 'en', translationWords: 'en' },
  toolsSelectedOwners: { translationNotes: 'unfoldingWord', translationWords: 'unfoldingWord' },
  tc_en_check_version_translationNotes: 'v88_unfoldingWord',
  tc_en_check_version_translationWords: 'v88_unfoldingWord',
};
const USFM = '\\id OBA\n\\usfm 3.0\n\\h Obadiah\n\\c 1\n\\p\n\\v 1 go whup Edom good.\n';
const zip = zipSync({
  'manifest.json': strToU8(JSON.stringify(MANIFEST)),
  'oba.usfm': strToU8(USFM),
  ...files, // the checkData files we just built
});
check('round-trip: the written project is still detected as tC3', detectProjectFormat(zip) === 'tc3');
const reimported = importTc3(zip);
const reseeded = seedStatesFromDecisions(reimported.decisions);
const back = reseeded['tn-1:1-jd1r'];
check('round-trip: the decision re-imports to the same check id',
  !!back && reimported.decisions.tn.length === 1);
check('round-trip: selection, comment, reminder survive the write -> read cycle',
  back?.selections?.[0]?.text === 'go whup' &&
  back?.comment === 'double-check this rendering' &&
  back?.reminder === true && isDoneState(back) === true);

// ---------- 4. append-only diff: nothing changed since remote => no new files ----------
{
  // remoteStates = exactly what a prior sync pushed (seeded from the same files)
  const remoteStates = seedStatesFromDecisions(importTc3(zip).decisions);
  const none = buildTc3CheckDataFiles({ book: 'OBA', checks, states, remoteStates, username: 'deferredreward', pins });
  check('idempotent: a decision already on the remote is not re-appended', Object.keys(none).length === 0);

  // edit only the comment locally -> only a comments file is appended
  const edited = { ...states, 'tn-1:1-jd1r': { ...states['tn-1:1-jd1r'], comment: 'changed my mind', modifiedAt: '2026-07-08T20:00:00.000Z' } };
  const delta = buildTc3CheckDataFiles({ book: 'OBA', checks, states: edited, remoteStates, username: 'deferredreward', pins });
  const deltaPaths = Object.keys(delta);
  check('append-only: only the changed category (comments) is re-written',
    deltaPaths.length === 1 && deltaPaths[0].includes('/comments/') &&
    deltaPaths[0].endsWith('/2026-07-08T20_00_00.000Z.json') &&
    JSON.parse(strFromU8(delta[deltaPaths[0]])).text === 'changed my mind');
}

// ---------- 5b. clearing a selection writes an empty-selections file (un-set) ----------
{
  // remote records the check as done; locally the user un-selects it
  const remoteStates = seedStatesFromDecisions(importTc3(zip).decisions); // has tn-1:1-jd1r done
  const cleared = { 'tn-1:1-jd1r': { selections: [], comment: remoteStates['tn-1:1-jd1r'].comment, reminder: remoteStates['tn-1:1-jd1r'].reminder, nothingToSelect: false, invalidated: false, modifiedAt: '2026-07-08T21:00:00.000Z' } };
  const out = buildTc3CheckDataFiles({ book: 'OBA', checks, states: cleared, remoteStates, username: 'x', pins });
  const selPaths = Object.keys(out).filter((p) => p.includes('/selections/'));
  check('clear: un-selecting a remotely-done check writes an empty-selections file',
    selPaths.length === 1 && (() => { const r = JSON.parse(strFromU8(out[selPaths[0]])); return r.selections.length === 0 && r.nothingToSelect === false; })());

  // a check that was never decided on either side emits nothing (no spurious clear)
  const undecided = { 'tw-1:1-ab12': { selections: [], comment: '', reminder: false, nothingToSelect: false, invalidated: false, modifiedAt: '2026-07-08T21:00:00.000Z' } };
  check('clear: a never-decided check emits no file', Object.keys(buildTc3CheckDataFiles({ book: 'OBA', checks, states: undecided, remoteStates: {}, username: 'x', pins })).length === 0);
}

// ---------- 5. tW selection + same-verse+category filename-collision handling ----------
{
  const st = {
    'tn-1:1-jd1r': { selections: [{ text: 'a', occurrence: 1, occurrences: 1 }], comment: '', reminder: false, nothingToSelect: false, modifiedAt: '2026-07-08T19:29:48.018Z' },
    'tw-1:1-ab12': { selections: [{ text: 'Edom', occurrence: 1, occurrences: 1 }], comment: '', reminder: false, nothingToSelect: false, modifiedAt: '2026-07-08T19:29:48.018Z' },
  };
  const out = buildTc3CheckDataFiles({ book: 'OBA', checks, states: st, remoteStates: {}, username: 'x', pins });
  const selFiles = Object.keys(out).filter((p) => p.includes('/selections/oba/1/1/'));
  check('collision: two checks in the same verse+category get two distinct files', selFiles.length === 2 && new Set(selFiles).size === 2);
  const tw = Object.values(out).map((b) => JSON.parse(strFromU8(b))).find((r) => r.contextId.checkId === 'ab12');
  check('tW selection: quote is the OrigWords string (not a word-array), tool is translationWords',
    typeof tw.contextId.quote === 'string' && tw.contextId.quote === 'אֱדֹ֑ום' && tw.contextId.tool === 'translationWords');
}

// ---------- 6. non-English tW GL: decision keys + round-trips against a pinned non-en TWL ----------
// Regression for the PR #11 gap: a project that checked tW against a non-English
// GL (here es-419 / es-419_gl, which ships its own es-419_twl list). The tW pin
// now flows through fetchTwlTsv, so the loaded tW checkIds match the seeded
// decision — and the emitted selection carries the pin's GL, agreeing with the
// contextId instead of an en default.
{
  const esManifest = {
    project: { id: 'oba', name: 'Obadiah' },
    resource: { id: 'RNB', name: 'redneck obadiah' },
    tcInitialized: true, tc_version: 8,
    toolsSelectedGLs: { translationNotes: 'en', translationWords: 'es-419' },
    toolsSelectedOwners: { translationNotes: 'unfoldingWord', translationWords: 'es-419_gl' },
    tc_en_check_version_translationNotes: 'v88_unfoldingWord',
    'tc_es-419_check_version_translationWords': 'v10_es-419_gl',
  };
  const { pins: esPins } = importTc3(zipSync({
    'manifest.json': strToU8(JSON.stringify(esManifest)),
    'oba.usfm': strToU8(USFM),
  }));
  check('es-419: manifest resolves the tW pin to es-419_gl/es-419_tw @ v10',
    esPins.translationWords.repoPath === 'git.door43.org/es-419_gl/es-419_tw' &&
    esPins.translationWords.version === 'v10' &&
    esPins.translationNotes.repoPath === 'git.door43.org/unfoldingWord/en_tn');

  const esStates = {
    'tw-1:1-ab12': { selections: [{ text: 'Edom', occurrence: 1, occurrences: 1 }], comment: 'reviewed', reminder: false, nothingToSelect: false, invalidated: false, modifiedAt: '2026-07-08T22:00:00.000Z' },
  };
  const esFiles = buildTc3CheckDataFiles({ book: 'OBA', checks, states: esStates, remoteStates: {}, username: 'x', pins: esPins });
  const esSelPath = Object.keys(esFiles).find((p) => p.includes('/selections/'));
  const esSel = JSON.parse(strFromU8(esFiles[esSelPath]));
  check('es-419: emitted tW selection stamps gatewayLanguageCode from the pin (es-419, not en)',
    esSel.gatewayLanguageCode === 'es-419' && esSel.contextId.checkId === 'ab12' && esSel.contextId.tool === 'translationWords');

  const esZip = zipSync({
    'manifest.json': strToU8(JSON.stringify(esManifest)),
    'oba.usfm': strToU8(USFM),
    ...esFiles,
  });
  const esReseeded = seedStatesFromDecisions(importTc3(esZip).decisions);
  const esBack = esReseeded['tw-1:1-ab12'];
  check('es-419: the non-en tW decision survives build -> read and keys to tw-1:1-ab12',
    !!esBack && esBack.selections?.[0]?.text === 'Edom' && esBack.comment === 'reviewed' && isDoneState(esBack) === true);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
