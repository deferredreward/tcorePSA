import { fetchTaTitle } from './door43';

const cache = new Map();

// Human title for a check-type group. tN slugs resolve via tA title.md;
// tW terms just get capitalized.
export async function groupTitle(tool, groupId) {
  if (tool === 'tw') return groupId.charAt(0).toUpperCase() + groupId.slice(1);
  if (cache.has(groupId)) return cache.get(groupId);
  try {
    const title = (await fetchTaTitle(groupId)).trim();
    cache.set(groupId, title);
    return title;
  } catch {
    cache.set(groupId, groupId);
    return groupId;
  }
}
