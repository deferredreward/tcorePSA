import { describe, it, expect, beforeEach, vi } from 'vitest';
import { zipSync, strToU8, strFromU8 } from 'fflate';
import { importTc3 } from './tc3.js';
import { seedStatesFromDecisions } from './tc4.js';

// The upgrade module is the only bridge between the tC3 and burrito pipelines.
// Its DCS + store + network collaborators are mocked so this exercises the real
// conversion (tC3 project + seeded states → buildBurritoFiles → commit shape +
// format transition) in node, without live Door43.

// ---- mocked collaborators ------------------------------------------------

const commitFiles = vi.fn(() => ({ commit: { sha: 'committed-sha' } }));
const createRepo = vi.fn((name) => ({ name, owner: { login: 'testuser' }, default_branch: 'master' }));
const getBranchSha = vi.fn(() => 'remote-sha');
// getRepo: the in-place link (en_rnb_oba_book) exists; any other name (a new
// repo) is available (null). Lets both the new-repo collision pre-check and the
// in-place existence check resolve.
const getRepo = vi.fn((owner, repo) =>
  repo === 'en_rnb_oba_book' ? { name: repo, owner: { login: owner }, default_branch: 'master' } : null,
);
// a realistic tC3 repo tree: markers to delete + a .gitignore that will be
// overwritten + neutral files that must survive
const getTree = vi.fn(() => ({
  'manifest.json': 'sha-man',
  'oba.usfm': 'sha-usfm',
  'oba/1.json': 'sha-ch1',
  'oba/notes.md': 'sha-notes', // a user file under <book>/ — must NOT be deleted
  '.apps/translationCore/checkData/selections/oba/1/1/x.json': 'sha-cd',
  '.gitignore': 'sha-gi',
  'LICENSE.md': 'sha-lic',
  'README.md': 'sha-readme',
}));

vi.mock('./dcs', () => ({
  DCS_HOST: 'https://git.door43.org',
  createRepo: (...a) => createRepo(...a),
  commitFiles: (...a) => commitFiles(...a),
  getBranchSha: (...a) => getBranchSha(...a),
  getTree: (...a) => getTree(...a),
  getRepo: (...a) => getRepo(...a),
  toBase64: () => 'BASE64',
}));

// tN check list at the tC3 pins — ids match the seeded decisions so the states
// attach and their decisions get written into the burrito
const TN_CHECKS = [
  { id: 'tn-1:1-jd1r', checkId: 'jd1r', tool: 'tn', chapter: 1, verse: 1, reference: '1:1', quote: 'לַ⁠מִּלְחָמָֽה', occurrence: 1, groupId: 'figs-abstractnouns', support: 'rc://*/ta/man/translate/figs-abstractnouns', note: 'Abstract noun.' },
  { id: 'tn-1:7-rc1i', checkId: 'rc1i', tool: 'tn', chapter: 1, verse: 7, reference: '1:7', quote: 'אֵ֥ין תְּבוּנָ֖ה בּֽ⁠וֹ', occurrence: 1, groupId: 'figs-aside', support: 'rc://*/ta/man/translate/figs-aside', note: 'Aside.' },
];
vi.mock('./sync', () => ({
  ensureFreshAuth: (a) => a,
  loadChecks: () => ({ tn: TN_CHECKS, tw: [], skipped: { tn: 0, tw: 0 } }),
  // faithful to sync.js's real contextFromFiles (pins read from resources.json)
  contextFromFiles: (files) => {
    const read = (p) => (files[p] ? JSON.parse(strFromU8(files[p])) : null);
    const resources = read('ingredients/checking/resources.json');
    return { metadata: read('metadata.json'), files, pins: resources?.resources || null, settings: read('ingredients/checking/settings.json') };
  },
}));

vi.mock('./journal', () => ({ getActorId: () => 'pwa-testactor', getJournal: () => [] }));

// in-memory store
let store;
vi.mock('./store', () => ({
  getDcsAuth: () => ({ username: 'testuser', token: 't0k', kind: 'pat' }),
  getProject: (id) => store.projects[id],
  saveProject: (p) => {
    store.projects[p.id] = p;
  },
  getCheckStates: (id) => store.states[id] || {},
  saveBurrito: (importId, data) => {
    store.burritos[importId] = data;
  },
}));

