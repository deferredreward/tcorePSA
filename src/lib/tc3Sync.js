// translationCore 3 (tC3) sync-back — the WRITE-orchestration half of
// "Pipeline A". COMPLETELY SEPARATE from the burrito sync (src/lib/sync.js):
// routed on `project.format === 'tc3'`, the two pipelines never share a write
// path. This module reads a tC3 project back off Door43, merges its decisions
// into local state, and appends the user's decisions to the SAME repo in tC3's
// native checkData layout — never a burrito. The pure file builder lives in
// src/lib/tc3CheckData.js (node-testable); this file is the network/store shell,
// mirroring how sync.js orchestrates the pure tc4.js builder.

import * as dcs from './dcs';
import { importTc3 } from './tc3';
import { seedStatesFromDecisions } from './tc4';
import { loadChecks, gitBlobSha, mergeStates, ensureFreshAuth } from './sync';
import { parseUsfm } from './usfmParse';
import { getProject, getCheckStates, saveCheckStates, saveProject, getDcsAuth } from './store';
import { buildTc3CheckDataFiles } from './tc3CheckData';

// Same store-sourced-then-refresh resolution every DCS entry point uses
// (mirrors sync.js's private resolveAuth — kept separate so the pipelines don't
// import each other's internals).
async function resolveAuth(auth) {
  return ensureFreshAuth((await getDcsAuth()) || auth);
}

// Sync one tC3 project back to its source Door43 repo: pull + merge + push, but
// producing tC3 checkData files (never a burrito). Returns
// {pulled, pushed, repoUrl}. Throws for non-tC3 projects (symmetric with
// sync.js's syncProject, which throws for tC3) so the two pipelines stay isolated.
export async function syncTc3Project(projectId, auth) {
  auth = await resolveAuth(auth);
  if (!auth?.token) throw new Error('Sign in to your Door43 account first');
  const project = await getProject(projectId);
  if (!project) throw new Error('Project not found');
  if (project.format !== 'tc3') {
    throw new Error('Not a translationCore 3 project — the Scripture Burrito sync path handles this one.');
  }
  const link = project.dcs;
  if (!link) {
    // tC3 sync writes decisions back INTO the source repo (it never emits the
    // manifest/USFM), so a project not imported from Door43 has no valid target.
    throw new Error('This tC3 project was not imported from Door43, so there is no source repo to sync its decisions back to.');
  }
  const { owner, repo } = link;
  const branch = link.branch || 'master';
  const book = project.bookCode.toLowerCase();

  const repoInfo = await dcs.getRepo(owner, repo, auth.token);
  if (!repoInfo) throw new Error(`${owner}/${repo} not found on Door43`);
  const remoteSha = await dcs.getBranchSha(owner, repo, branch, auth.token);
  if (!remoteSha) throw new Error(`${owner}/${repo} is empty — expected a translationCore 3 project to sync into`);

  // ---- pull: import the remote tC3 project, merge its decisions into local ----
  // (always download so we have the remote's current decisions to diff against —
  // tC3 filenames are timestamped, so a git-tree sha diff alone can't tell an
  // already-synced decision from a fresh one.)
  const remote = importTc3(await dcs.downloadArchive(owner, repo, remoteSha, auth.token));
  const remoteStates = seedStatesFromDecisions(remote.decisions);
  let states = await getCheckStates(project.id);
  const m = mergeStates(states, remoteStates);
  states = m.merged;
  if (m.pulled) await saveCheckStates(project.id, states);

  // adopt the remote source USFM if it changed (this app never edits USFM in
  // place, so the remote is the authoritative evolving text — same rule as sync.js)
  let proj = project;
  if (remote.usfmText && remote.usfmText !== project.usfmText) {
    const parsed = parseUsfm(remote.usfmText);
    if (parsed.bookCode && Object.keys(parsed.chapters).length) {
      proj = { ...project, chapters: parsed.chapters, usfmText: remote.usfmText, bookName: parsed.bookName || project.bookName };
    }
  }

  // ---- build the changed checkData files and diff against the remote tree ----
  const checks = await loadChecks(proj, project.pins);
  const files = buildTc3CheckDataFiles({
    book,
    checks,
    states,
    remoteStates,
    username: auth.username,
    pins: project.pins,
    fallbackTimestamp: new Date().toISOString(),
  });
  const remoteTree = await dcs.getTree(owner, repo, remoteSha, auth.token);
  const entries = Object.entries(files);
  const shas = await Promise.all(entries.map(([path, data]) => (remoteTree[path] ? gitBlobSha(data) : null)));
  const changes = [];
  entries.forEach(([path, data], i) => {
    const remoteBlob = remoteTree[path];
    if (remoteBlob && remoteBlob === shas[i]) return; // identical file already there
    changes.push({
      operation: remoteBlob ? 'update' : 'create',
      path,
      content: dcs.toBase64(data),
      ...(remoteBlob ? { sha: remoteBlob } : {}),
    });
  });

  let newSha = remoteSha;
  if (changes.length) {
    const res = await dcs.commitFiles(
      owner,
      repo,
      { branch, message: `${project.bookCode.toUpperCase()}: sync checking decisions from tCore Checks (PWA)`, files: changes },
      auth.token,
    );
    newSha = res?.commit?.sha || null;
  }

  proj = {
    ...proj,
    dcs: {
      ...link,
      owner: repoInfo?.owner?.login || owner,
      repo: repoInfo?.name || repo,
      branch,
      lastSha: newSha,
      lastSyncAt: new Date().toISOString(),
    },
  };
  await saveProject(proj);

  return { pulled: m.pulled, pushed: changes.length, repoUrl: `${dcs.DCS_HOST}/${proj.dcs.owner}/${proj.dcs.repo}` };
}
