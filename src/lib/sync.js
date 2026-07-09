// Door43 (DCS) project sync — the tC3 "Upload to Door43" / online-import
// story rebuilt for the PWA, so a project checked offline on one device can
// be pushed to DCS and picked up on another.
//
// One sync = pull + merge + push:
//   1. download the remote repo archive (if it has commits) and merge its
//      decision records into local check states, last-write-wins per §5.2
//      identity key by modifiedAt; remote files become the new round-trip base
//   2. rebuild the burrito files from merged local state (buildBurritoFiles —
//      untouched remote records/files round-trip verbatim)
//   3. diff against the remote git tree by git blob sha and commit only the
//      changed files in a single batch commit
// Unlike tC3 (which rejects non-fast-forward pushes), the pull-first merge
// means concurrent edits on two devices converge instead of erroring.

import { strFromU8 } from 'fflate';
import * as dcs from './dcs';
import { importBurrito, buildBurritoFiles, seedStatesFromDecisions, stripAlignmentMarkup } from './tc4';
import { parseUsfm } from './usfmParse';
import { fetchTnTsv, fetchTwlTsv } from './door43';
import { parseTnChecks, parseTwChecks } from './checks';
import { getVerseText } from './verses';
import { getProject, getCheckStates, saveCheckStates, saveProject, getBurrito, saveBurrito, getDcsAuth, saveDcsAuth } from './store';
import { getActorId, getJournal } from './journal';

