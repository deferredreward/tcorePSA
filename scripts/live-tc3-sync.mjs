// LIVE round-trip of the tC3 sync-back pipeline against real Door43 (DCS).
// Closes the "orchestrator un-verified against live authenticated DCS" gap by
// exercising the real transport (src/lib/dcs.js: commitFiles, getTree,
// downloadArchive) end-to-end against an EXISTING tC3 repo the user named:
// pull + import the live project, append ONE clearly-labeled throwaway comment
// on OBA 1:1 (keeping the real selection/reminder/invalidated untouched), commit
// it, then re-download and re-import to prove it round-trips off the server.
//
// Reads DCS_TEST_TOKEN from .env.local (walked up from cwd). Never prints it.
// Creates NO repos. Run manually:  node scripts/live-tc3-sync.mjs
import fs from 'node:fs';
import path from 'node:path';
import { strFromU8 } from 'fflate';
import * as dcs from '../src/lib/dcs.js';
import { importTc3 } from '../src/lib/tc3.js';
import { seedStatesFromDecisions } from '../src/lib/tc4.js';
import { buildTc3CheckDataFiles } from '../src/lib/tc3CheckData.js';

// Target an existing tC3 repo the token can push to (override via env).
const OWNER = process.env.DCS_TEST_OWNER || 'deferredreward';
const REPO = process.env.DCS_TEST_REPO || 'en_rnb_oba_book';

// ---- load DCS_TEST_TOKEN from the nearest .env.local (no value ever logged) ----
function loadEnvLocal() {
  let dir = process.cwd();
  for (let up = 0; up < 6; up++) {
    const p = path.join(dir, '.env.local');
    if (fs.existsSync(p)) {
      for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
        const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
        if (m) process.env[m[1]] ??= m[2].trim().replace(/^["']|["']$/g, '');
      }
      return p;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}
const envPath = loadEnvLocal();
// deferredreward's push-capable token; fall back to the generic name
const token = process.env.DFRD_DCS_TEST_TOKEN || process.env.DCS_TEST_TOKEN;
if (!token) {
  console.error(`DFRD_DCS_TEST_TOKEN not found (looked for .env.local from ${process.cwd()} upward${envPath ? `; read ${envPath}` : ''}).`);
  process.exit(2);
}

let pass = 0, fail = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail && !ok ? ' — ' + detail : ''}`); ok ? pass++ : fail++; };

// git blob sha1 (inlined from sync.js, which is browser-only and can't load in node)
async function gitBlobSha(bytes) {
  const header = new TextEncoder().encode(`blob ${bytes.length}\0`);
  const buf = new Uint8Array(header.length + bytes.length);
  buf.set(header); buf.set(bytes, header.length);
  const digest = await crypto.subtle.digest('SHA-1', buf);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const pins = {
  translationNotes: { repoPath: 'git.door43.org/unfoldingWord/en_tn', version: 'v88' },
  translationWords: { repoPath: 'git.door43.org/unfoldingWord/en_tw', version: 'v88' },
};
// A real check in this repo (OBA 1:1 figs-abstractnouns, id jd1r @ en_tn v88).
const tnCheck = {
  id: 'tn-1:1-jd1r', checkId: 'jd1r', tool: 'tn', chapter: 1, verse: 1, reference: '1:1',
  quote: 'לַ⁠מִּלְחָמָֽה', occurrence: 1, groupId: 'figs-abstractnouns',
  support: 'rc://*/ta/man/translate/figs-abstractnouns', note: 'War is an abstract noun.',
};

async function main() {
  // No /user preflight: the test token is scoped write:repository only (no
  // read:user). Public-repo reads need no scope; commits use write:repository.
  console.log(`     target repo: ${OWNER}/${REPO}`);
  const repoInfo = await dcs.getRepo(OWNER, REPO, token);
  check('setup: target tC3 repo is reachable', !!repoInfo, `${OWNER}/${REPO} not found`);
  if (!repoInfo) { console.log(`\n${pass} passed, ${fail} failed`); process.exit(1); }
  const branch = repoInfo.default_branch || 'master';
  const sha = await dcs.getBranchSha(OWNER, REPO, branch, token);

  // ---- PULL: download + import the live repo, seed its current decisions ----
  const remote = importTc3(await dcs.downloadArchive(OWNER, REPO, sha, token));
  check('pull: live archive imports as tC3 (book oba)', remote.book === 'oba');
  const remoteStates = seedStatesFromDecisions(remote.decisions);

  // ---- BUILD: keep the real decision untouched, append ONLY a labeled comment ----
  // Base off the current remote state so selections/reminder/invalidated match
  // (no file emitted for them); only the comment differs -> one comments file.
  const modifiedAt = new Date().toISOString();
  const base = remoteStates['tn-1:1-jd1r'] || { selections: [], comment: '', reminder: false, nothingToSelect: false, invalidated: false };
  const marker = `[tcorePSA live-sync test ${modifiedAt} — safe to delete]`;
  const states = { 'tn-1:1-jd1r': { ...base, comment: marker, modifiedAt } };
  const files = buildTc3CheckDataFiles({ book: 'oba', checks: { tn: [tnCheck], tw: [] }, states, remoteStates, username: OWNER, pins });
  const wantComment = `.apps/translationCore/checkData/comments/oba/1/1/${modifiedAt.replace(/:/g, '_')}.json`;
  check('build: exactly one comments file, at the expected checkData path',
    Object.keys(files).length === 1 && !!files[wantComment], Object.keys(files).join(', '));

  // ---- PUSH: diff vs the live tree by blob sha, commit changed files ----
  const tree = await dcs.getTree(OWNER, REPO, sha, token);
  const entries = Object.entries(files);
  const shas = await Promise.all(entries.map(([p, d]) => (tree[p] ? gitBlobSha(d) : null)));
  const changes = [];
  entries.forEach(([p, d], i) => { if (tree[p] && tree[p] === shas[i]) return; changes.push({ operation: tree[p] ? 'update' : 'create', path: p, content: dcs.toBase64(d), ...(tree[p] ? { sha: tree[p] } : {}) }); });
  const res = changes.length ? await dcs.commitFiles(OWNER, REPO, { branch, message: 'OBA: tcorePSA live-sync verification (checkData comment)', files: changes }, token) : null;
  const newSha = res?.commit?.sha || sha;
  check('push: authenticated batch commit accepted by DCS', !!res?.commit?.sha, JSON.stringify(res)?.slice(0, 200));
  const pushedPath = changes[0]?.path;

  // ---- VERIFY: re-download + re-import proves the write round-tripped off the server ----
  const back = importTc3(await dcs.downloadArchive(OWNER, REPO, newSha, token));
  const s = seedStatesFromDecisions(back.decisions)['tn-1:1-jd1r'];
  check('round-trip: the pushed comment re-imports from live DCS on the same check id',
    !!s && s.comment === marker && s.selections?.[0]?.text === base.selections?.[0]?.text);

  console.log(`\n${pass} passed, ${fail} failed`);
  if (pushedPath) {
    console.log(`\nWrote one test file to ${OWNER}/${REPO} @ ${newSha?.slice(0, 8)}:`);
    console.log(`  ${pushedPath}`);
    console.log(`Revert it (removes only the test comment; older comment history stays):`);
    console.log(`  gh api -X DELETE repos/${OWNER}/${REPO}/contents/${pushedPath} -f message="remove live-sync test comment" -f sha=<blobSha> -f branch=${branch}`);
  }
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error('LIVE RUN ERROR:', e?.message || e); process.exit(1); });
