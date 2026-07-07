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
- Export of check data back to tC project format
- Gateway-language resource selection (hard-coded to unfoldingWord English)
