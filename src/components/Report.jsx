import { useEffect, useState } from 'preact/hooks';
import { groupChecks } from '../lib/checks';
import { groupTitle } from '../lib/titles';
import { isDone } from './CheckList';

const TOOL_NAMES = { tn: 'translationNotes', tw: 'translationWords' };

function ToolReport({ tool, checks, states }) {
  const groups = groupChecks(checks);
  const [titles, setTitles] = useState({});

  useEffect(() => {
    let live = true;
    Promise.all(groups.map(async (g) => [g.id, await groupTitle(tool, g.id)])).then(
      (entries) => live && setTitles(Object.fromEntries(entries)),
    );
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

export function Report({ checks, states, skipped }) {
  return (
    <div class="screen">
      {(skipped.tn > 0 || skipped.tw > 0) && (
        <p class="muted">
          {skipped.tn + skipped.tw} checks fall outside the portion you uploaded and are not
          counted.
        </p>
      )}
      <ToolReport tool="tn" checks={checks.tn} states={states} />
      <ToolReport tool="tw" checks={checks.tw} states={states} />
    </div>
  );
}
