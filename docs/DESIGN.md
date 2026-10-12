# Scrobble Analyzer — Design Rationale & Project History

Companion to CLAUDE.md. This is the "why" that isn't visible from the source: decisions made, alternatives rejected, current state, roadmap, and open questions. Written for a technical reader or AI coding agent picking the project up cold.

Alongside this file in `docs/`:

- **[EXTERNAL-DATA.md](EXTERNAL-DATA.md)** — facts about Last.fm, lastfmstats and MusicBrainz. What *their* systems do, as opposed to why *we* decided things. Read before any API or MusicBrainz work.
- **[case-studies/](case-studies/)** — worked investigations, kept whole. Currently one: the Cream of Clapton AlbumId mismatch, which is the evidence behind §1.4 and §3.2.
- **[releases/](releases/)** — release notes as shipped.

---

## 1. Key design decisions and their reasoning

### 1.1 File-export analysis, not live API sync

The tool analyzes a CSV export (lastfmstats.com format) rather than syncing against the Last.fm API. Rejected alternative: real-time API integration. Reasoning: the correction workflow is inherently batch-shaped (export → triage → fix on Last.fm → re-export), Last.fm provides **no API for editing scrobbles** anyway (corrections are website-UI-only), and API sync would add auth, rate limits, and a server dependency for zero workflow gain. This decision is settled; don't reopen it without a workflow argument, not a technical one.

### 1.2 Single-file HTML, no build step

Deliberate. The audience includes non-developers on r/lastfm who download one file and double-click it. Every dependency is a distribution and trust cost. Rejected: any bundler/framework. The cost we accept is a large single file; the mitigation is disciplined internal organization, not tooling.

### 1.3 "Flag, human decides" — no auto-correction

A community survey showed users want to research and decide for themselves; compilation handling in particular proved more controversial than expected (some users *want* compilation scrobbles as-is). The tool's contract is detection + evidence, never mutation. This also sidesteps liability for wrong merges — a false flag is an annoyance, a false auto-merge is data corruption.

### 1.4 MBIDs are hints, not facts — `AlbumId` is ignored

Established empirically during v0.6.0 testing. "The Cream of Clapton" (1995 compilation) rows carried an AlbumId resolving in MusicBrainz to "The Cream of Eric Clapton" (1987 UK release, MBID `01e7ce7d-8752-4887-990a-834d5c8e13d3`) — an entirely different album, eight years earlier, credited to a different artist. This **killed a proposed v0.7 feature** that would have used AlbumId as a correctness signal (a "verified" chip): a confidently-wrong chip is worse than no chip. Any future MusicBrainz integration must treat Last.fm-supplied MBIDs as leads to verify, never as ground truth.

