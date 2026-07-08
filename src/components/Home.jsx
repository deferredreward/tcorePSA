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

export function Home({ onOpen }) {
  const [projects, setProjects] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

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
  // states seeded from the checking/ decision sidecars
  async function addBurrito(file) {
    const imported = importBurrito(new Uint8Array(await file.arrayBuffer()));
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
      file.name;
    for (const { book, usfmText } of imported.books) {
      const parsed = parseUsfm(usfmText);
      const project = {
        id: `${book}-${Date.now()}`,
        name: `${parsed.bookName || book} (${projectName})`,
        ...parsed,
        usfmText,
        createdAt: new Date().toISOString(),
        tc4: { importId, book },
      };
      await saveProject(project);
      const seeded = seedStatesFromDecisions(imported.decisions[book] || {});
      if (Object.keys(seeded).length) await saveCheckStates(project.id, seeded);
    }
    await refresh();
  }

  async function onFile(e) {
    setError(null);
    setBusy(true);
    try {
      for (const file of e.target.files) {
        if (/\.zip$/i.test(file.name)) await addBurrito(file);
        else await addProject(await file.text(), file.name);
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
          translated — or a translationCore 4 project (Scripture Burrito .zip), or try a sample
          (Titus, unfoldingWord ULT).
        </p>
        <div class="row">
          <label class="primary">
            Upload USFM / tC4 zip
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
            </div>
          </div>
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
