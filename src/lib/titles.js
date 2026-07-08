import { fetchTaTitle } from './door43';

const cache = new Map();

// Human title for a check-type group. tN slugs resolve via tA title.md;
// tW terms just get capitalized. `pin` is the project's translationAcademy
// resource pin (tC4 imports), so titles come from the pinned version.
export async function groupTitle(tool, groupId, pin) {
  if (tool === 'tw') return groupId.charAt(0).toUpperCase() + groupId.slice(1);
  const key = `${pin?.repoPath || 'en_ta'}@${pin?.version || 'master'}|${groupId}`;
  if (cache.has(key)) return cache.get(key);
  try {
    const title = (await fetchTaTitle(groupId, pin)).trim();
    cache.set(key, title);
    return title;
  } catch {
    cache.set(key, groupId);
    return groupId;
  }
}
