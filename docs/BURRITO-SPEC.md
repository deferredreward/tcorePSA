# tC4 Project Format Specification (BURRITO-SPEC)

**Version:** 1.1-draft · 2026-07-07 (1.0-draft was 2026-07-05; this revision incorporates the accepted findings of the 2026-07-06 independent adversarial review: §8.4 derived-file merge rule, §4.1/§5.2 verse-span semantics, §5.2 triage `status`, §7 Stage-1/Stage-2 conformance split — harness extended to 27 checks in the same change, per §9)
**Status:** Normative for Phase 1; §8 (journal) is a Phase 2 design draft.
**Audience:** implementers (human or AI). Read `HANDOFF.md` first if you are new.
**Conformance language:** MUST / MUST NOT / SHOULD / MAY per RFC 2119.
**Reference implementation:** `../sample-burrito/` (a conforming project) and `../sample-burrito-validation/` (27 executable conformance checks). When this document and the harness disagree, the harness is wrong and MUST be fixed to match this document — then this document's version bumps.

---

## 1. Overview

A **tC4 project** is one git repository that is a valid Scripture Burrito (SB) at every commit, flavor `scripture/textTranslation`. It contains:

- the translation text: one plain-USFM file per book (**canonical in Phase 1**);
- checking sidecars under `ingredients/checking/`: word alignments, check decisions, resource pins, settings;
- (Phase 2, reserved) per-actor event journals, after which the journals become canonical and the USFM becomes a derived, committed artifact.

The same repository is what syncs to DCS (Door43), what other SB tools read, and what the tC4 app opens. There are no companion repos, no copies, no export/import loop.

## 2. Repository layout

```
<project>/                              git repository
  metadata.json                         SB metadata (§3)
  .gitignore                            MUST contain: **/*.bak
  ingredients/
    <BOOK>.usfm                         one per book in scope (§4.1)
    checking/
      alignments/<BOOK>.json            role x-alignment        (§5.1)
      translationWords/<BOOK>.json      role x-check-decisions  (§5.2)
      translationNotes/<BOOK>.json      role x-check-decisions  (§5.2)
      translationQuestions/<BOOK>.json  reserved, post-Phase-1 only (ledger #12); same schema as §5.2
      resources.json                    role x-resource-links   (§5.3)
      settings.json                     role x-check-settings   (§5.4)
      journal/<actorId>/<BOOK>.<seq>.jsonl   role x-journal — Phase 2 only (§8)
```

`<BOOK>` is the UPPERCASE 3-character USFM book code (`TIT`, `JON`, `1CO` …).

**Server path constraints (verified in pankosmia-web `utils/paths.rs`):** ingredient paths (the `ipath`, i.e. the part under `ingredients/`) MUST NOT have segments that are empty, start with `.`, or contain any of: `..  ~  \  &  *  +  |  space  ?  #  %  {  }  <  >  $  !  '`. This is why the sidecar directory is `checking/`, not `.tc4/`.

## 3. `metadata.json`

Base it on Pankosmia's own textTranslation template (`resource-core/templates/content_templates/text_translation/metadata.json`), then apply:

1. `meta.category` = `"source"`; `meta.normalization` = `"NFC"`; `meta.generator.softwareName` identifies tC4.
2. `idAuthorities` MUST include `local`, and `dcs` (`{"id": "https://git.door43.org", "name": {"en": "Door43 Content Service"}}`) when `relationships` are present.
3. `type.flavorType` = `{ name: "scripture", flavor: { name: "textTranslation", usfmVersion: "3.0", … } }`.
4. `type.flavorType.currentScope` MUST contain one key per book in the project (`{"TIT": [], "JON": []}`). Multi-book is native; a project MAY hold 1–66 books.
5. `ingredients` MUST list every file under `ingredients/` (path key includes the `ingredients/` prefix) with `checksum.md5`, `size`, `mimeType` (`text/plain` for `.usfm`, `application/json` for `.json`), `scope` (`{"<BOOK>": []}`) for files whose basename is a book code, and `role` per §2. Entries MUST NOT contain other fields (the bundled SB `ingredient.schema.json` sets `additionalProperties: false` — verified).
6. `relationships` (Stage 2 — see §6): the resource pins expressed natively. Shapes verified against the bundled `relationship.schema.json`:

```json
"relationships": [
  {"relationType": "source",         "flavor": "textTranslation",      "id": "dcs::unfoldingWord/grc_ugnt", "revision": "v0.34"},
  {"relationType": "source",         "flavor": "textTranslation",      "id": "dcs::unfoldingWord/hbo_uhb",  "revision": "v2.1.30"},
  {"relationType": "parascriptural", "flavor": "x-bcvarticles",        "id": "dcs::unfoldingWord/en_tw",    "revision": "v87"},
  {"relationType": "parascriptural", "flavor": "x-bcvnotes",           "id": "dcs::unfoldingWord/en_tn",    "revision": "v86"},
  {"relationType": "peripheral",     "flavor": "x-peripheralArticles", "id": "dcs::unfoldingWord/en_ta",    "revision": "v86"},
  {"relationType": "peripheral",     "flavor": "x-lexicon",            "id": "dcs::unfoldingWord/en_ugl",   "revision": "v2"},
  {"relationType": "peripheral",     "flavor": "x-lexicon",            "id": "dcs::unfoldingWord/en_uhl",   "revision": "v1"}
]
```

Schema gotchas (verified): `id` matches `^[0-9a-zA-Z][0-9a-zA-Z\-]{1,31}::\S+$` with the prefix declared in `idAuthorities`; the schema's `oneOf` means original-language repos MUST use `relationType: "source"` + flavor `textTranslation`, and custom `x-` flavors MUST NOT use `relationType: "target"` (it would match two branches and fail).

The full metadata example is `sample-burrito/metadata.json` — schema-valid against Pankosmia's bundled schema (harness check 1).

## 4. Text ingredients

### 4.1 `ingredients/<BOOK>.usfm`

- USFM 3.0, one whole book per file. `\id`, `\usfm 3.0`, `\h`, `\toc1-3`, `\mt`, then `\c`/`\p`/`\v` content. Untranslated verses use the platform stub convention `\v N ___`.
- **INVARIANT I-1: no alignment markup at rest.** The file MUST NOT contain `\zaln-s`/`\zaln-e` milestones or `\w` word-attribute tokens. Rationale (verified empirically): the platform drafting editor strips all such markup on save, whole-book; keeping alignments inline would make them destructible by any text edit. Alignments live in §5.1 and are folded into `\zaln` **only on export**.
- **Verse keys are strings, and MAY be spans.** A span verse uses the exact USFM span string as its key everywhere: `\v 9-10` parses to the single usfm-js key `"9-10"` (harness check 23, on the JON 2:9-10 fixture); word-aligner-lib's verse handling supports span keys (verified in its verseHelpers). Readers and writers MUST NOT coerce verse keys with `Number()` — `Number("9-10")` is `NaN` (harness check 24; this exact bug class existed in the prototype's fixtureStore). Identity keys (§5.2) and I-3 hashes key by the exact verse string.

### 4.2 Derivations (never stored)

These are computed at load and MUST NOT be persisted as authoritative data:
- **targetBible** for the checking components: `usfm-js.toJSON(usfm).chapters` → `{ "<ch>": { "<v>": {verseObjects} } }`, plus `headers`.
- **Check item lists** (groupsData/groupsIndex): derived from the pinned tN/tW TSVs + the original-language book, then merged with stored decisions (§5.2 identity key). Progress = decided ÷ derived-total. The TSV→items derivation is owned by the client's `derive/` module (versioned TSV parsing + the tN category map); the RCL's own helpers (`twlTsvToGroupData` / `tsvObjectsToGroupData`) are the contract/parity reference, and whether they also serve as a headless runtime dependency is ledger #14. **Proof status, stated honestly:** the harness proves the derive+merge mechanism and progress reconstruction on a miniature TSV defined inside the suite (check 18); derivation through real published tN/tW/tA files and the real resolver is not yet executed — ledger #15.
- **Aligned USFM**: produced on export by merging §5.1 data into verse text (`wordaligner.merge` → `\zaln` USFM). Round-trip proven byte-equivalent (harness checks 8–11, 22).
- A derived cache MAY be written (e.g. progress `summary` blocks, see §5.2) but MUST be regenerable and MUST be treated as disposable.

## 5. Checking sidecars (Phase 1 canonical user data)