// git blob sha1 of file bytes ("blob <len>\0" + content) — matches the shas
// in the remote tree so unchanged files are skipped without downloading them
export async function gitBlobSha(bytes) {
  const header = new TextEncoder().encode(`blob ${bytes.length}\0`);
  const buf = new Uint8Array(header.length + bytes.length);
  buf.set(header);
  buf.set(bytes, header.length);
  const digest = await crypto.subtle.digest('SHA-1', buf);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// LWW merge of remote-seeded states into local by modifiedAt (ISO strings
// compare lexicographically). A local state with no timestamp never loses
// work to an untimestamped remote record.
export function mergeStates(local, remote) {
  const merged = { ...local };
  let pulled = 0;
  for (const [key, rs] of Object.entries(remote)) {
    const ls = merged[key];
    const remoteWins = !ls || (rs.modifiedAt && (!ls.modifiedAt || rs.modifiedAt > ls.modifiedAt));
    if (remoteWins && JSON.stringify(ls) !== JSON.stringify(rs)) {
      merged[key] = rs;
      pulled++;
    }
  }
  return { merged, pulled };
}

// Fetch a project's tN/tW checks and filter them to the uploaded verses.
// Returns the kept lists plus how many were skipped (outside the upload).
// Shared with App.loadProjectData so the check-loading logic lives in one place.
export async function loadChecks(project, pins) {
  const [tnTsv, twlTsv] = await Promise.all([
    fetchTnTsv(project.bookCode, pins?.translationNotes),
    fetchTwlTsv(project.bookCode, pins?.translationWords),
  ]);
  const filter = (list) => list.filter((c) => getVerseText(project, c.chapter, c.verse) != null);
  const tnAll = parseTnChecks(tnTsv);
  const twAll = parseTwChecks(twlTsv);
  const tn = filter(tnAll);
  const tw = filter(twAll);
  return { tn, tw, skipped: { tn: tnAll.length - tn.length, tw: twAll.length - tw.length } };
}

// OAuth access tokens expire hourly — transparently refresh (and persist)
// before any authenticated operation. PATs pass through untouched.
export async function ensureFreshAuth(auth) {
  if (auth?.kind !== 'oauth' || !auth.refreshToken || !auth.expiresAt || Date.now() < auth.expiresAt) {
    return auth;
  }
  const fresh = await dcs.refreshOAuth(auth);
  await saveDcsAuth(fresh);
  return fresh;
}

// Resolve the real auth for an operation. The persisted record is the source
// of truth: a refresh rotates the token and saves the new one, but callers
// hold the old copy in React state — so read from the store (falling back to
// the passed hint) and then refresh if the access token has expired. This is
// why every DCS entry point below funnels through here.
async function resolveAuth(auth) {
  return ensureFreshAuth((await getDcsAuth()) || auth);
}

const readJson = (files, path) => (files[path] ? JSON.parse(strFromU8(files[path])) : null);

// A burrito {path: bytes} map -> the stored import context App.loadProjectData
// consumes (pins read from the checking/resources.json inside the map). Shared
// with the tC3→burrito upgrade so both write the same context shape.
export function contextFromFiles(files) {
  const resources = readJson(files, 'ingredients/checking/resources.json');
  return {
    metadata: readJson(files, 'metadata.json'),
    files,
    pins: resources?.resources || null,
    settings: readJson(files, 'ingredients/checking/settings.json'),
  };
}

// Sync one project with its linked DCS repo (creating/linking one on first
// sync — `promptRepoName(default)` lets the UI confirm the new repo's name).
// Returns {pulled, pushed, repoUrl} or {cancelled: true}.
export async function syncProject(projectId, auth, { promptRepoName } = {}) {
  auth = await resolveAuth(auth);
  if (!auth?.token) throw new Error('Sign in to your Door43 account first');
  let project = await getProject(projectId);
  if (!project) throw new Error('Project not found');
  // tC3 imports round-trip through their own (separate) write pipeline. Until
  // that lands, guard the burrito sync from ever pushing a burrito into a tC3
  // repo — importBurrito would fail on the pull anyway, but fail loud + early.
  if (project.format === 'tc3') {
    throw new Error(
      'This is a translationCore 3 project — syncing it back to Door43 (in tC3 format) is coming soon. Import is read-only for now.',
    );
  }
  const book = project.bookCode.toUpperCase();

  // resolve the repo link (first sync: name + create under the signed-in user)
  let link = project.dcs;
  if (!link) {
    const defaultName = `${project.bookCode.toLowerCase()}_checks`;
    const name = (promptRepoName ? promptRepoName(defaultName) : defaultName)?.trim();
    if (!name) return { cancelled: true }; // blank / whitespace-only = cancelled
    link = { owner: auth.username, repo: name, branch: 'master' };
  }
  const { owner, repo } = link;
  const branch = link.branch || 'master';

  let repoInfo = await dcs.getRepo(owner, repo, auth.token);
  if (!repoInfo) {
    if (owner.toLowerCase() !== auth.username.toLowerCase()) {
      throw new Error(`${owner}/${repo} not found on Door43 (repos can only be created under ${auth.username})`);
    }
    repoInfo = await dcs.createRepo(repo, auth.token);
  }

  // ---- pull: merge the remote project into local state before pushing ----
  const remoteSha = await dcs.getBranchSha(owner, repo, branch, auth.token);
  let states = await getCheckStates(project.id);
  let burrito = project.tc4 ? await getBurrito(project.tc4.importId) : null;
  let pulled = 0;
  if (remoteSha && remoteSha !== project.dcs?.lastSha) {
    const remote = importBurrito(await dcs.downloadArchive(owner, repo, remoteSha, auth.token));
    const m = mergeStates(states, seedStatesFromDecisions(remote.decisions[book] || {}));
    states = m.merged;
    pulled = m.pulled;
    if (pulled) await saveCheckStates(project.id, states);
    // remote files become the round-trip base (sibling books, other actors'
    // journals, everything unmodeled) — local decisions re-merge on top below
    burrito = { metadata: remote.metadata, files: remote.files, pins: remote.pins, settings: remote.settings };
    // Adopt the remote source text (this app never edits USFM in place — a
    // re-upload makes a new project — so remote is the authoritative evolving
    // source). Lets a device pick up a book expanded/updated elsewhere. Strip
    // BOTH sides: importBurrito returns the remote file verbatim, which may
    // carry alignment markup (externally-populated / tC3 repos); comparing and
    // storing stripped keeps INVARIANT I-1 and stops every sync re-churning it.
    const remoteBook = remote.books.find((b) => b.book === book);
    const remoteSource = remoteBook?.usfmText ? stripAlignmentMarkup(remoteBook.usfmText) : null;
    if (remoteSource && stripAlignmentMarkup(project.usfmText || '') !== remoteSource) {
      const parsed = parseUsfm(remoteSource);
      if (parsed.bookCode && Object.keys(parsed.chapters).length) {
        project = {
          ...project,
          chapters: parsed.chapters,
          usfmText: remoteSource,
          bookName: parsed.bookName || project.bookName,
        };
      }
    }
  }

  // ---- build local files and diff against the remote tree ----
  const { tn, tw } = await loadChecks(project, burrito?.pins);
  const files = buildBurritoFiles({
    project,
    burrito,
    checks: { tn, tw },
    states,
    journal: { actorId: await getActorId(), events: await getJournal(project.id) },
  });
  const remoteTree = remoteSha ? await dcs.getTree(owner, repo, remoteSha, auth.token) : {};
  // hash only files that already exist remotely (new files skip straight to
  // create); the SHA-1 digests are independent, so compute them in parallel
  const entries = Object.entries(files);
  const shas = await Promise.all(entries.map(([path, data]) => (remoteTree[path] ? gitBlobSha(data) : null)));
  const changes = [];
  entries.forEach(([path, data], i) => {
    const remoteBlob = remoteTree[path];
    if (remoteBlob && remoteBlob === shas[i]) return; // unchanged
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
      // omit branch while the repo is empty — the first commit creates the default branch
      { branch: remoteSha ? branch : undefined, message: `${book}: sync from tCore Checks (PWA)`, files: changes },
      auth.token,
    );
    newSha = res?.commit?.sha || null;
  }

  // ---- persist the link and the pushed files as the new base context ----
  const importId = project.tc4?.importId || `imp-${Date.now()}`;
  await saveBurrito(importId, contextFromFiles(files));
  project = {
    ...project,
    tc4: project.tc4 || { importId, book },
    dcs: {
      owner: repoInfo?.owner?.login || owner,
      repo: repoInfo?.name || repo,
      branch,
      lastSha: newSha,
      lastSyncAt: new Date().toISOString(),
    },
  };
  await saveProject(project);

  return { pulled, pushed: changes.length, repoUrl: `${dcs.DCS_HOST}/${project.dcs.owner}/${project.dcs.repo}` };
}

// Human-readable summary of a syncProject result, shared by the Home and
// report screens so both report a sync the same way. '' when cancelled or
// a no-op the UI shouldn't announce.
export function describeSyncResult(result) {
  if (result.cancelled) return '';
  if (!result.pushed && !result.pulled) return '✓ Up to date';
  return `✓ ${[result.pulled && `pulled ${result.pulled} decisions`, result.pushed && `pushed ${result.pushed} files`]
    .filter(Boolean)
    .join(', ')}`;
}

// The signed-in user's repos — funnels through resolveAuth so an expired
// OAuth token is refreshed first (same as every other DCS operation).
export async function listMyRepos(auth) {
  auth = await resolveAuth(auth);
  if (!auth?.token) throw new Error('Sign in to your Door43 account first');
  return dcs.listMyRepos(auth.token);
}

// Fetch a Door43 repo as a burrito zip for import. Returns {zip, dcs, name};
// the Home import path creates the projects and stamps the dcs link on them.
export async function fetchProjectFromDcs(input, auth) {
  const ref = dcs.parseRepoRef(input);
  if (!ref) throw new Error('Enter a Door43 repo like owner/name or paste its URL');
  auth = await resolveAuth(auth);
  const info = await dcs.getRepo(ref.owner, ref.repo, auth?.token);
  if (!info) throw new Error(`Repo not found on Door43: ${ref.owner}/${ref.repo}`);
  const branch = info.default_branch || 'master';
  const sha = await dcs.getBranchSha(info.owner?.login || ref.owner, info.name, branch, auth?.token);
  if (!sha) throw new Error(`${info.full_name} is empty — nothing to import yet`);
  const zip = await dcs.downloadArchive(info.owner?.login || ref.owner, info.name, sha, auth?.token);
  return {
    zip,
    name: info.full_name,
    dcs: { owner: info.owner?.login || ref.owner, repo: info.name, branch, lastSha: sha, lastSyncAt: new Date().toISOString() },
  };
}
