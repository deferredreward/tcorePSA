import { useEffect, useState } from 'preact/hooks';
import { parseUsfm } from '../lib/usfmParse';
import { fetchSampleUsfm } from '../lib/door43';
import { usfmFileNumber, BOOKS } from '../lib/books';
import {
  listProjects,
  getProject,
  saveProject,
  deleteProject,
  saveBurrito,
  saveCheckStates,
} from '../lib/store';
import { importBurrito, seedStatesFromDecisions } from '../lib/tc4';
import { detectProjectFormat, importTc3 } from '../lib/tc3';
import { syncProject, fetchProjectFromDcs, listMyRepos, describeSyncResult } from '../lib/sync';
import { upgradeTc3ToBurrito } from '../lib/upgrade';

export function Home({ onOpen, auth }) {
  const [projects, setProjects] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [syncStatus, setSyncStatus] = useState({}); // projectId -> message
  const [repoRef, setRepoRef] = useState('');
  const [myRepos, setMyRepos] = useState(null);
  const [upgradeMenu, setUpgradeMenu] = useState(null); // projectId with its upgrade options open

  async function refresh() {
    const ids = await listProjects();
    const loaded = await Promise.all(ids.map(getProject));
    setProjects(loaded.filter(Boolean));
  }
  useEffect(() => {
    refresh();
  }, []);

  async function addProject(usfmText, sourceName) {
    const parsed = parseUsfm(usfmText);
    if (!parsed.bookCode || !Object.keys(parsed.chapters).length) {
      throw new Error(`Could not find a book id / verses in ${sourceName}`);
    }
    const project = {
      id: `${parsed.bookCode}-${Date.now()}`,
      name: `${parsed.bookName} (${sourceName})`,
      ...parsed,
      usfmText,
      createdAt: new Date().toISOString(),
    };
    await saveProject(project);
    await refresh();
    return project;
  }

  // A tC4 Scripture Burrito project zip: one PWA project per book, check
  // states seeded from the checking/ decision sidecars. `dcs` (from an
  // online import) links every book project to its Door43 repo for syncing.
  async function addBurrito(zipBytes, sourceName, dcs = null) {
    const imported = importBurrito(zipBytes);
    const importId = `imp-${Date.now()}`;
    await saveBurrito(importId, {
      metadata: imported.metadata,
      files: imported.files,
      pins: imported.pins,
      settings: imported.settings,
    });
    const projectName =
      imported.metadata?.identification?.name?.en ||
      imported.metadata?.identification?.abbreviation?.en ||
      sourceName;
    for (const { book, usfmText } of imported.books) {
      const parsed = parseUsfm(usfmText);
      const project = {
        id: `${book}-${Date.now()}`,
        name: `${parsed.bookName || book} (${projectName})`,
        ...parsed,
        usfmText,
        createdAt: new Date().toISOString(),
        tc4: { importId, book },
        ...(dcs ? { dcs } : {}),
      };
      await saveProject(project);
      const seeded = seedStatesFromDecisions(imported.decisions[book] || {});
      if (Object.keys(seeded).length) await saveCheckStates(project.id, seeded);
    }
    await refresh();
  }

  // A legacy translationCore 3 project (manifest.json + .apps/translationCore
  // checkData) — the format that predates Scripture Burrito. Read-only import:
  // one PWA project for its book, check states seeded from the checkData
  // sidecars, pinned to the resource versions the manifest recorded. Marked
  // `format: 'tc3'` so the sync path routes it to the (separate) tC3 pipeline
  // rather than the burrito one.
  async function addTc3(zipBytes, sourceName, dcs = null) {
    const t = importTc3(zipBytes);
    const parsed = parseUsfm(t.usfmText);
    if (!parsed.bookCode || !Object.keys(parsed.chapters).length) {
      throw new Error(`Could not read a book from the tC3 project ${sourceName}`);
    }
    const project = {
      id: `${parsed.bookCode}-${Date.now()}`,
      name: `${parsed.bookName || parsed.bookCode} (${t.name || sourceName})`,
      ...parsed,
      usfmText: t.usfmText,
      createdAt: new Date().toISOString(),
      format: 'tc3',
      pins: t.pins,
      ...(dcs ? { dcs } : {}),
    };
    await saveProject(project);
    const seeded = seedStatesFromDecisions(t.decisions);
    if (Object.keys(seeded).length) await saveCheckStates(project.id, seeded);
    await refresh();
  }

  // Pull a Door43 repo down as a new project (or set of book projects),
  // stamping the dcs link on each so it syncs back to that repo. Detects a
  // legacy tC3 repo vs. a tC4 burrito and routes to the matching importer.
  async function importRepo(ref) {
    setError(null);
    setBusy(true);
    try {
      const fetched = await fetchProjectFromDcs(ref, auth);
      if (detectProjectFormat(fetched.zip) === 'tc3') {
        await addTc3(fetched.zip, fetched.name, fetched.dcs);
      } else {
        await addBurrito(fetched.zip, fetched.name, fetched.dcs);
      }
      setRepoRef('');
      setMyRepos(null);
    } catch (err) {
      setError(String(err.message || err));
    } finally {
      setBusy(false);
    }
  }

  async function showMyRepos() {
    setError(null);
    setBusy(true);
    try {
      setMyRepos(await listMyRepos(auth));
    } catch (err) {
      setError(String(err.message || err));
    } finally {
      setBusy(false);
    }
  }

  async function sync(projectId) {
    setSyncStatus((s) => ({ ...s, [projectId]: 'Syncing…' }));
    try {
      const result = await syncProject(projectId, auth, {
        promptRepoName: (dflt) => prompt('Door43 repository name for this project:', dflt),
      });
      setSyncStatus((s) => ({ ...s, [projectId]: describeSyncResult(result) }));
      await refresh();
    } catch (err) {
      setSyncStatus((s) => ({ ...s, [projectId]: `⚠ ${err.message || err}` }));
    }
  }

  // One-way tC3 → Scripture Burrito upgrade (upgrade.js). Reuses the per-project
  // syncStatus line for feedback; refresh() re-reads the project, now format
  // 'burrito' (its ⇅ sync button replaces the 🌯 upgrade button).
  async function upgrade(projectId, mode) {
    const p = projects.find((x) => x.id === projectId);
    if (
      mode === 'in-place' &&
      p?.dcs &&
      !confirm(
        `Rewrite ${p.dcs.owner}/${p.dcs.repo} as a Scripture Burrito? This replaces its translationCore 3 files and cannot be undone.`,
      )
    ) {
      return;
    }
    setUpgradeMenu(null);
    setSyncStatus((s) => ({ ...s, [projectId]: 'Upgrading…' }));
    try {
      const result = await upgradeTc3ToBurrito(projectId, auth, {
        mode,
        promptRepoName: (dflt) => prompt('New Door43 repository name:', dflt),
      });
      setSyncStatus((s) => ({
        ...s,
        [projectId]: result.cancelled
          ? ''
          : `✓ Upgraded → ${result.owner}/${result.repo}` +
            (result.unmapped ? ` · ${result.unmapped} decision(s) need re-confirming` : ''),
      }));
      await refresh();
    } catch (err) {
      setSyncStatus((s) => ({ ...s, [projectId]: `⚠ ${err.message || err}` }));
    }
  }

  async function onFile(e) {
    setError(null);
    setBusy(true);
    try {
      for (const file of e.target.files) {
        if (/\.zip$/i.test(file.name)) {
          const bytes = new Uint8Array(await file.arrayBuffer());
          if (detectProjectFormat(bytes) === 'tc3') await addTc3(bytes, file.name);
          else await addBurrito(bytes, file.name);
        } else await addProject(await file.text(), file.name);
      }
    } catch (err) {
      setError(String(err.message || err));
    } finally {
      setBusy(false);
      e.target.value = '';
    }
  }

  async function loadSample(code) {
    setError(null);
    setBusy(true);
    try {
      const usfm = await fetchSampleUsfm(usfmFileNumber(code), code);
      const project = await addProject(usfm, 'en_ULT sample');
      onOpen(project.id);
    } catch (err) {
      setError(String(err.message || err));
    } finally {
      setBusy(false);
    }
  }

  async function remove(id, name) {
    if (confirm(`Delete project "${name}" and its check data?`)) {
      await deleteProject(id);
      await refresh();
    }
  }

  return (
    <div class="screen">
      <div class="card">
        <h2>Add a translation</h2>
        <p class="muted">
          Upload a USFM file of your translation — a whole book or just the portion you've
          translated — or a translationCore project .zip (v3, or v4 Scripture Burrito), or
          try a sample (Titus, unfoldingWord ULT). A tC3 project on Door43 imports directly
          from its repo below.
        </p>
        <div class="row">
          <label class="primary">
            Upload USFM / tC zip
            <input
              type="file"
              accept=".usfm,.sfm,.txt,.usf,.zip"
              multiple
              style="display:none"
              onChange={onFile}
            />
          </label>
          <button class="secondary" onClick={() => loadSample('TIT')} disabled={busy}>
            {busy ? 'Loading…' : 'Sample: Titus (NT)'}
          </button>
          <button class="secondary" onClick={() => loadSample('RUT')} disabled={busy}>
            {busy ? 'Loading…' : 'Sample: Ruth (OT)'}
          </button>
        </div>
        {auth && (
          <div style="margin-top:12px;border-top:1px solid var(--border);padding-top:12px">
            <p class="muted" style="margin:0 0 8px">
              …or import a project you’ve synced to Door43:
            </p>
            <div class="row">
              <input
                type="text"
                class="grow"
                placeholder="owner/repo or Door43 URL"
                value={repoRef}
                onInput={(e) => setRepoRef(e.target.value)}
                autocapitalize="off"
              />
              <button
                class="secondary"
                onClick={() => importRepo(repoRef)}
                disabled={busy || !repoRef.trim()}
              >
                Import
              </button>
              <button class="secondary" onClick={showMyRepos} disabled={busy}>
                My repos
              </button>
            </div>
            {myRepos && !myRepos.length && (
              <p class="muted">No repos under @{auth.username} yet.</p>
            )}
            {myRepos?.map((r) => (
              <div class="row" style="align-items:center;margin-top:6px" key={r.full_name}>
                <span class="grow" style="overflow:hidden;text-overflow:ellipsis;font-size:0.9rem">
                  {r.full_name}
                </span>
                <button
                  class="secondary"
                  style="padding:6px 10px"
                  onClick={() => importRepo(r.full_name)}
                  disabled={busy}
                >
                  Import
                </button>
              </div>
            ))}
          </div>
        )}
        {error && <p class="error">{error}</p>}
      </div>

      <h2 style="font-size:0.95rem;color:var(--ocean)">Projects</h2>
      {!projects.length && <p class="muted">No projects yet.</p>}
      {projects.map((p) => (
        <div class="project-item" key={p.id} onClick={() => onOpen(p.id)}>
          <div class="grow">
            <div class="item-title">{p.bookName || BOOKS[p.bookCode] || p.bookCode}</div>
            <div class="item-sub">
              {p.name} · {Object.keys(p.chapters).length} chapters
              {p.dcs && ` · ⇅ ${p.dcs.owner}/${p.dcs.repo}`}
            </div>
            {syncStatus[p.id] && (
              <div class="item-sub" style="color:var(--ocean)">
                {syncStatus[p.id]}
              </div>
            )}
            {upgradeMenu === p.id && (
              <div class="row" style="margin-top:6px" onClick={(e) => e.stopPropagation()}>
                {p.dcs && p.dcs.owner?.toLowerCase() === auth.username?.toLowerCase() && (
                  <button
                    class="secondary"
                    style="padding:6px 10px"
                    onClick={() => upgrade(p.id, 'in-place')}
                  >
                    Upgrade repo in place
                  </button>
                )}
                <button
                  class="secondary"
                  style="padding:6px 10px"
                  onClick={() => upgrade(p.id, 'new-repo')}
                >
                  Export to new repo
                </button>
              </div>
            )}
          </div>
          {auth && p.format !== 'tc3' && (
            <button
              class="secondary"
              style="padding:6px 10px"
              title="Sync with Door43"
              disabled={syncStatus[p.id] === 'Syncing…'}
              onClick={(e) => {
                e.stopPropagation();
                sync(p.id);
              }}
            >
              ⇅
            </button>
          )}
          {auth && p.format === 'tc3' && (
            <button
              class="secondary"
              style="padding:6px 10px"
              title="Upgrade to Scripture Burrito"
              onClick={(e) => {
                e.stopPropagation();
                setUpgradeMenu(upgradeMenu === p.id ? null : p.id);
              }}
            >
              🌯
            </button>
          )}
          <button
            class="secondary"
            style="padding:6px 10px"
            onClick={(e) => {
              e.stopPropagation();
              remove(p.id, p.name);
            }}
          >
            🗑
          </button>
        </div>
      ))}
    </div>
  );
}
