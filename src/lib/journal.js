// Phase-2 event journal, per BURRITO-SPEC §8 (DESIGN DRAFT — the format is
// not finalized upstream; this is a best-effort forward-compatible
// implementation of the §8.2 envelope and the check.decision.set op).
// Pure event/HLC builders live here so node tests can use them; IndexedDB
// persistence is at the bottom.

import { get, set, del } from 'idb-keyval';
import { md5 } from './md5.js';
import { TOOL_IDS, normalizeQuote, isDoneState } from './tc4.js';

// HLC string: "<ISO-8601 UTC ms>|<4-hex logical counter>|<actorId>" (§8.2),
// lexicographically ordered
export function hlcString(ms, counter, actorId) {
  return `${new Date(ms).toISOString()}|${counter.toString(16).padStart(4, '0')}|${actorId}`;
}

export function nextHlcState(last, nowMs) {
  return nowMs > (last?.ms || 0) ? { ms: nowMs, n: 0 } : { ms: last.ms, n: last.n + 1 };
}

// One check.decision.set event (§8.3): envelope + contextId key fields +
// decision fields. `base` = id of the previous event for the same check
// (null for the first), so forks are detectable by construction.
export function buildDecisionEvent({ actor, ts, base, book, tool, check, state }) {
  const colon = check.reference.indexOf(':');
  const chapterStr = check.reference.slice(0, colon);
  const verseStr = check.reference.slice(colon + 1);
  const payload = {
    contextId: {
      checkId: check.checkId,
      tool: TOOL_IDS[tool],
      groupId: check.groupId,
      reference: {
        bookId: book.toLowerCase(),
        chapter: Number(chapterStr),
        verse: /^\d+$/.test(verseStr) ? Number(verseStr) : verseStr,
      },
      quoteString: normalizeQuote(check.quote),
      occurrence: Number(check.occurrence),
    },
    selections: state.selections?.length ? state.selections : false,
    comments: state.comment ? state.comment : false,
    reminders: !!state.reminder,
    nothingToSelect: !!state.nothingToSelect,
    status: isDoneState(state) ? 'valid' : 'todo',
  };
  return {
    v: 1,
    op: 'check.decision.set',
    actor,
    ts,
    id: md5(JSON.stringify(payload)),
    ref: `${book.toUpperCase()} ${check.reference}`,
    base: base || null,
    ...payload,
  };
}

// ---------- persistence (per-install actor, monotonic HLC, per-project log) ----------

export async function getActorId() {
  let actor = await get('tc4:actor');
  if (!actor) {
    actor = `pwa-${crypto.randomUUID().slice(0, 8)}`;
    await set('tc4:actor', actor);
  }
  return actor;
}

export async function nextHlc(actorId) {
  const state = nextHlcState((await get('tc4:hlc')) || { ms: 0, n: 0 }, Date.now());
  await set('tc4:hlc', state);
  return hlcString(state.ms, state.n, actorId);
}

export async function appendDecisionEvent(projectId, { book, tool, check, state }) {
  const actor = await getActorId();
  const events = (await get(`journal:${projectId}`)) || [];
  const previous = [...events]
    .reverse()
    .find((e) => e.contextId?.checkId === check.checkId && e.ref === `${book.toUpperCase()} ${check.reference}`);
  const event = buildDecisionEvent({
    actor,
    ts: await nextHlc(actor),
    base: previous?.id,
    book,
    tool,
    check,
    state,
  });
  events.push(event);
  await set(`journal:${projectId}`, events);
  return event;
}

export async function getJournal(projectId) {
  return (await get(`journal:${projectId}`)) || [];
}

export function deleteJournal(projectId) {
  return del(`journal:${projectId}`);
}
