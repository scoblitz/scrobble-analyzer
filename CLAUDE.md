# Scrobble Analyzer

Single-file, browser-based tool that analyzes Last.fm CSV exports (from lastfmstats.com) to surface metadata quality issues — artist/album/track name variations, invisible characters, compilation fragmentation, missing albums — and guide the user toward manual corrections. It detects and informs; it never auto-fixes.

Repo: github.com/scoblitz/scrobble-analyzer · Maintainer Last.fm username: scoblitz

## Architecture at a glance

One HTML file. No build step, no dependencies, no server. This is intentional — see DESIGN.md before proposing a bundler, framework, or backend.

Data flow:

1. **Upload/parse** — user selects a lastfmstats.com CSV export. The Last.fm username is parsed from the `Date#username` header (used to key dismissals). All fields are read; the `AlbumId` column is *intentionally ignored* (MBIDs from Last.fm are unreliable — see DESIGN.md).
2. **Normalization** — artist/album/track strings are reduced to normalization keys. The three normalizers differ and are *not* interchangeable: all lowercase, collapse whitespace, map NBSP → space and smart quotes → ASCII; only the artist normalizer strips a leading "the" and unifies &/and; only the album/track normalizers strip keyword suffixes (remaster/live/…). Punctuation stripping and diacritic folding are **not implemented anywhere** — see DESIGN.md §1.7 for the verified per-normalizer table before assuming a rule exists.
3. **Detection** — two detector classes:
   - *Variation detectors*: cluster entities by normalization key; any cluster with >1 original spelling is flagged.
   - *Pattern detectors*: regex against individual entries, no variation needed (compilation detection, missing-album detection; more coming in v0.7).
4. **UI** — issues rendered as cards grouped by category; character-reveal chips (NBSP, ZWSP, 2×SP, …) show invisible/ambiguous characters with Unicode codepoint tooltips.
5. **Dismissals** — persisted in localStorage, keyed by Last.fm username + name-based item IDs (stable across re-exports).
6. **Export** — report generation with a checkbox to include/exclude dismissed items.

## Run / test

- **Run:** open the HTML file directly in a browser. That's it.
- **Test:** no automated tests exist yet. A "merge contract" test file (Node-runnable; MUST-merge / MUST-NOT-merge pairs for the normalizers) is planned for v0.6.1 — see DESIGN.md. Until it lands, verify normalizer changes manually against real exports.

## Conventions & house rules

- Single file, vanilla JS. Keep it that way.
- Version number lives in-file; each release updates the "What's New" content.
- Item IDs are name-based, not index-based (dismissal stability). Don't regress this.
- Git: branch names describe the work, not the version (version-named branches collide with tags). Merge commits, not squash — commit granularity matters here.
- Detection philosophy: **flag, human decides.** A community survey confirmed users want to research and decide, not have corrections applied. Never add auto-correction.
- Never use `AlbumId` as a correctness signal.

## Current release state

v0.6.0 shipped (persistent dismissals, invisible-character consolidation + track-level detection, character reveal chips, visual refresh, five bug fixes). v0.6.1 (normalization patch) and v0.7.0 (pattern-detector release) are scoped but not built.

## Deeper context

Read **DESIGN.md** for design decisions and their rationale, rejected alternatives, known blind spots, the v0.6.1/v0.7 roadmap, and explicitly flagged open questions. Read it before touching the normalizers or detection logic.
