#!/usr/bin/env node
/*
 * Merge contract for the Scrobble Analyzer normalizers.
 *
 *   node tests/merge-contract.js
 *
 * WHAT THIS IS
 * ------------
 * A developer-side test. It never ships, never runs in the browser, and has no
 * effect on index.html - users still download one file. It exists because
 * normalization changes are the highest-risk edits in the codebase: they
 * silently change what groups with what, and nothing else makes that visible
 * before release.
 *
 * WHAT IT ASSERTS
 * ---------------
 * Grouping, NOT correctness. A MUST_MERGE pair claims two spellings belong on
 * the same card. It says nothing about which spelling is right - that stays a
 * human decision (DESIGN.md 1.3). MUST_NOT_MERGE is the mirror: these must stay
 * on separate cards because they are genuinely different things.
 *
 * The MUST_NOT list is the important half. A fix that fails to fix is obvious;
 * a fix that also quietly merges two distinct artists is the one that corrupts
 * somebody's triage.
 *
 * HOW TO ADD A CASE
 * -----------------
 *   1. Add the pair below with its issue number.
 *   2. Run this. WATCH IT FAIL - that is what proves you reproduced the report.
 *   3. Change the normalizer in index.html.
 *   4. Run again: new case passes, nothing in MUST_NOT_MERGE broke.
 *   5. Commit the contract change and the normalizer change together.
 *
 * The normalizers are READ OUT OF index.html at runtime, never copied here. A
 * copy drifts silently and you end up testing code you are not shipping.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const HTML = path.join(__dirname, '..', 'index.html');

// --- load the real normalizers straight out of index.html --------------------
function loadNormalizers() {
    const html = fs.readFileSync(HTML, 'utf8');
    const names = ['normalizeArtist', 'normalizeAlbum', 'normalizeTrack'];
    const sources = names.map(name => {
        const open = `        function ${name}(`;
        const start = html.indexOf(open);
        if (start === -1) {
            throw new Error(
                `Could not find "function ${name}" at top level in index.html.\n` +
                `The merge contract requires all three normalizers to be top-level\n` +
                `functions indented 8 spaces. If one was moved or re-nested, move it\n` +
                `back - see docs/DESIGN.md 4.1.1.`
            );
        }
        const close = '\n        }\n';
        const end = html.indexOf(close, start);
        if (end === -1) throw new Error(`No closing brace found for ${name}`);
        return html.slice(start, end + close.length);
    });
    const factory = new Function(sources.join('\n') + `\nreturn { ${names.join(', ')} };`);
    return factory();
}

const { normalizeArtist, normalizeAlbum, normalizeTrack } = loadNormalizers();

const FN = { artist: normalizeArtist, album: normalizeAlbum, track: normalizeTrack };

// --- the contract ------------------------------------------------------------
// [field, a, b, why]

const MUST_MERGE = [
    // --- shipped behaviour: these already pass and must keep passing ---
    ['artist', 'The Beatles',        'Beatles',              'leading "the" is stripped'],
    ['artist', 'Simon & Garfunkel',  'Simon and Garfunkel',  'ampersand unified on artists'],
    ['track',  '“Heroes”', '"Heroes"',             'smart double quotes fold to ASCII'],
    ['track',  'Goin’ Out West', "Goin' Out West",      'smart single quote folds to ASCII'],
    ['album',  'Aja (Remastered)',   'Aja',                  'edition suffix stripped'],
    ['track',  'Midtown - Remaster', 'Midtown',              'dash remaster suffix stripped'],
    ['track',  'Midtown (Instrumental)', 'Midtown',          'parenthetical keyword stripped'],
];

const MUST_NOT_MERGE = [
    // --- the canonical guard: different credits, correctly distinct ---
    ['artist', 'Elvis Costello', 'Elvis Costello & The Attractions', 'different credits (DESIGN.md 1.7)'],
    ['artist', 'Albert Hammond', 'Albert Hammond, Jr.',              'father and son, different artists'],

    // --- near-miss titles that edit distance would wrongly merge (DESIGN.md 3.7) ---
    ['track',  'Song for the Dead', 'Song for the Deaf', 'distinct QOTSA tracks, edit distance 1'],
    ['track',  'Opus 17',           'Opus 37',           'distinct pieces, edit distance 1'],
    ['track',  'Obstacle 1',        'Obstacle 2',        'distinct Interpol tracks'],

    // --- albums are not artists: no leading-"the" strip here ---
    ['album',  'The Wall',          'Wall',              'leading "the" is meaningful in album titles'],
];

// Assertions about a single key, not a pair.
//
// Some guards cannot be expressed as a pair, because the string you are
// guarding against is itself rewritten by the normalizer. The 3.15.20 guard is
// the case in point: asserting that "3.15.20" and "31520" stay unmerged proves
// nothing, since the year rule chews "31520" down to "3" and they differ no
// matter what punctuation does. The real requirement is about the key itself.
//
// [field, input, forbidden key, why]
const KEY_MUST_NOT_BE = [
    ['track', '3.15.20', '31520',
        'DESIGN.md 1.7 title guard: punctuation must map to a SPACE, never be ' +
        'deleted. If this fires, a rule is deleting "." instead of replacing it.'],
    ['album', '3.15.20', '31520', 'same guard on the album normalizer'],
];

// Cases that behave wrongly today and have deliberately not been fixed.
// Reported, visible, never fatal. The 4th field is what CORRECT behaviour would
// be, so this list covers both directions: pairs that should merge and don't,
// and pairs that shouldn't merge but do. When one starts behaving correctly the
// runner says so - promote it to MUST_MERGE or MUST_NOT_MERGE.
const KNOWN_MISS = [
    // --- scoped for v0.6.1, expected to flip as items land ---
    ['artist', 'Albert Hammond, Jr.', 'Albert Hammond Jr', true,
        'issue #11 - punctuation not stripped yet (v0.6.1 item 3)'],
    ['artist', 'Motörhead', 'Motorhead', true,
        'issue #14 - diacritics not folded yet (v0.6.1 item 4)'],
    ['track',  '9th & Hennepin', '9th and Hennepin', true,
        'discussion #10 - no ampersand rule on tracks yet (v0.6.1 item 5)'],
    ['track',  'Young Love [ft. Laura Marling]', 'Young Love (feat. Laura Marling)', true,
        'issue #17 - feat/ft not in the track keyword list yet (v0.6.1 item 2)'],
    ['track',  'Ramalama [Bang Bang]', 'Ramalama (Bang Bang)', true,
        'issue #17 - bracket/paren containers not canonicalised yet (v0.6.1 item 7)'],
    ['track',  'Someone´s in the Wolf', "Someone's in the Wolf", true,
        'issue #12 - U+00B4 not in the apostrophe class yet (v0.6.1 item 6)'],

    // --- no viable detector, not scoped to any release (DESIGN.md 3.7) ---
    ['track',  'Cartoons and Macramé Wounds', 'Cartoons and Macreme Wounds', true,
        'issue #15 - a typo, not an accent; edit distance is not usable'],
    ['track',  'Citizen Erased', 'Citzen Erased', true,
        'issue #16 - single-character typo; edit distance is not usable'],

    // --- found 2026-08-01 while writing this contract, not yet triaged ---
    ['track',  'Midtown - 2023 Remaster', 'Midtown', true,
        'dangling separator: "X - YYYY Remaster" leaves "x -" because the dash rule ' +
        'needs the keyword immediately after the dash, so the year rule strips the ' +
        'year and leaves the dash behind. Common Spotify format (disc. #7).'],
    ['track',  '19-2000', '19-2001', false,
        'over-eager year strip: the trailing \\d{4} rule eats part of a legitimate ' +
        'title, so both collapse to "19-". Same for Lorn "555-5555" -> "555-".'],
];

// --- runner ------------------------------------------------------------------
const GREEN = '\x1b[32m', RED = '\x1b[31m', DIM = '\x1b[2m', YEL = '\x1b[33m', OFF = '\x1b[0m';

let passed = 0;
const failures = [];

function check(field, a, b, why, shouldMatch) {
    const fn = FN[field];
    if (!fn) throw new Error('unknown field: ' + field);
    const ka = fn(a), kb = fn(b);
    const matched = ka === kb;
    if (matched === shouldMatch) {
        passed++;
        return true;
    }
    failures.push({ field, a, b, why, ka, kb, shouldMatch });
    return false;
}

MUST_MERGE.forEach(([f, a, b, why]) => check(f, a, b, why, true));
MUST_NOT_MERGE.forEach(([f, a, b, why]) => check(f, a, b, why, false));

const keyFailures = [];
KEY_MUST_NOT_BE.forEach(([field, input, forbidden, why]) => {
    const got = FN[field](input);
    if (got === forbidden) keyFailures.push({ field, input, forbidden, why, got });
    else passed++;
});

// KNOWN_MISS is reported, never fatal.
const fixed = [];
KNOWN_MISS.forEach(([f, a, b, shouldMatch, why]) => {
    if ((FN[f](a) === FN[f](b)) === shouldMatch) fixed.push({ f, a, b, shouldMatch, why });
});

console.log('\nmerge contract  ' + DIM + '(normalizers read live from index.html)' + OFF + '\n');

const totalFailures = failures.length + keyFailures.length;

if (totalFailures === 0) {
    console.log(`  ${GREEN}PASS${OFF}  ${passed} assertions`);
} else {
    console.log(`  ${RED}FAIL${OFF}  ${totalFailures} of ${passed + totalFailures} assertions\n`);
    failures.forEach(f => {
        const verb = f.shouldMatch ? 'should have merged, did not' : 'must NOT merge, but did';
        console.log(`  ${RED}x${OFF} [${f.field}] ${verb}`);
        console.log(`      ${JSON.stringify(f.a)}  ->  ${JSON.stringify(f.ka)}`);
        console.log(`      ${JSON.stringify(f.b)}  ->  ${JSON.stringify(f.kb)}`);
        console.log(`      ${DIM}${f.why}${OFF}\n`);
    });
    keyFailures.forEach(f => {
        console.log(`  ${RED}x${OFF} [${f.field}] key guard violated`);
        console.log(`      ${JSON.stringify(f.input)}  ->  ${JSON.stringify(f.got)}  ${RED}(forbidden)${OFF}`);
        console.log(`      ${DIM}${f.why}${OFF}\n`);
    });
}

if (KNOWN_MISS.length) {
    console.log(`\n  ${DIM}${KNOWN_MISS.length} known misses not yet fixed (not failures)${OFF}`);
}
if (fixed.length) {
    console.log(`\n  ${YEL}!${OFF} ${fixed.length} KNOWN_MISS case(s) now behave correctly - promote them:`);
    fixed.forEach(f => {
        const target = f.shouldMatch ? 'MUST_MERGE' : 'MUST_NOT_MERGE';
        console.log(`      [${f.f}] -> ${target}  ${JSON.stringify(f.a)} / ${JSON.stringify(f.b)}`);
        console.log(`          ${DIM}${f.why}${OFF}`);
    });
}

console.log('');
process.exit(totalFailures ? 1 : 0);
