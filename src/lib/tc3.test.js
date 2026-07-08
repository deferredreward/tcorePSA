import { describe, it, expect } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { detectProjectFormat, importTc3 } from './tc3.js';
import { seedStatesFromDecisions, isDoneState } from './tc4.js';

// A minimal but faithful tC3 project, built from the real records in
// git.door43.org/deferredreward/en_rnb_oba_book (a tc_version 8 project): two
// translationNotes checks done in Obadiah, plus a comment/reminder/invalidated
// sidecar to exercise the cross-category merge.
const MANIFEST = {
  project: { id: 'oba', name: 'Obadiah' },
  resource: { id: 'RNB', name: 'redneck obadiah' },
  toolsSelectedGLs: { translationWords: 'en', translationNotes: 'en' },
  target_language: { id: 'en', name: 'English', book: { name: 'Obadiah' } },
  tcInitialized: true,
  tc_version: 8,
  toolsSelectedOwners: { translationWords: 'unfoldingWord', translationNotes: 'unfoldingWord' },
  tc_en_check_version_translationNotes: 'v88_unfoldingWord',
  tc_en_check_version_translationWords: 'v88_unfoldingWord',
};

const USFM = `\\id OBA REDNECK_TEST en_English_ltr
\\usfm 3.0
\\h Obadiah
\\c 1
\\p
\\v 1 Now this here's what the Lord God done told me... go whup Edom good.
\\v 7 ...And you Edom folks ain't got the sense to see it comin'.
`;

const sel11 = {
  contextId: {
    checkId: 'jd1r',
    reference: { bookId: 'oba', chapter: 1, verse: 1 },
    tool: 'translationNotes',
    groupId: 'figs-abstractnouns',
    quote: 'לַ⁠מִּלְחָמָֽה',
    quoteString: 'לַ⁠מִּלְחָמָֽה',
    occurrence: 1,
  },
  modifiedTimestamp: '2026-07-08T19:29:48.018Z',
  selections: [{ text: 'go whup', occurrence: 1, occurrences: 1 }],
  nothingToSelect: false,
};

const sel17 = {
  contextId: {
    checkId: 'rc1i',
    reference: { bookId: 'oba', chapter: 1, verse: 7 },
    tool: 'translationNotes',
    groupId: 'figs-aside',
    quote: [
      { word: 'אֵ֥ין', occurrence: 1 },
      { word: 'תְּבוּנָ֖ה', occurrence: 1 },
      { word: 'בּֽ⁠וֹ', occurrence: 1 },
    ],
    quoteString: 'אֵ֥ין תְּבוּנָ֖ה בּֽ⁠וֹ',
    occurrence: 1,
  },
  modifiedTimestamp: '2026-07-08T19:30:06.072Z',
  selections: [{ text: "And you Edom folks ain't got the sense to see it comin'", occurrence: 1, occurrences: 1 }],
  nothingToSelect: false,
};

// same check as sel11, different categories (tC3 splits these into own files)
const comment11 = { contextId: sel11.contextId, text: 'double-check this rendering', modifiedTimestamp: '2026-07-08T19:29:50.000Z' };
const reminder11 = { contextId: sel11.contextId, enabled: true, modifiedTimestamp: '2026-07-08T19:29:51.000Z' };
const invalid11 = { contextId: sel11.contextId, invalidated: false, modifiedTimestamp: '2026-07-08T19:29:52.000Z' };

const cd = (cat, ch, v, ts, obj) => [
  `.apps/translationCore/checkData/${cat}/oba/${ch}/${v}/${ts}.json`,
  strToU8(JSON.stringify(obj)),
];

