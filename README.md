# Scrobble Analyzer

**Find and fix data quality issues in your Last.fm scrobble history.**

After 20 years of scrobbling and 150,000+ plays, I discovered my Last.fm data was full of invisible inconsistencies - artist name variations, album duplicates, tracks scattered across remastered editions, and even entries that *looked* identical but contained hidden Unicode characters. These issues were silently skewing my stats the whole time.

I couldn't find any tool that surfaced these problems, so I built one.

![Scrobble Analyzer Screenshot](scrobbleanalyzer-fullscreen.png)

## What It Does

Scrobble Analyzer examines your Last.fm export and identifies:

- **Artist Variations** - "The Allman Brothers Band" vs "Allman Brothers Band" vs "The Allman Brothers Band" (with invisible characters!)
- **Album Variations** - "Abbey Road" vs "Abbey Road (Super Deluxe Edition)" vs "Abbey Road (2019 Remaster)"
- **Track Variations** - "Statesboro Blues" vs "Statesboro Blues (Live)" vs "Statesboro Blues - Remastered"
- **Tracks Missing Albums** - Tracks that were scrobbled without album information
- **Tracks on Compilations** - Plays on "Greatest Hits" albums that could be reassigned to original releases
- **Invisible Characters** - Entries that look identical but aren't: non-breaking spaces, zero-width characters, doubled spaces, and other hidden differences in artists, albums, and tracks. Each one is revealed with a labeled chip (like `NBSP` or `2×SP`) showing exactly which character is hiding where.
- **Look-Alike Characters** - Names that differ only by which apostrophe, quote or accent they use: `Don’t` vs `Don't`, `Someone´s` vs `Someone's`, `Motörhead` vs `Motorhead`. Where the difference is genuinely invisible - Romanian comma-below vs cedilla, for instance - a chip names the exact character and its codepoint.
- **Formatting Variations** - Punctuation and spacing (`Albert Hammond, Jr.` vs `Albert Hammond Jr`), `&` vs "and", featured-artist tags (`(feat. …)`, `[ft. …]`) and bracket style are all treated as the same name, so those land on one card instead of scattering.

Issues are sorted by impact (scrobble count) so you can fix the biggest problems first.

Each variation includes a direct link to your Last.fm library (with `+noredirect` to prevent auto-redirects) so you can quickly navigate to fix issues, plus Google lookup buttons for researching ambiguous cases.

**Your dismissals stick.** Marked something as "not actually a problem"? That dismissal is remembered across new exports - tied to your Last.fm username, stored only in your browser. Re-export next month and pick up right where you left off.

**Everything happens in your browser.** Your scrobble data is never uploaded anywhere - the analysis runs entirely on your machine.

## How To Use It

### **→ [Launch Scrobble Analyzer](https://scoblitz.github.io/scrobble-analyzer)**
*Recommended - always up to date*

Or [download index.html](index.html) to run locally (note: you won't receive updates)

### Getting Your Data

1. Go to [lastfmstats.com](https://lastfmstats.com/)
2. Enter your Last.fm username and let it load your data
3. Use the Export feature to download your scrobble history as CSV
4. Drop the CSV file into the upload area in Scrobble Analyzer

**Required CSV format:** Must have a header row with columns for `Artist`, `Album`, `Track`, and `Date`. This is exactly what lastfmstats.com exports - no preparation needed.

## Current Status

**Version 0.6.1** - [full release notes](https://github.com/scoblitz/scrobble-analyzer/releases/tag/v0.6.1) · [all releases](https://github.com/scoblitz/scrobble-analyzer/releases)

v0.6.1 is a matching release. Accented spellings, punctuation and spacing, `&` vs "and", featured-artist tags, extra apostrophe styles and bracket styles are now all recognised as the same name. **Expect your issue count to go up** compared to your last export - those variations were always in your library, the tool just couldn't see them.

### Current Limitations

- Analysis only (doesn't modify your Last.fm data directly - you'll use Last.fm's edit interface)
- Shows first 100 issue cards per category (use search/filters to find more)
- Compilations spanning multiple track artists (e.g. an Eric Clapton compilation containing Cream tracks) appear split across those artists, because the export only carries the track artist
- The `AlbumId` column in the export is currently ignored - it turns out those IDs aren't always trustworthy (ask me about the two Clapton compilations sometime)
- Genuine misspellings aren't detected - `Citzen Erased` won't be matched to `Citizen Erased`. Everything above works by treating two spellings as the same name; a typo is a different name. Matching by similarity instead sounds obvious but flags far more real songs than typos (`Song for the Dead` and `Song for the Deaf` are both QOTSA tracks, one letter apart), so it isn't in yet
- Variations are only found when both spellings exist in your library. If everything you have is consistently wrong the same way, there's nothing to compare it against

## Roadmap Ideas

- [ ] MusicBrainz integration for canonical album/artist verification and lookups
- [ ] Personal "discography" - mark canonical versions to check against future exports
- [ ] More detection patterns based on community feedback

## Stay Updated

Get notified when new versions are released:

📬 **[Subscribe to updates](https://buttondown.com/scrobble-analyzer)**

No spam, just release announcements and occasional project news.

## Feedback Welcome

This project came out of my own frustration with messy scrobble data. If you:

- Find bugs or issues
- Have ideas for new detection patterns
- Discover edge cases in your own data

Please [open an issue](../../issues) or start a [discussion](../../discussions)! I'd love to hear what problems you're finding in your data.

## Built With

This is a collaboration between a music data nerd (me) and Claude (Anthropic's AI assistant). The entire tool is a single HTML file with no dependencies - just open it in a browser.

## License

MIT License - Do whatever you want with it. If you build something cool, I'd love to hear about it.

---