Common rules:
- Every sidecar file has a top-level `schemaVersion` (integer, currently `1`).
- **INVARIANT I-2: all `occurrence`/`occurrences` fields are integers.** USFM attribute parsing yields strings; writers MUST normalize (`Number(...)`) before persisting. The alignment libraries fail wholesale on string occurrences (verified — this exact bug cost us a debugging cycle; the current checks client carries a `fixOccurrences` patch for it).
- `contextId.reference.bookId` is **lowercase** (`"tit"`) — tC3 convention — while filenames/scope use uppercase (`TIT`). Do not "fix" this; the checking libraries expect lowercase.

### 5.1 Alignment: `checking/alignments/<BOOK>.json` (role `x-alignment`)

```jsonc
{
  "schemaVersion": 1,
  "book": "TIT",
  "chapters": {
    "1": {
      "1": {
        "alignments": [            // one entry per original-language word/word-group,
          {                        // INCLUDING empty ones (tC3 convention)
            "topWords": [          // original-language side
              {"word": "Παῦλος", "strong": "G39720", "lemma": "Παῦλος",
               "morph": "Gr,N,,,,,NMS,", "occurrence": 1, "occurrences": 1}
            ],
            "bottomWords": [       // target-language side; [] if unaligned
              {"word": "Pablo", "occurrence": 1, "occurrences": 1}
            ]
          }
        ],
        "wordBank": [              // target words not yet aligned
          {"word": "de", "occurrence": 1, "occurrences": 5}
        ],
        "invalid": false,          // set true when alignment needs re-review
        "targetVerseMd5": "<md5>", // see below
        "sourceVersion": "dcs::unfoldingWord/grc_ugnt@v0.34"
      }
    }
  }
}
```

- The `alignments`/`wordBank` payload is **exactly** what `word-aligner`'s `unmerge` produces and `merge` consumes (normalize occurrences per I-2; the library returns the key `alignment` — persist as `alignments`). Do not invent another shape; round-trip is proven with this one.
- **`targetVerseMd5`** = md5 (lowercase hex) of the UTF-8 bytes of the verse's plain text: concatenate the `text` fields of the verse's usfm-js verseObjects, then `trim()`. **INVARIANT I-3: an alignment entry is valid only if its `targetVerseMd5` matches the current verse text.** Mismatch ⇒ treat as `invalid` regardless of the flag. This replaces tC3's marker-file invalidation and is Phase 2's base-hash mechanism arriving early.
- Multi-source alignments (e.g. `Ἰησοῦ`+`Χριστοῦ` → `Jesucristo`) are one entry with two `topWords`. Verses with no alignment work yet MAY be absent entirely.

### 5.2 Decisions: `checking/<toolId>/<BOOK>.json` (role `x-check-decisions`)

`toolId` ∈ `translationWords` | `translationNotes` (| `translationQuestions`, reserved).

```jsonc
{
  "schemaVersion": 1,
  "tool": "translationWords",
  "book": "TIT",
  "resource": {"repoPath": "git.door43.org/unfoldingWord/en_tw", "version": "v87"},
  "decisions": [
    {
      "contextId": {
        "checkId": "t1g7",                       // the TSV ID column — the stable anchor
        "occurrenceNote": "",                    // tN: the note text
        "reference": {"bookId": "tit", "chapter": 1, "verse": 1},
        "tool": "translationWords",
        "groupId": "god",
        "quote": "Θεοῦ",                          // tW: string; tN: [{word, occurrence}]
        "quoteString": "Θεοῦ",
        "glQuote": "",
        "occurrence": 1
      },
      "category": "kt",                           // tW: kt|names|other; tN: tA category
      "selections": [{"text": "Dios", "occurrence": 1, "occurrences": 2}], // or false
      "comments": false,                          // or string
      "reminders": false,                         // bookmark flag
      "nothingToSelect": false,
      "verseEdits": false,
      "invalidated": false,
      "status": "valid",                          // OPTIONAL additive triage state (D2): valid|invalid|todo
      "modifiedTimestamp": "2026-07-02T14:21:07.000Z"   // Phase-2 forward-compat; REQUIRED
    }
  ],
  "summary": {"note": "derived cache, regenerable", "decided": {"kt": 2}}   // OPTIONAL, disposable
}
```

