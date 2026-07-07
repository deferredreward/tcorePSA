// Thin wrapper around translationCore's `selections` + tokenizer packages
import {
  addSelectionToSelections,
  removeSelectionFromSelections,
  selectionArray,
  generateSelection,
  checkSelectionOccurrences,
} from 'selections';
import { tokenize } from 'string-punctuation-tokenizer';

// Splice verse text into ordered segments {text, selected, occurrence?, start}
export function verseSegments(verseText, selections) {
  const segs = selectionArray(verseText, selections || []);
  let offset = 0;
  return segs.map((s) => {
    const seg = { ...s, start: offset };
    offset += s.text.length;
    return seg;
  });
}

// Tokenize a segment into renderable tokens {token, type, index} preserving all text
export function segmentTokens(text) {
  const tokens = tokenize({
    text,
    includeWords: true,
    includeNumbers: true,
    includePunctuation: true,
    includeWhitespace: true,
    includeUnknown: true,
    verbose: true,
  });
  let index = 0;
  for (const tok of tokens) {
    // tokens can be normalized/trimmed vs the source, so locate each one explicitly
    const found = text.indexOf(tok.token, index);
    tok.index = found >= 0 ? found : index;
    index = tok.index + tok.token.length;
  }
  return tokens;
}

export function addWordSelection(verseText, selections, tokenText, absOffset) {
  const sel = generateSelection(tokenText, verseText.slice(0, absOffset), verseText);
  return addSelectionToSelections(sel, selections || [], verseText);
}

export function removeSelection(verseText, selections, segment) {
  return removeSelectionFromSelections(
    { text: segment.text, occurrence: segment.occurrence, occurrences: segment.occurrences },
    selections || [],
    verseText,
  );
}

// Drop selections no longer valid for (possibly edited) verse text
export function validateSelections(verseText, selections) {
  return checkSelectionOccurrences(verseText, selections || []);
}
