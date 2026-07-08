# tcorePSA

A mobile-first, offline-capable **PWA reimplementation of translationCore (tC)**. It runs tC's
translationNotes (tN) and translationWords (tW) checks on a phone, fetching resources live from
Door43 (`git.door43.org/unfoldingWord`).

## Lean on the translationCore source

A full tC checkout lives at **`../translationCore`** (`C:/Users/benja/Documents/GitHub/tcc-ge-dcs/translationCore`).
**It is the source of truth for this app.** tC is the mature desktop implementation of the same
checking workflow we're rebuilding for mobile — before implementing or changing any behavior here,
look at how tC does it and mirror its logic rather than reinventing it. The goal is that this app
produces the same results a translator would get in the desktop app.

Useful entry points in `../translationCore/src/js`:
- `helpers/` (~60 files) — the checking logic. e.g. `gatewayLanguageHelpers.js` (aligned GL text /
  quote glosses), `WordAlignmentHelpers.js`, `groupDataHelpers.js` / `getToggledGroupData.js`
  (tN/tW group data), `ResourcesHelpers.js` / `ResourceAPI.js` / `originalLanguageResourcesHelpers.js`
  (Door43 resources), `usfmHelpers.js`, `bibleHelpers.js`, `checkDataHelpers.js`.
- `actions/`, `reducers/`, `selectors/`, `redux/` — app state and flow.
- `components/`, `containers/`, `pages/` — desktop UI (reference for what data each check screen shows).

Relevant packages tC depends on (same ones we use / could use): `usfm-js`, `word-aligner`,
`tsv-groupdata-parser`, `tc-ui-toolkit` (the latter's `getAlignedText` is the canonical
alignment-gloss routine).

Other sibling repos under `../` worth consulting: `gateway-edit`, `tc-create-app`.

## Working state

See [STATE.md](STATE.md) for design decisions and known gaps — including the measured divergence
between our `src/lib/alignment.js` and tC's `getAlignedText` (it is **not** a faithful port and
needs rework).
