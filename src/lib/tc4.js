// tC4 Scripture Burrito interoperability (BURRITO-SPEC 1.1-draft).
// Import: read a tC4 project zip (metadata + USFM + checking sidecars) into
// PWA projects/states, preserving every file we don't model verbatim.
// Export: write a conforming burrito back — full tC3-shape decision records
// merged by the spec's identity key, ingredients table regenerated with
// role carry-forward (same semantics as upstream Change 1).
// Pure module (no IndexedDB/DOM) so it runs in node tests as-is.

import { unzipSync, zipSync, strToU8, strFromU8 } from 'fflate';
import { md5 } from './md5.js';

export const TOOL_IDS = { tn: 'translationNotes', tw: 'translationWords' };
const DECISION_DIRS = ['translationWords', 'translationNotes', 'translationQuestions'];

// ---------- shared helpers ----------

function roleForPath(path) {
  if (/^ingredients\/checking\/alignments\//.test(path)) return 'x-alignment';
  if (new RegExp(`^ingredients/checking/(${DECISION_DIRS.join('|')})/`).test(path))
    return 'x-check-decisions';
  if (path === 'ingredients/checking/resources.json') return 'x-resource-links';
  if (path === 'ingredients/checking/settings.json') return 'x-check-settings';
  if (/^ingredients\/checking\/journal\//.test(path)) return 'x-journal';
  return null;
}

function mimeTypeForPath(path, previous) {
  if (/\.usfm$/i.test(path)) return 'text/plain';
  if (/\.jsonl$/i.test(path)) return 'application/x-ndjson';
  if (/\.json$/i.test(path)) return 'application/json';
  return previous || 'text/plain';
}

// "2:9-10" -> {chapterStr: "2", verseStr: "9-10"}; spans stay strings (never Number())
function splitReference(reference) {
  const i = reference.indexOf(':');
  return { chapterStr: reference.slice(0, i), verseStr: reference.slice(i + 1) };
}

// Identity key per BURRITO-SPEC §5.2 — chapter/verse compare as strings
export function decisionKey(checkId, bookId, chapter, verse, occurrence) {
  return [checkId, String(bookId).toLowerCase(), String(chapter), String(verse), String(occurrence)].join('|');
}

function keyOfRecord(d) {
  const r = d.contextId.reference;
  return decisionKey(d.contextId.checkId, r.bookId, r.chapter, r.verse, d.contextId.occurrence);
}

function keyOfCheck(check, book) {
  const { chapterStr, verseStr } = splitReference(check.reference);
  return decisionKey(check.checkId, book, chapterStr, verseStr, check.occurrence);
}

// Quote normalization for quoteString verification: zero-width spaces out,
// TSV "&" and ellipsis are the same discontinuity separator
export function normalizeQuote(quote) {
  const s = Array.isArray(quote) ? quote.map((w) => w.word).join(' ') : String(quote || '');
  return s.replace(/​/g, '').replace(/\s*&\s*/g, ' … ').replace(/\s+/g, ' ').trim();
}

// tN quote string -> [{word, occurrence}] array. Occurrence is the running
// count within the quote — correct whenever the quote occurs once in the
// verse (the TSV's Occurrence column covers the rest of the identity).
export function quoteToArray(quote) {
  const counts = {};
  return normalizeQuote(quote)
    .split(' ')
    .filter(Boolean)
    .map((word) => {
      counts[word] = (counts[word] || 0) + 1;
      return { word, occurrence: counts[word] };
    });
}

export function isDoneState(state) {
  return !!state && (state.nothingToSelect || (state.selections || []).length > 0);
}

function normalizeSelections(selections) {
  // INVARIANT I-2: occurrence/occurrences persist as integers
  return selections.map((s) => ({
    text: s.text,
    occurrence: Number(s.occurrence),
    occurrences: Number(s.occurrences),
  }));
}

const jsonBytes = (obj) => strToU8(JSON.stringify(obj, null, 2) + '\n');

// ---------- import ----------

// zipBytes (Uint8Array) -> {metadata, books, pins, gatewayLanguage, settings,
//   decisions: {BOOK: {tn: [...], tw: [...]}}, files: {path: Uint8Array}}
export function importBurrito(zipBytes) {
  const raw = unzipSync(zipBytes);
  // tolerate a single wrapper directory (hand-zipped project folders)
  const metaPath = Object.keys(raw)
    .filter((p) => p.split('/').pop() === 'metadata.json')
    .sort((a, b) => a.split('/').length - b.split('/').length)[0];
  if (!metaPath) throw new Error('Not a Scripture Burrito: no metadata.json in zip');
  const prefix = metaPath.slice(0, -'metadata.json'.length);

  const files = {};
  for (const [path, data] of Object.entries(raw)) {
    if (path.endsWith('/') || !path.startsWith(prefix)) continue;
    files[path.slice(prefix.length)] = data;
  }

  const text = (path) => (files[path] != null ? strFromU8(files[path]) : null);
  const json = (path) => {
    const t = text(path);
    return t == null ? null : JSON.parse(t);
  };

  const metadata = json('metadata.json');
  const flavor = metadata?.type?.flavorType?.flavor?.name;
  if (flavor && flavor !== 'textTranslation') {
    throw new Error(`Unsupported burrito flavor: ${flavor} (expected textTranslation)`);
  }

  const books = Object.keys(files)
    .map((p) => /^ingredients\/([A-Z0-9]{3})\.usfm$/i.exec(p))
    .filter(Boolean)
    .map((m) => ({ book: m[1].toUpperCase(), usfmText: text(m[0]) }));
  if (!books.length) throw new Error('Burrito contains no ingredients/<BOOK>.usfm files');

  const resources = json('ingredients/checking/resources.json');
  const decisions = {};
  for (const { book } of books) {
    decisions[book] = {};
    for (const [tool, dir] of Object.entries(TOOL_IDS)) {
      const file = json(`ingredients/checking/${dir}/${book}.json`);
      decisions[book][tool] = file?.decisions || [];
    }
  }

  return {
    metadata,
    books,
    pins: resources?.resources || null,
    gatewayLanguage: resources?.gatewayLanguage || null,
    settings: json('ingredients/checking/settings.json'),
    decisions,
    files,
  };
}

// Imported decision records -> PWA check states keyed by the PWA check id
// (`tn-1:1-swi9`); span verses key naturally ("9-10" is already a string)
export function seedStatesFromDecisions(decisionsByTool) {
  const states = {};
  for (const [tool, records] of Object.entries(decisionsByTool)) {
    for (const d of records) {
      const r = d.contextId?.reference;
      if (!r || d.contextId.checkId == null) continue;
      states[`${tool}-${r.chapter}:${r.verse}-${d.contextId.checkId}`] = {
        selections: Array.isArray(d.selections) ? d.selections : [],
        comment: typeof d.comments === 'string' ? d.comments : '',
        reminder: !!d.reminders,
        nothingToSelect: !!d.nothingToSelect,
        modifiedAt: d.modifiedTimestamp,
      };
    }
  }
  return states;
}

// ---------- decision merge (export) ----------

function taCategory(supportReference) {
  const m = /\/man\/([^/]+)\//.exec(supportReference || '');
  return m ? m[1] : 'translate';
}

function recordFromCheck(check, state, tool, book) {
  const { chapterStr, verseStr } = splitReference(check.reference);
  const isTn = tool === 'tn';
  return {
    contextId: {
      checkId: check.checkId,
      occurrenceNote: isTn ? check.note || '' : '',
      reference: {
        bookId: book.toLowerCase(),
        chapter: Number(chapterStr),
        verse: /^\d+$/.test(verseStr) ? Number(verseStr) : verseStr,
      },
      tool: TOOL_IDS[tool],
      groupId: check.groupId,
      quote: isTn ? quoteToArray(check.quote) : normalizeQuote(check.quote),
      quoteString: normalizeQuote(check.quote),
      glQuote: '',
      occurrence: Number(check.occurrence),
    },
    category: isTn ? taCategory(check.support) : check.category,
    ...decisionFieldsFromState(state),
  };
}

function decisionFieldsFromState(state) {
  return {
    selections: state.selections?.length ? normalizeSelections(state.selections) : false,
    comments: state.comment ? state.comment : false,
    reminders: !!state.reminder,
    nothingToSelect: !!state.nothingToSelect,
    verseEdits: false,
    invalidated: false,
    status: isDoneState(state) ? 'valid' : 'todo',
    modifiedTimestamp: state.modifiedAt || new Date().toISOString(),
  };
}

// Merge PWA states into the imported decision file for one tool+book.
// Untouched and unmatched imported records round-trip verbatim; a key match
// whose quoteString differs is treated as unmatched (resource changed).
export function mergeDecisions({ imported, checks, states, tool, book, resourcePin }) {
  const out = imported
    ? JSON.parse(JSON.stringify(imported))
    : {
        schemaVersion: 1,
        tool: TOOL_IDS[tool],
        book,
        resource: resourcePin
          ? { repoPath: resourcePin.repoPath, version: resourcePin.version }
          : { repoPath: `git.door43.org/unfoldingWord/en_${tool}`, version: 'master' },
        decisions: [],
      };

  const byKey = new Map(out.decisions.map((d) => [keyOfRecord(d), d]));
  const appended = [];
  for (const check of checks) {
    const state = states[check.id];
    if (!state) continue;
    const record = byKey.get(keyOfCheck(check, book));
    if (record) {
      if (!state.modifiedAt || state.modifiedAt === record.modifiedTimestamp) continue; // untouched
      if (normalizeQuote(record.contextId.quoteString) !== normalizeQuote(check.quote)) continue; // resource drift
      Object.assign(record, decisionFieldsFromState(state));
    } else if (
      state.selections?.length || state.comment || state.reminder || state.nothingToSelect
    ) {
      appended.push(recordFromCheck(check, state, tool, book));
    }
  }
  appended.sort((a, b) => {
    const ra = a.contextId.reference, rb = b.contextId.reference;
    return ra.chapter - rb.chapter || String(ra.verse).localeCompare(String(rb.verse), 'en', { numeric: true });
  });
  out.decisions.push(...appended);

  const decided = {};
  for (const d of out.decisions) {
    if (d.selections !== false || d.nothingToSelect) {
      decided[d.category] = (decided[d.category] || 0) + 1;
    }
  }
  out.summary = { note: 'derived cache, regenerable — decided counts by category', decided };
  return out;
}

// ---------- USFM at rest (INVARIANT I-1) ----------

// Strip \zaln milestones and unwrap \w tokens so alignment markup never
// lands in a stored burrito (BURRITO-SPEC §4.1). Structure (\p, \q…) is kept.
export function stripAlignmentMarkup(usfm) {
  return usfm
    .replace(/\\zaln-s[^\\]*\\\*/g, '')
    .replace(/\\zaln-e\\\*/g, '')
    .replace(/\\w (.*?)\|.*?\\w\*/g, '$1')
    .replace(/\\w (.*?)\\w\*/g, '$1')
    .replace(/ {2,}/g, ' ')
    .replace(/[ \t]+$/gm, '');
}

// ---------- metadata ----------

const GENERATOR = { softwareName: 'tCore Checks (PWA)', softwareVersion: '0.1.0' };

function freshMetadata(project, book) {
  const slug = `${book.toLowerCase()}_checks`;
  const created = project.createdAt || new Date().toISOString();
  return {
    format: 'scripture burrito',
    meta: {
      version: '1.0.0',
      category: 'source',
      generator: { ...GENERATOR },
      defaultLocale: 'en',
      dateCreated: created,
      normalization: 'NFC',
    },
    idAuthorities: { local: { id: 'http://_local_', name: { en: 'Local Project' } } },
    identification: {
      primary: { local: { [slug]: { revision: '1', timestamp: created } } },
      name: { en: project.name || book },
      abbreviation: { en: slug },
    },
    languages: [{ tag: 'und', name: { en: 'Undetermined' }, scriptDirection: 'ltr' }],
    type: {
      flavorType: {
        name: 'scripture',
        flavor: {
          name: 'textTranslation',
          usfmVersion: '3.0',
          translationType: 'firstTranslation',
          audience: 'common',
          projectType: 'standard',
        },
        currentScope: { [book]: [] },
      },
    },
    confidential: false,
    localizedNames: {},
    ingredients: {},
    copyright: { shortStatements: [{ statement: 'Copyright not specified' }] },
  };
}

// Rebuild the ingredients table from the files actually present: fresh scan
// wins for checksum/size/mimeType/scope; role carries forward for surviving
// paths, else is assigned by path convention (§2) — Change-1 semantics.
function rebuildIngredients(metadata, files) {
  const scope = metadata.type?.flavorType?.currentScope || {};
  const previous = metadata.ingredients || {};
  const ingredients = {};
  for (const path of Object.keys(files).sort()) {
    if (!path.startsWith('ingredients/')) continue;
    const data = files[path];
    const entry = {
      checksum: { md5: md5(data) },
      mimeType: mimeTypeForPath(path, previous[path]?.mimeType),
      size: data.length,
    };
    const bookPart = path.split('/').pop().split('.')[0].toUpperCase();
    if (scope[bookPart]) entry.scope = { [bookPart]: [] };
    const role = previous[path]?.role || roleForPath(path);
    if (role) entry.role = role;
    ingredients[path] = entry;
  }
  metadata.ingredients = ingredients;
}

// ---------- fresh-project sidecar defaults ----------

function defaultResources() {
  return {
    schemaVersion: 1,
    note: 'Written by tCore Checks (PWA). version "master" means unpinned — fetched from the default branch.',
    gatewayLanguage: { languageId: 'en', owner: 'unfoldingWord' },
    resources: {
      originalLanguage: {
        nt: { repoPath: 'git.door43.org/unfoldingWord/grc_ugnt', version: 'master', flavor: 'scripture/textTranslation' },
        ot: { repoPath: 'git.door43.org/unfoldingWord/hbo_uhb', version: 'master', flavor: 'scripture/textTranslation' },
      },
      translationWords: { repoPath: 'git.door43.org/unfoldingWord/en_tw', version: 'master', flavor: 'parascriptural/x-bcvarticles' },
      translationNotes: { repoPath: 'git.door43.org/unfoldingWord/en_tn', version: 'master', flavor: 'parascriptural/x-bcvnotes' },
      translationAcademy: { repoPath: 'git.door43.org/unfoldingWord/en_ta', version: 'master', flavor: 'peripheral/x-peripheralArticles' },
      lexicon: {
        nt: { repoPath: 'git.door43.org/unfoldingWord/en_ugl', version: 'master', flavor: 'peripheral/x-lexicon' },
        ot: { repoPath: 'git.door43.org/unfoldingWord/en_uhl', version: 'master', flavor: 'peripheral/x-lexicon' },
      },
    },
  };
}

function defaultSettings(checks) {
  const categories = (list, fallback) => {
    const seen = [...new Set(list.map((c) => c.category).filter(Boolean))];
    return seen.length ? seen : fallback;
  };
  return {
    schemaVersion: 1,
    checkCategories: {
      translationWords: categories(checks.tw, ['kt', 'names', 'other']),
      translationNotes: [...new Set(checks.tn.map((c) => taCategory(c.support)))],
    },
    ui: { paneSettings: [{ bibleId: 'targetBible', languageId: 'und' }], toolsSettings: {} },
  };
}

// ---------- export ----------

// Build a conforming tC4 burrito zip. `burrito` is the stored import context
// (null for fresh USFM uploads); `journal` is {actorId, actorInfo, events}.
// For imported multi-book projects, sibling books' files round-trip verbatim;
// only the current project's book is updated from local states.
export function exportBurrito({ project, burrito, checks, states, journal }) {
  const book = project.bookCode.toUpperCase();
  const files = { ...(burrito?.files || {}) };
  delete files['metadata.json']; // regenerated below

  if (!files[`ingredients/${book}.usfm`]) {
    if (!project.usfmText) {
      throw new Error('This project predates burrito export — re-upload its USFM to enable it.');
    }
    files[`ingredients/${book}.usfm`] = strToU8(stripAlignmentMarkup(project.usfmText));
  }

  const pins = burrito?.pins || null;
  for (const [tool, dir] of Object.entries(TOOL_IDS)) {
    const path = `ingredients/checking/${dir}/${book}.json`;
    const imported = files[path] ? JSON.parse(strFromU8(files[path])) : null;
    const merged = mergeDecisions({
      imported,
      checks: checks[tool] || [],
      states,
      tool,
      book,
      resourcePin: pins?.[TOOL_IDS[tool]],
    });
    if (merged.decisions.length || imported) files[path] = jsonBytes(merged);
  }

  if (!files['ingredients/checking/resources.json']) {
    files['ingredients/checking/resources.json'] = jsonBytes(defaultResources());
  }
  if (!files['ingredients/checking/settings.json']) {
    files['ingredients/checking/settings.json'] = jsonBytes(defaultSettings(checks));
  }
  if (!files['.gitignore']) files['.gitignore'] = strToU8('**/*.bak\n');

  if (journal?.events?.length) {
    const dir = `ingredients/checking/journal/${journal.actorId}`;
    files[`${dir}/actor.json`] = jsonBytes({
      actorId: journal.actorId,
      displayName: journal.actorInfo?.displayName || 'tCore Checks (PWA)',
      software: { ...GENERATOR },
    });
    // rotate at ~1 MB per BURRITO-SPEC §8.1
    let seq = 1, lines = [], size = 0;
    const flush = () => {
      if (!lines.length) return;
      files[`${dir}/${book}.${String(seq++).padStart(5, '0')}.jsonl`] = strToU8(lines.join('\n') + '\n');
      lines = []; size = 0;
    };
    for (const event of journal.events) {
      const line = JSON.stringify(event);
      lines.push(line);
      size += line.length + 1;
      if (size >= 1_000_000) flush();
    }
    flush();
  }

  const metadata = burrito?.metadata
    ? JSON.parse(JSON.stringify(burrito.metadata))
    : freshMetadata(project, book);
  metadata.meta = { ...metadata.meta, generator: { ...metadata.meta?.generator, ...GENERATOR } };
  const scope = metadata.type.flavorType.currentScope || {};
  if (!scope[book]) scope[book] = [];
  metadata.type.flavorType.currentScope = scope;
  rebuildIngredients(metadata, files);
  files['metadata.json'] = jsonBytes(metadata);

  return zipSync(files, { level: 6 });
}
