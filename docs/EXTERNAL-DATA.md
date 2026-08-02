# External Data — Last.fm, lastfmstats, MusicBrainz

What we know about the data sources the tool touches or might touch. Companion to DESIGN.md, which covers *decisions*; this covers *facts about other people's systems* — the things that cost real time to establish and are expensive to re-derive.

Salvaged from the project wiki (2026-08-02), which is being retired: it duplicated DESIGN.md, drifted out of date silently because nothing in the repo pointed at it, and one stale copy of the truth is worse than none. Everything here outlived it.

---

## 1. The export format (lastfmstats.com)

Semicolon-delimited CSV, header row, username embedded in the last column:

```
Artist;Album;AlbumId;Track;Date#username
```

- `Date` is a Unix timestamp in **milliseconds**.
- The username in the header is what dismissals are keyed on (DESIGN.md §1.5).
- **`Artist` is the *track* artist, not the album artist.** lastfmstats passes through what Last.fm returns and does no extra lookups. This one line explains the compilation blind spot in DESIGN.md §3.2 — the album-artist dimension simply is not in the file, so no amount of cleverness in the grouping key can recover it.
- `AlbumId` is a MusicBrainz **Release** MBID where Last.fm has one. Roughly **80%** of scrobbles that have an album also carry one. **It is not trustworthy** — see §3 and the Cream of Clapton case study.

**Other exporters:** `lastfmtocsv` produces a different shape — no header row, comma-separated, human-readable dates. Not supported, and supporting it would mean a second parser.

---

## 2. Last.fm

**API docs:** https://www.last.fm/api · community-maintained and more detailed: https://lastfm-docs.github.io/api-docs/

The tool does not call the API (DESIGN.md §1.1 — Last.fm has no endpoint for *editing* scrobbles, so a sync gains nothing for the correction workflow). Recorded here because the research keeps resurfacing.

`user.getRecentTracks` is the endpoint an export replaces:

```
https://ws.audioscrobbler.com/2.0/?method=user.getrecenttracks
    &user=USERNAME&api_key=KEY&format=json&limit=200
```

Per scrobble it returns `artist`, `album`, `name`, and `date`, each of `artist`/`album` carrying an optional `mbid`. Not every scrobble has MBIDs — it depends on how the track was matched at scrobble time.

**Behaviour worth knowing:**

- Album URLs resolve **case-insensitively** within an artist. Two differently-cased links land on the same page; the `+noredirect` "Did you mean" banner is the only trace. This is why case-only differences are out of scope (DESIGN.md §3.5).
- Last.fm silently autocorrects some artist names at scrobble time (Spotify's "The Goo Goo Dolls" → "Goo Goo Dolls"), so the tag you sent is not always the tag stored.
- Rate limits: not established. Would need testing before any direct-access work.

---

## 3. MusicBrainz

**API docs:** https://musicbrainz.org/doc/MusicBrainz_API
**Requires** a meaningful `User-Agent` (e.g. `ScrobbleAnalyzer/0.6.1 (https://github.com/scoblitz/scrobble-analyzer)`). **Rate limit ~1 request/second.**

### Vocabulary

| Entity | What it is | Example |
|---|---|---|
| **Release** | One specific edition or pressing | *Close to the Edge (2003 Remaster)* |
| **Release Group** | The album as a concept, grouping every edition | *Close to the Edge* |
| **Recording** | One recorded performance of a track | the song itself |
| **Artist** | Performer or group | Yes |

Scrobbles pin to **releases**. Questions of the form "have I listened to this album" almost always want the **release group**. The lookup chain is:

```
AlbumId in the CSV  ->  Release MBID  ->  release-group.id  ->  the canonical album
```

### Two things that would be genuinely useful

- **Artist aliases.** MusicBrainz stores known variants against an artist — "Tom Petty and the Heartbreakers" carries "Tom Petty & the Heartbreakers" as an alias. That is a *curated* answer to the problem the normalizers approximate by rule, and it could confirm variations rather than guess at them. Relevant to the reference detectors in DESIGN.md §4.3.
- **`release-group.secondary-types: ["Compilation"]`.** MusicBrainz explicitly types compilations. That is the authoritative version of what compilation detection currently approximates with title regexes ("greatest hits", "best of", …), which is why it misfires on albums merely containing the word *Gold*.

### But the join key cannot be trusted

The obvious design — join Last.fm history to MusicBrainz on the `AlbumId` already in the export — **does not work**, and this was established empirically rather than assumed. See [the Cream of Clapton case study](case-studies/2026-07-06-cream-of-clapton-albumid.md): an AlbumId attached to real scrobbles resolved to a different album by a different artist, from eight years earlier.

The consequences, in short:

1. **MBIDs from Last.fm are hints, never facts.** Any pipeline joining on them silently inherits errors.
2. **Presence of an AlbumId is not evidence of correctness.** It means Last.fm matched *something*.
3. Matching must therefore be by **normalized name search against MusicBrainz, with human confirmation** — never by the supplied ID.

---

## 4. Open threads

- Last.fm API rate limits — untested.
- Whether Last.fm's bulk edit accepts **album-artist** changes (try a single scrobble first).
- Batching MusicBrainz lookups against the 1 req/sec limit for a large library.
- Whether to cache API responses, and where, given the tool has no server.
- The Allman Brothers Band remains the planned systematic test case for release-vs-release-group behaviour.
