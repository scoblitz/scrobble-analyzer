#!/usr/bin/env node
'use strict';

const assert = require('assert/strict'), fs = require('fs'), path = require('path');
const source = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
function load(names, globals = {}) {
    const bodies = names.map(name => {
        const match = source.match(new RegExp(`        function ${name}\\(`));
        if (!match) throw new Error(`Missing top-level function: ${name}`);
        return source.slice(match.index, source.indexOf('\n        }\n', match.index) + 11);
    });
    return new Function(...Object.keys(globals), bodies.join('\n') + `\nreturn { ${names} };`)(...Object.values(globals));
}
const api = load(['normalizeArtist', 'normalizeAlbum', 'normalizeTrack', 'stripMetadataLabels', 'getVisibleString', 'hasInvisibleChars',
    'differsOnlyByCase', 'differsOnlyInvisibly', 'findArtistVariations', 'findAlbumVariations', 'findTrackVariations', 'findInvisibleCharacterIssues',
    'getIssueId', 'getItemId', 'getMemberKey', 'getLegacyIssueId', 'getLegacyItemId', 'currentBaseline', 'decodeDecisionId',
    'migrateIssueIdentities', 'libraryBaselines', 'dismissalStatus', 'recurrenceDelta', 'addRememberedRecurrences', 'isKeptMember', 'caseOnlyMembers',
    'observeFixedRecords', 'recurrenceNote', 'needsGroupingReview', 'freshNormalizationDecision'], { console: { log() {} } });
const S = (Artist, Album, Track, n) => Array.from({ length: n }, () => ({ Artist, Album, Track }));
const tests = [], test = (name, fn) => tests.push([name, fn]);
let migrate;
const issue = (key, names) => ({ type: 'track', artist: 'A', normalized: key, title: `A - ${names[0]}`, variations: names.map(name => ({ name, artist: 'A', count: 10 })) });
const fixed = card => ({ intent: 'fixed', identityVersion: 3, at: 1, members: api.currentBaseline(card), observedMembers: api.currentBaseline(card) });
const target = name => ({ kind: 'track', artist: 'A', name, memberKey: JSON.stringify(['A', name]) });