- The decision record is the **full tC3 check-item shape** — every field the `tc-checking-tool-rcl` `Checker` reads or writes (verified field-for-field against its published source). Do not simplify it; the local POC's simplified shape provably fails to round-trip.
- Only *touched* checks are stored. An item with no stored decision is "unchecked" — that is the representation of not-done.
- **Identity key (normative, for merge/upsert):** `(contextId.checkId, reference.bookId, reference.chapter, reference.verse, contextId.occurrence)`, with `quoteString` as a verification field (writers SHOULD reject a key match whose quoteString differs — it means the resource changed; treat as unmatched). tN `quote` word-arrays MUST be preserved as arrays. **Chapter and verse compare as strings** (`String(...)` both sides): a single verse is its decimal string, a span verse is the exact span string (`"9-10"`); never `Number()`-coerce (harness check 24). `reference.verse` itself stays a JSON number for single verses (tC3 convention) and is the span string for spans.
- `selections` semantics: `false` = none; `[]` is not used — empty coerces to `false` (RCL convention, verified). "Done" = `selections !== false || nothingToSelect === true`.
- **`status`** (OPTIONAL, additive — decision D2, 2026-07-06): explicit triage state, one of `"valid" | "invalid" | "todo"`. When absent, readers derive it: `invalidated` ⇒ `invalid`; done (rule above) ⇒ `valid`; else `todo`. A writer that sets `invalidated: true` MUST NOT leave `status: "valid"` in place. Additive-optional, so `schemaVersion` stays 1 (§9). Harness check 25.
- `verseEdits`/`invalidated` carry the re-review state that tC3 kept in timestamped marker files; the marker files are retired.

### 5.3 Resource pins: `checking/resources.json` (role `x-resource-links`)

```jsonc
{
  "schemaVersion": 1,
  "gatewayLanguage": {"languageId": "en", "owner": "unfoldingWord"},
  "resources": {
    "originalLanguage": {
      "nt": {"repoPath": "git.door43.org/unfoldingWord/grc_ugnt", "version": "v0.34",  "flavor": "scripture/textTranslation"},
      "ot": {"repoPath": "git.door43.org/unfoldingWord/hbo_uhb",  "version": "v2.1.30","flavor": "scripture/textTranslation"}
    },
    "translationWords":   {"repoPath": "git.door43.org/unfoldingWord/en_tw", "version": "v87", "flavor": "parascriptural/x-bcvarticles"},
    "translationNotes":   {"repoPath": "git.door43.org/unfoldingWord/en_tn", "version": "v86", "flavor": "parascriptural/x-bcvnotes"},
    "translationAcademy": {"repoPath": "git.door43.org/unfoldingWord/en_ta", "version": "v86", "flavor": "peripheral/x-peripheralArticles"},
    "lexicon": {
      "nt": {"repoPath": "git.door43.org/unfoldingWord/en_ugl", "version": "v2", "flavor": "peripheral/x-lexicon"},
      "ot": {"repoPath": "git.door43.org/unfoldingWord/en_uhl", "version": "v1", "flavor": "peripheral/x-lexicon"}
    }
  }
}
```

