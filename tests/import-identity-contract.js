#!/usr/bin/env node
'use strict';

// Developer-only regression tests. Functions are extracted from the shipped
// HTML, so the browser distribution still needs no dependencies or build step.
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const source = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
function load(names, globals = {}) {
    const bodies = names.map(name => {
        const match = source.match(new RegExp(`        (?:async )?function ${name}\\(`));
        if (!match) throw new Error(`Missing top-level function: ${name}`);
        const end = source.indexOf('\n        }\n', match.index);
        return source.slice(match.index, end + 11);
    });
    return new Function(...Object.keys(globals), bodies.join('\n') + `\nreturn { ${names} };`)(...Object.values(globals));
}
const names = ['parseCSV', 'parseCSVLine', 'parseCSVRecords', 'getIssueId', 'getItemId', 'getMemberKey',
    'normalizeArtist', 'normalizeAlbum', 'normalizeTrack', 'stripMetadataLabels', 'differsOnlyByCase', 'getVisibleString',
    'hasInvisibleChars', 'differsOnlyInvisibly', 'findArtistVariations',
    'findAlbumVariations', 'findTrackVariations', 'findMissingAlbums',
    'findCompilations', 'isCompilationAlbum', 'findInvisibleCharacterIssues', 'currentBaseline',
    'dismissalStatus', 'getLegacyIssueId', 'getLegacyItemId', 'migrateIssueIdentities', 'isKeptMember'];
const api = load(names, { console: { log() {} } });
const tests = [];
const test = (name, fn) => tests.push([name, fn]);
const S = (Artist, Album, Track, n) => Array.from({ length: n }, () => ({ Artist, Album, Track }));
const csv = body => 'Artist;Album;AlbumId;Track;Date#test-user\n' + body;

test('raw edge whitespace and quoted delimiters survive parsing', () => {
    const row = api.parseCSV(csv('" Artist\u00a0";"Album;Name";;"""Heroes""";1700000000000')).rows[0];
    assert.equal(row.Artist, ' Artist\u00a0');
    assert.equal(row.Album, 'Album;Name');
    assert.equal(row.Track, '"Heroes"');
});
test('quoted multiline fields remain one record', () => {
    const result = api.parseCSV(csv('Artist;Album;;"Song\r\nName";1700000000000\r\n'));
    assert.equal(result.rows.length, 1);
    assert.equal(result.rows[0].Track, 'Song\r\nName');
});
test('missing Album is rejected instead of fabricating findings', () => {
    assert.throws(() => api.parseCSV('Artist;Track;Date#test-user\nA;T;1'), /Album/);
});
test('missing account identity is rejected', () => {
    assert.throws(() => api.parseCSV('Artist;Album;Track;Date\nA;B;T;1'), /username/i);
});
test('truncated and unterminated records are rejected', () => {
    assert.throws(() => api.parseCSV(csv('A;B;;T')), /column|field/i);
    assert.throws(() => api.parseCSV(csv('A;B;;"T;1')), /quote/i);
});
test('duplicate headers and invalid timestamps are rejected', () => {
    assert.throws(() => api.parseCSV('Artist;Artist;Album;Track;Date#test-user\nA;A;B;T;1'), /duplicate/i);
    assert.throws(() => api.parseCSV(csv('A;B;;T;not-a-date')), /timestamp/i);
});
test('Unicode, punctuation and letter case stay distinct in row IDs', () => {
    for (const [a, b] of [['愛', '夢'], ['A/B', 'A-B'], ['Song', 'SONG'], ['Song (Live)', 'Song [Live]']]) {
        assert.notEqual(api.getItemId('missing-a', a), api.getItemId('missing-a', b));
    }
});
test('a change in the most-played spelling keeps the same card ID', () => {
    const before = api.findArtistVariations([...S('The Example', '', 'T', 6), ...S('Example', '', 'T', 5)])[0];
    const after = api.findArtistVariations([...S('The Example', '', 'T', 6), ...S('Example', '', 'T', 7)])[0];
    assert.equal(api.getIssueId(before), api.getIssueId(after));
});
test('invisible album and track cards have separate IDs', () => {
    const issues = api.findInvisibleCharacterIssues([...S('A', 'Same\u00a0Name', 'Same\u00a0Name', 4), ...S('A', 'Same Name', 'Same Name', 3)]);
    assert.equal(new Set(issues.map(api.getIssueId)).size, issues.length);
});
test('same-title members under different artist spellings retain separate baselines', () => {
    const issue = n => api.findInvisibleCharacterIssues([...S('A', 'Album', 'Song', n), ...S('A\u200b', 'Album', 'Song', 3)]).find(i => i.subtype === 'track');
    const before = api.currentBaseline(issue(4));
    assert.equal(Object.keys(before).length, 2);
    assert.equal(api.dismissalStatus({ intent: 'fixed', members: before }, api.currentBaseline(issue(5))), 'recurred');
});
test('reserved property names are ordinary metadata', () => {
    assert.equal(api.findMissingAlbums(S('constructor', '', '__proto__', 3))[0].variations[0].name, '__proto__');
});
test('compound keys preserve literal separator text', () => {
    const issues = api.findAlbumVariations([...S('A|||B', 'Album', 'T', 3), ...S('A|||B', 'Album (Deluxe)', 'T', 3)]);
    assert.equal(issues[0].artist, 'A|||B');
    assert.deepEqual(issues[0].variations.map(v => v.name).sort(), ['Album', 'Album (Deluxe)']);
});