**Full write-up: [case-studies/2026-07-06-cream-of-clapton-albumid.md](case-studies/2026-07-06-cream-of-clapton-albumid.md).** Read it before any MusicBrainz work — the summary above understates it. The case study also establishes *why* the album appeared as a variation at all (the scrobbler's `albumartist` field, not the casing difference it looked like), which is the mechanism behind §3.2. See also [EXTERNAL-DATA.md](EXTERNAL-DATA.md) §3.

### 1.5 Persistent dismissals keyed by username + name-based IDs

**v0.8.0 review work (2026-10-11):** phase 1 of the approved reliability and usability plan replaces lossy IDs with versioned, encoded name tuples. Variation-card identity uses the existing normalization key and artist context rather than the highest-count display title; invisible cards include their subtype and visible context. Per-track IDs retain the exact track spelling, including Unicode, punctuation and case. Card baselines retain both artist context and member name. See §4.6 for migration and validation. The v0.6/v0.7 description below records the previous design, not the new ID algorithm.

Shipped in v0.6.0. Two coupled decisions:

- **Keying by Last.fm username** (parsed from the `Date#username` CSV header) rather than file hash. Rejected alternative: file-hash keys — they broke on every re-export, defeating persistence. Migration from the old file-hash scheme is in place.
- **Name-based item IDs** rather than index-based. Indexes shift when the export changes; names don't (mostly — see open question 5.1).

A dismissal is currently a single bit that conflates "I fixed this" with "never show me this" — scoped to split in §4.5.

Strategic consequence: persistent dismissals **unlock detection categories that were previously too noisy**. Remaster flagging was rejected pre-v0.6 because users who deliberately listen to remasters would drown in flags; now triage is a one-time cost. "Features unlocking features" — keep this in mind when evaluating noisy-but-useful detector proposals.

### 1.6 Two detector classes: variation vs. pattern

- **Variation detectors** need a disagreement to exist: two spellings clustering to one normalization key. They can never see a *uniform* error (see §3.1).
- **Pattern detectors** match individual entries against regex, no twin required (compilation detection, missing-album detection today; remaster/feat. detection in v0.7).
  - The Invisible Characters category straddles both classes: visually identical twins are a variation match, but a **lone** artist, album or track whose own name carries an invisible character is flagged with no twin (albums and tracks gained this for issue #22; artists always had it). A doubled space is always wrong, and in real exports it is usually where an `&` used to be. The lone test looks at the entity's own name only, so an artist with a doubled space yields one card, not one per album and track.

A third class — **reference detectors**, comparing the library against an external canonical source (MusicBrainz) — is designed but not built (§4.3).

### 1.7 Normalization pipeline choices

**What is actually implemented today** — verified line-by-line against `index.html` on 2026-09-18, with v0.8.0 suffix refinements checked on 2026-10-11 (§4.8; first verified 2026-08-01, before v0.6.1 landed). An earlier revision of this document (and of CLAUDE.md) described the pipeline inaccurately; this table is the corrected record and should be re-verified whenever a normalizer changes.

| Step | Artist | Album | Track |
|---|:---:|:---:|:---:|
| lowercase, trim, collapse whitespace | yes | yes | yes |
| NBSP (U+00A0) → space | yes | yes | yes |
| apostrophe-likes U+2018/2019/00B4/0060/02BC → `'`, U+201C/201D → `"` | yes | yes | yes |
| `[ ]` → `( )` (container canonicalization) | — | yes | yes |
| fold diacritics (NFD, marks dropped) | yes | yes | yes |
| strip leading "the" | yes | — | — |
| keyword suffix stripping (remaster/live/feat/…), optional year between dash and keyword | — | yes | yes |
| bare trailing year after a real title ("Comfortably Numb 2022") | — | — | yes |
| "&" → "and" | yes | yes | yes |
| punctuation `.` `,` `-` U+2010 U+2013 U+2014 → **space** (never deleted) | yes | yes | yes |

Rules run in roughly that order; the punctuation row runs last because the suffix rules need the dash intact to match. Punctuation is mapped to a space rather than deleted (the *3.15.20* guard below); dashes joined the class for issue #20 ("Hip Hop" vs "Hip-Hop"), with the side effect that `Foo - 2000 - Remaster` now reaches `foo`. Before v0.6.1 none of punctuation, diacritic folding, or `&`/`and` on albums and tracks existed, and several issues traced to those gaps (§3.3). Each rule that *does* exist was driven by a real user report, not speculation. Principles worth preserving:

- Normalization changes are the highest-risk edits in the codebase — they silently change what groups with what. Hence the merge contract, `tests/merge-contract.js` (§4.1.1) — **built as of 2026-08-01**. Add cases there before changing behaviour here.
- The canonical MUST-NOT-merge example: **Elvis Costello vs. Elvis Costello & The Attractions** are different credits, correctly distinct. Any normalization change that merges them is wrong. Now enforced.
- The title guard — numeric-punctuation titles like *3.15.20* must not normalize to "31520" — **is now enforced**, but not as a pair. It could not be: asserting that `3.15.20` and `31520` stay unmerged proves nothing, because the year rule rewrites `31520` to `3` and the two differ no matter what punctuation does. It lives in the contract's `KEY_MUST_NOT_BE` list as an assertion about the key itself. This was found by injecting the exact mistake the guard exists to catch and watching the pair form pass.

**v0.8.0 precision refinements:** album/track metadata stripping now parses balanced parentheses after bracket canonicalization. A marker in one group cannot consume a meaningful sibling: `Song (Part 1) (Live)` retains `(Part 1)`. Nested groups are handled independently: `(Part 1 (Live))` retains Part 1, while `(Live (Berlin))` is metadata in full. Unclosed groups are retained. Removing a label inserts a space, so `Foo(Live)Bar` does not become `Foobar`. Markers require boundaries against Unicode letters, numbers and underscore; `Credit`, `Delivered`, `Mixtape` and `Inversion` are title text. Supported inflections are explicit, including Remastered/Remastering/Remasters, Remixed, Edited, Edition and Take 3A; `Alt.` keeps its literal period. Album and track vocabularies remain separate. Dash suffixes use the same whole-word principle, and bare year-plus-keyword track suffixes require whitespace on both sides of the four-digit year. The separate trailing-year rule and the artist normalizer are unchanged. These are grouping heuristics: a meaningful phrase containing a whole metadata word can still be flagged for human review.

### 1.8 Git/release conventions (and why)

- Branch names describe the work, not the version — a branch named `v0.6.0` collides with the tag `v0.6.0` in Git's ref namespace. Learned the hard way during the v0.6.0 cycle.
- Merge commits over squash: commit granularity is meaningful history for a project reviewed change-by-change.
- Release framing precedent: v0.6.1 is deliberately scoped as "the normalizer now catches what you reported" (bug-fix framing for detection widening), keeping the next minor as a coherent story. Strict semver would call detection widening a minor bump; the point-release framing was chosen consciously. v0.7.0 then went to the dismissal split (§4.5) rather than the pattern detectors, because it changes stored data and what users see on first load — a minor bump on its own merits — and the detectors moved to v0.8.0 (§4.2).

### 1.9 Chips signal invisibility, not incorrectness

The `⚠️ invisible chars` / `⚠️ smart quote` chips and the character-reveal chips (`NBSP`, `ZWSP`, `2×SP` with codepoint tooltips) exist for **one** reason: to tell the user what differs between two rows **when their eyes can't**. They are an accessibility aid for the comparison, not a verdict on the row they sit next to.

This was implicit in the code and is written down here because it is easy to misread a `⚠️` as "this variation is wrong" and then reason from that — which leads to the wrong conclusion about diacritics (see §5.4). The governing rule:

> Chip a variation when the difference between it and its siblings is **not visually resolvable at body-text size**. Do not chip a difference the user can simply see.

Corollaries worth keeping straight:

- A smart quote gets a chip not because curly quotes are wrong, but because `'` vs `'` is hard to resolve in a list.
- `Motörhead` vs `Motorhead` needs **no** chip. The difference is obvious, and the umlaut is the band's actual name — chipping it would imply the ASCII form is the fixed version, which inverts the truth.
- `Subcarpați` vs `Subcarpaţi` **does** need one, for exactly the reason `Motörhead` doesn't: the rows are the same picture. Character class is not the criterion; perceptual distinguishability is.

Because the card body is otherwise strictly neutral — name, play count, Last.fm link, sorted by count, no "correct" badge anywhere (`index.html:2483-2490`) — the chips are the only place the tool can accidentally editorialize. Keep them descriptive.

---

## 2. Current state of the codebase

**Solid (shipped in v0.6.0):**
- CSV parsing incl. quote-stripping fix (previously corrupted titles like Bowie's "Heroes")
- Variation detection for artist/album/track with the normalization pipeline above
- Invisible-character handling: consolidation routing (invisible-only variation groups go exclusively to the Invisible Characters category, not double-reported), track-level detection, broadened coverage (all non-plain-space whitespace + doubled spaces, not just the original six codepoints)
- Character reveal system: labeled chips (NBSP, ZWSP, 2×SP, …) with Unicode codepoint tooltips
- Persistent dismissals (username-keyed, name-based IDs, migration from old scheme)
- Export report with dismissed-items checkbox; search debounce; search/filter clear buttons
- Visual refresh (orange reserved for header LED + action buttons; tinted rather than solid active states)

**v0.8.0 review release (maintainer browser verification 2026-10-12):**
- Review phases 1–4 (§4.6–4.9): lossless imports, stable identities, correction memory, recurrence after observed count decreases, conservative history migration, detection precision and desktop triage with exact-track album evidence.
- Five dependency-free contract scripts in `tests/`: 155 merge assertions, 23 import/identity, 16 recurrence/correction, 16 detection/migration and 26 triage/evidence scenarios. They extract functions live from `index.html`; run every script before release.

**Scoped but not built:**
- The additional pattern detectors (§4.2, now v0.9.0), reference detection (§4.3) and other unimplemented roadmap ideas.

**Half-designed:**
- Uniform-error / reference detection (§4.3) — problem well understood, no implementation design yet.

---

## 3. Known issues and limitations

### 3.1 The uniform-error blind spot (structural)

Variation detection only sees *splits*. If every scrobble of an entity is consistently wrong the same way (e.g., all of Bowie's *"Heroes"* landing on the unquoted form), there is no variation, nothing clusters, and it stays silently wrong forever. Neither SA's detectors nor Last.fm's server-side alias correction will ever flag it. Fixing this requires a different signal — external cross-reference (MusicBrainz) or a curated known-gotchas list. This is the motivating problem for reference detectors (§4.3).

### 3.2 Compilation multi-artist fragmentation

Compilations spanning multiple track artists split across Artist values in the export — the album appears fragmented in ways the current grouping can't reunify. Documented blind spot; no fix designed. Maintainer's personal policy (context, not tool behavior): move compilation tracks to their original studio-album homes when a standard release exists.

**The cause is structural, not a grouping weakness.** The lastfmstats `Artist` column is the *track* artist; the album-artist dimension is not in the export at all, so no grouping key built from the file can recover it. One album can therefore legitimately occupy three buckets at once — track artist with no album artist, track artist with an album artist, and the album artist's own tracks filed under a different Artist entirely. Worked through in full in the [Cream of Clapton case study](case-studies/2026-07-06-cream-of-clapton-albumid.md) (rule 3), which is also where the mechanism was first identified. Any future fix needs a data source beyond the CSV — see [EXTERNAL-DATA.md](EXTERNAL-DATA.md) §3 on `release-group.secondary-types`, which is the authoritative version of what compilation detection currently approximates with title regexes.

### 3.3 Known normalization misses (user-reported, targeted by v0.6.1)

All confirmed against the issue-#11 export on 2026-08-01 unless noted.

- **Diacritics not folded** — no normalizer folds them (issue #14). Note: the reporter had already hand-corrected Motörhead before exporting, so that exact pair is *not* reproducible from the attached file. The gap is nonetheless real and abundantly evidenced elsewhere in the same library (Björk, Sigur Rós, and a three-way Romanian split — see §4.1).
- **Artist punctuation variants** — "Albert Hammond, Jr." (11 plays) vs. "Albert Hammond Jr" (4) sit in separate groups, neither flagged (issue #11). Confirmed.
- **Extended apostrophe variants** beyond smart quotes: U+00B4 acute, U+0060 backtick, U+02BC modifier-letter apostrophe (issue #12). The specific reported pair was already user-corrected, but other instances remain (e.g. GusGus, "When Your Lover´s Gone").
- **`&`/`and` not unified on tracks or albums** (discussion #10). This was logged as "a suspected bug"; it is confirmed and the cause is mundane — the track normalizer has no `&` rule at all. `9th & Hennepin` (5) and `9th and Hennepin` (9) both exist in the export and do not group. See §4.2 for why this is *not* the hard ampersand problem.
- **`feat.`/`ft.` absent from the track keyword list** (issue #17). Filed as a bracket-vs-parenthesis problem; it is not. See §3.6.

### 3.4 Platform

- Android file picker blocks CSV selection on Pixel devices (issue #5) — believed to be a one-line file-input `accept` attribute fix.

### 3.5 Case correction is out of scope by physics

Last.fm normalizes case to its catalog entry server-side; nothing SA flags about pure case will be user-fixable. Keep case-only differences from generating flags.

**Enforced in v0.8.0 phase 3 (§4.8):** ordinary artist/album/track detectors skip clusters whose raw names differ only by lowercase conversion. Mixed groups retain all spellings, and invisible-character detection is unchanged. Case aliases of an explicitly chosen kept member do not recur; punctuation, whitespace and accent differences still can. Old case-only fixed cards are not reconstructed as repeat offenses.

### 3.6 Container punctuation and the limits of suffix stripping

**Historical diagnosis, before v0.6.1:** the track/album suffix rule was `\s*[\(\[].*?(keyword…).*?[\)\]]`. The character classes made it *look* like brackets and parentheses were reconciled. They were not. The rule fired only when a **keyword** appeared inside; when it fired it deleted the whole parenthetical including its container, and when it didn't, both containers survived verbatim into the key:

```
"Song [Acoustic]"   vs "Song (Acoustic)"    -> "song" | "song"                           grouped
"Track [Interlude]" vs "Track (Interlude)"  -> "track [interlude]" | "track (interlude)"  NOT grouped
```

There was no code path that treated `[` as equivalent to `(`. Consequence for issue #17: adding `feat`/`ft` to the keyword list fixed that reported pair by deleting both parentheticals, which **sidestepped** the container question rather than answering it. The two changes are independent; both are in v0.6.1 (§4.1 items 2 and 7). Phase 3 (§4.8) additionally fixes the regex's ability to consume meaningful sibling parentheses or leave unmatched punctuation from nested metadata.

### 3.7 Near-miss / typo variations — no viable detector (issues #15, #16)

Issue #15 ("Missing accent variations") is **mis-titled**: the pair is `Cartoons and Macramé Wounds` vs `Cartoons and Macreme Wounds`. Fold the accent and you still have `macrame` vs `macreme` — the strings genuinely differ by a letter. It is the same class as issue #16 (`Citizen Erased` vs `Citzen Erased`), a typo, and **diacritic folding will not fix either one**.

Naive edit distance is not a usable answer, and this has been measured rather than assumed. Scanning the issue-#11 export for Levenshtein-distance-1 pairs among same-artist track keys yields **1,617 pairs**, and the highest-play ones are all legitimately distinct recordings:

```
[Queens of the Stone Age] "song for the dead"(94) ~ "song for the deaf"(64)
[Dustin O'Halloran]       "opus 17"(85)           ~ "opus 37"(83)
[Interpol]                "obstacle 1"(106)       ~ "obstacle 2"(29)
[Moderat]                 "porc #2"(97)           ~ "porc #1"(58)
```

Real typos exist in that set but are buried by design: they are *rare* (`Citzen Erased` has 1 play against 26), while distinct-track near-misses are *common* and high-play. Any future attempt needs an asymmetry that plain edit distance lacks — e.g. requiring a large play-count ratio, excluding pairs whose differing characters are digits, or gating on an external reference (§4.3). **Not scoped to any release.** Do not ship distance-based clustering without acceptance criteria derived from these numbers.

---

## 4. Roadmap

### 4.1 v0.6.1 — normalization patch (BUILT 2026-08-01, unreleased)

Theme: "the normalizer catches what you reported."

All ten items are implemented on branch `normalization-patch`, one commit each, each measured before it landed. Nothing is released yet.

**Measured outcome**, working tree vs. `main`, at the thresholds as shipped (artist ≥10 plays, album ≥5, track ≥3):

| | scoblitz (160,742 scrobbles) | Maeldun (380,877 scrobbles) |
|---|---|---|
| Artist | 46 → **49** | 38 → **49** |
| Album | 98 → **132** | 31 → **55** |
| Track | 994 → **1201** | 400 → **559** |
| Groups genuinely dropped | **0** | 6, all intentional |

Every disappearing group was classified rather than counted: scoblitz 42 gone / 42 absorbed into larger groups / 0 dropped; Maeldun 10 gone / 4 absorbed / 6 dropped, those six being the numeric-title false positives item 10 exists to remove. Dismissal orphaning stayed negligible on both (§5.1).

The per-item table below is the **pre-implementation estimate**, kept for attribution — it shows which change is responsible for what. Its figures were measured in isolation against Maeldun only, on a Node harness that copied the normalizers rather than reading them, and the combined row understates the shipped result because it predates items 9/10 and never covered albums. Trust the measured table above; use this one to attribute.

| # | Change | Artist | Track | Closes |
|---|---|:---:|:---:|---|
| 1 | **Merge contract** — hoist normalizers, then test file | — | — | build first |
| 2 | `feat`/`ft` added to track suffix keywords | — | **+59** | #17, part of disc. #4 |
| 3 | Punctuation `.` `,` → **space**, all three normalizers | +3 | **+54** | #11 |
| 4 | Diacritic folding (NFD), all three | **+8** | +24 | #14 class |
| 5 | `&` → `and` on track + album normalizers | — | +17 | disc. #10 |
| 6 | Apostrophes U+00B4, U+0060, U+02BC | 0 | +5 | #12 |
| 7 | Bracket/paren container canonicalization | — | +1 | #17 general class |
| 8 | Android file-input `accept` fix | — | — | #5 |
| 9 | Year allowed between dash and keyword | — | +4 | see 4.1.3 |
| 10 | Year suffix requires its keyword | — | **−6 false** | see 4.1.3 |
| | *estimated combined* | *38→49* | *400→561* | |

All 11 new artist groups and the top 40 new track groups were inspected by hand; no false positive was found. Notes:

1. **Merge contract** — `tests/merge-contract.js`, built first as planned. Now at **64 assertions** with 2 known misses (the typo cases #15/#16, which have no viable detector). It found items 9 and 10 before any scoped change was written — see §4.1.1 and §4.1.3.
2. Routes `feat.`/`ft.` pairs into ordinary track-variation cards. Accepted deliberately as a first step to *surface* the issue, deferring the separate "Multiple Artists" category (disc. #4) to v0.7 once §5.3 is settled.
3. **Period must map to a space, not to deletion.** This is exactly what preserves the §1.7 title guard: `3.15.20` → `3 15 20`, never `31520`. Verified.
4. The dominant win on this library is Romanian cedilla-vs-comma-below (`ş` U+015F vs `ș` U+0219); `Ștefan Hrușcă` is currently split three ways at 61/16/15 plays and NFD folding reconciles all three. **This item carries a hard dependency — see 4.1.2. Folding must not ship without the confusable-character chip.**
5. Not the hard ampersand problem — see §4.2.
7. Marginal on this library (one surfacing card: `Ramalama [Bang Bang]` vs `Ramalama (Bang Bang)`; a second pair falls under the 3-play threshold). Included on the judgment that it may be more prevalent in other libraries and costs almost nothing. Safe by construction: canonicalizing container characters can only merge strings that already differ solely in container type.

Guard check under the full combined change set: `Elvis Costello` and `Elvis Costello & The Attractions` remain distinct.

#### 4.1.1 What the merge contract actually is

It is a **proposal, not a pre-existing artifact** — no test file has ever been committed to this repo in any commit in its history, and it is unrelated to any other project. The name is just a label for the idea.

The concept: normalization changes are the highest-risk edits in the codebase because they silently change what groups with what, and there is currently no way to make that change visible before shipping. A merge contract is the cheapest possible fix — a single plain Node script, no framework, holding two lists of string pairs:

```js
const MUST_MERGE = [
  ['Albert Hammond, Jr.', 'Albert Hammond Jr'],   // #11
  ['9th & Hennepin',      '9th and Hennepin'],    // disc. #10
  ['Ramalama [Bang Bang]','Ramalama (Bang Bang)'],// #17 container class
];
const MUST_NOT_MERGE = [
  ['Elvis Costello', 'Elvis Costello & The Attractions'],  // distinct credits
  ['Song for the Dead', 'Song for the Deaf'],              // distinct tracks
  ['3.15.20', '31520'],                                    // title guard
];
```

Run it with `node`; it normalizes each pair and asserts the keys match (or don't). That's the whole thing. Its value is that the MUST-NOT list makes overmerge regressions *loud* — the failure mode that actually corrupts a user's triage — and that every future normalizer proposal has a concrete place to add its cases before any code changes. The throwaway harness used to produce the table above is a working prototype of it (§2).

**What it is not.** It is a developer-side test, not a rule set the application applies, and it is **never exposed to users**. It does not ship, does not run in the browser, and has no effect on the single-file artifact — users still download one HTML file. `merge-contract.js` simply sits beside it in the repo and is run from a terminal. It cannot "prevent" a change at runtime; it fails loudly at development time when an edit breaks a case previously judged to matter. The normalizers in `index.html` remain the only things doing real work.

**It asserts grouping, not correctness** — an important distinction given §1.3. `MUST_MERGE` on `['Albert Hammond, Jr.', 'Albert Hammond Jr']` claims only that the two belong on the same card; it says nothing about which spelling is right, and the tool still leaves that to the user. `MUST_NOT_MERGE` is the mirror image: Elvis Costello and Elvis Costello & The Attractions stay on separate cards because they are different credits, not because either is wrong.

**How rules are added or updated:** by editing the file, in the same commit as the change that motivated it. The workflow is where the value lives:

1. A miss is reported (say #11). Add the pair to `MUST_MERGE`, with the issue number in a comment.
2. Run it — **watch it fail.** This step is what proves the report was actually reproduced.
3. Change the normalizer.
4. Run again: the new case passes and nothing in `MUST_NOT_MERGE` broke.
5. Commit contract and normalizer together.

`MUST_NOT_MERGE` grows whenever an overmerge risk is discovered — `Song for the Dead` / `Song for the Deaf` earned its entry from the analysis in §3.7. The `KNOWN_MISS` class holds cases deliberately not fixed yet: recorded and visible, but not failing the run.

**Prerequisite — the normalizers are not currently reachable from Node.** All three live inline in `index.html`:

- **Artist** has no function at all; the logic is inline inside a `forEach` (`index.html:1624-1634`).
- **Album** (`normalizeAlbum:1680`) and **track** (`normalizeTrack:1880`) are named but nested *inside* `findAlbumVariations` / `findTrackVariations`, so nothing outside can call them.

So item 1 is really two steps: **hoist all three to top-level named functions** (a pure refactor, no behaviour change), then write the contract against them. The contract reads `index.html`, extracts those function bodies and evals them — mildly ugly, but it keeps one source of truth and adds no build step. Copy-pasting the logic into the test file is the tempting shortcut and must be avoided: the copy drifts from the original silently, and you end up testing code you are not shipping. Extracting the normalizers to a separate `.js` loaded via `<script src>` would be cleaner and is what most projects would do, but it breaks §1.2 and is therefore out.

Sequencing consequence: do the hoist **first**. Items 2–7 all modify the same three functions, so hoisting afterwards means reworking every one of them.

#### 4.1.2 Confusable-character chip — a dependency of item 4, not a nicety

Diacritic folding creates a class of card the tool has never produced before: **groups whose rows are visually identical.** Measured on the issue-#11 export, of the 8 artist groups folding newly creates, **4 are mark-vs-mark** — every row carries a diacritic and only its shape differs:

```
"Zdob şi Zdub"(17)      | "Zdob și Zdub"(8)
"Subcarpați"(19)        | "Subcarpaţi"(2)
"Alexandru Andrieș"(19) | "Alexandru Andrieş"(1)
"Țapinarii"(12)         | "Ţapinarii"(4)

ș U+0219 (comma below)  vs  ş U+015F (cedilla)
ț U+021B (comma below)  vs  ţ U+0163 (cedilla)
```

Shipping folding alone would present these as two indistinguishable names with a play count each and no way to tell them apart — the exact failure the invisible-character chips were built to prevent (§1.9). The other 4 groups (`Șuie Paparude` vs `Suie Paparude`) contain a plain-ASCII row and need nothing.

Required behaviour, following §1.9:

> When two members of a group fold to the same key **and** the differing characters are both marked, chip the differing character in the reveal-chip style (`ș U+0219`, codepoint tooltip) — informational, **not** `⚠️`. When one member is plain ASCII, chip nothing; the difference is already visible.

**Decision (2026-08-01): diacritic folding stays in v0.6.1, chip included.** The alternative considered and rejected was deferring folding to v0.7 to keep v0.6.1 purely mechanical — every other item in the release is a one-line normalizer edit, and this one pulls in rendering work. Rejected because folding is the second-largest detection win in the release (+8 artist, +24 track) and splitting it from the chip would ship the unreadable-card problem on purpose. v0.6.1 therefore contains exactly one piece of UI work; expect it in review.

Scope note: this is Romanian/Turkish cedilla-vs-comma-below in practice, but the rule is written on perceptual grounds rather than per-script so it generalises. It is small — the reveal-chip renderer already exists and is reused. Measurement caveat for whoever picks this up: an early pass put the track-side count at 2, but both were artifacts of a crude heuristic (it tested whether *every row* contained any mark, not whether the *differing* character was mark-vs-mark, so `À Mon Âme` vs `A Mon Âme` was misbinned). Treat the affected population as artist-side only until re-measured with a positional comparison.

#### 4.1.3 Items 9 and 10 — two suffix bugs found by the merge contract

Neither was reported by a user. Both surfaced on 2026-08-01 while writing MUST_MERGE cases for behaviour assumed to already work, which is the merge contract earning its place before a single scoped item had been built. Added to v0.6.1 by decision the same day.

**Item 9 — dangling separator.** `Midtown - 2023 Remaster` normalized to `midtown -`, so it grouped with nothing. The dash rule required its keyword *immediately* after the dash, so with a year in between it did not fire; the year rule then stripped `2023 Remaster` and abandoned the separator. This is the standard Spotify shape and exactly what discussion #7 raised. Fix: allow an optional `\d{4}` between the dash and the keyword, in the track *and* album normalizers. On the issue-#11 export: +4 groups, and track keys ending in an orphaned separator fall from 20 to 8 (the remainder are legitimate — Isis `-`, Mew `+ -`, a Morse-code artist).

**Item 10 — over-eager year strip.** The trailing-year rule made its keyword optional, so it deleted *any* trailing four-digit run. This did real damage: it was not merely failing to group, it was **fabricating cards**. Every wholly numeric title normalized to the empty string and collapsed together:

```
"1991"(55)  | "1983"(1)                                     <- distinct tracks, merged
"0001"(2)   | "0002"(2)  | "0003"(2) | "0004"(2)            <- distinct tracks, merged
"80186"(1)  | "80286"(1) | ... | "80686"(1)                 <- \d{4} matched inside a 5-digit title
"19-2000"   -> "19-"      "555-5555" -> "555-"              <- titles mangled
```

Fix: make the keyword required. On the export this removes **6 false-positive groups**. That is the reason items 9 and 10 read as `+4 / −6` in the table above: the headline count drops, and detection quality strictly improves. Do not read the −6 as a regression.

**Item 10, refined — and why one library was not enough.** Requiring the keyword also stopped bare trailing years being stripped at all. Maeldun's export contained no case where that mattered, so it looked free. Validating against a second library (the maintainer's own, 160,742 scrobbles) turned up the one it broke: `Comfortably Numb`(4) and `Comfortably Numb 2022`(2) stopped grouping. The final rule strips a bare trailing year only when **all three** hold, each guarding a specific failure:

| Condition | Guards against |
|---|---|
| whitespace-separated | `19-2000`, `555-5555` — digits belonging to the title |
| stem contains a letter | `1991`, `80186` — wholly numeric titles |
| stem ends alphanumeric | `Spring 1 - 2012` → `spring 1 -`, item 9's dangling separator returning |

Measured after refinement: scoblitz 1200 → 1201, Maeldun unchanged at 559. The six false-positive groups stay removed — every one is a set of genuinely distinct numerically-titled tracks (Crystal Castles `1991`/`1983`, HEALTH `0001`–`0004`, MASTER BOOT RECORD `80186`–`80686`).

The lesson is worth keeping: **a normalizer change validated against a single export is undertested.** One library's blind spot is another's common case. Both exports are now the standing validation set.

Both fixes are guarded going forward — item 9 by MUST_MERGE cases, item 10 by MUST_NOT_MERGE cases including `1991`/`1983` and `80186`/`80286`, plus a `KEY_MUST_NOT_BE` entry for the `Spring 1 - 2012` dangle.

### 4.2 v0.9.0 — pattern-detector release (scoped, not built; previously v0.7.0, then v0.8.0; review improvements take v0.8.0 — §4.10)

An opt-in **pattern search mode** (UI shape unresolved — §5.3), comprising:

1. **Remaster/deluxe/extended/instrumental flagging.** Same regex machinery as compilation detection, new category. Previously rejected as too noisy; unblocked by persistent dismissals (§1.5). Designed collaboratively in GitHub discussions #7/#10.
2. **"Multiple Artists" detector** — feat./ft. terms in artist or title fields (discussion #4; a sketch exists in that thread).
3. **Ampersand-drop grouping** — the Deezer-era artifact where "angus␣␣julia stone" should group with "Angus & Julia Stone". **This is the hard one.** It currently fails because the normalizer maps "&" → "and": one string normalizes to "angus and julia stone", the other to "angus julia stone" — different keys, no card. The fix is normalizing "&"/"and" to *nothing*, so all four spellings (&, and, missing, doubled-space) converge. That is a change to the grouping heart of the tool with real overmerge risk ("X and Y" as a distinct band name vs. "XY"); it must be tested against real libraries via the merge contract before shipping. Medium effort, not a regex tweak.

   **Do not conflate this with discussion #10.** An earlier revision of this document filed the reported `9th & Hennepin` / `9th and Hennepin` case here, under "the hard one." That was wrong. Hennepin is a *track*, and the track normalizer has no `&` rule of any kind — so the reported miss is the plain `&`↔`and` gap, a one-line fix already scoped into v0.6.1 (§4.1 item 5). The ampersand-*drop* case (`angus julia stone`, where the connector is missing entirely) is the genuinely hard problem and stays here. Two different problems that happen to share a character.

Also resolved during scoping: discussion #13 was closed by philosophy (no code needed), and the "AlbumId correctness chip" idea is dead (§1.4).

### 4.3 Reference detection / uniform errors (designed problem, no implementation)

Cross-reference library entities against MusicBrainz to catch uniformly-wrong tags (§3.1), and/or maintain a curated known-gotchas list (*"Heroes"*, *Déjà Vu*, *Frampton Comes Alive!*). Constraints already known: Last.fm MBIDs can't be trusted as the join key (§1.4), so matching must be by normalized name search against MusicBrainz with human confirmation; MusicBrainz API requires a `User-Agent` and has rate limits (1 req/s). Planned research case: The Allman Brothers Band, examining how Last.fm data maps to MusicBrainz release-group vs. specific-release MBIDs. No target version assigned.

**Start from [EXTERNAL-DATA.md](EXTERNAL-DATA.md)**, which holds the entity vocabulary, the release→release-group chain, and two leads that are more promising than anything the normalizers can do by rule: MusicBrainz **artist aliases** (a curated list of known name variants, which would *confirm* variations rather than infer them) and **`release-group.secondary-types`** (authoritative compilation typing). Both were established during earlier research and are easy to rediscover the hard way.

### 4.4 Separate tools (out of SA scope entirely)

- **"Buried Treasure"** — a discovery tool surfacing low-play-count albums; deliberately separate from SA and trusts Last.fm data as-is. Fragmentation detection stays in SA.
- **MCP radio-stations concept** — Apple Music playlists driven by Last.fm history via Claude Desktop. Exploratory.

### 4.5 Dismissal intent: "fixed" vs. "ignored" (scoped and built 2026-09-18; released as v0.7.0)

**The problem.** A dismissal today is one bit: hide this ID for this username, forever. Two incompatible intents share it. The maintainer's original intent was *"I fixed this on Last.fm; hide it so I can see what is left"* — persistence existed so the same file could be reloaded without re-triaging. Other users read the button as *"this is not a problem; never show it again."* Both are legitimate, and the single bit serves the second while silently breaking the first: a track dismissed after a fix that later recurs (the same compilation tag scrobbled again, a re-import with the old spelling) matches the stored ID and is hidden without anyone seeing it. Recurring issues are being missed.

**The decision.** Split dismissal into two intents, with different hiding rules:

| Intent | Button | Hides while | Re-shows when |
|---|---|---|---|
| **Fixed** | `✓ Fixed` | the item is unchanged from when it was marked | new plays appear under the flagged name, or a variation group's membership changes — tagged **recurred** |
| **Ignored** | `🚫 Ignore` | always | never (restore only) |

Restore (`↩️`) works on both, as today.

**The count rule, and why it is a count and not presence.** The tempting rule for *fixed* is "hide until the ID disappears from an export, then show it if it ever comes back." That breaks in the ordinary workflow: mark fixed, re-export before the Last.fm edit has reached lastfmstats.com, and the item is still in the file — it would un-hide immediately, and the user would have to dismiss it twice. Comparing **play counts** instead keeps it hidden until there are genuinely new scrobbles under the bad name. It also keeps reloading the *same* file safe, which was the original reason for persistence.

What is stored per ID:

- **Per-track items** (missing-album and compilation rows): the row's own play count. Recurrence = current count exceeds the stored count. This is exact; nothing but a new scrobble under that album can raise it.
- **Card-level items** (artist/album/track variation cards, invisible-character cards): a map of `{ member name → play count }` for every row on the card. Recurrence = any member's count exceeds its stored count, **or** a member appears that was not stored. Known tradeoff, accepted: if the user marks fixed, keeps listening to the *correct* spelling, and re-exports before the edit propagated, the winner's count has grown and the card recurs once — one click to re-mark it, and the re-mark stamps fresh counts. The alternative — compare only the non-winning members — was rejected because the tool does not know which spelling the user chose as the winner; guessing the top-count member misses the case where the correct spelling was the minority, and that miss is silent and permanent. A false recurrence costs a click; a missed one costs the thing this feature exists for.

**Legacy dismissals become "fixed" with no baseline.** Every ID stored by the current format migrates to `fixed` with an empty count (per-track: 0; card: empty member map). Consequence: anything legacy-dismissed that is *still present* in the next export recurs once, tagged, with both buttons offered. This is the intended behaviour, not a side effect, and it is why the maintainer chose fixed over ignored as the legacy default:

- Items that were genuinely fixed are absent from the export and never show. No noise from them.
- Items still present either recurred, were never actually fixed, or were meant as "ignore." All three need one human decision, and the tagged card asks for exactly that.
- Users who meant "ignore" confirm it once. Users who need to fix each recurrence see it, which they cannot today.

Rejected alternative: migrate legacy IDs as fixed but stamp a baseline count from the first export loaded after the upgrade. Gentler, but it swallows every recurrence that happened *before* the upgrade — the opposite of "seen at least once by everyone."

**Storage format.** Today: `{ dismissed: [id, …], savedAt }`. New:

```
{ version: 2,
  items: { "<id>": { intent: "fixed" | "ignored",
                     count: <number>            // per-track items
                     members: { name: count }   // card-level items
                     at: <ms timestamp>,
                     legacy: true               // only on migrated entries; dropped on re-mark
                   }, … },
  savedAt }
```

Migration runs in `loadDismissedState`: a blob with `dismissed` and no `items` is converted in memory and written back in the new format on the next save. IDs themselves are unchanged (§1.5 — name-based, keyed by username), so nothing about `getIssueId` / `getItemId` moves.

**The status function is the testable core.** One pure, top-level function — same 8-space-indented, top-level discipline as the normalizers (§4.1.1), so `tests/merge-contract.js` can read it live:

```
dismissalStatus(record | undefined, current)  →  'active' | 'hidden' | 'recurred'
```

where `current` is a count (per-track) or a member map (card). Everything else — hiding, counts, the recurred tag, the report markers — is a consumer of that one answer. The contract gets a `DISMISSAL_EXPECT` table: no record → active; ignored → hidden regardless; fixed + equal counts → hidden; fixed + higher count → recurred; fixed card + same members and counts → hidden; fixed card + new member → recurred; fixed card + winner grew → recurred (the accepted tradeoff, pinned so it is deliberate); legacy fixed + anything present → recurred; legacy fixed + absent → nothing to evaluate.

**UI.**

- Card footer: `✓ Fixed` and `🚫 Ignore` replace `✓ Dismiss`. Per-track rows get the same pair in the small style. Compilation cards' *Dismiss all* (built 2026-09-18) becomes `✓ Fixed all N` and `🚫 Ignore all N`; missing-album cards stay per-track only, by decision — each missing album is its own lookup, there is nothing to resolve in bulk.
- A recurred card carries a line that says why it is back: *"↻ Marked fixed 12 Aug 2026 at 5 plays — 3 new plays since."* For legacy: *"↻ Dismissed before v0.7 — fixed, or ignore from now on?"* Without that line a reappearance looks like the tool forgot, which is the confusion this feature exists to remove.
- The *View dismissed only* checkbox becomes a three-way filter: Active (default; includes recurred) / Fixed / Ignored. The sidebar dismissed count splits accordingly.
- Report: `[FIXED]` / `[IGNORED]` replace `[DISMISSED]`; recurred items get `[RECURRED]` in the active section.

**Build phases, each leaving main working.** Stop at any boundary.

1. Storage v2, migration, `dismissalStatus`, contract cases. No visible change — the UI keeps treating both intents as hidden until phase 2, so legacy users see nothing new yet.
2. Buttons, the recurred tag, report markers. This is the phase where legacy dismissals surface once.
3. Three-way filter and split sidebar counts.
4. Browser verification against a real export with a pre-seeded v1 `localStorage` blob (migration path), plus a v2 blob (steady state). Then What's New and the version bump — release framing is open question §5.6.

**Phase 1 as built (2026-09-18).** Storage v2, both migrations, `dismissalStatus`, and 18 contract cases (`DISMISSAL_EXPECT`, `MIGRATION_EXPECT`). `state.dismissedIds` (a Set) became `state.dismissals` (the `items` map); every reader goes through `isDismissed(id)` and every writer through `markDismissed(id, current)` / `unmarkDismissed(id)`, with `currentBaseline(issue, itemId?)` producing the count or member map from an issue's rows. Decisions the scope above left open, settled during the build:

- **The existing Dismiss button already stores a real baseline.** Anything dismissed on a phase-1 build is a normal `fixed` record, not a legacy one, so it will not surface spuriously when phase 2 lands. This is why the count extractor is phase-1 work even though nothing reads the counts yet.
- **Legacy records carry neither `count` nor `members`.** Migration runs in `loadDismissedState`, before detection, and cannot know whether an ID is a row or a card. `dismissalStatus` decides by the `legacy` flag alone, so the "0 / empty map" wording above is realized as "absent"; equivalent, simpler.
- **The pre-v0.6.0 file-hash migration (`migrateOldDismissals`) also writes legacy records**, so v0 → v2 behaves the same as v1 → v2. `at` on migrated entries is the old blob's `savedAt`.
- **The v2 blob keeps a `dismissed: [ids]` shadow array** alongside `items`, so opening a pre-split build of the tool still shows these dismissals rather than losing them. Costs a few bytes; drop it once the split has shipped. Migration detects v1 by the *absence* of `items`, so the shadow does not confuse it.
- **Two card cases the table above implied but did not state are pinned:** a member that disappears (with the rest unchanged) stays hidden — that is the fix landing; a member that disappears while the winner grows recurs.
- ~~`ignored` has no write path yet.~~ Phase 2 added the buttons.

**Phase 2 as built (2026-09-18).** The UI now reads status, never presence: `cardStatus(issue, id)` and `itemStatus(id, row)` wrap `dismissalStatus` with the live baseline, and every reader that used to ask `isDismissed(id)` asks for `'hidden'` instead (the only presence checks left are in the pre-v0.6.0 file-hash migration, where presence is the right question). A recurred item is active everywhere — counts, the default view, the report's active section. Buttons, tags and markers are as specified above, with these details settled during the build:

- **The recurred line's wording.** Per-track: *"↻ Marked fixed 12 Aug 2026 at 5 plays — 3 new plays since."* Card: *"↻ Marked fixed 12 Aug 2026 — 3 new plays and 1 new spelling since."* (one or both parts, whichever apply). The measurement is `recurrenceDelta(record, current)`, top-level and pinned in the contract (`DELTA_EXPECT`): growth in stored members plus the list of unstored spellings; a member that shrank or vanished contributes nothing. Track rows carry a short inline form (*"↻ 2 new plays since marked fixed"*).
- **Legacy wording** — *"↻ Dismissed before v0.7 — fixed, or ignore from now on?"* — as specified, once §5.6 settled the release number. (It was version-neutral for the day between the phase 2 build and that decision.)
- **Re-marking a recurred item.** Fixed or Ignore on a recurred item writes a fresh record (new baseline, no `legacy` flag) and it hides. There is no Restore on a recurred item; it is already visible, and Restore would only discard the baseline.
- **Ignore also stores a baseline.** Nothing reads it, but keeping the record shape uniform costs nothing and leaves the door open to switching an item's intent later without losing the count.
- **"Fixed all N" / "Ignore all N"** on a compilation card mark only the rows currently showing (active and recurred), never rows already hidden under the other intent.
- **Per-item card descriptions** name the split: *"3 tracks remaining (1 recurred, 2 fixed, 1 ignored)"*, parts omitted when zero. Hidden cards in the dismissed view are tagged *(fixed)* or *(ignored)* in the title.
- **Report.** `[FIXED]` / `[IGNORED]` on hidden items when included; `[RECURRED]` on recurred items always, followed by the recurred line indented under the item. The report header explains the tags.
- ~~**Sidebar** still says *View dismissed only (N)*~~ — replaced in phase 3.

**Phase 3 as built (2026-09-18).** The checkbox became a three-button switch under the issue-type nav — **Active / Fixed / Ignored**, each with its count — and `state.showDismissed` became `state.view`. One predicate, `inView(view, status, record)`, answers whether an item belongs in the current view: Active is everything not hidden (recurred included); Fixed and Ignored are hidden items of that intent. Cards, rows, the results count, per-item descriptions (*"2 fixed tracks"*), and the compilation Restore-all button all consult it.

- **Active carries a count too**, the same number as *All Issues*. Redundant on its own, but with it the three add up to everything flagged, which is the honest picture of what the tool found.
- **Restore all is view-scoped.** In the Fixed view it restores that card's fixed rows and leaves its ignored rows hidden, and vice versa. Same rule as Fixed all / Ignore all in the Active view: bulk actions touch only rows currently showing.
- **A new import resets to Active**, as the old checkbox reset to unchecked.
- The export checkbox (*Include dismissed items*) is unchanged; it includes both intents.

**Phase 4 as built (2026-09-18).** Verified in Chrome against the maintainer's own export (161,352 scrobbles; 2,169 issue cards; 5,290 flagged items):

- *Migration path.* A v1 blob of 15 real IDs (two each of artist, album and track cards, one invisible card, two rows each from a missing and a compilation card, plus one ID no longer in the export) loaded as 15 legacy records; the 14 present ones recurred with the legacy line, the absent one was never evaluated, and the blob stayed v1 on disk until the first save. Re-marking (one through a real button click, the rest through the same helpers) wrote v2 with real baselines, the stale ID still legacy.
- *Steady state.* Re-importing the same file against the v2 blob: every unchanged fixed and ignored item stayed hidden, no spurious recurrence.
- *Recurrence.* Lowering one card member's stored count by 5 and one row's by 1, then re-importing: exactly those two recurred, the card reading *"↻ Marked fixed Sep 18, 2026 — 5 new plays since."*
- *Cost.* With 2,169 cards, `renderIssues` took 23 ms and `updateCounts` 8 ms including every status check. Analysis itself finished in about 2 s.
- *One trap for whoever tests this next:* the analysis pipeline sleeps between stages with `setTimeout`, which Chrome throttles to once a second in a hidden tab and to once a minute after five minutes hidden. A background tab therefore looks frozen at *Finalizing…* for minutes. It is not the app; foreground the tab, or stub `sleep` for the test.

---

### 4.6 Approved review plan — import and identity foundations (phase 1, v0.8.0)

Approved 2026-10-11 after a code and interface review. Priorities: desktop usability, variation discovery, correction suggestions and memory of prior corrections. Supported inputs are **complete lastfmstats.com exports**; mobile layout is lower priority. The single-file architecture, separate normalizers, ignored AlbumId and human-led correction workflow remain requirements.

Phase 1 implementation:

- Parse the entire CSV stream with quoted delimiters, escaped quotes and embedded line breaks. Preserve raw metadata, including leading/trailing whitespace. Require Artist, Album, Track and Date columns, a Date#username account identity, consistent field counts and numeric millisecond timestamps. These checks validate the format; the CSV has no manifest that can prove an export is complete.
- Use JSON tuples for internal compound keys and null-prototype name dictionaries. Literal `|||`, `constructor` and `__proto__` are ordinary metadata.
- Use `issue-v3-` IDs containing encoded name tuples. Variation IDs remain stable when play-count order changes. Invisible album and track cards cannot share an ID. Per-track IDs preserve the exact spelling.
- Store dismissal blobs as version 3. Resolve v1/v2 IDs against the entire current issue set, including previous display winners. Migrate only unambiguous decisions and translate old member baselines where possible. Retain unmatched records for later exports. Quarantine ambiguous legacy records permanently and show affected findings for review, rather than guessing which sibling was dismissed. Existing v3 decisions take precedence. A fixed card with an irrecoverably overwritten baseline recurs with an explanation.
- Keep each import's data local until analysis finishes. Only the most recent import may commit results or report an error. Storage failures leave analysis and session decisions usable; unreadable existing data is not overwritten. Old file-hash keys are removed only after a successful save.

Validation: `node tests/merge-contract.js` (125 assertions) and `node tests/import-identity-contract.js` (23 regression scenarios, extracting shipped functions). The new cases were run against the old code first and reproduced the defects. The October 2 maintainer export still parses as 162,915 scrobbles, with 2,089 cards / 5,098 findings and **zero duplicate new IDs**. The one added card is the trailing NBSP artist variation previously erased by parsing. A synthetic legacy migration covering all current findings preserves 5,096 hidden decisions and leaves the two Marillion rows sharing one old key active; their original decision is retained as ambiguous. No listening-history fixtures are committed.

Phase 2 is implemented in §4.7, phase 3 in §4.8 and phase 4 in §4.9. Browser verification and release documentation are recorded in §4.10. Future normalizer changes must validate identity migration because IDs now use grouping keys; §5.1's historical measurement is not evidence for this new scheme. Maintainer verification in leading browsers is recorded in §4.10.

### 4.7 Approved review plan — correction memory and recurrence (phase 2, v0.8.0)

Authorized 2026-10-11 as the next reviewable chunk. This supersedes §4.5's mark-time-count-only rule and the accepted false recurrence from continued listening to the kept spelling **when the user explicitly identifies that spelling**. Detection remains advisory; no Last.fm data is changed.

- **Optional correction choices.** Artist, album, track and invisible-character cards offer “Spelling kept on Last.fm”; no winner is selected from play counts. Choose an existing raw member or enter another spelling with its artist context. Missing-album and compilation rows offer an optional album field under “Remember album correction”. Choices save when marking Fixed, appear on future findings and in reports, and remain remembered after Restore. Clearing the choice when marking Fixed forgets it. Ignore does not replace a remembered choice. Invisible whitespace is exposed in option labels while values preserve exact names.
- **Full-library observations.** Fixed records are observed against exact metadata counts throughout the complete export, regardless of whether their detector emits a card. Keep the original mark-time baseline and a separate lowest observed count for each source member. `10 → 0 → 1` and `10 → 2 → 3` recur; unchanged re-exports stay hidden. A chosen kept member is excluded from recurrence and delta calculations. Without a choice, all members remain monitored. New spellings still recur. Ignored, baseline-less legacy and ambiguous records are not assigned invented observation history.
- **Recurrence below thresholds.** Previously fixed problems that recur are reconstructed under their existing name-based IDs even when they are now a single spelling or have too few plays for normal discovery. Existing detector cards and rows take precedence. A previously removed or reduced count gets an explicit explanation, rather than claiming growth above the original mark-time count.
- **Snapshot ordering.** Storage v4 adds per-account `corrections` and `lastObservation`. The newest scrobble timestamp orders exports with new listening; file modification time breaks ties for metadata-only re-exports. Identical contents may be reloaded without moving the watermark backward. A smaller newest-play timestamp, or equal newest-play time with changed contents and an earlier/equal/missing file time, opens in **review only**: no new recurrence observations, no decision changes, no persistence writes. Stored decisions are still available for inspection and report export. An ordinary first v1/v2/v3 import establishes the watermark; prior versions contain no export chronology to recover.
- **Ordering limits.** The CSV does not carry an authoritative export-generation timestamp. Copying or touching an older file can defeat the metadata-only tie-breaker; deleting the newest scrobble can make a genuinely newer file appear historical. The conservative rule avoids silently lowering baselines from a known older export, but cannot prove chronology or completeness. Use fresh, complete exports and retain their original file times. An explicit “use this as my latest complete export” override remains a possible follow-up if this restriction proves inconvenient.
- **Re-marking.** Fixed stamps a new original baseline and clears previous low-water history. Restore discards the dismissal baseline while retaining the optional choice. Account switching separates decisions, choices and export chronology. Storage-read protection from phase 1 also covers invalid or future correction/history formats.

Validation: `node tests/recurrence-contract.js` adds 16 scenarios for disappearance, partial correction, selected-spelling growth, below-threshold recurrence, raw artist context, compilation album boundaries, ID decoding, snapshot ordering, v4 storage, controls and full import sequences. The 23 import/identity scenarios and 125 existing assertions also pass. The October 2 export still yields 162,915 scrobbles and 2,089 cards. A synthetic stress check marking all 5,098 current findings fixed, with explicit kept choices on variation cards, produces **zero false recurrences** for unchanged data. A full inline-script smoke check with a simulated DOM confirms real-file import, controls rendering, Fixed-view memory, re-import behavior and remembered choices in reports. No listening-history fixtures are committed. These checks do not substitute for browser layout/keyboard verification, which remains in the approved pre-release phase.

### 4.8 Approved review plan — detection precision (phase 3, v0.8.0)

Authorized 2026-10-11 as the next reviewable chunk. The precision rules are described in §1.7 and the case-only exclusion in §3.5. Thresholds, artist normalization, punctuation/diacritic folding, compilation and missing-album detectors are unchanged. No correction is applied to Last.fm.

- **Preserve history when grouping changes.** IDs still use `issue-v3-` and storage remains v4. Decisions and correction choices gain a separate `normalizationVersion: 2`. Recompute album/track destinations from every saved raw member, independent of the current export or detector thresholds. A single unambiguous destination moves the decision, mark-time baseline, observed low counts and choice together. Fixed choices retain `sourceMembers`, allowing remembered choices to follow a key move after Restore. Baseline-less legacy records and old restored choices without source names remain recoverable without guessing their original scope.
- **Split and conflicting groups require review.** Keep original records and choices quarantined when members now belong to multiple groups, or several old decisions converge on one new key. Do not copy a broad Fixed/Ignore decision into its children. Even when the old ID happens to name a current child, an ambiguous record cannot hide it. A fresh decision under the new rules wins over old sources. Show migration warnings only while affected current findings are available to review; retain vanished/singleton history silently.
- **Distinguish detection changes from new listening.** The first accepted observation after upgrading a fixed group checks for additional pre-existing spellings. If present, the card explains that refined detection expanded the group and asks for review; reports use `[REVIEW]`. An unchanged upgrade clears its transition marker, so subsequent count growth uses ordinary recurrence behavior. Re-marking establishes a fresh baseline and resolves that review. Older exports still cannot persist migration results or update recurrence history.

Validation: `node tests/merge-contract.js` passes **155 assertions**; `node tests/detection-contract.js` passes **15 scenarios** covering detector exclusions, meaningful/nested labels, recurrence, key moves, split/converging histories, deliberate fresh decisions, restored memory, actionable warnings and upgrade review notes. The **23 import/identity** and **16 recurrence/correction** scenarios also pass. New merge cases first reproduced 22 failures against the previous code. The two documented typo misses remain outside this chunk.

The October 2 maintainer export still parses as **162,915 scrobbles**, now yielding **2,113 cards / 5,122 findings**, compared with 2,089 / 5,098 before phase 3. There are 45 new card IDs and 21 removed IDs, including 11 case-only cards; several broad old groups split rather than disappear as problems. Newly matched variations chiefly preserve meaningful title parentheses alongside live/remaster labels and handle nested metadata correctly. Artist (52), missing-album (389), compilation (352) and invisible-character (6) card counts are unchanged; album cards change 104 → 93 and track cards 1,186 → 1,221. IDs remain unique.

A synthetic upgrade using the real export preserves all **5,098 saved decisions** and **1,348 correction choices**. Four expanded groups ask for review without claiming new plays; 14 split histories are retained as ambiguous, of which eight have current findings requiring review. A full inline-script simulated-DOM check covers import, rendered review explanations, four `[REVIEW]` report tags and zero false `[RECURRED]` tags, stable re-import and unchanged storage after loading the older September export. Listening-history fixtures remain local and uncommitted. Browser layout and keyboard verification remain part of the approved pre-release phase; these checks do not substitute for them.

### 4.9 Approved review plan — desktop triage and album evidence (phase 4, v0.8.0)

Authorized 2026-10-11 after committing phase 3. The single-file architecture and advisory correction workflow remain unchanged.

- **Every card is reachable.** Previous/Next controls above and below the results page through 100 cards at a time. The subtitle distinguishes findings from cards and states the visible card range. Missing-album and compilation tracks count as separate findings; variation cards count as one. Filter, search, view and sort changes restart at the first page. Dismissal clamps the page when the last card disappears. Reports still cover the full library, independent of paging or search.
- **Search and impact reflect the rows shown.** View membership is evaluated before search, so a hidden track cannot make an active card match. On missing-album/compilation cards, a track or remembered-album query narrows rows; an artist/source-album query keeps all rows in the current view. Ordinary variation searches retain siblings for comparison. Impact and variation sorting use visible rows, with deterministic title/ID ties. Artist filtering recognizes any member of an artist-variation card, and the dropdown includes those raw aliases. Compilation bulk actions affect only the rows currently shown by the query and view.
- **Bring follow-ups forward.** “Follow-ups only (Active)” narrows to returned Fixed findings and current groups affected by quarantined decisions. “Follow-ups first” sorts them ahead of ordinary findings. The restriction is disabled in Fixed/Ignored views without discarding the preference. A deliberate decision under the current grouping rules resolves old-source follow-up status; restored choices retain that resolution. Changed child cards explain why the prior decision needs review, and ambiguous remembered choices are labeled for review.
- **Use local album evidence conservatively.** Build an in-memory index keyed by exact raw `[artist, track]`. Suggest nonempty albums with plays of that exact artist and track, excluding the current source album and albums matching the existing compilation heuristic. The compilation predicate was extracted unchanged and cached by raw album name; detector behavior is preserved. Do not fold titles, pool artist aliases, combine album editions or use AlbumId. This deliberately avoids using a live/remaster/cover spelling as evidence for another recording.
- **Prior choices are evidence too.** Remembered album choices for missing-album/compilation rows are indexed by their exact artist and track even if their old source no longer appears. Deduplicate the same album across sources and rank prior choices before play-count evidence. Multiple different choices remain visible; none is selected automatically. Skip ambiguous memory and mismatched artist contexts. Each candidate shows exact-track play counts and/or prior-choice provenance, its raw spelling with invisible whitespace exposed, and a Last.fm album link. “Use this album” copies the exact name into the optional field and focuses it; Fixed is still required to save. Choices never change Last.fm data.
- **Keyboard and draft continuity.** Cards have native Show/Hide details buttons with `aria-expanded`, linked hidden panels and expansion memory across re-renders. Upload and category controls support Enter/Space; view controls expose their selected state, and search/filter/sort and row actions have accessible labels. Focus is retained on a surviving row/card or moved to the next card (or results status when empty). Row actions now re-render from actual counts instead of parsing displayed text or updating cards with animation. Draft correction fields and open album controls survive paging, filtering and other actions within an import; acted-on drafts are cleared and successful imports clear all drafts and expansion memory. Drafts are not persisted as correction choices.
- **Attribute escaping fix.** The shared HTML helper now escapes quotes as well as markup characters. The previous text-node `innerHTML` technique left quotes unescaped in input values, titles and other attributes. A new regression reproduced that behavior before the fix and pins malicious attribute-shaped metadata as inert escaped text.
- **Follow-up migration fix.** A fresh Ignore on a split child must prevail even if Ignore retained an ambiguous old choice. Migration now checks the deliberate current decision before processing old choice ambiguity, using the same resolution predicate as follow-up triage. A regression reproduced the prior re-import incorrectly reopening the ignored child; its decision now remains hidden while the old choice remains recoverable.

Validation: **155 merge assertions**, **23 import/identity**, **16 recurrence/correction**, **16 detection/migration** and **26 triage/evidence scenarios** pass. Triage checks exercise row/view search, visible impact, every page, page clamping and navigation focus, exact evidence isolation, cross-source remembered choices, compilation exclusions, raw Unicode/delimiter names, details state, draft round-trips, shipped render callbacks for row/bulk actions and candidate use, and attribute escaping. No dependencies or listening-history fixtures are added.

A full inline-script simulated-DOM run with the October 2 export preserves **162,915 scrobbles, 2,113 cards and 5,122 findings**. All 2,113 unique cards are reached across **22 pages**; the last page renders 13 cards. Album evidence is available for **1,813 of 3,750** per-track findings: **1,300 of 2,483** missing-album rows and **513 of 1,267** compilation rows, yielding 2,417 distinct candidate options (maximum seven on one row). These are evidence coverage counts, not verified corrections. The prior full-import stress check still preserves 5,098 decisions and 1,348 choices, four grouping-review report tags and zero false repeat-play tags, with stable re-import and historical-export write protection. Browser layout, native keyboard/focus behavior and leading-browser compatibility remain pending in the approved pre-release phase.

Candidate limits: absent exact-track evidence is left for manual research; a matching album may itself be mistagged, and the compilation heuristic can exclude legitimate albums. Play counts describe listening, not correctness or original-release provenance. External catalog verification and similarity matching are outside this chunk.

### 4.10 v0.8.0 — review release (phase 5)

Approved 2026-10-11: finish and release the current review work before examining direct library retrieval further. The maintainer selected **v0.8.0**, moving the planned pattern-detector release to **v0.9.0**. This release adds correction memory and changes saved-history handling as well as desktop triage; it is a minor release, not a normalization-only patch.

The in-file version, What's New, README, contributor instructions and [release notes](releases/v0.8.0.md) describe the final scope. Export instructions now explain lastfmstats' per-account Database → Remove from database control and the need for a completed full retrieval after historical edits. There is no new cache-detection heuristic or direct retrieval in this release.

**Browser verification (2026-10-12):** the maintainer reported checking the page in Chrome, Firefox and Safari and noticing no issues, in response to [the manual checklist](releases/v0.8.0-checklist.md). Individual checklist-step outcomes were not separately logged. This is maintainer verification, not automated browser coverage: the browser tool previously rejected opening the local HTML file. All five contracts pass again. The question about album suggestions was checked against the real export in the full-source simulated DOM: compilation candidate text and Use controls render; suggestions are supported for both missing-album and compilation rows, inside Remember album correction, only with exact artist/track evidence or saved choices. No behavior change was needed. Preserve the feature-branch commits with a merge commit when publishing v0.8.0.

Direct retrieval and correction verification remain a separate post-release proposal. There is a new workflow argument for reconsidering §1.1: detecting historical changes made on Last.fm without requiring a prior Fixed action. No API implementation or architecture change is authorized as part of v0.8.0.

## 5. Open questions — flag these to the maintainer, don't guess

1. ~~**Dismissal ID stability across normalization changes.**~~ **RESOLVED 2026-08-01 — no migration needed.** `getIssueId()` (`index.html:1133`) derives from `issue.title`, which is the **raw display name of the highest-count member** of a group, not a normalized key. So normalizer changes orphan a dismissal only when they change *which member ranks first*. Measured across the full combined v0.6.1 change set on the issue-#11 export: **0 of 76** previously-flagged artist members change their top name, **2 of 878** track members do, and no previously-flagged group stops being flagged. The risk is negligible and v0.6.1 is unblocked on this question.
2. ~~**Test data access.**~~ **RESOLVED.** `lastfmstats-Maeldun.zip` is attached to issue #11, downloads without authentication, and contains 380,877 scrobbles. The reporter supplied it explicitly for debugging. Fine for local validation — but it is a real person's complete listening history: do not commit it to the repo, redistribute it, or paste excerpts of it into public issues beyond the cases the reporter already published themselves.
3. **v0.9 pattern-mode UI.** Checkbox within existing views vs. a separate tab. Explicitly undecided.
4. ~~**Diacritic folding philosophy.**~~ **RESOLVED 2026-08-01.** Yes — diacritics follow the same model as smart quotes: fold for *grouping*, preserve originals for *display*, human picks the winner. The concern that a card might imply the ASCII form is "correct" turned out to be unfounded on inspection: the card body is strictly neutral (name, count, Last.fm link, no badge), and the Google lookup asks `Is the correct spelling "X" or "Y"…` rather than asserting. A Motörhead card is just an ordinary variation card.

   The one place the tool *could* editorialize is the chips — and the governing principle there is §1.9: **chips mark invisibility, not incorrectness.** That reframes the question from "should diacritics be chipped?" (wrong question — it treats a character class as the criterion) to "can the user see this difference?". `Motörhead` vs `Motorhead`: yes, no chip. `Subcarpați` vs `Subcarpaţi`: no, chip it. See §4.1.2, which makes the confusable-character chip a hard dependency of shipping folding.
5. **Ampersand-drop overmerge risk.** No acceptance criteria yet for what real-library overmerge rate is tolerable. Define via merge-contract cases before implementing.
6. ~~**Release framing for the dismissal split (§4.5).**~~ **RESOLVED 2026-09-18 — its own minor release, v0.7.0.** The maintainer judged it significant enough to take the number on its own; the pattern-detector release becomes v0.8.0 (§4.2). The reasoning stands as written: it changes stored data and what users see on first load, so it is not a patch.

---

## 6. Working style notes (for an AI agent)

The maintainer reviews in testable chunks, wants tradeoffs explained *before* code is written, does not want scope built until explicitly agreed, and is learning Git/GitHub and API workflows deliberately — explain the "why" of process steps, don't just execute them. Community input arrives via GitHub issues/discussions and r/lastfm; several roadmap items originated there and the issue numbers above are the source of truth for their details.
