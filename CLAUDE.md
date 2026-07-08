# tcorePSA

A mobile-first, offline-capable **PWA reimplementation of translationCore (tC)**. It runs tC's
translationNotes (tN) and translationWords (tW) checks on a phone, fetching resources live from
Door43 (`git.door43.org/unfoldingWord`).

## Lean on the translationCore source

A full tC checkout lives at **`../translationCore`** (`C:/Users/benja/Documents/GitHub/tcc-ge-dcs/translationCore`).
It is the source of truth for check behavior, resource formats, and alignment logic.

**Before implementing or changing any checking behavior, look at how tC already does it and mirror
its logic** — don't reinvent it. The goal is that this app produces the same results a translator
would get in the desktop app.

Key references in tC:
- **Aligned gateway-language (English) gloss of an original-language quote** —
  `getAlignedText(verseObjects, quote, occurrence)` from the `tc-ui-toolkit` package, wrapped by
  `getAlignedGLText` / `getAlignedTextFromBible` in
  `../translationCore/src/js/helpers/gatewayLanguageHelpers.js`.
  Our [`src/lib/alignment.js`](src/lib/alignment.js) is a standalone reimplementation of this. When
  extending it, reconcile with tC — in particular verse-span quotes (`isVerseSpan` /
  `getVerseSpanRange`) and array-form quotes (`getQuoteAsArray`), which our version does not yet handle.
- **TSV group data** — tC uses `tsv-groupdata-parser`; alignment traversal uses `word-aligner` + `usfm-js`.

Other sibling repos under `../` that may be worth consulting: `gateway-edit`, `tc-create-app`.
