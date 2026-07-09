import { useEffect, useState } from 'preact/hooks';
import { groupChecks } from '../lib/checks';
import { groupTitle } from '../lib/titles';
import { buildReportMarkdown, downloadText } from '../lib/report';
import { exportBurrito } from '../lib/tc4';
import { getActorId, getJournal } from '../lib/journal';
import { getBurrito } from '../lib/store';
import { syncProject, describeSyncResult } from '../lib/sync';
import { upgradeTc3ToBurrito } from '../lib/upgrade';
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
        <tbody>
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
        </tbody>
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

export function Report({ project, checks, states, skipped, pins, auth, onSynced }) {
  const [exportError, setExportError] = useState(null);
  const [syncMsg, setSyncMsg] = useState(null);
  const [upgradeMsg, setUpgradeMsg] = useState(null);
  const [upgrading, setUpgrading] = useState(false);

  // One-way tC3 → Scripture Burrito upgrade (upgrade.js). 'in-place' rewrites
  // the linked Door43 repo; 'new-repo' pushes to a fresh personal repo. On
  // success onSynced reloads the project — now format 'burrito', so this
  // screen re-renders with the normal burrito export/sync controls.
  async function upgrade(mode) {
    if (
      mode === 'in-place' &&
      !confirm(
        `Rewrite ${project.dcs.owner}/${project.dcs.repo} as a Scripture Burrito? This replaces its translationCore 3 files and cannot be undone.`,
      )
    ) {
      return;
    }
    setUpgrading(true);
    setUpgradeMsg('Upgrading…');
    try {
      const result = await upgradeTc3ToBurrito(project.id, auth, {
        mode,
        promptRepoName: (dflt) => prompt('New Door43 repository name:', dflt),
      });
      if (result.cancelled) {
        setUpgradeMsg(null);
        return;
      }
      setUpgradeMsg(
        `✓ Upgraded → ${result.owner}/${result.repo}` +
          (result.unmapped ? ` · ${result.unmapped} decision(s) need re-confirming at the current resource version` : ''),
      );
      await onSynced?.();
    } catch (err) {
      setUpgradeMsg(`⚠ ${err.message || err}`);
    } finally {
      setUpgrading(false);
    }
  }

  // Sync with the linked Door43 repo (pull + merge + push); first sync
  // creates/links a repo under the signed-in account
  async function sync() {
    setSyncMsg('Syncing…');
    try {
      const result = await syncProject(project.id, auth, {
        promptRepoName: (dflt) => prompt('Door43 repository name for this project:', dflt),
      });
      setSyncMsg(describeSyncResult(result) || null);
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
    // tC3 imports must not go through the burrito export: buildBurritoFiles has
    // no tC3 import context, so it would emit a fresh master-pinned burrito that
    // drops the project's tc3 resource pins. Converting tC3 -> burrito is the
    // (separate) upgrade flow. Guard defensively; the button is also hidden below.
    if (project.format === 'tc3') return;
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
      {project.format === 'tc3' ? (
        <div style="margin-bottom:12px">
          <p class="muted" style="margin:0 0 8px">
            🌯 This is a translationCore 3 project. Upgrade it to a Scripture Burrito (one-way — no
            going back):
          </p>
          {auth ? (
            <div class="row">
              {project.dcs && project.dcs.owner?.toLowerCase() === auth.username?.toLowerCase() && (
                <button class="secondary grow" disabled={upgrading} onClick={() => upgrade('in-place')}>
                  Upgrade this repo in place
                </button>
              )}
              <button class="secondary grow" disabled={upgrading} onClick={() => upgrade('new-repo')}>
                Export to a new repo
              </button>
            </div>
          ) : (
            <p class="muted" style="margin:0">
              Sign in to Door43 (top-right) to upgrade.
            </p>
          )}
          {upgradeMsg && (
            <p class={upgradeMsg.startsWith('⚠') ? 'error' : 'muted'}>{upgradeMsg}</p>
          )}
        </div>
      ) : (
        <button class="secondary" style="width:100%;margin-bottom:12px" onClick={downloadBurrito}>
          🌯 Export tC4 project (Scripture Burrito .zip)
        </button>
      )}
      {auth && project.format !== 'tc3' && (
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
