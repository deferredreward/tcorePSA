// One-way tC3 → Scripture Burrito upgrade — the deliberate, user-triggered
// bridge between the app's two otherwise-isolated pipelines (the tC3 read
// import in tc3.js and the native burrito path in tc4.js/sync.js).
//
// This is the ONLY place the two formats meet, and it only ever runs on an
// explicit user action. Two modes:
//   'in-place' — rewrite the SAME linked Door43 repo as a burrito (the repo
//                stops being tC3; the tC3 marker files are deleted). The
//                project is re-pointed at that repo with format 'burrito'.
//   'new-repo' — create a fresh personal repo under the signed-in user, push
//                the burrito there, and leave the original tC3 repo untouched.
//                The project is re-linked to the new repo with format 'burrito'.
// There is no downgrade (burrito → tC3).
//
// The conversion itself is buildBurritoFiles (tc4.js) run over the tC3
// project's usfmText + the PWA check states (seeded from the tC3 checkData on
// import). We pass a MINIMAL burrito context — no tC3 files are layered in, so
// the result is a clean fresh burrito — carrying only a freshly-built
// resources.json so the tC3 manifest's resource pins survive the upgrade (see
// resourcesFromTc3 below for why that matters).
//
// The tC3 checkData (`.apps/translationCore/checkData/…`) is intentionally
// DROPPED, not carried across: every decision in it was seeded into the PWA
// states on import, and buildBurritoFiles re-emits those as the burrito's
// checking/ decision sidecars. See STATE.md "tC3→Burrito upgrade".
//
// Pure-ish module: DCS calls + IndexedDB store, no DOM. The UI passes a
// promptRepoName callback for the new-repo name (mirrors syncProject).

import { buildBurritoFiles } from './tc4';
import * as dcs from './dcs';
import { loadChecks, ensureFreshAuth } from './sync';
import { getProject, saveProject, getCheckStates, saveBurrito, getDcsAuth } from './store';
import { getActorId, getJournal } from './journal';
import { strToU8, strFromU8 } from 'fflate';

// Build a burrito checking/resources.json (BURRITO-SPEC §5.3) from the tC3
// project's manifest-derived pins. WHY this matters: on reload (and on any
// later re-import) the app reads a burrito's resource pins from resources.json
// — not from the per-decision `resource` field — and fetches its tN/tW check
// lists at those versions. A fresh burrito defaults to en_*/master; if the tC3
// project was checked against, say, en_tn v88, the check ids at master can
// differ and the just-migrated decisions would silently fail to re-attach.
// Carrying the tC3 pins forward keeps "same pins ⇒ same check ids ⇒ decisions
// line up". OL/lexicon are informational here (tC3 pins neither) and stay at
// unfoldingWord master, matching tc4.js's defaultResources.
function resourcesFromTc3(pins) {
  const tn = pins?.translationNotes;
  const tw = pins?.translationWords;
  const ta = pins?.translationAcademy;
  // gatewayLanguage is informational; derive it from the tN pin repoPath
  // (git.door43.org/<owner>/<gl>_tn) so it reflects the project's GL/owner.
  const m = /\/([^/]+)\/([a-z0-9-]+)_tn$/i.exec(tn?.repoPath || '');
  const owner = m ? m[1] : 'unfoldingWord';
  const languageId = m ? m[2] : 'en';
  const pin = (p, repo, flavor) => ({
    repoPath: p?.repoPath || `git.door43.org/unfoldingWord/en_${repo}`,
    version: p?.version || 'master',
    flavor,
  });
  return {
    schemaVersion: 1,
    note: 'Written by tCore Checks (PWA) upgrading a translationCore 3 project. Pins carried from the tC3 manifest so check ids keep matching. version "master" means unpinned.',
    gatewayLanguage: { languageId, owner },
    resources: {
      originalLanguage: {
        nt: { repoPath: 'git.door43.org/unfoldingWord/grc_ugnt', version: 'master', flavor: 'scripture/textTranslation' },
        ot: { repoPath: 'git.door43.org/unfoldingWord/hbo_uhb', version: 'master', flavor: 'scripture/textTranslation' },
      },
      translationWords: pin(tw, 'tw', 'parascriptural/x-bcvarticles'),
      translationNotes: pin(tn, 'tn', 'parascriptural/x-bcvnotes'),
      translationAcademy: pin(ta, 'ta', 'peripheral/x-peripheralArticles'),
      lexicon: {
        nt: { repoPath: 'git.door43.org/unfoldingWord/en_ugl', version: 'master', flavor: 'peripheral/x-lexicon' },
        ot: { repoPath: 'git.door43.org/unfoldingWord/en_uhl', version: 'master', flavor: 'peripheral/x-lexicon' },
      },
    },
  };
}

// A path in the linked repo that identifies it as a tC3 project and has no
// place in a burrito, so an in-place upgrade removes it. Positive
// identification only (never a catch-all "delete everything else") so we can't
// destroy unrelated files a user added (LICENSE, README); anything we miss is
// harmless because detectProjectFormat prefers metadata.json ⇒ burrito. Layout
// per tc3.js: root manifest.json, root <book>.usfm (+ repo-named copy),
// .apps/translationCore/…, and the redundant chapter-split <book>/N.json dir.
function isTc3Artifact(path, bookCode) {
  const book = String(bookCode || '').toLowerCase();
  return (
    path === 'manifest.json' ||
    path.startsWith('.apps/') ||
    /^[^/]+\.usfm$/i.test(path) || // root-level USFM (burrito USFM is ingredients/<BOOK>.usfm)
    (!!book && path.startsWith(`${book}/`)) // chapter-split verse json
  );
}

