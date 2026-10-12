# Scrobble Analyzer

Single-file, browser-based tool that analyzes Last.fm CSV exports (from lastfmstats.com) to surface metadata quality issues — artist/album/track name variations, invisible characters, compilation fragmentation, missing albums — and guide the user toward manual corrections. It detects and informs; it never auto-fixes.

Repo: github.com/scoblitz/scrobble-analyzer · Maintainer Last.fm username: scoblitz

## Architecture at a glance

One HTML file. No build step, no dependencies, no server. This is intentional — see DESIGN.md before proposing a bundler, framework, or backend.

Data flow:

1. **Upload/parse** — user selects a lastfmstats.com CSV export. The Last.fm username is parsed from the `Date#username` header (used to key dismissals). All fields are read; the `AlbumId` column is *intentionally ignored* (MBIDs from Last.fm are unreliable — see DESIGN.md).
2. **Normalization** — artist/album/track strings are reduced to normalization keys. The three normalizers differ and are *not* interchangeable: all lowercase, collapse whitespace, map NBSP → space, apostrophe-likes and smart quotes → ASCII, fold diacritics (NFD), unify &/and, and map `.` `,` and dashes to a **space** (never deleted); only the artist normalizer strips a leading "the"; only the album/track normalizers strip keyword suffixes (remaster/live/feat/…) and canonicalize `[ ]` to `( )`. See DESIGN.md §1.7 for the verified per-normalizer table before assuming a rule exists.
3. **Detection** — two detector classes:
   - *Variation detectors*: cluster entities by normalization key; any cluster with >1 original spelling is flagged.
   - *Pattern detectors*: regex against individual entries, no variation needed (compilation detection, missing-album detection; additional patterns scoped for v0.9.0).
4. **UI** — issues rendered as cards grouped by category; character-reveal chips (NBSP, ZWSP, 2×SP, …) show invisible/ambiguous characters with Unicode codepoint tooltips.
5. **Dismissals** — persisted in localStorage, keyed by Last.fm username + name-based item IDs (stable across re-exports).
6. **Export** — report generation with a checkbox to include/exclude dismissed items.

## Run / test

- **Run:** open the HTML file directly in a browser. That's it.
- **Test:** run all five scripts in `tests/` with Node: `merge-contract.js`, `import-identity-contract.js`, `recurrence-contract.js`, `detection-contract.js` and `triage-contract.js`. They read functions live out of index.html (keep extracted functions top-level, 8-space-indented — see DESIGN.md §4.1.1). Add cases before changing behaviour. Still verify UI changes manually against a real export.

## Conventions & house rules

- Single file, vanilla JS. Keep it that way.
- Version number lives in-file; each release updates the "What's New" content.
- Item IDs are name-based, not index-based (dismissal stability). Don't regress this.
- Git: branch names describe the work, not the version (version-named branches collide with tags). Merge commits, not squash — commit granularity matters here.
- Detection philosophy: **flag, human decides.** A community survey confirmed users want to research and decide, not have corrections applied. Never add auto-correction.
- Never use `AlbumId` as a correctness signal.

## Current release state

v0.8.0 adds correction choices, recurrence after observed play-count decreases, storage v4 and issue-v3 name tuples, conservative grouping migrations, precise metadata labels, paged desktop triage and album suggestions from exact library evidence. Maintainer browser checks in Chrome, Firefox and Safari reported no issues on 2026-10-12; see DESIGN.md §4.10. Earlier releases: v0.7.0 (Fixed / Ignored views), v0.6.1 (normalization patch), v0.6.0 (persistent dismissals, invisible-character work, visual refresh). v0.9.0 (pattern-detector release) is scoped but not built. Direct library retrieval is deferred to a separate proposal after this release.

## Deeper context

Read **DESIGN.md** for design decisions and their rationale, rejected alternatives, known blind spots, the roadmap, and explicitly flagged open questions. Read it before touching the normalizers or detection logic.