import { upgradeTc3ToBurrito } from './upgrade.js';

// ---- a real tC3 project (mirrors tc3.test.js's fixture) ------------------

const MANIFEST = {
  project: { id: 'oba', name: 'Obadiah' },
  resource: { id: 'RNB', name: 'redneck obadiah' },
  toolsSelectedGLs: { translationWords: 'en', translationNotes: 'en' },
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
  contextId: { checkId: 'jd1r', reference: { bookId: 'oba', chapter: 1, verse: 1 }, tool: 'translationNotes', groupId: 'figs-abstractnouns', quote: 'לַ⁠מִּלְחָמָֽה', quoteString: 'לַ⁠מִּלְחָמָֽה', occurrence: 1 },
  modifiedTimestamp: '2026-07-08T19:29:48.018Z',
  selections: [{ text: 'go whup', occurrence: 1, occurrences: 1 }],
  nothingToSelect: false,
};
const sel17 = {
  contextId: { checkId: 'rc1i', reference: { bookId: 'oba', chapter: 1, verse: 7 }, tool: 'translationNotes', groupId: 'figs-aside', quote: [{ word: 'אֵ֥ין', occurrence: 1 }], quoteString: 'אֵ֥ין תְּבוּנָ֖ה בּֽ⁠וֹ', occurrence: 1 },
  modifiedTimestamp: '2026-07-08T19:30:06.072Z',
  selections: [{ text: "And you Edom folks ain't got the sense to see it comin'", occurrence: 1, occurrences: 1 }],
  nothingToSelect: false,
};
const cd = (cat, ch, v, ts, obj) => [`.apps/translationCore/checkData/${cat}/oba/${ch}/${v}/${ts}.json`, strToU8(JSON.stringify(obj))];

function tc3Project(dcs = null) {
  const zip = zipSync({
    'manifest.json': strToU8(JSON.stringify(MANIFEST)),
    'oba.usfm': strToU8(USFM),
    ...Object.fromEntries([
      cd('selections', 1, 1, '2026-07-08T19_29_48.018Z', sel11),
      cd('selections', 1, 7, '2026-07-08T19_30_06.072Z', sel17),
    ]),
  });
  const t = importTc3(zip);
  const project = {
    id: 'OBA-123',
    bookCode: 'OBA',
    bookName: 'Obadiah',
    chapters: { 1: { 1: 'x', 7: 'y' } },
    usfmText: t.usfmText,
    createdAt: '2026-07-08T00:00:00.000Z',
    format: 'tc3',
    pins: t.pins,
    ...(dcs ? { dcs } : {}),
  };
  const states = seedStatesFromDecisions(t.decisions);
  return { project, states };
}

beforeEach(() => {
  store = { projects: {}, states: {}, burritos: {} };
  vi.clearAllMocks();
});

// ---- tests ----------------------------------------------------------------

