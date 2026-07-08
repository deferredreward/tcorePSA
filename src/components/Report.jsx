import { useEffect, useState } from 'preact/hooks';
import { groupChecks } from '../lib/checks';
import { groupTitle } from '../lib/titles';
import { buildReportMarkdown, downloadText } from '../lib/report';
import { exportBurrito } from '../lib/tc4';
import { getActorId, getJournal } from '../lib/journal';
import { getBurrito, getDcsAuth } from '../lib/store';
import { syncProject } from '../lib/sync';
import { isDone } from './CheckList';

const TOOL_NAMES = { tn: 'translationNotes', tw: 'translationWords' };

function ToolReport({ tool, checks, states, pins }) {
  const groups = groupChecks(checks);
  const [titles, setTitles] = useState({});

  useEffect(() => {
    let live = true;
    Promise.all(
      groups.map(async (g) => [g.id, await groupTitle(tool, g.id, pins?.translationAcademy)]),
    ).then((entries) => live && setTitles(Object.fromEntries(entries)));
    return () => {
      live = false;
    };
  }, [checks]);

  const done = checks.filter((c) => isDone(states[c.id])).length;
  const attention = checks.filter((c) => states[c.id]?.reminder || states[c.id]?.comment);

  return (
    <div class="card">
      <h2>{TOOL_NAMES[tool]}</h2>
      <p style="margin:4px 0">
        <strong>{done}</strong> of <strong>{checks.length}</strong> checks completed
      </p>
      <div class="progress-track">
        <div class="progress-fill" style={`width:${checks.length ? (100 * done) / checks.length : 0}%`} />
      </div>
      <table class="report-table">
        {groups.map((g) => {
          const gDone = g.checks.filter((c) => isDone(states[c.id])).length;
          const gFlag = g.checks.filter((c) => states[c.id]?.reminder).length;
          return (
            <tr>
              <td>{titles[g.id] || g.id}</td>
              <td class="num">
                {gDone}/{g.checks.length}
              </td>
              <td class="num">{gFlag ? `🚩${gFlag}` : ''}</td>
            </tr>
          );
        })}
      </table>
      {attention.length > 0 && (
        <>
          <h2 style="margin-top:14px">Needs attention</h2>
          {attention.map((c) => {
            const s = states[c.id];
            return (
              <div class="report-flag">
                <div>
                  {s.reminder ? '🚩 ' : '💬 '}
                  <strong>{c.reference}</strong> · {titles[c.groupId] || c.groupId}{' '}
                  <span class="muted">{c.quote}</span>
                </div>
                {s.comment && <div class="muted">“{s.comment}”</div>}
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}

export function Report({ project, checks, states, skipped, pins, onSynced }) {
  const [exportError, setExportError] = useState(null);
  const [auth, setAuth] = useState(null);
  const [syncMsg, setSyncMsg] = useState(null);

  useEffect(() => {
    getDcsAuth().then(setAuth);
  }, []);

  // Sync with the linked Door43 repo (pull + merge + push); first sync
  // creates/links a repo under the signed-in account
  async function sync() {
    setSyncMsg('Syncing…');
    try {
      const result = await syncProject(project.id, auth, {
        promptRepoName: (dflt) => prompt('Door43 repository name for this project:', dflt),
      });
      setSyncMsg(
        result.cancelled
          ? null
          : !result.pushed && !result.pulled
            ? '✓ Up to date'
            : `✓ ${[result.pulled && `pulled ${result.pulled} decisions`, result.pushed && `pushed ${result.pushed} files`]
                .filter(Boolean)
                .join(', ')}`,
      );
      if (!result.cancelled) await onSynced?.();
    } catch (err) {
      setSyncMsg(`⚠ ${err.message || err}`);
    }
  }

  async function download() {
    const md = await buildReportMarkdown(project, checks, states, skipped, pins);
    downloadText(`${project.bookCode}-check-report.md`, md);
  }

  // tC4 Scripture Burrito export: full project zip (metadata + USFM +
  // checking sidecars + §8-draft journal), importable by translationCore 4
  async function downloadBurrito() {
    setExportError(null);
    try {
      const burrito = project.tc4 ? await getBurrito(project.tc4.importId) : null;
      const zip = exportBurrito({
        project,
        burrito,
        checks,
        states,
        journal: { actorId: await getActorId(), events: await getJournal(project.id) },
      });
      downloadText(`${project.bookCode.toLowerCase()}-tc4-burrito.zip`, zip, 'application/zip');
    } catch (err) {
      setExportError(String(err.message || err));
    }
  }

  return (
    <div class="screen">
      <button class="primary" style="width:100%;margin-bottom:12px" onClick={download}>
        ⬇ Download report (.md)
      </button>
      <button class="secondary" style="width:100%;margin-bottom:12px" onClick={downloadBurrito}>
        🌯 Export tC4 project (Scripture Burrito .zip)
      </button>
      {auth && (
        <button
          class="secondary"
          style="width:100%;margin-bottom:12px"
          onClick={sync}
          disabled={syncMsg === 'Syncing…'}
        >
          ⇅ Sync with Door43{project.dcs ? ` (${project.dcs.owner}/${project.dcs.repo})` : ''}
        </button>
      )}
      {syncMsg && <p class={syncMsg.startsWith('⚠') ? 'error' : 'muted'}>{syncMsg}</p>}
      {exportError && <p class="error">Export failed: {exportError}</p>}
      {(skipped.tn > 0 || skipped.tw > 0) && (
        <p class="muted">
          {skipped.tn + skipped.tw} checks fall outside the portion you uploaded and are not
          counted.
        </p>
      )}
      <ToolReport tool="tn" checks={checks.tn} states={states} pins={pins} />
      <ToolReport tool="tw" checks={checks.tw} states={states} pins={pins} />
    </div>
  );
}
