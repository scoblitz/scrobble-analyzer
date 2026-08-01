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

Current normalization for clustering: lowercase, strip leading "the", unify "&"/"and", strip punctuation, smart single/double quotes (U+2018/2019, U+201C/201D) → ASCII. Each addition was driven by a real user report, not speculation. Two principles worth preserving:

- Normalization changes are the highest-risk edits in the codebase — they silently change what groups with what. Hence the planned merge contract (§4.1).
- The canonical MUST-NOT-merge example: **Elvis Costello vs. Elvis Costello & The Attractions** are different credits, correctly distinct. Any normalization change that merges them is wrong.
- A dormant future guard exists conceptually for title normalization: numeric-punctuation titles like *3.15.20* must not normalize to "31520". Not yet enforced anywhere; encode it in the merge contract when title normalization is touched.

### 1.8 Git/release conventions (and why)

- Branch names describe the work, not the version — a branch named `v0.6.0` collides with the tag `v0.6.0` in Git's ref namespace. Learned the hard way during the v0.6.0 cycle.
- Merge commits over squash: commit granularity is meaningful history for a project reviewed change-by-change.
- Release framing precedent: v0.6.1 is deliberately scoped as "the normalizer now catches what you reported" (bug-fix framing for detection widening), keeping v0.7 as a coherent "new detection categories" story. Strict semver would call detection widening a minor bump; the point-release framing was chosen consciously.

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
- Everything in the roadmap (§4). Notably: **no automated tests exist**. The merge contract is the first planned test infrastructure.

**Half-designed:**
- Uniform-error / reference detection (§4.3) — problem well understood, no implementation design yet.

---

## 3. Known issues and limitations

### 3.1 The uniform-error blind spot (structural)

