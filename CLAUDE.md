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
`tsv-groupdata-parser`. For the English gloss of a quote we use unfoldingWord's maintained
`uw-quote-helpers` (`getTargetQuoteFromSourceQuote`) rather than tC's React-bound `tc-ui-toolkit`
— see [STATE.md](STATE.md) for why.

Other sibling repos under `../` worth consulting: `gateway-edit`, `tc-create-app`.

## tC4 / Scripture Burrito interop

This app imports and exports **translationCore 4** projects (one project = one Scripture Burrito
git repo). The project format we implement is [docs/BURRITO-SPEC.md](docs/BURRITO-SPEC.md)
(BURRITO-SPEC 1.1-draft) — the normative contract for `src/lib/tc4.js`; conformance is checked by
`npm run test:tc4` against `test/fixtures/sample-burrito/`.

The full tC4 reference package (the spec plus internal unfoldingWord/Pankosmia direction &
architecture docs, the original sample project, and its `boon`/harness validators) is kept
**outside this public repo** at `../tc4-pankosmia-package/`
(`C:/Users/benja/Documents/GitHub/tcc-ge-dcs/tc4-pankosmia-package/`) — those companion docs are
internal partnership material and are deliberately not committed here. Only the neutral, technical
BURRITO-SPEC lives in-tree.

## Working state

See [STATE.md](STATE.md) for design decisions and how each piece is implemented — including the
tC4 / Scripture Burrito interop notes and the quote-gloss story (`src/lib/alignment.js` →
`uw-quote-helpers`) and the evidence behind that choice.