function buildZip(extra = {}) {
  return zipSync({
    'manifest.json': strToU8(JSON.stringify(MANIFEST)),
    'oba.usfm': strToU8(USFM),
    'oba/manifest.json': strToU8(JSON.stringify({ project: { id: 'oba' } })), // nested decoy
    ...Object.fromEntries([
      cd('selections', 1, 1, '2026-07-08T19_29_48.018Z', sel11),
      cd('selections', 1, 7, '2026-07-08T19_30_06.072Z', sel17),
      cd('comments', 1, 1, '2026-07-08T19_29_50.000Z', comment11),
      cd('reminders', 1, 1, '2026-07-08T19_29_51.000Z', reminder11),
      cd('invalidated', 1, 1, '2026-07-08T19_29_52.000Z', invalid11),
    ]),
    ...extra,
  });
}

describe('detectProjectFormat', () => {
  it('recognizes a tC3 project by its tc-initialized manifest', () => {
    expect(detectProjectFormat(buildZip())).toBe('tc3');
  });

  it('recognizes a Scripture Burrito by its metadata.json', () => {
    const zip = zipSync({
      'metadata.json': strToU8(JSON.stringify({ format: 'scripture burrito', type: { flavorType: {} } })),
    });
    expect(detectProjectFormat(zip)).toBe('burrito');
  });

  it('tolerates a wrapper directory (DCS archive layout)', () => {
    const wrapped = zipSync({
      'en_rnb_oba_book/manifest.json': strToU8(JSON.stringify(MANIFEST)),
      'en_rnb_oba_book/oba.usfm': strToU8(USFM),
    });
    expect(detectProjectFormat(wrapped)).toBe('tc3');
  });

  it('returns null for an unrelated zip', () => {
    expect(detectProjectFormat(zipSync({ 'readme.txt': strToU8('hi') }))).toBe(null);
  });
});

describe('importTc3', () => {
  it('reads the book, name, and resource pins from the manifest', () => {
    const t = importTc3(buildZip());
    expect(t.book).toBe('oba');
    expect(t.name).toBe('redneck obadiah');
    expect(t.gatewayLanguage).toEqual({ languageId: 'en', owner: 'unfoldingWord' });
    // pinned to the release the project was checked against so checkIds line up
    expect(t.pins.translationNotes).toEqual({
      repoPath: 'git.door43.org/unfoldingWord/en_tn',
      version: 'v88',
    });
  });

  it('merges the per-category checkData files into one tc4-shaped record per check', () => {
    const t = importTc3(buildZip());
    expect(t.decisions.tn).toHaveLength(2);
    expect(t.decisions.tw).toHaveLength(0);
    const r11 = t.decisions.tn.find((d) => d.contextId.checkId === 'jd1r');
    // selections/comments/reminders/invalidated all folded into the one record
    expect(r11.selections[0].text).toBe('go whup');
    expect(r11.comments).toBe('double-check this rendering'); // tC3 `text` -> `comments`
    expect(r11.reminders).toBe(true); //                        tC3 `enabled` -> `reminders`
    expect(r11.invalidated).toBe(false);
  });

  it('throws on a zip that is not a tC3 project', () => {
    expect(() => importTc3(zipSync({ 'readme.txt': strToU8('hi') }))).toThrow(/no manifest\.json/i);
  });
});

describe('tC3 decisions seed into the app check states', () => {
  it('keys decisions to the exact check ids and preserves done-state', () => {
    const t = importTc3(buildZip());
    const states = seedStatesFromDecisions(t.decisions);

    // check.id in checks.js is `tn-<Reference>-<ID>`; with en_tn v88 the row
    // ids are jd1r@1:1 and rc1i@1:7 (verified against the live TSV)
    expect(Object.keys(states).sort()).toEqual(['tn-1:1-jd1r', 'tn-1:7-rc1i']);

    const s11 = states['tn-1:1-jd1r'];
    expect(s11.selections[0].text).toBe('go whup');
    expect(s11.comment).toBe('double-check this rendering');
    expect(s11.reminder).toBe(true);
    expect(isDoneState(s11)).toBe(true);

    const s17 = states['tn-1:7-rc1i'];
    expect(s17.selections[0].text).toBe("And you Edom folks ain't got the sense to see it comin'");
    expect(isDoneState(s17)).toBe(true);
  });
});
