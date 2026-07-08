# Project state / working notes

Living scratchpad of design decisions and known gaps. Read alongside [CLAUDE.md](CLAUDE.md).

## tC4 / Scripture Burrito interop — `src/lib/tc4.js`, `src/lib/journal.js`

**Status: working and round-trip tested (41 checks, `npm run test:tc4`, in CI). Implements
BURRITO-SPEC 1.1-draft from the tC4-pankosmia package; the reference sample project is vendored
at `test/fixtures/sample-burrito/` with Pankosmia's SB schema bundle beside it.**

Design decisions (the load-bearing ones):

- **Decisions merge by the spec's §5.2 identity key** — `(checkId, bookId, chapter, verse,
  occurrence)`, chapter/verse compared as **strings** so span verses (`"9-10"`) never collapse
  under `Number()`. `quoteString` is a verification field, not part of the key.
- **quoteString drift on a touched record re-anchors it** to the current resource (fresh
  contextId from the current check + the user's decision fields). The spec's "treat as
  unmatched" wording is a writer's trap: appending duplicates the identity key, skipping loses
  the user's work. Flagged as spec feedback; untouched records always round-trip verbatim.
- **Everything the PWA doesn't model round-trips byte-identical** (alignments sidecars, sibling
  books' files, journals from other actors). `metadata.json` is regenerated with fresh
  md5/size/scope and **role carry-forward** — the same semantics as tC4's upstream Change 1.
- **Imported `invalidated`/`status: invalid` records seed as needs-re-review**, are excluded
  from done counts (`isDone` in CheckList/report), and a fresh save clears the flag.
- **Resource pins (§5.3) are honored** for tN TSVs and tW/tA articles *and titles*
  (`vN…` version ⇒ `raw/tag/`, else `raw/branch/`).
- **Journal is the §8 DESIGN DRAFT, best-effort** — `check.decision.set` events with HLC
  timestamps (`ISO|hex4|actorId`), per-install actor id, content-hash `id`, `base` chaining;
  exported as `checking/journal/<actorId>/<BOOK>.<seq>.jsonl`. The format is not finalized
  upstream; expect churn.

Known gaps:

- **Multi-book exports update only the current book** — sibling books' decision files round-trip
  verbatim from import; states checked in a sibling PWA project are not merged in.
- **tN quote arrays use within-quote occurrence counting**, exact only when the quote occurs
  once in the verse — this tc4 path does not resolve quotes against the OL Bible. The English-gloss
  path had the same root gap but was since fixed by adopting `uw-quote-helpers` (see below); this
  path could adopt the same for exact per-word occurrences.
- **The en_ULT and UHB/UGNT used for English glosses are unpinned** (master) — §5.3 has no
  gateway-bible / original-language slot yet (`extraScripture` is not normative until tC4's first
  J2 increment).

Spec feedback owed to the tC4 team:

1. The sample-burrito's decision checkIds (`swi9`, `t1g7`, …) are fabricated — they don't exist
   in the real pinned en_tn v86 / en_twl TSVs (real TIT 1:1 tN ids: `rtc9`, `xrtm`, `tn97`,
   `fyf8`). Supports their ledger #15 (derive proof not yet run on real resources).
2. §5.3 pins have no slot for the TWL *list* repo (`en_twl`), only en_tw articles — tW check
   lists can't be pinned, undercutting "same pins ⇒ same check lists" for tW.
3. §5.2's quoteString-mismatch guidance doesn't say what a writer does with its own new
   decision (see re-anchor decision above).

## Door43 (DCS) sync — `src/lib/dcs.js`, `src/lib/sync.js`

**Status: implemented and tested against a fake DCS (4-scenario integration test in
`sync.integration.test.js`); the unauthenticated network path verified live in-browser against
real DCS. Authenticated write (createRepo/commitFiles) and OAuth are NOT yet verified against
live DCS — no credentials/client-id were available; the request shapes are verified against
DCS's own swagger (`ChangeFilesOptions`/`ChangeFileOperation`).**

The tC3 "Upload to Door43" story rebuilt for the browser: check offline on one device, sync when
online, pick up on another. Design decisions:

- **REST, not git.** tC3 shells out to system git (`simple-git`) — impossible in a browser.
  DCS (Gitea 1.26.4+dcs) sends `Access-Control-Allow-Origin: *` on `/api/v1`, archive downloads,
  and the OAuth token endpoint (verified by curl 2026-07-08), so the PWA uses pure REST like
  gateway-edit/tc-create-app: archive-zip download for reads (feeds the existing `importBurrito`,
  which already tolerates the archive's wrapper dir), batch `POST /repos/{o}/{r}/contents` for
  writes (one commit, many files; Gitea ≥1.18).
- **One sync = pull + merge + push.** Download remote archive → merge remote decisions into local
  states (LWW per §5.2 identity key by `modifiedAt`; `mergeStates`) → remote files become the new
  round-trip base → `buildBurritoFiles` (extracted from `exportBurrito`) re-merges local states on
  top → diff by locally-computed **git blob sha** (`crypto.subtle` SHA-1) → commit only changed
  files. Unlike tC3 (errors on non-fast-forward), concurrent edits on two devices converge.
  Remote-only files are never deleted.
- **Auth is optional and dual-path.** The app works fully signed-out (all resource reads stay
  unauthenticated). Sign-in: (a) OAuth PKCE public client — bible-editor's DCS OAuth design minus
  the backend; the token endpoint's CORS preflight only allows GET, so the code exchange is a
  form-encoded *simple request* (no preflight). Needs a one-time OAuth app registration on DCS
  (public client, redirect = app URL) exposed as `VITE_DCS_CLIENT_ID`; access tokens auto-refresh
  (`ensureFreshAuth`). (b) Zero-setup fallback: username+password → per-app access token
  (`tcore-checks-pwa`, delete-and-recreate since Gitea only reveals the secret at creation), or an
  existing PAT pasted as the password (works with 2FA). Auth lives in IndexedDB (`dcs:auth`).
- **Repo naming**: first sync prompts, default `{book}_checks`, created under the signed-in user.
  Link stored on the project (`project.dcs = {owner, repo, branch, lastSha, lastSyncAt}`);
  online imports (`fetchProjectFromDcs`) stamp the link on every book project so they sync back
  to their source repo. Multiple single-book projects pointed at one repo accumulate books.
- **The SW must not cache DCS API state** — `vite.config.js` runtimeCaching now excludes
  `/api/` and `/login/` (a stale branch head would make sync diff against an outdated tree).

Known gaps: no delete propagation (removing a project locally never touches DCS); race between
archive download and commit is unguarded (a concurrent push mid-sync could be overwritten for
the current book's files — acceptable while one translator owns a book, flagged for later);
`listMyRepos` shows all repos, not just burritos.

## English gloss of quotes — `src/lib/alignment.js`

**Status: RESOLVED. `src/lib/alignment.js` now delegates to the maintained
[`uw-quote-helpers`](https://www.npmjs.com/package/uw-quote-helpers) package
(`getTargetQuoteFromSourceQuote`). The hand-rolled matcher is gone from the code; the analysis
below is kept as the rationale for the switch.**

The feature shows the English (ULT) gloss of a check's original-language quote. `uw-quote-helpers`
matches the quote against the original-language book (UHB/UGNT = `sourceBook`) and pulls the aligned
words from the ULT (`targetBook`) — the same source→target model tC uses, handling word order,
per-word occurrence, verse spans and discontiguous (`&`) quotes. So `App.jsx` now fetches the OL
book alongside the ULT (`fetchOlUsfm`), and `glossQuote` is a thin wrapper.

Verified: the Obadiah 1:10 case that motivated the rework (`תְּכַסְּךָ בוּשָׁה`, where quote order ≠
verse order) now returns **"shame will cover you"** instead of nothing; OT (Ruth/UHB) and NT
(Titus/UGNT) both glossed correctly in-app. Full sweep over all 490 Ruth+Titus tN quotes:
coverage went from **350/490 (71%) → 490/490 (100%)** — every one of the 140 quotes the old matcher
returned nothing for now resolves, and sampled recoveries (discontiguous, long, word-order-flipped)
are correct.

### Why we replaced the hand-rolled version (measured evidence)

The original `glossQuote` was written from scratch (not ported). I transcribed tC's `getAlignedText`
(from `tc-ui-toolkit`) and ran it head-to-head with that version over **every tN quote
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

### How it was resolved

Rather than porting `getAlignedText` by hand (and re-implementing the OL quote-resolution step it
depends on), we pulled in **`uw-quote-helpers`** — unfoldingWord's maintained, non-React library that
does exactly this (source→target quote glossing with OL matching + verse-span support). Notes on the
pull-in:
- **Not `tc-ui-toolkit`.** That package carries `getAlignedText`, but it drags in React / Material-UI /
  react-bootstrap and pins `usfm-js@^2` (we're on 3.x → peer conflict). Wrong dependency for a Preact PWA.
- `uw-quote-helpers` peer-deps `usfm-js@^3.4.2` (matches ours), adds ~13 small packages, no React,
  and bundles cleanly in Vite.
- This also let us delete the fuzzy accent-normalization + contiguity code entirely — the library
  matches against the real OL text, so no bridging hack is needed.
