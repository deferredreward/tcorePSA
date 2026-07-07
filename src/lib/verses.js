// Look up verse text, tolerating bridged verse keys like "4-5"
export function getVerseText(project, chapter, verse) {
  const ch = project.chapters?.[chapter];
  if (!ch) return null;
  if (ch[verse]) return ch[verse];
  for (const key of Object.keys(ch)) {
    const m = /^(\d+)-(\d+)$/.exec(key);
    if (m && verse >= Number(m[1]) && verse <= Number(m[2])) return ch[key];
  }
  return null;
}