describe('upgradeTc3ToBurrito — new repo', () => {
  it('creates a repo and pushes a clean, correctly-pinned burrito', async () => {
    const { project, states } = tc3Project();
    store.projects[project.id] = project;
    store.states[project.id] = states;

    const result = await upgradeTc3ToBurrito(project.id, null, { mode: 'new-repo', repoName: 'oba_burrito' });

    expect(createRepo).toHaveBeenCalledWith('oba_burrito', 't0k');
    expect(result.owner).toBe('testuser');
    expect(result.repo).toBe('oba_burrito');
    expect(result.repoUrl).toBe('https://git.door43.org/testuser/oba_burrito');

    // one commit, every file a create, no branch (empty repo → first commit
    // creates the default branch)
    expect(commitFiles).toHaveBeenCalledTimes(1);
    const [, , payload] = commitFiles.mock.calls[0];
    expect(payload.branch).toBeUndefined();
    expect(payload.files.every((f) => f.operation === 'create')).toBe(true);
    const paths = payload.files.map((f) => f.path);
    expect(paths).toContain('metadata.json');
    expect(paths).toContain('ingredients/OBA.usfm');
    expect(paths).toContain('ingredients/checking/resources.json');
    expect(paths).toContain('ingredients/checking/translationNotes/OBA.json');
    // OBA fixture: both tN decisions map to fetched checks, tw empty → none unmapped
    expect(result.unmapped).toBe(0);
  });

  it('refuses (clear error) when the target repo name already exists', async () => {
    const { project, states } = tc3Project();
    store.projects[project.id] = project;
    store.states[project.id] = states;
    // getRepo mock returns a repo for 'en_rnb_oba_book' → simulate a collision
    await expect(
      upgradeTc3ToBurrito(project.id, null, { mode: 'new-repo', repoName: 'en_rnb_oba_book' }),
    ).rejects.toThrow(/already exists/i);
    expect(createRepo).not.toHaveBeenCalled();
    expect(store.projects[project.id].format).toBe('tc3'); // untouched
  });

  it('carries the tC3 resource pins into resources.json (so check ids keep matching)', async () => {
    const { project, states } = tc3Project();
    store.projects[project.id] = project;
    store.states[project.id] = states;
    await upgradeTc3ToBurrito(project.id, null, { mode: 'new-repo', repoName: 'oba_burrito' });

    const res = store.burritos[Object.keys(store.burritos)[0]];
    expect(res.pins.translationNotes.version).toBe('v88');
    expect(res.pins.translationWords.version).toBe('v88');
    expect(res.pins.translationNotes.repoPath).toBe('git.door43.org/unfoldingWord/en_tn');
  });

  it('preserves every tC3 decision (checkData drop loses nothing)', async () => {
    const { project, states } = tc3Project();
    store.projects[project.id] = project;
    store.states[project.id] = states;
    await upgradeTc3ToBurrito(project.id, null, { mode: 'new-repo', repoName: 'oba_burrito' });

    const ctx = store.burritos[Object.keys(store.burritos)[0]];
    const tn = JSON.parse(strFromU8(ctx.files['ingredients/checking/translationNotes/OBA.json']));
    expect(tn.decisions).toHaveLength(2);
    const r11 = tn.decisions.find((d) => d.contextId.checkId === 'jd1r');
    expect(r11.selections[0].text).toBe('go whup');
    expect(r11.status).toBe('valid');
    // decision file pinned to the tC3 release too
    expect(tn.resource.version).toBe('v88');
    // USFM at rest carries no alignment markup and keeps the translation
    const usfm = strFromU8(ctx.files['ingredients/OBA.usfm']);
    expect(usfm).toContain('go whup Edom good');
    expect(usfm).not.toContain('\\zaln');
  });

  it('carries a tC3 invalidated (needs-re-review) decision as status invalid, not valid', async () => {
    const { project, states } = tc3Project();
    states['tn-1:1-jd1r'].invalidated = true; // imported as needs-re-review, not re-decided
    store.projects[project.id] = project;
    store.states[project.id] = states;
    await upgradeTc3ToBurrito(project.id, null, { mode: 'new-repo', repoName: 'oba_burrito' });

    const ctx = store.burritos[Object.keys(store.burritos)[0]];
    const tn = JSON.parse(strFromU8(ctx.files['ingredients/checking/translationNotes/OBA.json']));
    const r = tn.decisions.find((d) => d.contextId.checkId === 'jd1r');
    expect(r.status).toBe('invalid'); // not silently revalidated
    expect(r.invalidated).toBe(true);
  });

  it('flips the project to the burrito pipeline and drops the tC3 pins', async () => {
    const { project, states } = tc3Project();
    store.projects[project.id] = project;
    store.states[project.id] = states;
    await upgradeTc3ToBurrito(project.id, null, { mode: 'new-repo', repoName: 'oba_burrito' });

    const saved = store.projects[project.id];
    expect(saved.format).toBe('burrito');
    expect(saved.tc4.importId).toMatch(/^imp-/);
    expect(saved.tc4.book).toBe('OBA');
    expect(saved.dcs).toMatchObject({ owner: 'testuser', repo: 'oba_burrito', branch: 'master', lastSha: 'committed-sha' });
    expect(saved.pins).toBeUndefined();
  });

  it('cancels cleanly when no repo name is given', async () => {
    const { project, states } = tc3Project();
    store.projects[project.id] = project;
    store.states[project.id] = states;
    const result = await upgradeTc3ToBurrito(project.id, null, { mode: 'new-repo', promptRepoName: () => '' });
    expect(result).toEqual({ cancelled: true });
    expect(createRepo).not.toHaveBeenCalled();
    expect(store.projects[project.id].format).toBe('tc3'); // untouched
  });
});

