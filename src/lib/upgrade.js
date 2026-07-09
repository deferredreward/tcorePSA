// One-way tC3 → Scripture Burrito upgrade — the deliberate, user-triggered
// bridge between the app's two otherwise-isolated pipelines (the tC3 read
// import in tc3.js and the native burrito path in tc4.js/sync.js).
//
// This is the ONLY place the two formats meet, and it only ever runs on an
// explicit user action. Two modes:
//   'in-place' — rewrite the SAME linked Door43 repo as a burrito. The tC3
//                FORMAT markers (manifest.json, the USFM copies, the chapter
//                json) are deleted; the `.apps/` checkData is PRESERVED as a
//                safety net (see isTc3FormatMarker). The project is re-pointed
//                at that repo with format 'burrito'.
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
// The burrito's checking/ sidecars carry every decision whose check id still
// resolves at the fetched resource versions. Some may NOT (tW is fetched at
// en_twl master with no pin; pre-checkId projects seed nothing), so the upgrade
// (a) counts them (`unmapped` in the result) instead of reporting a silent
// clean success, and (b) never destroys the source: new-repo leaves the tC3
// repo untouched, in-place keeps the `.apps/` checkData. See STATE.md.
//
// Pure-ish module: DCS calls + IndexedDB store, no DOM. The UI passes a
// promptRepoName callback for the new-repo name (mirrors syncProject).

import { buildBurritoFiles } from './tc4';
import * as dcs from './dcs';
import { loadChecks, ensureFreshAuth, contextFromFiles } from './sync';
import { getProject, saveProject, getCheckStates, saveBurrito, getDcsAuth } from './store';
import { getActorId, getJournal } from './journal';
import { strToU8 } from 'fflate';

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

// A path that defines the repo's tC3 FORMAT and has no place in a burrito, so
// an in-place upgrade removes it. Deliberately the format markers ONLY — the
// root manifest.json, the root/repo-named USFM copies, and the redundant
// chapter-split <book>/N.json — and NOT `.apps/translationCore/…`.
//
// The `.apps/` checkData is the authoritative record of every checking decision
// the project ever made, and the burrito's checking/ sidecars only carry
// decisions whose check ids still resolve at the fetched resource versions —
// tW is always fetched at en_twl master (no pin support yet), and pre-checkId
// projects seed nothing. So the burrito can silently omit decisions, and
// deleting the checkData would make that loss permanent. In-place therefore
// PRESERVES `.apps/` as an unmodeled leftover: harmless (detectProjectFormat
// prefers metadata.json ⇒ burrito, and burrito sync round-trips unmodeled files
// verbatim) and a guaranteed safety net. Positive-ID only, so a user's
// LICENSE/README also survive.
function isTc3FormatMarker(path, bookCode) {
  const book = String(bookCode || '').toLowerCase();
  return (
    path === 'manifest.json' ||
    /^[^/]+\.usfm$/i.test(path) || // root-level USFM copies (burrito USFM is ingredients/<BOOK>.usfm)
    // chapter-split verse json ONLY (<book>/<chapter>.json) — NOT every path
    // under <book>/, so a user's oba/notes.md or oba/assets/… is never deleted
    (!!book && new RegExp(`^${book}/\\d+\\.json$`).test(path))
  );
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
  // These four are independent: the check-list fetch (loadChecks, the network
  // one) runs alongside the IndexedDB reads rather than serialized around them.
  // loadChecks fetches at the tC3 pins so tN ids match the seeded decisions'
  // checkIds (the point of carrying the pins forward).
  const [states, { tn, tw }, actorId, events] = await Promise.all([
    getCheckStates(project.id),
    loadChecks(project, project.pins),
    getActorId(),
    getJournal(project.id),
  ]);
  const resources = resourcesFromTc3(project.pins);
  const files = buildBurritoFiles({
    project,
    // ONLY the resources sidecar — no tC3 files — so buildBurritoFiles emits a
    // clean fresh burrito that is nonetheless correctly pinned.
    burrito: {
      files: { 'ingredients/checking/resources.json': strToU8(JSON.stringify(resources, null, 2) + '\n') },
      pins: resources.resources,
      metadata: null, // → fresh burrito metadata (generator = the PWA)
    },
    checks: { tn, tw },
    states,
    journal: { actorId, events },
  });

  // A decided state whose check id isn't in the freshly-fetched lists can't be
  // written into the burrito — mergeDecisions only emits decisions for a check
  // it can match (tc4.js). This happens when the fetched resource differs from
  // what the project was checked against — notably tW, always fetched at en_twl
  // master (no pin support yet). Count them so the upgrade never reports a clean
  // success while quietly omitting work; nothing is *lost* (new-repo leaves the
  // source repo untouched; in-place preserves .apps/ — see isTc3FormatMarker),
  // but those checks need re-confirming against the current resource.
  const fetchedIds = new Set([...tn, ...tw].map((c) => c.id));
  const unmapped = Object.entries(states).filter(
    ([id, s]) => (s.selections?.length || s.comment || s.reminder || s.nothingToSelect) && !fetchedIds.has(id),
  ).length;

  // ---- resolve the target repo and commit ----
  let owner, repo, branch, lastSha, deleted = 0;
  if (mode === 'in-place') {
    if (!project.dcs) {
      throw new Error('This project has no linked Door43 repo to upgrade in place — use “Export to a new repo” instead.');
    }
    ({ owner, repo } = project.dcs);
    if (owner.toLowerCase() !== auth.username.toLowerCase()) {
      throw new Error(`Can only rewrite a repo you own — ${owner}/${repo} belongs to ${owner}. Use “Export to a new repo” instead.`);
    }
    // Confirm the repo still exists and resolve its real default branch: a stale
    // link (repo deleted/renamed, or default branch is 'main' not 'master')
    // would otherwise make getBranchSha return null — indistinguishable from an
    // empty repo — and the commit would push existing paths as 'create' (422)
    // while skipping the tC3-marker deletes.
    const repoInfo = await dcs.getRepo(owner, repo, auth.token);
    if (!repoInfo) {
      throw new Error(`${owner}/${repo} no longer exists on Door43 — use “Export to a new repo” instead.`);
    }
    branch = project.dcs.branch || repoInfo.default_branch || 'master';
    const remoteSha = await dcs.getBranchSha(owner, repo, branch, auth.token);
    // Refuse if the repo moved on since import: an in-place rewrite builds from
    // the LOCAL (import-time) usfmText/states and would clobber whatever landed
    // remotely (tC3 has no pull/merge path — that's the burrito pipeline). Steer
    // to a fresh re-import or new-repo instead of silently overwriting.
    if (remoteSha && project.dcs.lastSha && remoteSha !== project.dcs.lastSha) {
      throw new Error(
        `${owner}/${repo} has changed on Door43 since you imported it — re-import it, or use “Export to a new repo”, before upgrading in place.`,
      );
    }
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
    // delete the tC3 format markers we positively identify and aren't already
    // overwriting (the .apps/ checkData is deliberately kept — see isTc3FormatMarker)
    for (const [path, sha] of Object.entries(tree)) {
      if (files[path] || !isTc3FormatMarker(path, project.bookCode)) continue;
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
    // Fail early and clearly on a name collision rather than letting createRepo
    // surface a raw 409 (also catches a retry after a create-then-commit failure).
    if (await dcs.getRepo(auth.username, name, auth.token)) {
      throw new Error(`A repo named “${name}” already exists under @${auth.username} — pick a different name.`);
    }
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
  await saveBurrito(importId, contextFromFiles(files));
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
    unmapped,
  };
}
