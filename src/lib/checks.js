import { parseTsv } from './tsv';

// "1:3" | "1:3-4" | "front:intro" -> {chapter, verse} (numeric first verse) or null
function parseReference(ref) {
  const m = /^(\d+):(\d+)/.exec(ref);
  if (!m) return null;
  return { chapter: Number(m[1]), verse: Number(m[2]) };
}

// tN 7-column TSV (Reference, ID, Tags, SupportReference, Quote, Occurrence, Note)
// -> ordered check list
export function parseTnChecks(tsvText) {
  const rows = parseTsv(tsvText);
  const checks = [];
  for (const row of rows) {
    const ref = parseReference(row.Reference || '');
    if (!ref) continue; // skip front/intro rows in this PoC
    const support = row.SupportReference || '';
    checks.push({
      id: `tn-${row.Reference}-${row.ID}`,
      tool: 'tn',
      chapter: ref.chapter,
      verse: ref.verse,
      reference: row.Reference,
      quote: (row.Quote || '').replace(/​/g, '').trim(),
      occurrence: Number(row.Occurrence) || 1,
      support,
      groupId: support ? support.split('/').pop() : 'other',
      note: (row.Note || '').replace(/\\n/g, '\n').replace(/<br>/g, '\n'),
    });
  }
  return checks.sort((a, b) => a.chapter - b.chapter || a.verse - b.verse);
}

// TWL TSV (Reference, ID, Tags, OrigWords, Occurrence, TWLink) -> ordered check list
export function parseTwChecks(twlText) {
  const rows = parseTsv(twlText);
  const checks = [];
  for (const row of rows) {
    const ref = parseReference(row.Reference || '');
    if (!ref || !row.TWLink) continue;
    const term = row.TWLink.split('/').pop();
    const category = row.TWLink.split('/').slice(-2, -1)[0]; // kt | names | other
    checks.push({
      id: `tw-${row.Reference}-${row.ID}`,
      tool: 'tw',
      chapter: ref.chapter,
      verse: ref.verse,
      reference: row.Reference,
      quote: (row.OrigWords || '').replace(/​/g, '').trim(),
      occurrence: Number(row.Occurrence) || 1,
      term,
      category,
      groupId: term,
      link: row.TWLink,
    });
  }
  return checks.sort((a, b) => a.chapter - b.chapter || a.verse - b.verse);
}

// Pivot an ordered check list into groups (all metaphors together, all
// occurrences of one term together) — mirrors tC's groupsData organization
export function groupChecks(checks) {
  const map = new Map();
  for (const check of checks) {
    if (!map.has(check.groupId)) map.set(check.groupId, []);
    map.get(check.groupId).push(check);
  }
  return [...map.entries()]
    .map(([id, groupChecks]) => ({ id, checks: groupChecks, category: groupChecks[0].category }))
    .sort((a, b) => a.id.localeCompare(b.id));
}
