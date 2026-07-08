import { useEffect, useState } from 'preact/hooks';
import { groupTitle } from '../lib/titles';
import { isDone } from './CheckList';

export function GroupList({ tool, groups, states, pins, onOpen }) {
  const [titles, setTitles] = useState({});

  useEffect(() => {
    let live = true;
    (async () => {
      const entries = await Promise.all(
        groups.map(async (g) => [g.id, await groupTitle(tool, g.id, pins?.translationAcademy)]),
      );
      if (live) setTitles(Object.fromEntries(entries));
    })();
    return () => {
      live = false;
    };
  }, [groups, tool]);

  return (
    <>
      {groups.map((group, i) => {
        const done = group.checks.filter((c) => isDone(states[c.id])).length;
        const flagged = group.checks.some((c) => states[c.id]?.reminder);
        return (
          <div class="check-item" key={group.id} onClick={() => onOpen(i)}>
            <span class={`status-dot ${done === group.checks.length ? 'done' : ''} ${flagged ? 'flagged' : ''}`} />
            <div class="grow">
              <div class="item-title">{titles[group.id] || group.id}</div>
              <div class="item-sub">
                {done}/{group.checks.length} checked
                {group.category ? ` · ${group.category}` : ''}
              </div>
            </div>
            <span style="color:var(--muted)">›</span>
          </div>
        );
      })}
    </>
  );
}
