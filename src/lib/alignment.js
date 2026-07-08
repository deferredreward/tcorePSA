import { getParsedUSFM, getTargetQuoteFromSourceQuote } from 'uw-quote-helpers';

// Parse a USFM string into the chapters object uw-quote-helpers expects.
export function parseBook(usfmText) {
  return getParsedUSFM(usfmText).chapters;
}

// Gloss an original-language quote into the gateway-language (English) text,
// using unfoldingWord's uw-quote-helpers: it matches the quote against the
// original-language book (UHB/UGNT) and pulls the aligned words from the ULT.
// This is the maintained, canonical routine — handles word order, per-word
// occurrence, verse spans and discontiguous ("&") quotes. Returns null on no match.
export function glossQuote({ sourceBook, targetBook, chapter, verse, quote, occurrence }) {
  if (!sourceBook || !targetBook || !quote) return null;
  try {
    const text = getTargetQuoteFromSourceQuote({
      quote,
      ref: `${chapter}:${verse}`,
      sourceBook,
      targetBook,
      options: { occurrence: occurrence || 1, fromOrigLang: true },
    });
    return text ? text.trim() : null;
  } catch {
    return null;
  }
}
