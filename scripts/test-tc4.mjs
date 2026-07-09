// Round-trip test for the tC4 Scripture Burrito interop layer, run against
// the tC4 reference sample project (test/fixtures/sample-burrito, from the
// tC4-pankosmia package) and Pankosmia's bundled SB schema.
// Run: npm run test:tc4
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipSync, unzipSync, strFromU8, strToU8 } from 'fflate';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { md5 } from '../src/lib/md5.js';
import {
  importBurrito,
  exportBurrito,
  seedStatesFromDecisions,
  mergeDecisions,
  quoteToArray,
  stripAlignmentMarkup,
} from '../src/lib/tc4.js';
import { buildDecisionEvent, hlcString, nextHlcState } from '../src/lib/journal.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE = path.join(root, 'test', 'fixtures', 'sample-burrito');
const SCHEMA = path.join(root, 'test', 'fixtures', 'sb-schema');

let pass = 0, fail = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail && !ok ? ' — ' + detail : ''}`);
  ok ? pass++ : fail++;
}
const deepEq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ---------- SB schema validator (same loading pattern as the tC4 harness) ----------
const ajv = new Ajv({ strict: false, allErrors: true });
addFormats(ajv);
{
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(path.join(dir, e.name)) : e.name.endsWith('.json') ? [path.join(dir, e.name)] : []);
  for (const f of walk(SCHEMA)) {
    let schema;
    try { schema = JSON.parse(fs.readFileSync(f, 'utf8').replace(/,(\s*[}\]])/g, '$1')); }
    catch { continue; }
    schema.$id = 'https://sb.local/' + path.relative(SCHEMA, f).split(path.sep).join('/');
    try { ajv.addSchema(schema); } catch { /* duplicate $id — first wins */ }
  }
}
const validateMetadata = ajv.getSchema('https://sb.local/source_metadata.schema.json');
const sbValid = (metadata) => {
  const ok = !!validateMetadata && !!validateMetadata(metadata);
  return { ok, errors: ok ? '' : JSON.stringify(validateMetadata?.errors?.slice(0, 3)) };
};

// ---------- 1. md5 ----------
check('md5: RFC 1321 vectors', md5('') === 'd41d8cd98f00b204e9800998ecf8427e' && md5('abc') === '900150983cd24fb0d6963f7d28e17f72');
{
  const titBytes = new Uint8Array(fs.readFileSync(path.join(FIXTURE, 'ingredients', 'TIT.usfm')));
  const recorded = JSON.parse(fs.readFileSync(path.join(FIXTURE, 'metadata.json'), 'utf8'))
    .ingredients['ingredients/TIT.usfm'].checksum.md5;
  check('md5: matches the sample metadata checksum for TIT.usfm', md5(titBytes) === recorded);
}

// ---------- 2. import ----------
const fixtureFiles = {};
{
  const walk = (dir, base = '') => fs.readdirSync(dir, { withFileTypes: true }).forEach((e) => {
    const rel = base ? `${base}/${e.name}` : e.name;
    if (e.isDirectory()) walk(path.join(dir, e.name), rel);
    else fixtureFiles[rel] = new Uint8Array(fs.readFileSync(path.join(dir, e.name)));
  });
  walk(FIXTURE);
}
const fixtureZip = zipSync(fixtureFiles);
const imp = importBurrito(fixtureZip);

check('import: both books found', deepEq(imp.books.map((b) => b.book).sort(), ['JON', 'TIT']));
check('import: resource pins read (tN v86, tW v87)',
  imp.pins?.translationNotes?.version === 'v86' && imp.pins?.translationWords?.version === 'v87');
check('import: decision records per tool', imp.decisions.TIT.tn.length === 2 && imp.decisions.TIT.tw.length === 2);
check('import: verse-span fixture present in JON USFM', imp.books.find((b) => b.book === 'JON').usfmText.includes('\\v 9-10 '));

const seeded = seedStatesFromDecisions(imp.decisions.TIT);
check('import: decisions seed PWA states by check id',
  seeded['tw-1:1-t1g7']?.selections[0]?.text === 'Dios' &&
  seeded['tn-1:1-swi9']?.comment.startsWith('Verificar') &&
  seeded['tw-1:1-a9p2']?.reminder === true);
check('import: span verse keys stay strings in seeded ids',
  Object.keys(seedStatesFromDecisions({
    tn: [{ contextId: { checkId: 'zz99', reference: { bookId: 'jon', chapter: 2, verse: '9-10' } }, selections: false, modifiedTimestamp: 't' }],
  }))[0] === 'tn-2:9-10-zz99');
check('import: invalidated records seed as needs-re-review, not done',
  seeded['tn-1:4-gr8c']?.invalidated === true && seeded['tn-1:1-swi9']?.invalidated === false);
check('import: colliding (checkId, reference) keeps the newer decision, not file order',
  seedStatesFromDecisions({
    tn: [
      { contextId: { checkId: 'dup1', reference: { bookId: 'tit', chapter: 1, verse: 1 } }, comments: 'older', modifiedTimestamp: '2026-01-01T00:00:00Z' },
      { contextId: { checkId: 'dup1', reference: { bookId: 'tit', chapter: 1, verse: 1 } }, comments: 'newer', modifiedTimestamp: '2026-06-01T00:00:00Z' },
      { contextId: { checkId: 'dup1', reference: { bookId: 'tit', chapter: 1, verse: 1 } }, comments: 'oldest', modifiedTimestamp: '2025-01-01T00:00:00Z' },
    ],
  })['tn-1:1-dup1']?.comment === 'newer');

// miniature check lists mirroring the fixture's decision records (what the
// PWA derives from the pinned TSVs at load time)
const twChecks = [
  { id: 'tw-1:1-t1g7', checkId: 't1g7', tool: 'tw', chapter: 1, verse: 1, reference: '1:1', quote: 'Θεοῦ', occurrence: 1, term: 'god', category: 'kt', groupId: 'god', link: 'rc://*/tw/dict/bible/kt/god' },
  { id: 'tw-1:1-a9p2', checkId: 'a9p2', tool: 'tw', chapter: 1, verse: 1, reference: '1:1', quote: 'ἀπόστολος', occurrence: 1, term: 'apostle', category: 'kt', groupId: 'apostle', link: 'rc://*/tw/dict/bible/kt/apostle' },
];
const tnChecks = [
  { id: 'tn-1:1-swi9', checkId: 'swi9', tool: 'tn', chapter: 1, verse: 1, reference: '1:1', quote: 'κατὰ πίστιν', occurrence: 1, groupId: 'figs-abstractnouns', support: 'rc://*/ta/man/translate/figs-abstractnouns', note: 'Faith is an abstract noun.' },
  { id: 'tn-1:4-gr8c', checkId: 'gr8c', tool: 'tn', chapter: 1, verse: 4, reference: '1:4', quote: 'χάρις καὶ εἰρήνη', occurrence: 1, groupId: 'translate-blessing', support: 'rc://*/ta/man/translate/translate-blessing', note: 'Grace and peace was a customary greeting.' },
];
const checks = { tn: tnChecks, tw: twChecks };
const project = { bookCode: 'TIT', name: 'Round-trip', createdAt: '2026-07-07T00:00:00.000Z' };
const burrito = { metadata: imp.metadata, files: imp.files, pins: imp.pins, settings: imp.settings };

// ---------- 3. export with nothing touched: everything round-trips ----------
{
  const out = unzipSync(exportBurrito({ project, burrito, checks, states: seeded, journal: null }));
  check('round-trip: unmodeled files byte-identical (alignments sidecar)',
    deepEq(out['ingredients/checking/alignments/TIT.json'], fixtureFiles['ingredients/checking/alignments/TIT.json']));
  check('round-trip: sibling book USFM byte-identical', deepEq(out['ingredients/JON.usfm'], fixtureFiles['ingredients/JON.usfm']));
  check('round-trip: resources.json and settings.json byte-identical',
    deepEq(out['ingredients/checking/resources.json'], fixtureFiles['ingredients/checking/resources.json']) &&
    deepEq(out['ingredients/checking/settings.json'], fixtureFiles['ingredients/checking/settings.json']));

  for (const tool of ['translationNotes', 'translationWords']) {
    const exported = JSON.parse(strFromU8(out[`ingredients/checking/${tool}/TIT.json`]));
    const original = JSON.parse(strFromU8(fixtureFiles[`ingredients/checking/${tool}/TIT.json`]));
    check(`round-trip: untouched ${tool} decisions verbatim (full tC3 record shape)`,
      deepEq(exported.decisions, original.decisions) && exported.resource.version === original.resource.version);
  }

  const metadata = JSON.parse(strFromU8(out['metadata.json']));
  const { ok, errors } = sbValid(metadata);
  check('round-trip: metadata.json valid against Pankosmia bundled SB schema', ok, errors);
  const fixtureMeta = JSON.parse(strFromU8(fixtureFiles['metadata.json']));
  check('round-trip: relationships and identification preserved (Change-1 semantics)',
    deepEq(metadata.relationships, fixtureMeta.relationships) && deepEq(metadata.identification, fixtureMeta.identification));

  const zipIngredients = Object.keys(out).filter((p) => p.startsWith('ingredients/')).sort();
  const listed = Object.keys(metadata.ingredients).sort();
  const integrity = zipIngredients.every((p) =>
    metadata.ingredients[p] && metadata.ingredients[p].checksum.md5 === md5(out[p]) && metadata.ingredients[p].size === out[p].length);
  check('round-trip: ingredients table matches zip exactly (paths, md5, size)',
    deepEq(zipIngredients, listed) && integrity);
  check('round-trip: ingredient roles carried forward',
    metadata.ingredients['ingredients/checking/alignments/TIT.json'].role === 'x-alignment' &&
    metadata.ingredients['ingredients/checking/translationWords/TIT.json'].role === 'x-check-decisions' &&
    metadata.ingredients['ingredients/checking/resources.json'].role === 'x-resource-links');
}

// ---------- 4. export with changes: merge by identity key ----------
{
  const states = JSON.parse(JSON.stringify(seeded));
  states['tw-1:1-t1g7'] = {
    selections: [{ text: 'Señor', occurrence: '1', occurrences: '1' }], // strings on purpose: I-2 must normalize
    comment: '', reminder: false, nothingToSelect: false, modifiedAt: '2026-07-07T10:00:00.000Z',
  };
  const newTn = { id: 'tn-3:15-zzz9', checkId: 'zzz9', tool: 'tn', chapter: 3, verse: 15, reference: '3:15', quote: 'χάρις & εἰρήνη', occurrence: 1, groupId: 'translate-blessing', support: 'rc://*/ta/man/translate/translate-blessing', note: 'A new check.' };
  states['tn-3:15-zzz9'] = { selections: [], comment: 'revisar', reminder: true, nothingToSelect: false, modifiedAt: '2026-07-07T10:05:00.000Z' };

  const out = unzipSync(exportBurrito({ project, burrito, checks: { tn: [...tnChecks, newTn], tw: twChecks }, states, journal: null }));
  const tw = JSON.parse(strFromU8(out['ingredients/checking/translationWords/TIT.json']));
  const updated = tw.decisions.find((d) => d.contextId.checkId === 't1g7');
  const untouched = tw.decisions.find((d) => d.contextId.checkId === 'a9p2');
  const originalTw = JSON.parse(strFromU8(fixtureFiles['ingredients/checking/translationWords/TIT.json']));
  check('merge: touched record updated in place (selections, status, timestamp)',
    updated.selections[0].text === 'Señor' && updated.selections[0].occurrence === 1 &&
    updated.status === 'valid' && updated.invalidated === false &&
    updated.modifiedTimestamp === '2026-07-07T10:00:00.000Z' &&
    updated.contextId.quote === 'Θεοῦ' && updated.contextId.glQuote === '');
  check('merge: I-2 — occurrences persisted as integers',
    typeof updated.selections[0].occurrence === 'number' && typeof updated.selections[0].occurrences === 'number');
  check('merge: untouched record byte-for-byte verbatim (incl. reminders, no status added)',
    deepEq(untouched, originalTw.decisions.find((d) => d.contextId.checkId === 'a9p2')));

  const tn = JSON.parse(strFromU8(out['ingredients/checking/translationNotes/TIT.json']));
  const appended = tn.decisions.find((d) => d.contextId.checkId === 'zzz9');
  check('merge: new decision appended in full tC3 shape',
    appended && appended.contextId.tool === 'translationNotes' &&
    appended.contextId.reference.bookId === 'tit' && appended.contextId.reference.chapter === 3 &&
    appended.contextId.reference.verse === 15 && appended.category === 'translate' &&
    appended.contextId.occurrenceNote === 'A new check.' && appended.comments === 'revisar' &&
    appended.reminders === true && appended.selections === false && appended.status === 'todo');
  check('merge: tN quote is a word-array; "&" becomes a bare ellipsis marker (tC shape)',
    deepEq(appended.contextId.quote, [{ word: 'χάρις', occurrence: 1 }, { word: '…' }, { word: 'εἰρήνη', occurrence: 1 }]) &&
    appended.contextId.quoteString === 'χάρις … εἰρήνη');
  check('merge: invalidated record left verbatim when untouched',
    tn.decisions.find((d) => d.contextId.checkId === 'gr8c').invalidated === true);
  check('merge: summary regenerated from decisions', tw.summary.decided.kt === 2 && tn.summary.decided.translate === 2);
}

// ---------- 5. identity key semantics (spans, no Number() coercion) ----------
{
  const spanRecord = {
    contextId: { checkId: 'sp01', reference: { bookId: 'jon', chapter: 2, verse: '9-10' }, tool: 'translationNotes', groupId: 'g', quote: [{ word: 'x', occurrence: 1 }], quoteString: 'x', glQuote: '', occurrence: 1 },
    category: 'translate', selections: false, comments: false, reminders: false, nothingToSelect: false,
    verseEdits: false, invalidated: false, modifiedTimestamp: '2026-07-01T00:00:00.000Z',
  };
  const imported = { schemaVersion: 1, tool: 'translationNotes', book: 'JON', resource: { repoPath: 'r', version: 'v' }, decisions: [spanRecord] };
  const spanCheck = { id: 'tn-2:9-10-sp01', checkId: 'sp01', reference: '2:9-10', quote: 'x', occurrence: 1, groupId: 'g', support: '', note: '' };
  const merged = mergeDecisions({
    imported, checks: [spanCheck],
    states: { 'tn-2:9-10-sp01': { selections: [{ text: 'y', occurrence: 1, occurrences: 1 }], comment: '', reminder: false, nothingToSelect: false, modifiedAt: '2026-07-07T11:00:00.000Z' } },
    tool: 'tn', book: 'JON',
  });
  check('spans: "2:9-10" state matches the "9-10" record (strings both sides)',
    merged.decisions.length === 1 && merged.decisions[0].selections !== false && merged.decisions[0].contextId.reference.verse === '9-10');

  const notMerged = mergeDecisions({
    imported: JSON.parse(JSON.stringify(imported)),
    checks: [{ ...spanCheck, id: 'tn-2:9-sp01', reference: '2:9' }],
    states: { 'tn-2:9-sp01': { selections: [{ text: 'y', occurrence: 1, occurrences: 1 }], comment: '', reminder: false, nothingToSelect: false, modifiedAt: '2026-07-07T11:00:00.000Z' } },
    tool: 'tn', book: 'JON',
  });
  check('spans: verse 9 does NOT match the 9-10 span record; new record appended instead',
    notMerged.decisions.length === 2 && notMerged.decisions[0].selections === false);
  // resource drifted under a touched decision: the user's work must not be
  // lost, and duplicating the identity key is not allowed — the record is
  // re-anchored to the current resource
  const drifted = mergeDecisions({
    imported: JSON.parse(JSON.stringify(imported)),
    checks: [{ ...spanCheck, quote: 'DIFFERENT' }],
    states: { 'tn-2:9-10-sp01': { selections: [{ text: 'y', occurrence: 1, occurrences: 1 }], comment: '', reminder: false, nothingToSelect: false, modifiedAt: '2026-07-07T11:00:00.000Z' } },
    tool: 'tn', book: 'JON',
  });
  check('quoteString drift + touched: record re-anchored to current resource, work kept',
    drifted.decisions.length === 1 &&
    drifted.decisions[0].contextId.quoteString === 'DIFFERENT' &&
    drifted.decisions[0].selections[0]?.text === 'y' &&
    drifted.decisions[0].modifiedTimestamp === '2026-07-07T11:00:00.000Z');
  check('quoteString drift + untouched: record round-trips verbatim',
    mergeDecisions({
      imported: JSON.parse(JSON.stringify(imported)),
      checks: [{ ...spanCheck, quote: 'DIFFERENT' }],
      states: { 'tn-2:9-10-sp01': { selections: [], comment: '', reminder: false, nothingToSelect: false, modifiedAt: '2026-07-01T00:00:00.000Z' } },
      tool: 'tn', book: 'JON',
    }).decisions[0].contextId.quoteString === 'x');
}

// ---------- 6. journal (BURRITO-SPEC §8 design draft) ----------
{
  const actor = 'pwa-test1234';
  const ts1 = hlcString(Date.parse('2026-07-07T10:00:00.000Z'), 0, actor);
  const e1 = buildDecisionEvent({
    actor, ts: ts1, base: null, book: 'TIT', tool: 'tw', check: twChecks[0],
    state: { selections: [{ text: 'Señor', occurrence: 1, occurrences: 1 }], comment: '', reminder: false, nothingToSelect: false },
  });
  const e2 = buildDecisionEvent({
    actor, ts: hlcString(Date.parse('2026-07-07T10:00:00.000Z'), 1, actor), base: e1.id, book: 'TIT', tool: 'tw', check: twChecks[0],
    state: { selections: [], comment: '', reminder: false, nothingToSelect: true },
  });
  check('journal: §8.2 envelope shape (v, op, actor, HLC ts, content-hash id, ref, base)',
    e1.v === 1 && e1.op === 'check.decision.set' && e1.actor === actor &&
    /^2026-07-07T10:00:00\.000Z\|0000\|pwa-test1234$/.test(e1.ts) &&
    /^[0-9a-f]{32}$/.test(e1.id) && e1.ref === 'TIT 1:1' && e1.base === null && e2.base === e1.id);
  check('journal: HLC is monotonic within one millisecond and orders lexicographically',
    nextHlcState({ ms: 5, n: 0 }, 5).n === 1 && nextHlcState({ ms: 5, n: 3 }, 9).n === 0 && e1.ts < e2.ts);

  const out = unzipSync(exportBurrito({ project, burrito, checks, states: seeded, journal: { actorId: actor, events: [e1, e2] } }));
  const jsonl = strFromU8(out[`ingredients/checking/journal/${actor}/TIT.00001.jsonl`] || new Uint8Array());
  const lines = jsonl.trim().split('\n').map((l) => JSON.parse(l));
  check('journal: exported as per-actor JSONL with actor.json',
    lines.length === 2 && lines[1].base === lines[0].id && !!out[`ingredients/checking/journal/${actor}/actor.json`]);
  const metadata = JSON.parse(strFromU8(out['metadata.json']));
  const entry = metadata.ingredients[`ingredients/checking/journal/${actor}/TIT.00001.jsonl`];
  check('journal: ingredient registered with role x-journal + application/x-ndjson + book scope',
    entry?.role === 'x-journal' && entry?.mimeType === 'application/x-ndjson' && deepEq(entry?.scope, { TIT: [] }));
  check('journal: metadata still schema-valid with journal ingredients', sbValid(metadata).ok, sbValid(metadata).errors);
}

// ---------- 7. fresh (non-burrito) project export ----------
{
  const aligned = [
    '\\id TIT test', '\\usfm 3.0', '\\h Tito', '\\toc1 Tito', '\\toc2 Tito', '\\toc3 Tit', '\\mt Tito', '\\c 1', '\\p',
    '\\v 1 \\zaln-s |x-strong="G39720" x-lemma="Παῦλος" x-morph="Gr,N,,,,,NMS," x-occurrence="1" x-occurrences="1" x-content="Παῦλος"\\*\\w Pablo|x-occurrence="1" x-occurrences="1"\\w*\\zaln-e\\*, siervo de Dios',
  ].join('\n');
  const fresh = { bookCode: 'TIT', name: 'Tito (upload)', createdAt: '2026-07-07T00:00:00.000Z', usfmText: aligned };
  const states = { 'tw-1:1-t1g7': { selections: [{ text: 'Dios', occurrence: 1, occurrences: 1 }], comment: '', reminder: false, nothingToSelect: false, modifiedAt: '2026-07-07T12:00:00.000Z' } };
  const out = unzipSync(exportBurrito({ project: fresh, burrito: null, checks, states, journal: null }));

  const usfm = strFromU8(out['ingredients/TIT.usfm']);
  check('fresh: INVARIANT I-1 — no alignment markup at rest, text intact',
    !usfm.includes('\\zaln') && !usfm.includes('\\w ') && usfm.includes('\\v 1 Pablo, siervo de Dios'));
  check('fresh: plain USFM passes through the stripper unchanged',
    stripAlignmentMarkup(strFromU8(fixtureFiles['ingredients/TIT.usfm'])) === strFromU8(fixtureFiles['ingredients/TIT.usfm']));

  const metadata = JSON.parse(strFromU8(out['metadata.json']));
  check('fresh: metadata valid against SB schema', sbValid(metadata).ok, sbValid(metadata).errors);
  check('fresh: scope + generator + gitignore',
    deepEq(metadata.type.flavorType.currentScope, { TIT: [] }) &&
    metadata.meta.generator.softwareName === 'tCore Checks (PWA)' &&
    strFromU8(out['.gitignore']).includes('**/*.bak'));
  const resources = JSON.parse(strFromU8(out['ingredients/checking/resources.json']));
  check('fresh: unpinned resources.json written (version master)',
    resources.resources.translationNotes.version === 'master' && !!out['ingredients/checking/settings.json']);
  const tw = JSON.parse(strFromU8(out['ingredients/checking/translationWords/TIT.json']));
  check('fresh: decision file holds the one touched check',
    tw.decisions.length === 1 && tw.decisions[0].contextId.checkId === 't1g7' && tw.decisions[0].status === 'valid');
  check('fresh: quoteToArray occurrence counts repeat within a quote',
    deepEq(quoteToArray('τοῦ Θεοῦ καὶ τοῦ'), [{ word: 'τοῦ', occurrence: 1 }, { word: 'Θεοῦ', occurrence: 1 }, { word: 'καὶ', occurrence: 1 }, { word: 'τοῦ', occurrence: 2 }]));
  // Regression (OBA 1:5 figs-doublet w86v): a maqaf-joined quote must tokenize
  // the way tC's group data does — split on "־", maqaf as its own token — or tC
  // drops the decision (its findGroupDataItem deep-equals the quote array).
  check('fresh: quoteToArray splits on the Hebrew maqaf like tC group data',
    deepEq(quoteToArray('אִם־גַּנָּבִ֤ים בָּאֽוּ־לְ⁠ךָ֙ אִם־שׁ֣וֹדְדֵי לַ֔יְלָה'), [
      { word: 'אִם', occurrence: 1 }, { word: '־', occurrence: 1 }, { word: 'גַּנָּבִ֤ים', occurrence: 1 },
      { word: 'בָּאֽוּ', occurrence: 1 }, { word: '־', occurrence: 2 }, { word: 'לְ⁠ךָ֙', occurrence: 1 },
      { word: 'אִם', occurrence: 2 }, { word: '־', occurrence: 3 }, { word: 'שׁ֣וֹדְדֵי', occurrence: 1 },
      { word: 'לַ֔יְלָה', occurrence: 1 },
    ]));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
