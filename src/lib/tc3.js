// translationCore 3 (tC3) project import — backward compatibility.
//
// READ-ONLY, and deliberately isolated from the burrito path (src/lib/tc4.js):
// nothing here writes, and the burrito pipeline never imports this file. A tC3
// project is converted into the same neutral shape the app already consumes —
// a target USFM string, resource pins, and decision records shaped exactly like
// tc4.js's so `seedStatesFromDecisions` seeds them unchanged.
//
// tC3 on-disk layout (verified against a real tc_version 8 project,
// git.door43.org/deferredreward/en_rnb_oba_book):
//   manifest.json                                   ← book id, GL, resource pins
//   <book>.usfm                                     ← target translation
//   .apps/translationCore/checkData/<category>/<book>/<ch>/<v>/<ISO>.json
//       category ∈ selections | comments | reminders | invalidated | verseEdits
//       — decisions are SPLIT across per-category files (tc4 merges them into
//         one record), each timestamped; newest per (identity, category) wins.
//
// `verseEdits` is deliberately NOT imported (see IGNORED_CATEGORIES): it is an
// audit trail of target-text edits, not a checking decision — the edited text
// itself is already in <book>.usfm, which we import — and tC itself never counts
// a verse edit as a completed check (only selections/nothingToSelect count).
//
// Pure module (no IndexedDB/DOM) so it runs in node tests as-is.

import { unzipSync, strFromU8 } from 'fflate';

// tC3 contextId.tool -> the app's short tool key (matches tc4.js TOOL_IDS)
const TOOL_SHORT = { translationNotes: 'tn', translationWords: 'tw' };

// Per-category file payload -> the merged-record fields tc4's
// seedStatesFromDecisions reads. tC3 names two fields differently from tc4:
// comment text is `text` (tc4: `comments`), reminder flag is `enabled`
// (tc4: `reminders`) — bridged here so the downstream seeder is untouched.
const CATEGORY_FIELDS = {
  selections: (r) => ({
    selections: Array.isArray(r.selections) ? r.selections : [],
    nothingToSelect: !!r.nothingToSelect,
  }),
  comments: (r) => ({ comments: typeof r.text === 'string' ? r.text : '' }),
  reminders: (r) => ({ reminders: !!r.enabled }),
  invalidated: (r) => ({ invalidated: !!r.invalidated }),
};

// tC3 checkData categories we recognize but intentionally do not import, with
// the reason. Kept explicit (rather than falling through the CATEGORY_FIELDS
// miss) so a dropped category is a documented decision, not a silent omission.
const IGNORED_CATEGORIES = {
  verseEdits: 'target-text edit history — the edited text is already in <book>.usfm, and tC does not count an edit as a completed check',
};

const CHECKDATA_RE =
  /^\.apps\/translationCore\/checkData\/([^/]+)\/[^/]+\/([^/]+)\/([^/]+)\/[^/]+\.json$/;

// ---------- zip helpers ----------

// Shallowest path ending in `anchor` (tolerates the single wrapper directory
// a DCS archive download wraps the project in), or null.
function anchorPrefix(raw, anchor) {
  const hit = Object.keys(raw)
    .filter((p) => p.split('/').pop() === anchor)
    .sort((a, b) => a.split('/').length - b.split('/').length)[0];
  return hit ? hit.slice(0, -anchor.length) : null;
}

function parseJsonAt(raw, path) {
  const bytes = raw[path];
  if (bytes == null) return null;
  try {
    return JSON.parse(strFromU8(bytes));
  } catch {
    return null;
  }
}

// 'scripture burrito' | 'tc3' | null — routes an imported zip to the right
// importer. Prefers the explicit burrito signature; falls back to the tC3
// manifest signature so a tC3 project (which also has a manifest.json, but no
// scripture-burrito metadata.json) is recognized.
export function detectProjectFormat(zipBytes) {
  const raw = unzipSync(zipBytes);

  const metaPrefix = anchorPrefix(raw, 'metadata.json');
  if (metaPrefix != null) {
    const m = parseJsonAt(raw, `${metaPrefix}metadata.json`);
    if (m && (/burrito/i.test(String(m.format || '')) || m.type?.flavorType)) return 'burrito';
  }

  const manPrefix = anchorPrefix(raw, 'manifest.json');
  if (manPrefix != null) {
    const m = parseJsonAt(raw, `${manPrefix}manifest.json`);
    if (m && (m.tcInitialized || m.tc_version || m.tsv_relation)) return 'tc3';
  }

  return metaPrefix != null ? 'burrito' : null;
}

// ---------- manifest -> resource pins ----------

// "v88_unfoldingWord" -> "v88" (a tag pin fetchTnTsv turns into raw/tag/v88);
// anything not shaped like a version tag falls back to unpinned master.
function pinVersion(raw) {
  const v = String(raw || '').split('_')[0];
  return /^v\d/.test(v) ? v : 'master';
}

