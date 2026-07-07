// Parse a TSV string into an array of row objects keyed by the header row
export function parseTsv(text) {
  const lines = text.split('\n').filter((l) => l.length);
  if (!lines.length) return [];
  const headers = lines[0].replace(/\r$/, '').split('\t');
  return lines.slice(1).map((line) => {
    const cells = line.replace(/\r$/, '').split('\t');
    const row = {};
    headers.forEach((h, i) => {
      row[h] = cells[i] || '';
    });
    return row;
  });
}