test('a previous winning spelling migrates after another member overtakes it', () => {
    const before = api.findArtistVariations([...S('The Example', '', 'T', 6), ...S('Example', '', 'T', 5)])[0];
    const after = api.findArtistVariations([...S('The Example', '', 'T', 6), ...S('Example', '', 'T', 7)])[0];
    const oldId = api.getLegacyIssueId(before);
    const result = api.migrateIssueIdentities({ [oldId]: { intent: 'fixed', members: { 'The Example': 6, Example: 5 }, at: 42 } }, [after]);
    const record = result.items[api.getIssueId(after)];
    assert.equal(record.at, 42);
    assert.equal(result.items[oldId], undefined);
    assert.equal(api.dismissalStatus(record, api.currentBaseline(after)), 'recurred');
});
test('unambiguous ignored rows retain their intent and count', () => {
    const issue = api.findMissingAlbums(S('A', '', 'Song', 3))[0];
    const oldId = api.getLegacyItemId(api.getLegacyIssueId(issue), 'Song');
    const record = { intent: 'ignored', count: 3, at: 42 };
    const result = api.migrateIssueIdentities({ [oldId]: record }, [issue]);
    assert.deepEqual(result.items[api.getItemId(api.getIssueId(issue), 'Song')], { ...record, identityVersion: 3 });
});
test('colliding legacy row decisions are quarantined, never copied to both rows', () => {
    const issue = api.findMissingAlbums([...S('A', '', 'A/B', 3), ...S('A', '', 'A-B', 3)])[0];
    const oldId = api.getLegacyItemId(api.getLegacyIssueId(issue), 'A/B');
    const result = api.migrateIssueIdentities({ [oldId]: { intent: 'ignored', at: 42 } }, [issue]);
    assert.equal(result.ambiguous, 1);
    assert.equal(result.items[oldId].identityAmbiguous, true);
    issue.variations.forEach(row => assert.equal(result.items[api.getItemId(api.getIssueId(issue), row.name)], undefined));
    // Even after one sibling disappears, a quarantined record stays inactive.
    const single = { ...issue, variations: [issue.variations[0]] };
    const next = api.migrateIssueIdentities(result.items, [single]);
    assert.equal(next.items[api.getItemId(api.getIssueId(single), single.variations[0].name)], undefined);
    const resolved = { ...result.items };
    issue.variations.forEach(row => { resolved[api.getItemId(api.getIssueId(issue), row.name)] = { intent: 'ignored', identityVersion: 3, at: 50 }; });
    assert.equal(api.migrateIssueIdentities(resolved, [issue]).ambiguous, 0);
});
test('legacy invisible baselines with overwritten members require review', () => {
    const issue = api.findInvisibleCharacterIssues([...S('A', 'Album', 'Song', 4), ...S('A\u200b', 'Album', 'Song', 3)]).find(i => i.subtype === 'track');
    const oldId = api.getLegacyIssueId(issue);
    const result = api.migrateIssueIdentities({ [oldId]: { intent: 'fixed', members: { Song: 3 }, at: 42 } }, [issue]);
    const record = result.items[api.getIssueId(issue)];
    assert.equal(record.identityReview, true);
    assert.equal(api.dismissalStatus(record, api.currentBaseline(issue)), 'recurred');
});
test('existing v3 decisions win and unrelated legacy records remain recoverable', () => {
    const issue = api.findArtistVariations([...S('The A', '', 'T', 6), ...S('A', '', 'T', 5)])[0];
    const id = api.getIssueId(issue), oldId = api.getLegacyIssueId(issue);
    const record = { intent: 'fixed', identityVersion: 3, members: api.currentBaseline(issue), at: 9 };
    const orphan = { intent: 'ignored', at: 1 };
    const first = api.migrateIssueIdentities({ [oldId]: orphan, [id]: record, 'artist-absent': orphan }, [issue]);
    assert.deepEqual(first.items[id], record);
    assert.deepEqual(first.items['artist-absent'], orphan);
    assert.deepEqual(api.migrateIssueIdentities(first.items, [issue]), first);
});

