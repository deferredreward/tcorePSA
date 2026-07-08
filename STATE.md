# Project state / working notes

Living scratchpad of design decisions and known gaps. Read alongside [CLAUDE.md](CLAUDE.md).

## English gloss of quotes — `src/lib/alignment.js`

**Status: works for simple quotes, materially degraded on ~40% of real quotes. NOT a faithful
port of translationCore. Needs rework — see fix path below.**

The feature shows the English (ULT) gloss of a check's original-language quote. tC's canonical
routine is `getAlignedText(verseObjects, quote, occurrence)` in
`tc-ui-toolkit` (`src/VerseCheck/helpers/checkAreaHelpers.js`), wrapped by `getAlignedGLText` /
`getAlignedTextFromBible` in `../translationCore/src/js/helpers/gatewayLanguageHelpers.js`.
Our `glossQuote` was written from scratch, not ported.

### Measured divergence (evidence, not assumption)

I transcribed tC's `getAlignedText` and ran it head-to-head with `glossQuote` over **every tN quote
in Ruth (288) and Titus (202) = 490 quotes**, against the real ULT alignment. To compare algorithms
(not the normalization gap — see below), tC's inputs were normalized the same way `glossQuote`
normalizes, and occurrence coerced to numeric.

| | Ruth | Titus | Combined |
|---|---|---|---|
| Exact match | 148 | 103 | **251 (51%)** |
| Differ, punctuation/gap only (semantically fine) | 26 | 14 | 40 (8%) |
| Differ, **wrong/truncated words** | 43 | 16 | **59 (12%)** |
| **`glossQuote` returns nothing, tC finds text** | 71 | 69 | **140 (29%)** |

So ~59% acceptable, **~41% wrong or missing**. Examples of real failures:
- `לִשְׁתֵּי כַלֹּתֶיהָ` → tC `"to her two daughters-in-law"`, ours `"to her"` (truncated)
- `הֻגֵּד הֻגַּד` → tC `"It has been fully reported"`, ours `"fully reported"` (dropped first word)
- `כָּל־הָעִיר` → tC `"the entire town"`, ours `"entire town"` (dropped the article prefix)

### Why they diverge (from reading both line by line)

1. **Contiguity assumption (biggest cause).** `glossQuote` requires the quoted original words to be a
   *contiguous run* in alignment order, then takes that slice's English. tC instead matches **each
   word independently by content + occurrence** and assembles the English in verse order, inserting
   gap markers. Original word order ≠ English word order constantly, so our contiguous run finds only
   a fragment (truncation) or nothing (the 140 empties).
2. **Occurrence semantics.** tC matches per-word occurrence-in-verse; we ignore per-word occurrence and
   use the quote's single occurrence to pick the Nth contiguous phrase. Diverges on repeated words.
3. **Dropped punctuation.** We collect only `\w` word text and join with spaces; tC preserves the
   `type:'text'` nodes between matched words (`daughters-in-law`, `{are}`). Cosmetic but visible.
4. **Gap marker.** We emit `…` only where the quote literally contains `&`; tC emits `&` computed from
   actual verse gaps. Our gap placement is sometimes wrong.
5. **Normalization vs. quote resolution — the architectural root.** tC compares `content === word`
   with **no normalization**; on raw TSV quotes it matched **0 / 490** (the ULT `\zaln` content differs
   from the tN quote in accent order/presence). tC gets away with exact match because upstream
   `tsv-groupdata-parser` first resolves each quote against the **original-language** Bible (UHB/UGNT),
   producing exact content strings + per-word occurrences. We skipped that step and bridged it with
   fuzzy accent-stripping normalization + contiguity — which is precisely why it degrades.

Caveat on the numbers: to test, tC was fed the raw quote *string* (occurrence applied to all words),
which is not how real tC runs multi-word quotes (it uses the resolved per-word array). So true tC would
be *even better* than the "tC" column here — these numbers understate the gap.

### Fix path

Adopt tC's architecture rather than the shortcut:
1. Resolve each tN/tW quote against the OL Bible to get exact content + per-word occurrences —
   ideally by pulling in `tsv-groupdata-parser` (what tC uses), which also builds the group data.
2. Replace `glossQuote` with a port of `getAlignedText` operating on raw ULT `verseObjects`
   (keep the tree; don't pre-flatten), so nesting, per-word occurrence, gaps, and punctuation are
   handled as tC does.
3. Keep normalization only as the bridge in the content-matching step if quote resolution still needs it.