// Build the {translationNotes, translationWords} pin map in the same shape the
// burrito's checking/resources.json produces (BURRITO-SPEC §5.3), so loadChecks
// fetches the very release the project was checked against. tC3 stores the GL,
// owner, and version PER TOOL — a project can check tN and tW against different
// gateway languages — so each pin is resolved from that tool's own fields
// (`toolsSelectedGLs[tool]`, `toolsSelectedOwners[tool]`,
// `tc_<gl>_check_version_<tool>`), mirroring translationCore's MyProjectsActions.
function pinsFromManifest(manifest) {
  const gls = manifest.toolsSelectedGLs || {};
  const owners = manifest.toolsSelectedOwners || {};
  const pin = (tool, repo) => {
    const gl = gls[tool] || 'en';
    return {
      repoPath: `git.door43.org/${owners[tool] || 'unfoldingWord'}/${gl}_${repo}`,
      version: pinVersion(manifest[`tc_${gl}_check_version_${tool}`]),
    };
  };
  const tnGl = gls.translationNotes || 'en';
  const tnOwner = owners.translationNotes || 'unfoldingWord';
  return {
    gl: tnGl,
    owner: tnOwner,
    pins: {
      translationNotes: pin('translationNotes', 'tn'),
      translationWords: pin('translationWords', 'tw'),
      // tN check types resolve their titles/articles from translationAcademy.
      // tC3 ties tA to the tN gateway (same owner + GL) but records no tA
      // version (translationCore's MyProjectsActions adds the tA URL without a
      // version), so it stays master — matching how tC itself fetches it.
      translationAcademy: { repoPath: `git.door43.org/${tnOwner}/${tnGl}_ta`, version: 'master' },
    },
  };
}

// ---------- checkData -> merged decision records ----------

// A check's stable identity within the project. Prefer checkId (the TSV row id,
// present in modern tC3 projects) so records key 1:1 to the app's checks; fall
// back to group+quote+occurrence for older projects that predate checkId (those
// won't attach until re-anchored against the current resource — a known gap).
function identityOf(ctx, tool) {
  const ref = ctx.reference || {};
  const tail = ctx.checkId ?? `${ctx.groupId}:${ctx.quoteString || ''}:${ctx.occurrence}`;
  return [tool, ref.chapter, ref.verse, tail].join('|');
}

// Fold the per-category, per-verse, timestamped checkData files into one
// tc4-shaped decision record per check. Newest timestamp wins within a
// category; the record's modifiedTimestamp is the max across merged categories
// so downstream last-write-wins merges behave.
function mergeCheckData(raw, prefix) {
  // key = `${identity}|${category}` -> {ts, record, ctx, tool, identity}
  const latestPerCat = new Map();
  for (const path of Object.keys(raw)) {
    if (!path.startsWith(prefix)) continue;
    const m = CHECKDATA_RE.exec(path.slice(prefix.length));
    if (!m) continue;
    const category = m[1];
    if (IGNORED_CATEGORIES[category]) continue; // deliberate, documented skip
    if (!CATEGORY_FIELDS[category]) continue; //   unrecognized category — not modeled
    const record = parseJsonAt(raw, path);
    const ctx = record?.contextId;
    const tool = ctx && TOOL_SHORT[ctx.tool];
    if (!tool) continue;
    const identity = identityOf(ctx, tool);
    const ts = record.modifiedTimestamp || '';
    const key = `${identity}|${category}`;
    const prev = latestPerCat.get(key);
    if (!prev || ts > prev.ts) latestPerCat.set(key, { ts, record, ctx, tool, identity, category });
  }

  const merged = new Map(); // identity -> tc4-shaped decision record
  for (const { ts, record, ctx, tool, identity, category } of latestPerCat.values()) {
    let mr = merged.get(identity);
    if (!mr) {
      mr = {
        _tool: tool,
        contextId: ctx,
        selections: [],
        comments: '',
        reminders: false,
        nothingToSelect: false,
        invalidated: false,
        modifiedTimestamp: '',
      };
      merged.set(identity, mr);
    }
    Object.assign(mr, CATEGORY_FIELDS[category](record));
    if (ts > mr.modifiedTimestamp) mr.modifiedTimestamp = ts;
    // keep whichever contextId carries a checkId (best for keying)
    if (!mr.contextId.checkId && ctx.checkId) mr.contextId = ctx;
  }

  const decisions = { tn: [], tw: [] };
  for (const mr of merged.values()) {
    const { _tool, ...record } = mr;
    decisions[_tool].push(record);
  }
  return decisions;
}

// ---------- import ----------

// zipBytes (Uint8Array) -> {book, name, usfmText, gatewayLanguage, pins,
//   decisions: {tn: [...], tw: [...]}, manifest}. Decisions are tc4-shaped so
// Home's seedStatesFromDecisions seeds them directly.
export function importTc3(zipBytes) {
  const raw = unzipSync(zipBytes);
  const prefix = anchorPrefix(raw, 'manifest.json');
  if (prefix == null) throw new Error('Not a tC3 project: no manifest.json in zip');

  const manifest = parseJsonAt(raw, `${prefix}manifest.json`);
  if (!manifest || !(manifest.tcInitialized || manifest.tc_version)) {
    throw new Error('Not a translationCore 3 project (manifest.json is not tC-initialized)');
  }

  const book = String(manifest.project?.id || '').toLowerCase();
  if (!book) throw new Error('tC3 manifest.json has no project.id (book code)');

  // target USFM: <book>.usfm, else any root-level .usfm (tC also writes a
  // repo-named copy) — the chapter-split <book>/N.json is redundant with it.
  const text = (p) => (raw[`${prefix}${p}`] != null ? strFromU8(raw[`${prefix}${p}`]) : null);
  let usfmText = text(`${book}.usfm`);
  if (usfmText == null) {
    const rootUsfm = Object.keys(raw).find(
      (p) => p.startsWith(prefix) && /^[^/]+\.usfm$/i.test(p.slice(prefix.length)),
    );
    usfmText = rootUsfm ? strFromU8(raw[rootUsfm]) : null;
  }
  if (!usfmText) throw new Error(`tC3 project has no ${book}.usfm target text`);

  const { gl, owner, pins } = pinsFromManifest(manifest);

  return {
    book,
    name: manifest.resource?.name || manifest.project?.name || book,
    usfmText,
    gatewayLanguage: { languageId: gl, owner },
    pins,
    decisions: mergeCheckData(raw, prefix),
    manifest,
  };
}