test('only the latest import can commit results or show a read error', async () => {
    const state = { importSequence: 0, expandedIssues: new Set(), correctionDrafts: new Map() };
    const readers = [], pending = [], published = [];
    class FileReader {
        constructor() { readers.push(this); }
        readAsText(file) { this.onload({ target: { result: file } }); }
    }
    const elements = Object.fromEntries(['emptyState', 'loadingState', 'resultsContainer', 'progressText', 'progressFill'].map(key => [key, { style: {} }]));
    const notice = { style: {} };
    const globals = { ...elements, state, FileReader, document: { getElementById: () => notice }, console: { log() {}, error() {} },
        hashString: x => x, parseCSV: x => ({ username: x, rows: [{ Artist: x }] }),
        sleep: () => new Promise(resolve => pending.push(resolve)),
        loadDismissedState: () => ({}), setView() {}, migrateOldDismissals() {},
        exportObservation: () => ({ latestScrobble: 1, modified: 1, hash: 'test' }), isOlderObservation: () => false,
        libraryBaselines: () => ({}), observeFixedRecords: items => items,
        addRememberedRecurrences: issues => issues, saveDismissedState() {},
        migrateIssueIdentities: items => ({ items, ambiguous: 0 }), showImportNotices() {},
        migrateNormalizationIdentities: items => ({ items, corrections: {}, ambiguous: 0 }),
        buildAlbumEvidence: () => new Map(), issueGrid: { innerHTML: '' },
        displayResults: () => published.push({ username: state.username, artists: state.issues.map(i => i.artist) }), escapeHtml: x => x };
    for (const name of ['findArtistVariations', 'findAlbumVariations', 'findTrackVariations', 'findMissingAlbums', 'findCompilations', 'findInvisibleCharacterIssues']) {
        globals[name] = rows => [{ artist: rows[0].Artist }];
    }
    const { processFile } = load(['processFile'], globals);
    await processFile('user-a');
    pending.shift()();
    await Promise.resolve();
    await processFile('user-b');
    for (let i = 0; pending.length && i < 20; i++) {
        const next = pending.splice(0); next.forEach(resolve => resolve());
        await Promise.resolve(); await Promise.resolve();
    }
    assert.deepEqual(published, [{ username: 'user-b', artists: Array(6).fill('user-b') }]);
    const before = JSON.stringify(elements);
    readers[0].onerror();
    assert.equal(JSON.stringify(elements), before);
});
test('storage failures keep session decisions usable and protect unreadable data', () => {
    const state = { username: 'test-user', dismissals: { sample: { intent: 'ignored', at: 1 } } };
    let writes = 0;
    const api = load(['loadDismissedState', 'saveDismissedState', 'userStorageKey', 'migrateDismissalBlob', 'legacyDismissalRecord'], {
        state, showImportNotices() {}, localStorage: { getItem() { throw new Error('blocked'); }, setItem() { writes++; } }
    });
    assert.deepEqual(api.loadDismissedState('test-user'), {});
    assert.equal(api.saveDismissedState(), false);
    assert.equal(writes, 0);
    assert.equal(state.dismissals.sample.intent, 'ignored');
    state.persistenceReadFailed = false;
    assert.equal(api.saveDismissedState(), true);
});
test('write failures do not throw or erase session decisions', () => {
    const state = { username: 'test-user', dismissals: { sample: { intent: 'fixed', count: 3, at: 1 } } };
    const api = load(['saveDismissedState', 'userStorageKey'], {
        state, showImportNotices() {}, localStorage: { setItem() { throw new Error('quota'); } }
    });
    assert.equal(api.saveDismissedState(), false);
    assert.equal(state.dismissals.sample.count, 3);
    assert.match(state.persistenceNotice, /could not be saved/);
});
test('legacy invisible subtypes cannot share a migrated dismissal', () => {
    const issues = api.findInvisibleCharacterIssues([...S('A', 'Same\u00a0Name', 'Same\u00a0Name', 4), ...S('A', 'Same Name', 'Same Name', 3)]);
    const oldId = api.getLegacyIssueId(issues[0]);
    const result = api.migrateIssueIdentities({ [oldId]: { intent: 'ignored', at: 42 } }, issues);
    assert.equal(result.ambiguous, 1);
    issues.forEach(i => assert.equal(result.items[api.getIssueId(i)], undefined));
});
test('conflicting legacy aliases for one group are retained for review', () => {
    const issue = api.findArtistVariations([...S('The Example', '', 'T', 6), ...S('Example', '', 'T', 5)])[0];
    const result = api.migrateIssueIdentities({
        'artist-the-example': { intent: 'fixed', members: { 'The Example': 6, Example: 5 }, at: 1 },
        'artist-example': { intent: 'ignored', at: 2 }
    }, [issue]);
    assert.equal(result.ambiguous, 2);
    assert.equal(result.items[api.getIssueId(issue)], undefined);
});
test('old file-hash data is removed only after a successful migration save', () => {
    const issue = api.findMissingAlbums(S('A', '', 'Song', 3))[0];
    const key = 'scrobble-analyzer-file';
    const oldId = `${api.getLegacyIssueId(issue)}-item-0`;
    const stored = JSON.stringify({ dismissed: [oldId], savedAt: 42 });
    for (const saved of [false, true]) {
        const state = { dismissals: {} }, removed = [];
        const globals = { ...api, state, console: { log() {} }, saveDismissedState: () => saved,
            localStorage: { length: 1, key: () => key, getItem: () => stored, removeItem: k => removed.push(k) } };
        const { migrateOldDismissals } = load(['migrateOldDismissals', 'isDismissed', 'legacyDismissalRecord'], globals);
        migrateOldDismissals('file', [issue]);
        assert.equal(state.dismissals[api.getItemId(api.getIssueId(issue), 'Song')].legacy, true);
        assert.deepEqual(removed, saved ? [key] : []);
    }
});

(async () => {
    let passed = 0;
    for (const [name, fn] of tests) {
        try { await fn(); passed++; }
        catch (error) { console.error(`FAIL: ${name}\n${error.stack}`); process.exitCode = 1; }
    }
    console.log(`Import / identity contract: ${passed}/${tests.length} cases passed`);
})();
