# API Case Study 1 - The Cream of Clapton AlbumId Mismatch

*2026-07-06 — from Scrobble Analyzer v0.6.0 testing. First MusicBrainz API call.*

## The specimen

Scrobble Analyzer flagged an album variation under **Cream**: "The Cream **Of** Clapton" (4 scrobbles) vs "The Cream **of** Clapton" (3 scrobbles). Looked like a simple capitalization issue. It wasn't.

## What was actually going on

The Cream of Clapton (1995) is an **Eric Clapton compilation** containing tracks by Cream, Blind Faith, and Derek and the Dominos. For the Cream-era tracks, **track artist (Cream) ≠ album artist (Eric Clapton)**.

My listening to this one album is split into three buckets in the data:

1. **Track artist Cream, no album artist** → freetext album under Cream, uppercase "Of", no AlbumId in CSV (4 scrobbles)
2. **Track artist Cream, album artist Eric Clapton** → catalog-linked, lowercase "of", has AlbumId (3 scrobbles)
3. **Track artist Eric Clapton** (his solo tracks on the same album) → filed under a different Artist entirely in the CSV, invisible to the variation card (4 scrobbles)

Key insight: **the casing difference was a symptom, not the cause.** The real fork is whether the scrobbler sent an `albumartist` field. The lastfmstats.com export flattens this — its single Artist column is the *track* artist, so the album-artist dimension is invisible except via the AlbumId fingerprint.

Also learned: Last.fm resolves album URLs **case-insensitively** within an artist. The two differently-cased links led to the same page (the noredirect "Did you mean" banner is the only trace). The lowercase scrobbles actually live under `/music/Eric+Clapton/The+Cream+of+Clapton` — confirmed, that page shows all 7 Eric-Clapton-album-artist scrobbles across buckets 2 and 3.

## The API call (first one!)

Ran in Aspen:

```
GET https://musicbrainz.org/ws/2/release/01e7ce7d-8752-4887-990a-834d5c8e13d3?inc=artist-credits+release-groups&fmt=json
User-Agent: ScrobbleAnalyzer/0.6.0 (https://github.com/scoblitz/scrobble-analyzer)
```

(MusicBrainz requires a meaningful User-Agent; rate limit ~1 req/sec.)

## The plot twist

The AlbumId attached to my scrobbles resolves to **"The Cream of Eric Clapton" — the 1987 UK compilation. A completely different album.**

- Returned release: `01e7ce7d-8752-4887-990a-834d5c8e13d3` = 1987-09, UK, Polydor jewel case
- Its release group: `80f0a368-c681-4315-9612-4d8b23d1b6c0` ("1987 compilation")
- The album I actually listened to: The Cream of Clapton (1995), release group `976d6745-0091-39f1-ae60-c142986485a5`, US release `29a89b27-ee52-4e84-a411-8b3ae971673d`

These two compilations are famously confused — both the MusicBrainz annotation and Last.fm's own wiki carry "not to be confused with" warnings. Last.fm's title→MBID mapping fell into exactly that trap. (Probably Last.fm's matching or the streaming service's metadata feed circa 2010–2014, likely Rhapsody-era; I never used Picard and never had local files of this album.)

## Rules extracted

1. **MBIDs in Last.fm data are hints, never facts.** Verify title + artist-credit against MusicBrainz before trusting one. Any pipeline joining Last.fm history to MusicBrainz on these IDs silently inherits errors like this.
2. **AlbumId presence ≠ correctness.** An AlbumId means Last.fm matched *something*, not that it matched *correctly*. Killed the v0.7 idea of using AlbumId as a "this is the right one" indicator in variation cards — a confidently-wrong chip is worse than no chip.
3. **The (artist, album) grouping key has a structural blind spot for compilations.** Scrobbles for one compilation legitimately span multiple Artist values in the export; no single variation card can show the whole story without the album-artist dimension, which the CSV doesn't carry.
4. **`release-group.secondary-types: ["Compilation"]`** — MusicBrainz explicitly types compilations. The authoritative version of what Scrobble Analyzer approximates with title regexes. Free compilation detection if/when an enrichment tool exists.
5. **Release vs release group, seen in the wild:** `id` = the specific edition/pressing; `release-group.id` = the album as a concept. Scrobbles pin to releases; "did I listen to this album" questions usually want the group.

## Decisions

- **Scrobble Analyzer continues to ignore the AlbumId column** — correct default, now with evidence. Revisit only as part of a larger matching-data evaluation (API research track, not a release feature).
- **My fix for these scrobbles:** move both Cream songs to their original albums (Badge → Goodbye, White Room → Wheels of Fire) and remove the compilation attribution entirely. Personal rule: tracks only stay on compilations if they have no standard-release home.

## Open threads

- Test whether Last.fm bulk edit accepts album-artist changes (try one scrobble first)
- Allman Brothers Band remains the planned systematic test case; this one volunteered early