test('case-only artist, album and track differences are not ordinary findings', () => {
    assert.deepEqual(api.findArtistVariations([...S('Example', 'B', 'T', 10), ...S('EXAMPLE', 'B', 'T', 10)]), []);
    assert.deepEqual(api.findAlbumVariations([...S('A', 'Album', 'T', 5), ...S('A', 'ALBUM', 'T', 5)]), []);
    assert.deepEqual(api.findTrackVariations([...S('A', 'B', 'Song', 3), ...S('A', 'B', 'SONG', 3)]), []);
});
test('punctuation, accents, whitespace, suffixes and mixed groups still surface', () => {
    for (const [a, b] of [['Album', 'Album (Deluxe)'], ['Album & More', 'Album and More'], ['Oxygène', 'Oxygene']]) {
        assert.equal(api.findAlbumVariations([...S('A', a, 'T', 5), ...S('A', b, 'T', 5)]).length, 1);
    }
    const mixed = api.findTrackVariations([...S('A', 'B', 'Song', 3), ...S('A', 'B', 'SONG', 3), ...S('A', 'B', 'Song (Live)', 3)]);
    assert.equal(mixed.length, 1);
    assert.equal(mixed[0].variations.length, 3);
    assert.equal(api.findInvisibleCharacterIssues([...S('A', 'B', 'Song', 3), ...S('A', 'B', 'Song\u00a0', 3)]).length, 1);
});
test('previously fixed case-only cards cannot be reconstructed as recurrences', () => {
    const card = issue('song', ['Song', 'SONG']), id = api.getIssueId(card), items = { [id]: fixed(card) };
    const current = api.libraryBaselines([...S('A', 'B', 'Song', 20), ...S('A', 'B', 'SONG', 20)], items);
    assert.deepEqual(api.addRememberedRecurrences([], items, current, {}), []);
});
test('case variants of a chosen member do not recur but metadata differences do', () => {
    const card = issue('song', ['Song', 'Song (Live)']), record = fixed(card);
    const chosen = target('Song');
    const current = { ...api.currentBaseline(card), '["A","SONG"]': 1 };
    assert.equal(api.dismissalStatus(record, current, chosen), 'hidden');
    assert.deepEqual(api.recurrenceDelta(record, current, chosen), { newPlays: 0, newMembers: [] });
    assert.equal(api.dismissalStatus(record, { ...current, '["A","Song (Live)"]': 11 }, chosen), 'recurred');
    assert.equal(api.dismissalStatus(record, { ...current, '["A\u200b","Song"]': 1 }, chosen), 'recurred');
});
test('malformed or unbalanced groups are retained instead of swallowed', () => {
    assert.equal(api.normalizeTrack('Song (Part 1 (Live)'), 'song (part 1 (live)');
    assert.notEqual(api.normalizeTrack('Song (Live'), api.normalizeTrack('Song'));
    assert.notEqual(api.normalizeTrack('Foo(Live)Bar'), api.normalizeTrack('Foobar'));
});
test('a group-key move keeps fixed counts, low-water history and its correction', () => {
    const old = issue('song', ['Song (Part 1) (Live)', 'Song (Part 1) (Remastered)']);
    const id = api.getIssueId(old), nextId = api.getIssueId(issue('song (part 1)', []));
    const record = fixed(old), choice = target('Song (Part 1)');
    record.observedMembers['["A","Song (Part 1) (Live)"]'] = 0;
    const before = JSON.stringify(record);
    const result = migrate({ [id]: record }, { [id]: choice });
    assert.equal(result.items[id], undefined);
    assert.equal(result.items[nextId].members['["A","Song (Part 1) (Live)"]'], 10);
    assert.equal(result.items[nextId].observedMembers['["A","Song (Part 1) (Live)"]'], 0);
    assert.equal(result.corrections[nextId].name, choice.name);
    assert.equal(result.corrections[id], undefined);
    assert.equal(result.ambiguous, 0);
    assert.equal(JSON.stringify(record), before);
});
test('a split fixed or ignored group is quarantined even if its old ID names a current child', () => {
    const old = issue('song', ['Song', 'Song (Part 1) (Live)']), id = api.getIssueId(old);
    for (const intent of ['fixed', 'ignored']) {
        const record = { ...fixed(old), intent }, choice = target('Song');
        const result = migrate({ [id]: record }, { [id]: choice });
        assert.equal(result.items[id].identityAmbiguous, true);
        assert.equal(api.dismissalStatus(result.items[id], { '["A","Song"]': 10 }), 'active');
        assert.equal(result.ambiguous, 1);
        assert.equal(Object.keys(result.items).length, 1);
        assert.deepEqual(result.items[id].members, record.members);
        assert.equal(result.corrections[id].name, choice.name);
        assert.equal(Object.keys(api.libraryBaselines(S('A', 'B', 'Song', 20), result.items)).length, 0);
    }
});
test('a legacy raw-title decision is also checked for split boundaries after ID migration', () => {
    const old = issue('song', ['Song', 'Song (Part 1) (Live)']);
    const current = issue('song', ['Song', 'Song (Live)']);
    const legacyId = api.getLegacyIssueId(old);
    const first = api.migrateIssueIdentities({ [legacyId]: { intent: 'ignored', members: { Song: 10, 'Song (Part 1) (Live)': 10 }, at: 1 } }, [current]);
    const result = migrate(first.items, {});
    assert.equal(result.items[api.getIssueId(current)].identityAmbiguous, true);
});
test('two old decisions converging on one new key are not silently overwritten', () => {
    const a = issue('song)', ['Song (Live (Berlin))']), b = issue('song', ['Song (Live)']);
    const ia = api.getIssueId(a), ib = api.getIssueId(b);
    const result = migrate({ [ia]: fixed(a), [ib]: { ...fixed(b), intent: 'ignored' } }, { [ia]: target('Song') });
    assert.equal(result.ambiguous, 2);
    assert.equal(result.items[ia].identityAmbiguous, true);
    assert.equal(result.items[ib].identityAmbiguous, true);
});
test('a fresh decision at the new key takes precedence over old migration sources', () => {
    const old = issue('song)', ['Song (Live (Berlin))']), next = issue('song', ['Song (Live)']);
    const oldId = api.getIssueId(old), newId = api.getIssueId(next), fresh = { ...fixed(next), normalizationVersion: 2 };
    const result = migrate({ [oldId]: fixed(old), [newId]: fresh }, { [oldId]: target('Song'), [newId]: { ...target('SONG'), normalizationVersion: 2 } });
    assert.deepEqual(result.items[newId].members, fresh.members);
    assert.equal(result.corrections[newId].name, 'SONG');
    assert.equal(result.items[oldId].identityAmbiguous, true);
    assert.equal(result.ambiguous, 0);
});
test('a fresh Ignore on a split child stays effective when old correction memory is ambiguous', () => {
    const old = issue('song', ['Song', 'Song (Part 1) (Live)']), id = api.getIssueId(old);
    const first = migrate({ [id]: fixed(old) }, { [id]: target('Song') });
    const next = issue('song', ['Song', 'Song (Live)']);
    first.items[id] = { ...fixed(next), intent: 'ignored', normalizationVersion: 2 };
    const again = migrate(first.items, first.corrections, [next]);
    assert.equal(api.dismissalStatus(again.items[id], api.currentBaseline(next), again.corrections[id]), 'hidden');
    assert.equal(again.items[id].identityAmbiguous, undefined);
    assert.equal(again.corrections[id].normalizationAmbiguous, true);
    assert.equal(again.ambiguous, 0);
});
test('migration is idempotent; unmatched legacy decisions and choices stay recoverable', () => {
    const old = issue('song', ['Song (Part 1) (Live)', 'Song (Part 1) (Remastered)']), id = api.getIssueId(old);
    const items = { [id]: fixed(old), legacy: { intent: 'fixed', legacy: true, at: 1 } };
    const corrections = { [id]: target('Song (Part 1)'), orphan: target('Unknown') };
    const first = migrate(items, corrections);
    assert.deepEqual(migrate(first.items, first.corrections), first);
    assert.deepEqual(first.items.legacy, items.legacy);
    assert.deepEqual(first.corrections.orphan, corrections.orphan);
});
test('correction-only memory with known source members follows an unambiguous key move', () => {
    const old = issue('song', ['Song (Part 1) (Live)']), id = api.getIssueId(old);
    const result = migrate({}, { [id]: { ...target('Song (Part 1)'), sourceMembers: Object.keys(api.currentBaseline(old)) } });
    assert.equal(Object.keys(result.items).length, 0);
    assert.equal(result.corrections[api.getIssueId(issue('song (part 1)', []))].name, 'Song (Part 1)');
});
test('quarantined history warns only when a current finding is available for review', () => {
    const old = issue('song', ['Song', 'Song (Part 1) (Live)']), id = api.getIssueId(old), items = { [id]: fixed(old) };
    const absent = migrate(items, {}, []);
    assert.equal(absent.ambiguous, 0);
    assert.equal(absent.items[id].identityAmbiguous, true);
    const child = issue('song (part 1)', ['Song (Part 1)', 'Song (Part 1) (Live)']);
    assert.equal(migrate(absent.items, absent.corrections, [child]).ambiguous, 1);
});
test('newly grouped pre-existing spellings ask for review rather than claiming repeat plays', () => {
    const old = issue('song', ['Song', 'Song (Live)']), id = api.getIssueId(old);
    const first = migrate({ [id]: fixed(old) }, { [id]: target('Song') });
    const current = { ...api.currentBaseline(old), '["A","Song ((Original Single Mono Version))"]': 10 };
    const observed = api.observeFixedRecords(first.items, { [id]: current }, first.corrections);
    assert.equal(observed[id].normalizationUpgrade, undefined);
    assert.equal(api.needsGroupingReview(observed[id], current, target('Song')), true);
    assert.match(api.recurrenceNote(observed[id], current, false, target('Song')), /Refined detection/);
    assert.doesNotMatch(api.recurrenceNote(observed[id], current, false, target('Song')), /new plays|since marked/);
});
test('an unchanged upgrade clears its transition marker and future new plays remain normal recurrences', () => {
    const old = issue('song', ['Song', 'Song (Live)']), id = api.getIssueId(old);
    const first = migrate({ [id]: fixed(old) }, { [id]: target('Song') });
    const observed = api.observeFixedRecords(first.items, { [id]: api.currentBaseline(old) }, first.corrections);
    assert.equal(observed[id].normalizationUpgrade, undefined);
    const returned = { ...api.currentBaseline(old), '["A","Song (Live)"]': 11 };
    assert.equal(api.needsGroupingReview(observed[id], returned, target('Song')), false);
    assert.equal(api.dismissalStatus(observed[id], returned, target('Song')), 'recurred');
});

(async () => {
    let passed = 0;
    migrate = load(['migrateNormalizationIdentities'], api).migrateNormalizationIdentities;
    for (const [name, fn] of tests) {
        try { await fn(); passed++; }
        catch (error) { console.error(`FAIL: ${name}\n${error.stack}`); process.exitCode = 1; }
    }
    console.log(`Detection / normalization identity contract: ${passed}/${tests.length} cases passed`);
})();
