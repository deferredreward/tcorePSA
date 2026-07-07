import { useEffect, useMemo, useState } from 'preact/hooks';
import {
  verseSegments,
  segmentTokens,
  addWordSelection,
  removeSelection,
} from '../lib/selectionEngine';
import { getVerseText } from '../lib/verses';
import { fetchTwArticle, fetchTaArticle } from '../lib/door43';
import { groupTitle } from '../lib/titles';
import { Markdown } from './Markdown';

const EMPTY_STATE = { selections: [], comment: '', reminder: false, nothingToSelect: false };

function TappableVerse({ verseText, selections, disabled, onChange }) {
  const segments = useMemo(() => verseSegments(verseText, selections), [verseText, selections]);

  function tapWord(token, absOffset) {
    if (disabled) return;
    onChange(addWordSelection(verseText, selections, token, absOffset));
  }
  function tapSelection(segment) {
    onChange(removeSelection(verseText, selections, segment));
  }

  return (
    <div class="verse-area" dir="auto">
      {segments.map((seg) =>
        seg.selected ? (
          <span class="sel" onClick={() => tapSelection(seg)}>
            {seg.text}
          </span>
        ) : (
          segmentTokens(seg.text).map((tok) => {
            const abs = seg.start + tok.index;
            return tok.type === 'word' || tok.type === 'number' ? (
              <span class="word" onClick={() => tapWord(tok.token, abs)}>
                {tok.token}
              </span>
            ) : (
              <span>{tok.token}</span>
            );
          })
        ),
      )}
    </div>
  );
}

export function CheckRunner({ project, tool, checks, index, states, onSave, onNavigate }) {
  const check = checks[index];
  const state = states[check.id] || EMPTY_STATE;
  const verseText = getVerseText(project, check.chapter, check.verse);
  const [article, setArticle] = useState(null); // tW definition / tA explainer
  const [title, setTitle] = useState('');
  const [comment, setComment] = useState(state.comment);

  useEffect(() => {
    setComment(states[check.id]?.comment || '');
  }, [check.id]);

  useEffect(() => {
    let live = true;
    setArticle(null);
    groupTitle(tool, check.groupId).then((t) => live && setTitle(t));
    const load =
      tool === 'tw'
        ? fetchTwArticle(check.link)
        : check.groupId !== 'other'
          ? fetchTaArticle(check.groupId)
          : Promise.resolve(null);
    load.then((a) => live && setArticle(a)).catch((e) => live && setArticle(`_Could not load article: ${e.message}_`));
    return () => {
      live = false;
    };
  }, [check.id, tool]);

  function save(patch) {
    onSave(check.id, { ...state, comment, ...patch });
  }

  return (
    <div class="screen">
      <div class="card">
        <div class="row" style="justify-content:space-between">
          <span class="pill">{title || check.groupId}</span>
          <span class="muted">
            {check.reference} · {index + 1}/{checks.length}
          </span>
        </div>
        {tool === 'tw' ? (
          <div class="check-quote">
            <div class="tw-term">
              {(article && /^#+\s*(.+)$/m.exec(article)?.[1]) || title || check.term}
            </div>
            <div class="tw-orig">
              {check.quote}
              {check.occurrence > 1 ? ` (occurrence ${check.occurrence})` : ''}
            </div>
          </div>
        ) : (
          check.quote && (
            <div class="check-quote">
              {check.quote}
              {check.occurrence > 1 ? <span class="muted"> (occurrence {check.occurrence})</span> : ''}
            </div>
          )
        )}
        {tool === 'tn' && <Markdown text={check.note} />}
      </div>

      <div class="card">
        <h2>
          Your translation — {project.bookName} {check.chapter}:{check.verse}
        </h2>
        {verseText ? (
          <>
            <p class="muted" style="margin:0 0 4px">
              Tap the words that express this in your translation.
            </p>
            <TappableVerse
              verseText={verseText}
              selections={state.selections}
              disabled={state.nothingToSelect}
              onChange={(selections) => save({ selections, nothingToSelect: false })}
            />
          </>
        ) : (
          <p class="error">Verse {check.chapter}:{check.verse} not found in this translation.</p>
        )}
        <label class="toggle">
          <input
            type="checkbox"
            checked={state.nothingToSelect}
            onChange={(e) => save({ nothingToSelect: e.target.checked, selections: [] })}
          />
          No selection needed for this check
        </label>
        <label class="toggle">
          <input
            type="checkbox"
            checked={state.reminder}
            onChange={(e) => save({ reminder: e.target.checked })}
          />
          🚩 Flag for review
        </label>
        <textarea
          class="comment"
          placeholder="Comment…"
          value={comment}
          onInput={(e) => setComment(e.target.value)}
          onBlur={() => save({})}
        />
      </div>

      {tool === 'tw' && (
        <div class="card">
          <details class="about">
            <summary>
              📖 Word article{article ? `: ${/^#+\s*(.+)$/m.exec(article)?.[1] || ''}` : ''}
            </summary>
            {article == null ? <p class="muted">Loading article…</p> : <Markdown text={article} />}
          </details>
        </div>
      )}
      {tool === 'tn' && check.groupId !== 'other' && (
        <div class="card">
          <details class="about">
            <summary>About “{title || check.groupId}” checks</summary>
            {article == null ? <p class="muted">Loading…</p> : <Markdown text={article} />}
          </details>
        </div>
      )}

      <div class="checkbar">
        <button class="secondary" disabled={index === 0} onClick={() => { save({}); onNavigate(index - 1); }}>
          ◀ Previous
        </button>
        <button
          class="primary"
          disabled={index === checks.length - 1}
          onClick={() => { save({}); onNavigate(index + 1); }}
        >
          Next ▶
        </button>
      </div>
    </div>
  );
}
