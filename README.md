# tCore Checks (PWA proof of concept)

A mobile-first, offline-capable progressive web app that reimplements the
**translationNotes** and **translationWords** checking tools from
[translationCore](https://github.com/unfoldingWord/translation-core) —
so checkers can work from a phone.

## What works (PoC)

- **Upload a USFM translation** — a whole book *or just the portion you've
  translated* (partial books are supported: checks outside your uploaded verses
  are hidden and not counted). Or load a one-tap sample (Titus, en_ULT).
- **translationNotes checks**, pivoted by check type (all Metaphor checks
  together, all Abstract Nouns together, …) with the matching
  translationAcademy article explaining what you're checking for. A by-verse
  view is also available.
- **translationWords checks**, pivoted by term, with the tW article.
- **Word selections** — tap the words in your translation that express the
  original quote. Uses translationCore's own `selections` package, so the
  stored data (`{text, occurrence, occurrences}`) matches tC's format.
- **Comments, flags, "no selection needed"** per check, auto-saved locally
  (IndexedDB).
- **Report** — per-check-type progress plus everything flagged or commented.
- **Offline** — app shell precached by a service worker; Door43 resources
  (tN/TWL TSVs, tW/tA articles) are cached after first use, both by the
  service worker and in IndexedDB.
- **translationCore 4 interoperability (Scripture Burrito)** — see below.

## tC4 / Scripture Burrito interoperability

Implements the tC4 project format (BURRITO-SPEC 1.1-draft, tC4-pankosmia
package) so checking work round-trips with translationCore 4 projects:

- **Import a tC4 project zip** — a Scripture Burrito holding `metadata.json`,
  `ingredients/<BOOK>.usfm`, and `checking/` sidecars. Multi-book burritos
  become one PWA project per book; existing check decisions seed local check
  states; the project's resource pins (`checking/resources.json`, §5.3) are
  honored when fetching tN TSVs and tW/tA articles (e.g. `en_tn` @ `v86`).
- **Export a tC4 project zip** (Report screen) — a conforming burrito:
  decisions in the **full tC3 record shape** (§5.2) merged by the spec's
  identity key (string chapter/verse comparison, span-safe, quoteString
  verification, integer occurrences per I-2, additive `status` field),
  regenerated `metadata.json` (md5/size/scope, role carry-forward — the
  upstream Change-1 semantics), no alignment markup at rest (I-1), and every
  file the PWA doesn't model (alignments, sibling books' sidecars) preserved
  byte-for-byte.
- **Event journal (§8 design draft)** — every decision save appends a
  `check.decision.set` event (HLC timestamp, per-install actor id,
  content-hash id, `base` chaining) exported as
  `checking/journal/<actorId>/<BOOK>.<seq>.jsonl`. The journal format is not
  finalized upstream; this is a best-effort implementation of the draft.

Known limits: exporting from one book of a multi-book import updates only
that book's decisions (siblings round-trip verbatim); the TWL list repo
(`en_twl`) has no pin slot in §5.3 and stays on `master`; tN quote-array
word occurrences are counted within the quote (exact only when the quote is
unique in the verse).

Test: `npm run test:tc4` — 39 checks against the vendored tC4 reference
sample project (`test/fixtures/sample-burrito/`, from the tC4-pankosmia
package), validating exported metadata against Pankosmia's bundled SB schema.

## Reused from the translationCore ecosystem

| Package | Used for |
|---|---|
| `usfm-js` | Parsing uploaded USFM (incl. alignment milestones) |
| `selections` | Selection objects, merge/optimize, occurrence validation |
| `string-punctuation-tokenizer` | Tokenizing verses into tappable words |
| Door43 content (`en_tn`, `en_twl`, `en_tw`, `en_ta`, `en_ult`) | Check data & helps, fetched live and cached |

## Develop

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # production build with service worker in dist/
npm run preview
```

Built with [Preact](https://preactjs.com/) (React-compatible, ~4 KB) + Vite +
`vite-plugin-pwa` for snappy startup on older Android phones.

## Not yet done

- Original-language quote highlighting against aligned text (quotes are shown
  in Greek/Hebrew; selections are made in the target text, as in tC)
- Verse editing, invalidation of selections after edits (the `selections`
  validation function is already wired in `src/lib/selectionEngine.js`)
- Front-matter / intro notes (`front:intro`, `x:intro` rows are skipped)
- Gateway-language resource selection (hard-coded to unfoldingWord English)
