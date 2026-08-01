# Scrobble Analyzer — Design Rationale & Project History

Companion to CLAUDE.md. This is the "why" that isn't visible from the source: decisions made, alternatives rejected, current state, roadmap, and open questions. Written for a technical reader or AI coding agent picking the project up cold.

---

## 1. Key design decisions and their reasoning

### 1.1 File-export analysis, not live API sync

The tool analyzes a CSV export (lastfmstats.com format) rather than syncing against the Last.fm API. Rejected alternative: real-time API integration. Reasoning: the correction workflow is inherently batch-shaped (export → triage → fix on Last.fm → re-export), Last.fm provides **no API for editing scrobbles** anyway (corrections are website-UI-only), and API sync would add auth, rate limits, and a server dependency for zero workflow gain. This decision is settled; don't reopen it without a workflow argument, not a technical one.

### 1.2 Single-file HTML, no build step

Deliberate. The audience includes non-developers on r/lastfm who download one file and double-click it. Every dependency is a distribution and trust cost. Rejected: any bundler/framework. The cost we accept is a large single file; the mitigation is disciplined internal organization, not tooling.

### 1.3 "Flag, human decides" — no auto-correction

A community survey showed users want to research and decide for themselves; compilation handling in particular proved more controversial than expected (some users *want* compilation scrobbles as-is). The tool's contract is detection + evidence, never mutation. This also sidesteps liability for wrong merges — a false flag is an annoyance, a false auto-merge is data corruption.

### 1.4 MBIDs are hints, not facts — `AlbumId` is ignored

Established empirically during v0.6.0 testing. Case study: "The Cream of Clapton" (1995 compilation) rows carried an AlbumId resolving in MusicBrainz to "The Cream of Eric Clapton" (1987 UK release, MBID `01e7ce7d-8752-4887-990a-834d5c8e13d3`) — an entirely different album. Verified via a live MusicBrainz call (`GET /ws/2/release/{id}?inc=artist-credits+release-groups&fmt=json`, `User-Agent` header required). This **killed a proposed v0.7 feature** that would have used AlbumId as a correctness signal (a "verified" chip). Any future MusicBrainz integration must treat Last.fm-supplied MBIDs as leads to verify, never as ground truth.

### 1.5 Persistent dismissals keyed by username + name-based IDs

Shipped in v0.6.0. Two coupled decisions:

- **Keying by Last.fm username** (parsed from the `Date#username` CSV header) rather than file hash. Rejected alternative: file-hash keys — they broke on every re-export, defeating persistence. Migration from the old file-hash scheme is in place.
- **Name-based item IDs** rather than index-based. Indexes shift when the export changes; names don't (mostly — see open question 5.1).

Strategic consequence: persistent dismissals **unlock detection categories that were previously too noisy**. Remaster flagging was rejected pre-v0.6 because users who deliberately listen to remasters would drown in flags; now triage is a one-time cost. "Features unlocking features" — keep this in mind when evaluating noisy-but-useful detector proposals.

### 1.6 Two detector classes: variation vs. pattern

- **Variation detectors** need a disagreement to exist: two spellings clustering to one normalization key. They can never see a *uniform* error (see §3.1).
- **Pattern detectors** match individual entries against regex, no twin required (compilation detection, missing-album detection today; remaster/feat. detection in v0.7).

A third class — **reference detectors**, comparing the library against an external canonical source (MusicBrainz) — is designed but not built (§4.3).

### 1.7 Normalization pipeline choices

**What is actually implemented today** — verified line-by-line against `index.html` on 2026-08-01. An earlier revision of this document (and of CLAUDE.md) described the pipeline inaccurately; this table is the corrected record.

