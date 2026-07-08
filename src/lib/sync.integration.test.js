// Integration test of the full syncProject flow against an in-memory fake
// DCS and fake idb-keyval: first sync pushes a fresh project into an empty
// repo; a second device then syncs the same repo and the two devices'
// decisions converge by LWW without losing either side's newer work.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { strFromU8, zipSync } from 'fflate';

// ---- fake idb-keyval (per-test in-memory map = one device's storage) ----
let db;
vi.mock('idb-keyval', () => ({
  get: async (k) => db.get(k),
  set: async (k, v) => void db.set(k, v),
  del: async (k) => void db.delete(k),
}));

// ---- fake DCS: one remote repo as a {path: Uint8Array} map ----
const remote = { exists: false, files: null, commits: 0 };
const headSha = () => (remote.files ? `commit-${remote.commits}` : null);

vi.mock('./dcs', async (importOriginal) => {
  const real = await importOriginal(); // keep toBase64/parseRepoRef/DCS_HOST
  return {
    ...real,
    getRepo: async (owner, repo) =>
      remote.exists ? { name: repo, owner: { login: owner }, default_branch: 'master' } : null,
    createRepo: async (name) => {
      remote.exists = true;
      remote.files = null;
      return { name, owner: { login: 'tester' }, default_branch: 'master' };
    },
    getBranchSha: async () => headSha(),
    getTree: async () => {
      const { gitBlobSha } = await import('./sync');
      const tree = {};
      for (const [path, data] of Object.entries(remote.files || {})) {
        tree[path] = await gitBlobSha(data);
      }
      return tree;
    },
    downloadArchive: async () => zipSync({ ...remote.files }),
    commitFiles: async (owner, repo, { files }) => {
      remote.files = { ...(remote.files || {}) };
      for (const f of files) {
        remote.files[f.path] = Uint8Array.from(atob(f.content), (c) => c.charCodeAt(0));
      }
      remote.commits++;
      return { commit: { sha: headSha() } };
    },
  };
});

// ---- fake Door43 resource fetches: one tN check, one TWL check in TIT 1:1 ----
vi.mock('./door43', () => ({
  fetchTnTsv: async () =>
    'Reference\tID\tTags\tSupportReference\tQuote\tOccurrence\tNote\n' +
    '1:1\tab12\t\trc://*/ta/man/translate/figs-metaphor\tδοῦλος\t1\tA note\n',
  fetchTwlTsv: async () =>
    'Reference\tID\tTags\tOrigWords\tOccurrence\tTWLink\n' +
    '1:1\tcd34\t\tΘεοῦ\t1\trc://*/tw/dict/bible/kt/god\n',
}));

const { syncProject } = await import('./sync');
const { saveProject, getCheckStates, saveCheckStates } = await import('./store');

const AUTH = { username: 'tester', token: 'fake', kind: 'pat' };

function makeProject(id) {
  return {
    id,
    name: 'Titus (test)',
    bookCode: 'TIT',
    bookName: 'Titus',
    chapters: { 1: { 1: 'Paul, a servant of God…' } },
    usfmText: '\\id TIT\n\\c 1\n\\v 1 Paul, a servant of God…\n',
    createdAt: '2026-07-01T00:00:00.000Z',
  };
}

const tnState = (comment, modifiedAt) => ({
  selections: [],
  comment,
  reminder: false,
  nothingToSelect: true,
  invalidated: false,
  modifiedAt,
});

const readDecisions = (files, tool) => {
  const path = `ingredients/checking/translation${tool === 'tn' ? 'Notes' : 'Words'}/TIT.json`;
  return JSON.parse(strFromU8(files[path])).decisions;
};

beforeEach(() => {
  db = new Map();
  remote.exists = false;
  remote.files = null;
  remote.commits = 0;
});

describe('syncProject end-to-end (fake DCS)', () => {
  it('first sync creates the repo and pushes a full burrito', async () => {
    await saveProject(makeProject('TIT-a'));
    await saveCheckStates('TIT-a', { 'tn-1:1-ab12': tnState('from device A', '2026-07-02T00:00:00Z') });

    const result = await syncProject('TIT-a', AUTH);

    expect(result.pulled).toBe(0);
    expect(result.pushed).toBeGreaterThan(0);
    expect(result.repoUrl).toBe('https://git.door43.org/tester/tit_checks');
    expect(remote.files['metadata.json']).toBeDefined();
    expect(remote.files['ingredients/TIT.usfm']).toBeDefined();
    const decisions = readDecisions(remote.files, 'tn');
    expect(decisions).toHaveLength(1);
    expect(decisions[0].comments).toBe('from device A');
    // the project is now linked for future syncs
    expect((await db.get('project:TIT-a')).dcs).toMatchObject({
      owner: 'tester',
      repo: 'tit_checks',
      branch: 'master',
      lastSha: 'commit-1',
    });
  });

  it('second device pulls A’s decision, adds its own, and re-sync converges', async () => {
    // device A seeds the remote
    await saveProject(makeProject('TIT-a'));
    await saveCheckStates('TIT-a', { 'tn-1:1-ab12': tnState('from device A', '2026-07-02T00:00:00Z') });
    await syncProject('TIT-a', AUTH);

    // device B: fresh storage, its own newer tW decision
    db = new Map();
    const projectB = { ...makeProject('TIT-b'), dcs: { owner: 'tester', repo: 'tit_checks', branch: 'master' } };
    await saveProject(projectB);
    await saveCheckStates('TIT-b', { 'tw-1:1-cd34': tnState('from device B', '2026-07-03T00:00:00Z') });

    const result = await syncProject('TIT-b', AUTH);

    // pulled A's tN decision into B's local states…
    expect(result.pulled).toBe(1);
    const statesB = await getCheckStates('TIT-b');
    expect(statesB['tn-1:1-ab12'].comment).toBe('from device A');
    expect(statesB['tw-1:1-cd34'].comment).toBe('from device B');
    // …and pushed B's tW decision without disturbing A's record
    expect(readDecisions(remote.files, 'tn')[0].comments).toBe('from device A');
    expect(readDecisions(remote.files, 'tw')[0].comments).toBe('from device B');
  });

  it('conflicting edits to the same check: newer modifiedAt wins on both sides', async () => {
    await saveProject(makeProject('TIT-a'));
    await saveCheckStates('TIT-a', { 'tn-1:1-ab12': tnState('older A', '2026-07-02T00:00:00Z') });
    await syncProject('TIT-a', AUTH);

    // device B edited the SAME check later
    db = new Map();
    const projectB = { ...makeProject('TIT-b'), dcs: { owner: 'tester', repo: 'tit_checks', branch: 'master' } };
    await saveProject(projectB);
    await saveCheckStates('TIT-b', { 'tn-1:1-ab12': tnState('newer B', '2026-07-04T00:00:00Z') });
    await syncProject('TIT-b', AUTH);

    // remote now carries B's newer decision
    expect(readDecisions(remote.files, 'tn')[0].comments).toBe('newer B');
    // B's local kept its own (newer) state
    expect((await getCheckStates('TIT-b'))['tn-1:1-ab12'].comment).toBe('newer B');
  });

  it('no changes -> nothing pushed', async () => {
    await saveProject(makeProject('TIT-a'));
    await saveCheckStates('TIT-a', { 'tn-1:1-ab12': tnState('once', '2026-07-02T00:00:00Z') });
    await syncProject('TIT-a', AUTH);
    const again = await syncProject('TIT-a', AUTH);
    expect(again.pulled).toBe(0);
    expect(again.pushed).toBe(0);
    expect(remote.commits).toBe(1);
  });
});
