import { useMemo, useState } from 'preact/hooks';
import { Home } from './components/Home';
import { CheckList, checkProgress } from './components/CheckList';
import { GroupList } from './components/GroupList';
import { CheckRunner } from './components/CheckRunner';
import { Report } from './components/Report';
import { fetchTnTsv, fetchTwlTsv } from './lib/door43';
import { parseTnChecks, parseTwChecks, groupChecks } from './lib/checks';
import { getVerseText } from './lib/verses';
import { getProject, getCheckStates, saveCheckState, getBurrito } from './lib/store';
import { appendDecisionEvent } from './lib/journal';

const TOOL_NAMES = { tn: 'translationNotes', tw: 'translationWords' };

export function App() {
  const [route, setRoute] = useState({ view: 'home' });
  const [project, setProject] = useState(null);
  const [checks, setChecks] = useState(null); // {tn: [], tw: []} filtered to uploaded verses
  const [skipped, setSkipped] = useState({ tn: 0, tw: 0 });
  const [states, setStates] = useState({});
  const [pins, setPins] = useState(null); // tC4 resource pins (BURRITO-SPEC §5.3)
  const [loadError, setLoadError] = useState(null);

  const groups = useMemo(
    () => (checks ? { tn: groupChecks(checks.tn), tw: groupChecks(checks.tw) } : null),
    [checks],
  );

  async function openProject(id) {
    setRoute({ view: 'project' });
    setProject(null);
    setChecks(null);
    setLoadError(null);
    try {
      const p = await getProject(id);
      setProject(p);
      setStates(await getCheckStates(id));
      // imported tC4 projects check against their pinned resource versions
      const projectPins = p.tc4 ? (await getBurrito(p.tc4.importId))?.pins || null : null;
      setPins(projectPins);
      const [tnTsv, twlTsv] = await Promise.all([
        fetchTnTsv(p.bookCode, projectPins?.translationNotes),
        fetchTwlTsv(p.bookCode),
      ]);
      // partial-book support: only keep checks whose verse exists in the upload
      const filter = (list) => list.filter((c) => getVerseText(p, c.chapter, c.verse) != null);
      const tn = parseTnChecks(tnTsv);
      const tw = parseTwChecks(twlTsv);
      const tnKept = filter(tn);
      const twKept = filter(tw);
      setChecks({ tn: tnKept, tw: twKept });
      setSkipped({ tn: tn.length - tnKept.length, tw: tw.length - twKept.length });
    } catch (err) {
      setLoadError(`Could not load checking resources: ${err.message || err}`);
    }
  }

  async function onSaveState(checkId, state) {
    // navigation re-saves unchanged state; don't stamp/journal a no-op
    const prev = states[checkId];
    const hasContent = state.selections?.length || state.comment || state.reminder || state.nothingToSelect;
    if (!prev && !hasContent) return;
    if (prev && JSON.stringify({ ...prev, modifiedAt: 0 }) === JSON.stringify({ ...state, modifiedAt: 0 }))
      return;
    // a fresh decision on the current text resolves any imported re-review flag
    const stamped = { ...state, invalidated: false, modifiedAt: new Date().toISOString() };
    const next = await saveCheckState(project.id, checkId, stamped);
    setStates({ ...next });
    // journal every decision (BURRITO-SPEC §8 draft); never block the UI on it
    const tool = checkId.startsWith('tw-') ? 'tw' : 'tn';
    const check = checks[tool].find((c) => c.id === checkId);
    if (check) {
      appendDecisionEvent(project.id, {
        book: project.bookCode,
        tool,
        check,
        state: stamped,
      }).catch(() => {});
    }
  }

  // The ordered check list the runner is stepping through
  function activeChecks() {
    if (route.groupIndex != null) return groups[route.tool][route.groupIndex].checks;
    return checks[route.tool];
  }

  function back() {
    if (route.view === 'check') {
      if (route.groupIndex != null) setRoute({ view: 'group', tool: route.tool, groupIndex: route.groupIndex });
      else setRoute({ view: 'tool', tool: route.tool, mode: 'verses' });
    } else if (route.view === 'group') setRoute({ view: 'tool', tool: route.tool, mode: 'groups' });
    else if (route.view === 'tool' || route.view === 'report') setRoute({ view: 'project' });
    else setRoute({ view: 'home' });
  }

  const title =
    route.view === 'home'
      ? 'tCore Checks'
      : route.view === 'project'
        ? project?.bookName || '…'
        : route.view === 'report'
          ? `${project?.bookName} · Report`
          : `${project?.bookName || ''} · ${TOOL_NAMES[route.tool]}`;

  return (
    <>
      <header class="topbar">
        {route.view !== 'home' && <button onClick={back} aria-label="Back">‹</button>}
        <h1>{title}</h1>
        {route.view === 'home' && <span class="sub">notes & words PoC</span>}
      </header>

      {route.view === 'home' && <Home onOpen={openProject} />}

      {route.view === 'project' && (
        <div class="screen">
          {loadError && <p class="error">{loadError}</p>}
          {!project && !loadError && <p class="center muted">Loading project…</p>}
          {project && !checks && !loadError && (
            <p class="center muted">Fetching translationNotes & translationWords…</p>
          )}
          {project && checks && (
            <>
              {['tn', 'tw'].map((tool) => {
                const { done, total } = checkProgress(checks[tool], states);
                return (
                  <div
                    class="tool-item"
                    key={tool}
                    onClick={() => setRoute({ view: 'tool', tool, mode: 'groups' })}
                  >
                    <div class="grow">
                      <div class="item-title">{TOOL_NAMES[tool]}</div>
                      <div class="item-sub">
                        {done}/{total} checks · {groups[tool].length} check types
                      </div>
                      <div class="progress-track">
                        <div class="progress-fill" style={`width:${total ? (100 * done) / total : 0}%`} />
                      </div>
                    </div>
                    <span style="color:var(--muted)">›</span>
                  </div>
                );
              })}
              <button class="secondary" style="width:100%" onClick={() => setRoute({ view: 'report' })}>
                📋 View report
              </button>
              {skipped.tn + skipped.tw > 0 && (
                <p class="muted">
                  Partial upload: {skipped.tn + skipped.tw} checks outside your uploaded verses are
                  hidden.
                </p>
              )}
            </>
          )}
        </div>
      )}

      {route.view === 'tool' && checks && (
        <div class="screen">
          <div class="row seg-toggle">
            <button
              class={route.mode === 'groups' ? 'primary' : 'secondary'}
              onClick={() => setRoute({ ...route, mode: 'groups' })}
            >
              By check type
            </button>
            <button
              class={route.mode === 'verses' ? 'primary' : 'secondary'}
              onClick={() => setRoute({ ...route, mode: 'verses' })}
            >
              By verse
            </button>
          </div>
          {route.mode === 'groups' ? (
            <GroupList
              tool={route.tool}
              groups={groups[route.tool]}
              states={states}
              pins={pins}
              onOpen={(groupIndex) => setRoute({ view: 'group', tool: route.tool, groupIndex })}
            />
          ) : (
            <CheckList
              checks={checks[route.tool]}
              states={states}
              onOpen={(index) => setRoute({ view: 'check', tool: route.tool, index })}
            />
          )}
        </div>
      )}

      {route.view === 'group' && groups && (
        <div class="screen">
          <CheckList
            checks={groups[route.tool][route.groupIndex].checks}
            states={states}
            onOpen={(index) =>
              setRoute({ view: 'check', tool: route.tool, groupIndex: route.groupIndex, index })
            }
          />
        </div>
      )}

      {route.view === 'check' && checks && (
        <CheckRunner
          project={project}
          tool={route.tool}
          checks={activeChecks()}
          index={route.index}
          states={states}
          pins={pins}
          onSave={onSaveState}
          onNavigate={(index) => setRoute({ ...route, index })}
        />
      )}

      {route.view === 'report' && checks && (
        <Report project={project} checks={checks} states={states} skipped={skipped} pins={pins} />
      )}
    </>
  );
}
