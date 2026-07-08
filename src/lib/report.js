import { groupChecks } from './checks';
import { groupTitle } from './titles';

const TOOL_NAMES = { tn: 'translationNotes', tw: 'translationWords' };

function isDone(state) {
  return !!state && !state.invalidated && (state.nothingToSelect || (state.selections || []).length > 0);
}

// Markdown report covering only checks that are done, flagged, or commented
export async function buildReportMarkdown(project, checks, states, skipped, pins) {
  const lines = [
    `# Check report — ${project.bookName}`,
    '',
    `- Project: ${project.name}`,
    `- Generated: ${new Date().toLocaleString()}`,
  ];
  if (skipped && skipped.tn + skipped.tw > 0) {
    lines.push(
      `- Partial upload: ${skipped.tn + skipped.tw} checks outside the uploaded verses are excluded`,
    );
  }
  lines.push('');

  for (const tool of ['tn', 'tw']) {
    const list = checks[tool];
    const done = list.filter((c) => isDone(states[c.id])).length;
    lines.push(`## ${TOOL_NAMES[tool]} — ${done}/${list.length} checks completed`, '');
    for (const group of groupChecks(list)) {
      const included = group.checks.filter((c) => {
        const s = states[c.id];
        return s && (isDone(s) || s.reminder || s.comment);
      });
      if (!included.length) continue;
      const title = await groupTitle(tool, group.id, pins?.translationAcademy);
      const gDone = group.checks.filter((c) => isDone(states[c.id])).length;
      lines.push(`### ${title} (${gDone}/${group.checks.length} checked)`, '');
      for (const c of included) {
        const s = states[c.id];
        let line = `- **${c.reference}**`;
        if (c.quote) line += ` \`${c.quote}\``;
        if (s.selections?.length) {
          line += ` — selected: “${s.selections.map((x) => x.text).join(' … ')}”`;
        } else if (s.nothingToSelect) {
          line += ' — no selection needed';
        }
        if (s.reminder) line += ' 🚩';
        lines.push(line);
        if (s.comment) lines.push(`  - 💬 ${s.comment}`);
      }
      lines.push('');
    }
  }
  return lines.join('\n');
}

export function downloadText(filename, text, type = 'text/markdown') {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
