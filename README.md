---
title: README
---
# Scrobble Analyzer

**Find and fix data quality issues in your Last.fm scrobble history.**

After 20 years of scrobbling and 150,000+ plays, I discovered my Last.fm data was full of invisible inconsistencies - artist name variations, album duplicates, tracks scattered across remastered editions, and even entries that *looked* identical but contained hidden Unicode characters. These issues were silently skewing my stats the whole time.
 I have been correcting as I found things but I knew there were just so many that I never noticed or had missing data that made them not show up at all, so I never saw them.
 
I couldn't find any tool that surfaced these problems, so I built one.

**Full Screen View**
![image](images/scrobbleanalyzer-fullscreen.jpg)

**Issue List**
![image](images/scrobbleanalyzer-issuelist.jpg)

**Tracks Missing Album**
![image](images/scrobbleanalyzer-missingalbum.jpg)

## What It Does

Scrobble Analyzer examines your Last.fm export and identifies:

- **Artist Variations** - "The Allman Brothers Band" vs "Allman Brothers Band" vs "The Allman Brothers Band" (with invisible characters!)
- **Album Variations** - "Abbey Road" vs "Abbey Road (Super Deluxe Edition)" vs "Abbey Road (2019 Remaster)"
- **Track Variations** - "Statesboro Blues" vs "Statesboro Blues (Live)" vs "Statesboro Blues - Remastered"
- **Missing Albums** - Tracks that were scrobbled without album information
- **Compilations** - Plays on "Greatest Hits" albums that could be reassigned to original releases
- **Invisible Characters** - Entries that look identical but contain non-breaking spaces or other hidden Unicode characters

Issues are sorted by impact (scrobble count) so you can fix the biggest problems first.

Each variation includes a direct link to your Last.fm library (with `+noredirect` to prevent auto-redirects) so you can quickly navigate to fix issues.

## How To Use It

### Option 1: Use it online
Visit: **[scoblitz.github.io/scrobble-analyzer](https://your-github-username.github.io/scrobble-analyzer)**

### Option 2: Run locally
1. Download `index.html`
2. Open it in your browser
3. That's it - everything runs client-side, your data never leaves your computer

### Getting Your Data

1. Go to a Last.fm stats service like [Last.fm Stats](https://lastfmstats.com/) or similar
2. Export your scrobble history as CSV
3. Drop the CSV file into Scrobble Analyzer

The CSV should have columns for Artist, Album, Track, and optionally AlbumId.

## What It Found In My Data

From ~150,000 scrobbles over 20 years:

- **77 artist variation issues** - Including 7 entries with invisible characters
- **488 album variation issues** - Remasters, deluxe editions, and typos
- **600+ track variations** - 11 different versions of "Statesboro Blues" alone!
- **494 artists with missing album data** - ~6% of all scrobbles. Gov't Mule alone has 110 tracks without album data accounting for 348 total scrobbles.
- **637 compilation albums** - Plays that could be reassigned to their original releases

I had no idea it was this messy. If you've been scrobbling for years, yours probably is too.

## Current Status

**Version 0.4.0** - Working proof of concept

This is functional and useful right now, but still evolving. Current limitations:

- Analysis only (doesn't modify your Last.fm data directly - you'll use Last.fm's edit interface)
- Shows first 100 issues per category (use search/filters to find more)

## Roadmap Ideas

- Personal "discography" - mark canonical versions to check against future exports
- Direct Last.fm API integration (skip the export step)
- More detection patterns based on community feedback
- Track-level invisible character detection

## Feedback Welcome

This project came out of my own frustration with messy scrobble data.
 If you:
- Find bugs or issues
- Have ideas for new detection patterns
- Discover edge cases in your own data

Please open an issue! I'd love to hear what problems you're finding in your data.

## Built With

This is a collaboration between a music data nerd (me) and Claude (Anthropic's AI assistant). The entire tool is a single HTML file with no dependencies - just open it in a browser. Feature requests and bug reports are welcome via Issues, but I'm not accepting code contributions at this time.

## License

MIT License - Do whatever you want with it. If you build something cool, I'd love to hear about it.

---

*"It combines a few of my favorite things: music and data."*