| Step | Artist | Album | Track |
|---|:---:|:---:|:---:|
| lowercase, trim, collapse whitespace | yes | yes | yes |
| NBSP (U+00A0) → space | yes | yes | yes |
| smart quotes U+2018/2019/201C/201D → ASCII | yes | yes | yes |
| strip leading "the" | yes | — | — |
| "&" → "and" | yes | **no** | **no** |
| keyword suffix stripping (remaster/live/…) | — | yes | yes |
| strip punctuation | **no** | **no** | **no** |
| fold diacritics | **no** | **no** | **no** |

Punctuation stripping and diacritic folding are **not implemented anywhere**, and the `&`/`and` rule exists **only on artists**. Earlier drafts claimed punctuation stripping was part of the pipeline; it never was. Several open issues trace directly to these three gaps (§3.3). Each rule that *does* exist was driven by a real user report, not speculation. Two principles worth preserving:

- Normalization changes are the highest-risk edits in the codebase — they silently change what groups with what. Hence the planned merge contract (§4.1).
- The canonical MUST-NOT-merge example: **Elvis Costello vs. Elvis Costello & The Attractions** are different credits, correctly distinct. Any normalization change that merges them is wrong.
- A dormant future guard exists conceptually for title normalization: numeric-punctuation titles like *3.15.20* must not normalize to "31520". Not yet enforced anywhere; encode it in the merge contract when title normalization is touched.

### 1.8 Git/release conventions (and why)

- Branch names describe the work, not the version — a branch named `v0.6.0` collides with the tag `v0.6.0` in Git's ref namespace. Learned the hard way during the v0.6.0 cycle.
- Merge commits over squash: commit granularity is meaningful history for a project reviewed change-by-change.
- Release framing precedent: v0.6.1 is deliberately scoped as "the normalizer now catches what you reported" (bug-fix framing for detection widening), keeping v0.7 as a coherent "new detection categories" story. Strict semver would call detection widening a minor bump; the point-release framing was chosen consciously.

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

**Scoped but not built:**
- Everything in the roadmap (§4). Notably: **no automated tests exist** — no test file has ever been committed to this repo, in any commit in its history. The merge contract (§4.1) is the first planned test infrastructure.
- A throwaway Node harness replicating the three shipped normalizers was written to validate the v0.6.1 scope against a real export (§4.1). It is a *prototype of* the merge contract, not a substitute for it, and was deliberately not checked in.

**Half-designed:**
- Uniform-error / reference detection (§4.3) — problem well understood, no implementation design yet.

---

## 3. Known issues and limitations

### 3.1 The uniform-error blind spot (structural)

