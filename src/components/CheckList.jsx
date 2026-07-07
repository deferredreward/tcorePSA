function isDone(state) {
  return !!state && (state.nothingToSelect || (state.selections || []).length > 0);
}

export function checkProgress(checks, states) {
  const done = checks.filter((c) => isDone(states[c.id])).length;
  return { done, total: checks.length };
}

export function CheckList({ checks, states, onOpen }) {
  let lastChapter = null;
  return (
    <>
      {checks.map((check, i) => {
        const state = states[check.id];
        const header =
          check.chapter !== lastChapter ? (
            <h2 style="font-size:0.9rem;color:var(--ocean);margin:14px 2px 6px">
              Chapter {check.chapter}
            </h2>
          ) : null;
        lastChapter = check.chapter;
        return (
          <div key={check.id}>
            {header}
            <div class="check-item" onClick={() => onOpen(i)}>
              <span class={`status-dot ${isDone(state) ? 'done' : ''} ${state?.reminder ? 'flagged' : ''}`} />
              <div class="grow">
                <div class="item-title">
                  {check.reference} {check.tool === 'tw' ? `· ${check.term}` : ''}
                </div>
                <div class="item-sub">
                  {check.quote || (check.note || '').split('\n')[0].slice(0, 80)}
                </div>
              </div>
              {state?.comment ? <span title="has comment">💬</span> : null}
            </div>
          </div>
        );
      })}
    </>
  );
}

export { isDone };