- Replaces the per-book `version_manager.json` the current checks client writes. `version` is the git branch/tag checked out locally (the platform pins by branch checkout — verified).
- Deterministic derivation (§4.2) depends on these pins: same pins ⇒ same check lists ⇒ saved decisions always re-attach. An intentional resource upgrade re-derives; unmatched decisions surface for review rather than silently persisting.
- **Stage rule S-1:** until pankosmia-web PR-1 lands, this file is **authoritative** and `metadata.json.relationships` is a best-effort mirror (the server's remake-ingredients drops `relationships` and ingredient `role`s — verified). After PR-1, flip: relationships authoritative, this file becomes a mirror, then retires.
- Extra scripture panes (gateway bibles) MAY be added under an `extraScripture` array of the same entry shape. [AGREED — D10/ledger #13, 2026-07-06: ULT/UST drafting panes require it; promotion to normative lands in the first J2 increment's PR, spec + harness together (checklist C1b.1). Until that PR it is not normative and no reader consumes it.]

### 5.4 Settings: `checking/settings.json` (role `x-check-settings`)

```jsonc
{
  "schemaVersion": 1,
  "checkCategories": {
    "translationWords": ["kt", "names", "other"],
    "translationNotes": ["translate"]
  },
  "ui": {
    "paneSettings": [ {"bibleId": "targetBible", "languageId": "es-419"} ],
    "toolsSettings": {}
  }
}
```

Home for the RCL `saveSettings` payload (pane/tool settings — an unpersisted TODO in the current client) and the check-category filter (`checker_setting.json` equivalent).

## 6. Server interaction rules (Phase 1)

Verified semantics of pankosmia-web (v0.16.x) that conforming writers MUST respect:

- **W-1** Writes go through `POST /burrito/ingredient/raw/...?ipath=<path under ingredients/>` with body `{"payload": "<string>"}` (JSON payloads are stringified). The handler creates missing directories; a missing/non-string `payload` panics the handler — never send one.
- **W-2** Registration is opt-in: pass `update_ingredients` on the write (or call `POST /burrito/metadata/remake-ingredients/...` after a batch). Regeneration rescans the whole repo — unregistered files self-heal in, and (until PR-1) `role`/`relationships` are wiped by the same rescan. Hence **Stage rule S-2: paths are authoritative; roles are decorative until PR-1.**
- **W-3** `no_bak` skips the single-level `.bak` backup/undo. Writers SHOULD omit `no_bak` for USFM (keep undo) and MAY use it for high-frequency sidecar writes. `.bak` files are git-ignored and excluded from ingredient scans (verified).
- **W-4** Nothing auto-commits. The app MUST call `POST /git/add-and-commit/{path}` at checkpoints (session close, book done, pre-sync). Note `add-and-commit` sweeps **all** pending changes in the repo, and branch switching refuses on a dirty tree (verified) — commit before any branch operation.
- **W-5** Whole-file writes only (no append; the server writes unconditionally). Phase 1 accepts the read-modify-write race on `<BOOK>.usfm` (single user, same app); load-time revalidation (I-3 + selections validation) self-heals stale sidecars. The same whole-file race exists for every sidecar; compare-and-swap or read-merge-retry for sidecar writes is an open item (ledger #17).

## 7. Conformance

A project is conforming when `sample-burrito-validation`'s checks pass against it. The suite has **27 checks in three groups**:

- **Stage-1 — path-authoritative conformance (23 checks).** Schema validity; ingredient integrity; targetBible derivability; alignment round-trip + staleness guard; selections validity + invalidation firing; decision-shape completeness incl. the additive `status` field; derive+merge progress reconstruction; multi-book scope; pin completeness; zaln export; verse-span key semantics. These hold on today's pankosmia-web unmodified.
- **Stage-2 — role/relationships durability (2 checks).** Role-tagged sidecars and native SB `relationships`. The sample carries both, schema-valid — but today's server **wipes them on any metadata regeneration** (stage rules S-1/S-2), so a project rescanned by today's server fails exactly these two checks. That is expected, is why Stage 1 treats paths as authoritative, and is what upstream Change 1 (PR-1) fixes.
- **Phase-2 — journal-merge design (2 checks).** The two-actor `metadata.json` merge conflict and the §8.4 derived-file rule that resolves it, exercised in a disposable git repo.

Run: `npm install && npm run validate` (`.npmrc` handles the required `legacy-peer-deps`).

## 8. Phase 2: the event journal (DESIGN DRAFT — finalize before building; ledger #10)

When Phase 2 ships, journals become canonical; `<BOOK>.usfm` becomes a **derived, committed** artifact regenerated from the fold at checkpoints (declared `merge=ours` in `.gitattributes`, regenerated after merges). `metadata.json`'s `ingredients` table is likewise a scan product and follows the same derived-file merge rule (§8.4). Everything in §§3–5 remains valid for reading; sidecars seed the journal at migration (one `seed` event per record, using `modifiedTimestamp` and `targetVerseMd5`).

### 8.1 Files

`ingredients/checking/journal/<actorId>/<BOOK>.<seq>.jsonl` — append-only, one JSON event per line (ingredient `mimeType`: `application/x-ndjson`), rotated (`<seq>` = zero-padded 5 digits) at ~1 MB. `<actorId>` = stable per-install identifier (UUID-derived slug); a device MUST only ever write under its own `<actorId>`. A `journal/<actorId>/actor.json` records display name/device info. **Disjoint-writer layout is the merge guarantee for the journals** — no two devices write the same journal file, so combining copies never conflicts *in the journals*. The shared derived files are NOT covered by this guarantee; they are covered by the §8.4 rule.

### 8.2 Event envelope

```jsonc
{"v": 1, "op": "text.verse.set", "actor": "maria-x1", "ts": "<HLC>",
 "id": "<hash>", "ref": "TIT 1:4", "base": "<hash|null>", ...op-specific fields}
```

- `ts` — hybrid logical clock string, lexicographically ordered: `<ISO-8601 UTC ms>|<4-hex logical counter>|<actorId>`. Receiving any event ratchets the local HLC. Total order = (`ts`, then `actor`).
- `id` — content hash of the op-specific payload (for text ops: the md5 of the new verse text, aligning with `targetVerseMd5`).
- `base` — the `id`/hash this change was made against (`null` for first content). Two events sharing a `base` = a **fork**: the fold surfaces both in the review queue; a later event superseding them resolves it.

### 8.3 Operations and fold rules

| op | payload | fold rule |
|---|---|---|
| `text.verse.set` | `{text}` + `ref`, `base` | LWW register per verse **with fork detection** (competing drafts → review queue, never silent) |
| `text.headers.set` | `{headers:[…]}` per book | LWW per book |
| `align.verse.set` | `{alignments, wordBank, targetVerseMd5}` | LWW per verse; valid only while `targetVerseMd5` matches folded text (I-3) |
| `check.decision.set` | contextId key fields + decision fields (§5.2) | LWW per identity key |
| `note.add` | `{target, text}` | grow-only set (comments are additive) |
| `resource.pin.set` | one §5.3 slot | LWW per slot |
| `seed.import` | `{source, scope}` + batch reference | marks migrated/imported data; ordinary events follow |

Structural/paragraph-level ops beyond headers are **deliberately deferred** to the Phase 2 design task (ledger #10) — do not improvise them.

### 8.4 Sync and the derived-file merge rule

Actor branches on the shared DCS repo (`actor/<actorId>`): pushing your own branch is always fast-forward and requires pulling nothing. Integration (any device or a coordinator) merges actor branches into `main`. Works today via checkout+copy+commit; pankosmia-web PR-2 (branch-merge endpoint) upgrades history quality. Out-of-band USFM edits (another app) reconcile via `seed.import` when the committed USFM hash diverges from the fold's projection.

**Derived-file merge rule (normative).** The no-conflict guarantee covers journal files only. Two shared files are edited by *every* actor's checkpoint and conflict in a naive `git merge` — proven by a two-actor test (harness check 26): each branch added only its own journal file, and `metadata.json` still conflicted, because its `ingredients` table must list every file. The two files are `metadata.json` and `<BOOK>.usfm` (the regenerated view). Both are **derived at integration time** and carry no authoritative state, so:

1. Declare them `merge=ours` in `.gitattributes` (`metadata.json merge=ours`, `ingredients/*.usfm merge=ours`). Note the `ours` merge *driver* is not enabled by default (`git config merge.ours.driver true` for CLI git), and libgit2-based merges — including the proposed PR-2 endpoint, which computes in memory and writes nothing on conflict — do not run config-defined drivers, so the declaration alone is a convenience, not the guarantee.
2. The guarantee is the algorithm: integration MUST treat any derived-file conflict as resolvable by taking **either side wholesale**, and MUST then **regenerate post-union** before committing — fold journals → regenerate `<BOOK>.usfm`; rescan `ingredients/` → regenerate the `ingredients` table (fresh scan wins for checksum/size/mimeType; per-ingredient extras carry forward for surviving paths — the same semantics as upstream Change 1).
3. Consequence, stated plainly: non-ingredient edits to `metadata.json` (e.g. a project rename) made on the branch whose copy was discarded are lost at integration. Until a journal op carries those fields (part of ledger #10), clients SHOULD treat non-ingredient metadata as single-writer.

The rule is executable: harness checks 26–27 reproduce the conflict and prove resolve-either-side + regenerate-post-union completes cleanly (two-parent merge commit; both actors' journals present and listed; ingredients table matching disk exactly).

## 9. Spec evolution

Bump a sidecar's `schemaVersion` only for breaking payload changes; readers MUST reject unknown major versions with a clear message. Additive optional fields do not bump. This document is versioned in git alongside the code; changes require updating the harness in the same change.