Variation detection only sees *splits*. If every scrobble of an entity is consistently wrong the same way (e.g., all of Bowie's *"Heroes"* landing on the unquoted form), there is no variation, nothing clusters, and it stays silently wrong forever. Neither SA's detectors nor Last.fm's server-side alias correction will ever flag it. Fixing this requires a different signal — external cross-reference (MusicBrainz) or a curated known-gotchas list. This is the motivating problem for reference detectors (§4.3).

### 3.2 Compilation multi-artist fragmentation

Compilations spanning multiple track artists split across Artist values in the export — the album appears fragmented in ways the current grouping can't reunify. Documented blind spot; no fix designed. Maintainer's personal policy (context, not tool behavior): move compilation tracks to their original studio-album homes when a standard release exists.

### 3.3 Known normalization misses (user-reported, targeted by v0.6.1)

- Diacritics not folded: Motörhead vs. Motorhead don't cluster (issue #14)
- Artist punctuation variants: "Albert Hammond, Jr." vs. "Albert Hammond Jr" not flagged (issue #11 — has a real user export attached for testing)
- Extended apostrophe variants beyond smart quotes: U+00B4 acute accent, U+0060 backtick, U+02BC modifier-letter apostrophe (issue #12)
- A suspected additional bug in discussion #10 (verify against the attached export)

### 3.4 Platform

- Android file picker blocks CSV selection on Pixel devices (issue #5) — believed to be a one-line file-input `accept` attribute fix.

### 3.5 Case correction is out of scope by physics

Last.fm normalizes case to its catalog entry server-side; nothing SA flags about pure case will be user-fixable. Keep case-only differences from generating flags.

---

## 4. Roadmap

### 4.1 v0.6.1 — normalization patch (scoped, not built)

Theme: "the normalizer catches what you reported." Contents:

1. **Merge contract** — a checked-in, Node-runnable test file: MUST-merge pairs, MUST-NOT-merge pairs (Elvis Costello & The Attractions enshrined), documented KNOWN_MISS class, and a dormant title-guard section (*3.15.20* ≠ "31520"). **Build this first**; normalization changes land only after it passes.
2. **Artist punctuation fix** — comma → space, period → removal (issue #11).
3. **Apostrophe variants** — add U+00B4, U+0060, U+02BC to the smart-quote class in the artist/album/track normalizers (issue #12). Decision made to ride along in v0.6.1 rather than wait for v0.7.
4. **Diacritic folding** (issue #14) — pending the philosophy question in §5.4.
5. **Android file input fix** (issue #5).

Validation: run against the real user export attached to issue #11 ("Maeldun's export" — see §5.2).

### 4.2 v0.7.0 — pattern-detector release (scoped, not built)

An opt-in **pattern search mode** (UI shape unresolved — §5.3), comprising:

1. **Remaster/deluxe/extended/instrumental flagging.** Same regex machinery as compilation detection, new category. Previously rejected as too noisy; unblocked by persistent dismissals (§1.5). Designed collaboratively in GitHub discussions #7/#10.
2. **"Multiple Artists" detector** — feat./ft. terms in artist or title fields (discussion #4; a sketch exists in that thread).
3. **Ampersand-drop grouping** — the Deezer-era artifact where "angus␣␣julia stone" should group with "Angus & Julia Stone". **This is the hard one.** It currently fails because the normalizer maps "&" → "and": one string normalizes to "angus and julia stone", the other to "angus julia stone" — different keys, no card. The fix is normalizing "&"/"and" to *nothing*, so all four spellings (&, and, missing, doubled-space) converge. That is a change to the grouping heart of the tool with real overmerge risk ("X and Y" as a distinct band name vs. "XY"); it must be tested against real libraries via the merge contract before shipping. Medium effort, not a regex tweak.

Also resolved during scoping: discussion #13 was closed by philosophy (no code needed), and the "AlbumId correctness chip" idea is dead (§1.4).

### 4.3 Reference detection / uniform errors (designed problem, no implementation)

Cross-reference library entities against MusicBrainz to catch uniformly-wrong tags (§3.1), and/or maintain a curated known-gotchas list (*"Heroes"*, *Déjà Vu*, *Frampton Comes Alive!*). Constraints already known: Last.fm MBIDs can't be trusted as the join key (§1.4), so matching must be by normalized name search against MusicBrainz with human confirmation; MusicBrainz API requires a `User-Agent` and has rate limits (1 req/s). Planned research case: The Allman Brothers Band, examining how Last.fm data maps to MusicBrainz release-group vs. specific-release MBIDs. No target version assigned.

### 4.4 Separate tools (out of SA scope entirely)

- **"Buried Treasure"** — a discovery tool surfacing low-play-count albums; deliberately separate from SA and trusts Last.fm data as-is. Fragmentation detection stays in SA.
- **MCP radio-stations concept** — Apple Music playlists driven by Last.fm history via Claude Desktop. Exploratory.

---

## 5. Open questions — flag these to the maintainer, don't guess

1. **Dismissal ID stability across normalization changes.** Item IDs are name-based; v0.6.1's normalizer changes may alter how items group, potentially orphaning existing dismissals. Unresolved: whether IDs derive from raw names (stable) or normalized keys (unstable under normalizer changes), and whether a migration is needed. Check the code, then confirm the intended behavior with the maintainer before shipping normalizer changes.
2. **Test data access.** Validation of v0.6.1 depends on the user export attached to issue #11 (Maeldun's). Confirm it's obtainable and licensed for local testing.
3. **v0.7 pattern-mode UI.** Checkbox within existing views vs. a separate tab. Explicitly undecided.
4. **Diacritic folding philosophy.** Should diacritics follow the same "flag, human decides" model as smart quotes (fold for *grouping*, preserve originals for *display*, human picks the winner)? Leaning yes, but not confirmed — and Motörhead is a case where the diacritic form is canonical, so the tool must never imply the ASCII form is "correct."
5. **Ampersand-drop overmerge risk.** No acceptance criteria yet for what real-library overmerge rate is tolerable. Define via merge-contract cases before implementing.

---

## 6. Working style notes (for an AI agent)

The maintainer reviews in testable chunks, wants tradeoffs explained *before* code is written, does not want scope built until explicitly agreed, and is learning Git/GitHub and API workflows deliberately — explain the "why" of process steps, don't just execute them. Community input arrives via GitHub issues/discussions and r/lastfm; several roadmap items originated there and the issue numbers above are the source of truth for their details.