Variation detection only sees *splits*. If every scrobble of an entity is consistently wrong the same way (e.g., all of Bowie's *"Heroes"* landing on the unquoted form), there is no variation, nothing clusters, and it stays silently wrong forever. Neither SA's detectors nor Last.fm's server-side alias correction will ever flag it. Fixing this requires a different signal — external cross-reference (MusicBrainz) or a curated known-gotchas list. This is the motivating problem for reference detectors (§4.3).

### 3.2 Compilation multi-artist fragmentation

Compilations spanning multiple track artists split across Artist values in the export — the album appears fragmented in ways the current grouping can't reunify. Documented blind spot; no fix designed. Maintainer's personal policy (context, not tool behavior): move compilation tracks to their original studio-album homes when a standard release exists.

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

### 3.6 Container punctuation and the limits of suffix stripping

The track/album suffix rule is `\s*[\(\[].*?(keyword…).*?[\)\]]`. The character classes make it *look* like brackets and parentheses are reconciled. They are not. The rule fires only when a **keyword** appears inside; when it fires it deletes the whole parenthetical including its container, and when it doesn't, both containers survive verbatim into the key:

```
"Song [Acoustic]"   vs "Song (Acoustic)"    -> "song" | "song"                           grouped
"Track [Interlude]" vs "Track (Interlude)"  -> "track [interlude]" | "track (interlude)"  NOT grouped
```

There is no code path that treats `[` as equivalent to `(`. Consequence for issue #17: adding `feat`/`ft` to the keyword list fixes that reported pair by deleting both parentheticals, which **sidesteps** the container question rather than answering it. The two changes are independent; both are in v0.6.1 (§4.1 items 2 and 7).

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

### 4.1 v0.6.1 — normalization patch (scoped, not built)

Theme: "the normalizer catches what you reported."

**Scope validated 2026-08-01** against the 380,877-scrobble export attached to issue #11 (§5.2), using a Node harness that replicated the three shipped normalizers verbatim. Baseline on that library, at the thresholds as shipped (artist ≥10 plays, track ≥3): **38 artist issues, 400 track issues**. Each change measured in isolation:

| # | Change | Artist | Track | Closes |
|---|---|:---:|:---:|---|
| 1 | **Merge contract** test file | — | — | build first |
| 2 | `feat`/`ft` added to track suffix keywords | — | **+59** | #17, part of disc. #4 |
| 3 | Punctuation `.` `,` → **space**, all three normalizers | +3 | **+54** | #11 |
| 4 | Diacritic folding (NFD), all three | **+8** | +24 | #14 class |
| 5 | `&` → `and` on track + album normalizers | — | +17 | disc. #10 |
| 6 | Apostrophes U+00B4, U+0060, U+02BC | 0 | +5 | #12 |
| 7 | Bracket/paren container canonicalization | — | +1 | #17 general class |
| 8 | Android file-input `accept` fix | — | — | #5 |
| | **all combined** | **38→49** | **400→561** | |

All 11 new artist groups and the top 40 new track groups were inspected by hand; no false positive was found. Notes:

1. **Merge contract** — a checked-in, Node-runnable test file: MUST-merge pairs, MUST-NOT-merge pairs (Elvis Costello & The Attractions enshrined), documented KNOWN_MISS class, and a dormant title-guard section (*3.15.20* ≠ "31520"). **Build this first**; normalization changes land only after it passes. Nothing of the kind exists yet — see §4.1.1.
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

Scope note: this is Romanian/Turkish cedilla-vs-comma-below in practice, but the rule is written on perceptual grounds rather than per-script so it generalises. It is small — the reveal-chip renderer already exists and is reused. Measurement caveat for whoever picks this up: an early pass put the track-side count at 2, but both were artifacts of a crude heuristic (it tested whether *every row* contained any mark, not whether the *differing* character was mark-vs-mark, so `À Mon Âme` vs `A Mon Âme` was misbinned). Treat the affected population as artist-side only until re-measured with a positional comparison.

### 4.2 v0.7.0 — pattern-detector release (scoped, not built)

An opt-in **pattern search mode** (UI shape unresolved — §5.3), comprising:

1. **Remaster/deluxe/extended/instrumental flagging.** Same regex machinery as compilation detection, new category. Previously rejected as too noisy; unblocked by persistent dismissals (§1.5). Designed collaboratively in GitHub discussions #7/#10.
2. **"Multiple Artists" detector** — feat./ft. terms in artist or title fields (discussion #4; a sketch exists in that thread).
3. **Ampersand-drop grouping** — the Deezer-era artifact where "angus␣␣julia stone" should group with "Angus & Julia Stone". **This is the hard one.** It currently fails because the normalizer maps "&" → "and": one string normalizes to "angus and julia stone", the other to "angus julia stone" — different keys, no card. The fix is normalizing "&"/"and" to *nothing*, so all four spellings (&, and, missing, doubled-space) converge. That is a change to the grouping heart of the tool with real overmerge risk ("X and Y" as a distinct band name vs. "XY"); it must be tested against real libraries via the merge contract before shipping. Medium effort, not a regex tweak.

   **Do not conflate this with discussion #10.** An earlier revision of this document filed the reported `9th & Hennepin` / `9th and Hennepin` case here, under "the hard one." That was wrong. Hennepin is a *track*, and the track normalizer has no `&` rule of any kind — so the reported miss is the plain `&`↔`and` gap, a one-line fix already scoped into v0.6.1 (§4.1 item 5). The ampersand-*drop* case (`angus julia stone`, where the connector is missing entirely) is the genuinely hard problem and stays here. Two different problems that happen to share a character.

Also resolved during scoping: discussion #13 was closed by philosophy (no code needed), and the "AlbumId correctness chip" idea is dead (§1.4).

### 4.3 Reference detection / uniform errors (designed problem, no implementation)

Cross-reference library entities against MusicBrainz to catch uniformly-wrong tags (§3.1), and/or maintain a curated known-gotchas list (*"Heroes"*, *Déjà Vu*, *Frampton Comes Alive!*). Constraints already known: Last.fm MBIDs can't be trusted as the join key (§1.4), so matching must be by normalized name search against MusicBrainz with human confirmation; MusicBrainz API requires a `User-Agent` and has rate limits (1 req/s). Planned research case: The Allman Brothers Band, examining how Last.fm data maps to MusicBrainz release-group vs. specific-release MBIDs. No target version assigned.

### 4.4 Separate tools (out of SA scope entirely)

- **"Buried Treasure"** — a discovery tool surfacing low-play-count albums; deliberately separate from SA and trusts Last.fm data as-is. Fragmentation detection stays in SA.
- **MCP radio-stations concept** — Apple Music playlists driven by Last.fm history via Claude Desktop. Exploratory.

---

## 5. Open questions — flag these to the maintainer, don't guess

1. ~~**Dismissal ID stability across normalization changes.**~~ **RESOLVED 2026-08-01 — no migration needed.** `getIssueId()` (`index.html:1133`) derives from `issue.title`, which is the **raw display name of the highest-count member** of a group, not a normalized key. So normalizer changes orphan a dismissal only when they change *which member ranks first*. Measured across the full combined v0.6.1 change set on the issue-#11 export: **0 of 76** previously-flagged artist members change their top name, **2 of 878** track members do, and no previously-flagged group stops being flagged. The risk is negligible and v0.6.1 is unblocked on this question.
2. ~~**Test data access.**~~ **RESOLVED.** `lastfmstats-Maeldun.zip` is attached to issue #11, downloads without authentication, and contains 380,877 scrobbles. The reporter supplied it explicitly for debugging. Fine for local validation — but it is a real person's complete listening history: do not commit it to the repo, redistribute it, or paste excerpts of it into public issues beyond the cases the reporter already published themselves.
3. **v0.7 pattern-mode UI.** Checkbox within existing views vs. a separate tab. Explicitly undecided.
4. ~~**Diacritic folding philosophy.**~~ **RESOLVED 2026-08-01.** Yes — diacritics follow the same model as smart quotes: fold for *grouping*, preserve originals for *display*, human picks the winner. The concern that a card might imply the ASCII form is "correct" turned out to be unfounded on inspection: the card body is strictly neutral (name, count, Last.fm link, no badge), and the Google lookup asks `Is the correct spelling "X" or "Y"…` rather than asserting. A Motörhead card is just an ordinary variation card.

   The one place the tool *could* editorialize is the chips — and the governing principle there is §1.9: **chips mark invisibility, not incorrectness.** That reframes the question from "should diacritics be chipped?" (wrong question — it treats a character class as the criterion) to "can the user see this difference?". `Motörhead` vs `Motorhead`: yes, no chip. `Subcarpați` vs `Subcarpaţi`: no, chip it. See §4.1.2, which makes the confusable-character chip a hard dependency of shipping folding.
5. **Ampersand-drop overmerge risk.** No acceptance criteria yet for what real-library overmerge rate is tolerable. Define via merge-contract cases before implementing.

---

## 6. Working style notes (for an AI agent)

The maintainer reviews in testable chunks, wants tradeoffs explained *before* code is written, does not want scope built until explicitly agreed, and is learning Git/GitHub and API workflows deliberately — explain the "why" of process steps, don't just execute them. Community input arrives via GitHub issues/discussions and r/lastfm; several roadmap items originated there and the issue numbers above are the source of truth for their details.