// Turn the generated burrito file map into the stored import context the rest
// of the app consumes (App.loadProjectData reads pins from here).
function contextFromFiles(files, resources) {
  const read = (p) => (files[p] ? JSON.parse(strFromU8(files[p])) : null);
  return {
    metadata: read('metadata.json'),
    files,
    pins: resources.resources,
    settings: read('ingredients/checking/settings.json'),
  };
}

// Convert an imported tC3 project (project.format === 'tc3') to a Scripture
// Burrito and push it to Door43.
//   projectId       the tC3 project to upgrade
//   auth            Door43 auth hint (re-resolved from the store here)
//   opts.mode       'in-place' | 'new-repo'
//   opts.repoName   new-repo name (skips the prompt if given)
//   opts.promptRepoName(default) => name | null   new-repo name prompt (UI)
// Returns {mode, owner, repo, repoUrl, pushed, deleted} or {cancelled:true}.
export async function upgradeTc3ToBurrito(projectId, auth, { mode = 'new-repo', repoName, promptRepoName } = {}) {
  auth = await ensureFreshAuth((await getDcsAuth()) || auth);
  if (!auth?.token) throw new Error('Sign in to your Door43 account first');

  let project = await getProject(projectId);
  if (!project) throw new Error('Project not found');
  if (project.format !== 'tc3') {
    throw new Error('Only translationCore 3 projects can be upgraded to Scripture Burrito');
  }
  const book = project.bookCode.toUpperCase();

  // ---- build the burrito files from the tC3 project + seeded states ----
  const states = await getCheckStates(project.id);
  // Fetch the check lists at the tC3 pins so their ids match the seeded
  // decisions' checkIds (the whole point of carrying the pins forward).
  const { tn, tw } = await loadChecks(project, project.pins);
  const resources = resourcesFromTc3(project.pins);
  const burritoContext = {
    // ONLY the resources sidecar — no tC3 files — so buildBurritoFiles emits a
    // clean fresh burrito that is nonetheless correctly pinned.
    files: { 'ingredients/checking/resources.json': strToU8(JSON.stringify(resources, null, 2) + '\n') },
    pins: resources.resources,
    metadata: null, // → fresh burrito metadata (generator = the PWA)
  };
  const files = buildBurritoFiles({
    project,
    burrito: burritoContext,
    checks: { tn, tw },
    states,
    journal: { actorId: await getActorId(), events: await getJournal(project.id) },
  });

  // ---- resolve the target repo and commit ----
  let owner, repo, branch, lastSha, deleted = 0;
  if (mode === 'in-place') {
    if (!project.dcs) {
      throw new Error('This project has no linked Door43 repo to upgrade in place — use “Export to a new repo” instead.');
    }
    ({ owner, repo } = project.dcs);
    branch = project.dcs.branch || 'master';
    if (owner.toLowerCase() !== auth.username.toLowerCase()) {
      throw new Error(`Can only rewrite a repo you own — ${owner}/${repo} belongs to ${owner}. Use “Export to a new repo” instead.`);
    }
    const remoteSha = await dcs.getBranchSha(owner, repo, branch, auth.token);
    const tree = remoteSha ? await dcs.getTree(owner, repo, remoteSha, auth.token) : {};
    const changes = [];
    for (const [path, data] of Object.entries(files)) {
      const sha = tree[path];
      changes.push(
        sha
          ? { operation: 'update', path, content: dcs.toBase64(data), sha }
          : { operation: 'create', path, content: dcs.toBase64(data) },
      );
    }
    // delete tC3 markers we positively identify and aren't already overwriting
    for (const [path, sha] of Object.entries(tree)) {
      if (files[path] || !isTc3Artifact(path, project.bookCode)) continue;
      changes.push({ operation: 'delete', path, sha });
      deleted++;
    }
    const res = await dcs.commitFiles(
      owner,
      repo,
      {
        branch: remoteSha ? branch : undefined,
        message: `Upgrade ${book} to Scripture Burrito (from translationCore 3)`,
        files: changes,
      },
      auth.token,
    );
    lastSha = res?.commit?.sha || null;
  } else {
    // new-repo: create a fresh personal repo (empty → every file is a create,
    // and the branch is omitted so the first commit creates the default branch)
    const defaultName = `${project.bookCode.toLowerCase()}_checks`;
    const name = (repoName || (promptRepoName ? promptRepoName(defaultName) : defaultName) || '').trim();
    if (!name) return { cancelled: true };
    const created = await dcs.createRepo(name, auth.token);
    owner = created?.owner?.login || auth.username;
    repo = created?.name || name;
    branch = created?.default_branch || 'master';
    const changes = Object.entries(files).map(([path, data]) => ({
      operation: 'create',
      path,
      content: dcs.toBase64(data),
    }));
    const res = await dcs.commitFiles(
      owner,
      repo,
      { message: `Create ${book} Scripture Burrito (upgraded from translationCore 3)`, files: changes },
      auth.token,
    );
    lastSha = res?.commit?.sha || null;
  }

  // ---- flip the project to the burrito pipeline ----
  // Store the burrito context so App.loadProjectData reads pins/metadata from
  // it (via project.tc4.importId), exactly like a natively-imported burrito.
  const importId = `imp-${Date.now()}`;
  await saveBurrito(importId, contextFromFiles(files, resources));
  const upgraded = {
    ...project,
    format: 'burrito',
    tc4: { importId, book },
    dcs: { owner, repo, branch, lastSha, lastSyncAt: new Date().toISOString() },
  };
  // project.pins was the tC3 pin store; the burrito context now owns pins, so
  // this field is dead — remove the orphan this upgrade created.
  delete upgraded.pins;
  await saveProject(upgraded);

  return {
    mode,
    owner,
    repo,
    repoUrl: `${dcs.DCS_HOST}/${owner}/${repo}`,
    pushed: Object.keys(files).length,
    deleted,
  };
}