describe('upgradeTc3ToBurrito — in place', () => {
  const LINK = { owner: 'testuser', repo: 'en_rnb_oba_book', branch: 'master', lastSha: 'remote-sha' };

  it('rewrites the linked repo: deletes tC3 markers, keeps neutral files, updates existing', async () => {
    const { project, states } = tc3Project(LINK);
    store.projects[project.id] = project;
    store.states[project.id] = states;

    const result = await upgradeTc3ToBurrito(project.id, null, { mode: 'in-place' });
    expect(result.mode).toBe('in-place');
    expect(result.repo).toBe('en_rnb_oba_book');
    expect(createRepo).not.toHaveBeenCalled();

    const [owner, repo, payload] = commitFiles.mock.calls[0];
    expect(owner).toBe('testuser');
    expect(repo).toBe('en_rnb_oba_book');
    expect(payload.branch).toBe('master'); // existing repo → target its branch

    const byPath = Object.fromEntries(payload.files.map((f) => [f.path, f]));
    // tC3 FORMAT markers deleted
    expect(byPath['manifest.json'].operation).toBe('delete');
    expect(byPath['oba.usfm'].operation).toBe('delete');
    expect(byPath['oba/1.json'].operation).toBe('delete');
    // .apps/ checkData PRESERVED (safety net) — not in the commit at all
    expect(byPath['.apps/translationCore/checkData/selections/oba/1/1/x.json']).toBeUndefined();
    // a user file under <book>/ is NOT a chapter-json marker → preserved
    expect(byPath['oba/notes.md']).toBeUndefined();
    // neutral files untouched (not in the commit at all)
    expect(byPath['LICENSE.md']).toBeUndefined();
    expect(byPath['README.md']).toBeUndefined();
    // .gitignore already existed → update with its sha, not create
    expect(byPath['.gitignore'].operation).toBe('update');
    expect(byPath['.gitignore'].sha).toBe('sha-gi');
    // burrito files created
    expect(byPath['metadata.json'].operation).toBe('create');
    expect(byPath['ingredients/OBA.usfm'].operation).toBe('create');
    expect(result.deleted).toBe(3); // manifest.json, oba.usfm, oba/1.json
  });

  it('preserves the tC3 repo when it is not owned by the signed-in user', async () => {
    const { project, states } = tc3Project({ owner: 'someone-else', repo: 'en_rnb_oba_book', branch: 'master' });
    store.projects[project.id] = project;
    store.states[project.id] = states;
    await expect(upgradeTc3ToBurrito(project.id, null, { mode: 'in-place' })).rejects.toThrow(/own/i);
    expect(commitFiles).not.toHaveBeenCalled();
  });

  it('refuses in-place when the linked repo no longer exists', async () => {
    const { project, states } = tc3Project({ owner: 'testuser', repo: 'gone_repo', branch: 'master' });
    store.projects[project.id] = project;
    store.states[project.id] = states;
    await expect(upgradeTc3ToBurrito(project.id, null, { mode: 'in-place' })).rejects.toThrow(/no longer exists/i);
  });

  it('refuses in-place when the remote repo changed since import', async () => {
    const { project, states } = tc3Project({ owner: 'testuser', repo: 'en_rnb_oba_book', branch: 'master', lastSha: 'old-sha' });
    store.projects[project.id] = project;
    store.states[project.id] = states;
    await expect(upgradeTc3ToBurrito(project.id, null, { mode: 'in-place' })).rejects.toThrow(/changed on Door43/i);
    expect(commitFiles).not.toHaveBeenCalled();
  });

  it('refuses in-place when the project has no linked repo', async () => {
    const { project, states } = tc3Project(); // no dcs link
    store.projects[project.id] = project;
    store.states[project.id] = states;
    await expect(upgradeTc3ToBurrito(project.id, null, { mode: 'in-place' })).rejects.toThrow(/no linked Door43 repo/i);
  });
});

describe('upgradeTc3ToBurrito — guards', () => {
  it('refuses to upgrade a non-tC3 project', async () => {
    store.projects['B-1'] = { id: 'B-1', bookCode: 'TIT', format: 'burrito' };
    await expect(upgradeTc3ToBurrito('B-1', null, { mode: 'new-repo', repoName: 'x' })).rejects.toThrow(/Only translationCore 3/i);
  });
});
