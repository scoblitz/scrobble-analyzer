#!/usr/bin/env node
'use strict';

// Extract the shipped functions; no listening history or distribution dependencies.
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const source = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
function load(names, globals = {}) {
    const bodies = names.map(name => {
        const match = source.match(new RegExp(`        (?:async )?function ${name}\\(`));
        if (!match) throw new Error(`Missing top-level function: ${name}`);
        return source.slice(match.index, source.indexOf('\n        }\n', match.index) + 11);
    });
    return new Function(...Object.keys(globals), bodies.join('\n') + `\nreturn { ${names} };`)(...Object.values(globals));
}
const names = ['getIssueId', 'getItemId', 'getMemberKey', 'decodeDecisionId',
    'normalizeArtist', 'normalizeAlbum', 'normalizeTrack', 'stripMetadataLabels', 'differsOnlyByCase', 'getVisibleString', 'hasInvisibleChars',
    'currentBaseline', 'dismissalStatus', 'recurrenceDelta', 'recurrenceNote',
    'libraryBaselines', 'observeFixedRecords', 'addRememberedRecurrences',
    'exportObservation', 'isOlderObservation', 'isKeptMember', 'caseOnlyMembers', 'migrateNormalizationIdentities', 'needsGroupingReview',
    'isCompilationAlbum', 'buildAlbumEvidence', 'freshNormalizationDecision'];
const tests = [], test = (name, fn) => tests.push([name, fn]);
const S = (Artist, Album, Track, n, Date = '100') => Array.from({ length: n }, () => ({ Artist, Album, Track, Date }));
let api;
const trackIssue = (a = 10, b = 10) => ({ type: 'track', artist: 'A', normalized: 'song', title: 'A - Song', variations: [{ artist: 'A', name: 'Song', count: a }, { artist: 'A', name: 'Song (Live)', count: b }] });
const rowIssue = (type = 'missing') => ({ type, artist: 'A', album: 'Greatest Hits', title: type === 'missing' ? 'A' : 'A - Greatest Hits', variations: [{ name: 'Song', count: 10 }] });
const fixed = issue => ({ intent: 'fixed', identityVersion: 3, members: api.currentBaseline(issue), at: 1 });

test('a row that vanished returns below its original fixed count', () => {
    const issue = rowIssue(), id = api.getItemId(api.getIssueId(issue), 'Song');
    let items = { [id]: { intent: 'fixed', count: 10, identityVersion: 3, at: 1 } };
    items = api.observeFixedRecords(items, api.libraryBaselines(S('A', 'Album', 'Song', 10), items), {});
    assert.equal(items[id].observedCount, 0);
    const next = api.libraryBaselines(S('A', '', 'Song', 1), items);
    assert.equal(api.dismissalStatus(items[id], next[id]), 'recurred');
    assert.equal(api.recurrenceDelta(items[id], next[id]).newPlays, 1);
    const restored = api.addRememberedRecurrences([], items, next, {});
    assert.equal(restored.length, 1);
    assert.equal(restored[0].variations[0].count, 1);
    assert.equal(api.getItemId(api.getIssueId(restored[0]), 'Song'), id);
});
test('partial corrections lower the observed baseline without rewriting the marked baseline', () => {
    const record = { intent: 'fixed', count: 10, at: 1 }, id = 'x';
    const observed = api.observeFixedRecords({ [id]: record }, { [id]: 2 }, {});
    assert.equal(observed[id].count, 10);
    assert.equal(observed[id].observedCount, 2);
    assert.equal(record.observedCount, undefined);
    assert.equal(api.dismissalStatus(observed[id], 3), 'recurred');
    assert.equal(api.dismissalStatus(observed[id], 2), 'hidden');
});
test('a disappearing card member is tracked even after the variation stops being detected', () => {
    const issue = trackIssue(), id = api.getIssueId(issue), items = { [id]: fixed(issue) };
    const target = { kind: 'track', artist: 'A', name: 'Song', memberKey: JSON.stringify(['A', 'Song']) };
    const corrections = { [id]: target };
    const gone = api.libraryBaselines(S('A', 'Album', 'Song', 20), items);
    const observed = api.observeFixedRecords(items, gone, corrections);
    assert.equal(api.dismissalStatus(observed[id], gone[id], target), 'hidden');
    const returned = api.libraryBaselines([...S('A', 'Album', 'Song', 22), ...S('A', 'Album', 'Song (Live)', 1)], observed);
    assert.equal(api.dismissalStatus(observed[id], returned[id], target), 'recurred');
    assert.deepEqual(api.recurrenceDelta(observed[id], returned[id], target), { newPlays: 1, newMembers: [] });
    assert.equal(api.addRememberedRecurrences([], observed, returned, corrections)[0].type, 'track');
});
test('known kept spelling growth is excluded; other and new spellings still recur', () => {
    const issue = trackIssue(), rec = fixed(issue), target = { memberKey: JSON.stringify(['A', 'Song']) };
    assert.equal(api.dismissalStatus(rec, api.currentBaseline(trackIssue(50, 10)), target), 'hidden');
    assert.equal(api.dismissalStatus(rec, api.currentBaseline(trackIssue(50, 11)), target), 'recurred');
    assert.equal(api.dismissalStatus(rec, { ...api.currentBaseline(issue), '["A","Song - Remastered"]': 1 }, target), 'recurred');
    assert.equal(api.dismissalStatus(rec, api.currentBaseline(trackIssue(50, 10))), 'recurred');
});
test('compilation recurrence counts only the old album and same raw artist/track', () => {
    const issue = rowIssue('compilation'), id = api.getItemId(api.getIssueId(issue), 'Song');
    const items = { [id]: { intent: 'fixed', count: 10, at: 1 } };
    const gone = api.libraryBaselines([...S('A', 'Original Album', 'Song', 10), ...S('B', 'Greatest Hits', 'Song', 7)], items);
    assert.equal(gone[id], 0);
    const observed = api.observeFixedRecords(items, gone, {});
    const returned = api.libraryBaselines(S('A', 'Greatest Hits', 'Song', 1), observed);
    assert.equal(api.addRememberedRecurrences([], observed, returned, {})[0].album, 'Greatest Hits');
});
test('artist and invisible singleton recurrence bypasses normal discovery thresholds', () => {
    for (const issue of [
        { type: 'artist', normalized: 'example', title: 'The Example', variations: [{ name: 'The Example', count: 10 }, { name: 'Example', count: 10 }] },
        { type: 'invisible', subtype: 'track', artist: 'A', title: 'A - Song', variations: [{ artist: 'A', name: 'Song\u200b', count: 10 }] }
    ]) {
        const id = api.getIssueId(issue), items = { [id]: fixed(issue) };
        const observed = api.observeFixedRecords(items, api.libraryBaselines(S('Unrelated', 'B', 'T', 1), items), {});
        const rows = issue.type === 'artist' ? S('The Example', 'B', 'T', 1) : S('A', 'B', 'Song\u200b', 1);
        const current = api.libraryBaselines(rows, observed);
        const restored = api.addRememberedRecurrences([], observed, current, {});
        assert.equal(restored.length, 1);
        assert.equal(api.getIssueId(restored[0]), id);
    }
});
test('synthetic recurrence does not duplicate a normally detected card or row', () => {
    const issue = trackIssue(10, 11), id = api.getIssueId(issue), items = { [id]: fixed(trackIssue()) };
    const current = api.libraryBaselines([...S('A', 'B', 'Song', 10), ...S('A', 'B', 'Song (Live)', 11)], items);
    const result = api.addRememberedRecurrences([issue], items, current, {});
    assert.equal(result.length, 1);
    assert.equal(result[0], issue);
});
test('several returned tracks share one reconstructed card and retain exact row IDs', () => {
    const issue = rowIssue('compilation'), cardId = api.getIssueId(issue);
    const items = Object.fromEntries(['Song', 'Other Song'].map(name => [api.getItemId(cardId, name), { intent: 'fixed', count: 10, observedCount: 0, at: 1 }]));
    const current = api.libraryBaselines([...S('A', 'Greatest Hits', 'Song', 1), ...S('A', 'Greatest Hits', 'Other Song', 1)], items);
    const restored = api.addRememberedRecurrences([], items, current, {});
    assert.equal(restored.length, 1);
    assert.equal(restored[0].totalCount, 2);
    assert.equal(restored[0].variations.length, 2);
    assert.equal(api.getIssueId(restored[0]), cardId);
});
test('invisible cards observe equal titles under distinct raw artist spellings', () => {
    const issue = { type: 'invisible', subtype: 'album', artist: 'A', title: 'A - Album', variations: [{ artist: 'A', name: 'Album', count: 10 }, { artist: 'A\u200b', name: 'Album', count: 10 }] };
    const id = api.getIssueId(issue), items = { [id]: fixed(issue) };
    const target = { kind: 'album', artist: 'A', name: 'Album', memberKey: '["A","Album"]' };
    const gone = api.libraryBaselines(S('A', 'Album', 'T', 20), items);
    const observed = api.observeFixedRecords(items, gone);
    const current = api.libraryBaselines([...S('A', 'Album', 'T', 22), ...S('A\u200b', 'Album', 'T', 1)], observed);
    assert.equal(api.dismissalStatus(observed[id], current[id], target), 'recurred');
    assert.equal(api.recurrenceDelta(observed[id], current[id], target).newPlays, 1);
    const restored = api.addRememberedRecurrences([], observed, current, { [id]: target });
    assert.equal(api.getIssueId(restored[0]), id);
    assert.equal(restored[0].variations[1].artist, 'A\u200b');
});
test('ignored and legacy/ambiguous records are never newly observed or synthesized', () => {
    const id = api.getIssueId(trackIssue());
    for (const rec of [{ intent: 'ignored', members: api.currentBaseline(trackIssue()) }, { ...fixed(trackIssue()), legacy: true }, { ...fixed(trackIssue()), identityReview: true }]) {
        const items = { [id]: rec }, next = api.observeFixedRecords(items, { [id]: {} }, {});
        assert.deepEqual(next, items);
        assert.deepEqual(api.addRememberedRecurrences([], next, { [id]: {} }, {}), []);
    }
});
test('new scrobbles and file times order complete snapshots conservatively', () => {
    const previous = { latestScrobble: 100, modified: 200, hash: 'a' };
    assert.equal(api.isOlderObservation(previous, { latestScrobble: 99, modified: 300, hash: 'b' }), true);
    assert.equal(api.isOlderObservation(previous, { latestScrobble: 100, modified: 199, hash: 'b' }), true);
    assert.equal(api.isOlderObservation(previous, { latestScrobble: 100, modified: 200, hash: 'b' }), true);
    assert.equal(api.isOlderObservation(previous, previous), false);
    assert.equal(api.isOlderObservation(previous, { latestScrobble: 100, modified: 201, hash: 'b' }), false);
    assert.equal(api.isOlderObservation(previous, { latestScrobble: 101, modified: 1, hash: 'b' }), false);
    assert.deepEqual(api.exportObservation([{ Date: '30' }, { Date: '100' }, { Date: '50' }], { lastModified: 200 }, 'a'), previous);
});
test('encoded metadata containing item markers is decoded without confusing card and row', () => {
    const issue = { ...rowIssue('compilation'), album: 'Album]-item-Name' };
    const id = api.getIssueId(issue), row = api.getItemId(id, 'Song]-item-"Name"');
    assert.equal(api.decodeDecisionId(id).itemName, undefined);
    assert.equal(api.decodeDecisionId(row).itemName, 'Song]-item-"Name"');
    assert.equal(api.decodeDecisionId(row).album, issue.album);
    assert.equal(api.decodeDecisionId('legacy-id'), null);
});

test('correction memory persists independently of Restore and can be explicitly forgotten', () => {
    const state = { username: 'test-user', dismissals: {}, corrections: {}, savedObservation: { latestScrobble: 100, modified: 200, hash: 'a' } };
    let stored;
    const memory = load(['markDismissed', 'unmarkDismissed', 'saveDismissedState', 'loadDismissedState', 'userStorageKey', 'migrateDismissalBlob', 'legacyDismissalRecord'], {
        state, showImportNotices() {}, localStorage: { getItem: () => stored, setItem: (_, value) => { stored = value; } }
    });
    const choice = { kind: 'album', artist: 'A', name: 'Original Album' };
    memory.markDismissed('test', 10, 'fixed', choice);
    memory.unmarkDismissed('test');
    assert.deepEqual(state.corrections.test, choice);
    memory.markDismissed('test', 1, 'fixed');
    memory.saveDismissedState();
    const saved = JSON.parse(stored);
    assert.equal(saved.version, 4);
    assert.equal(saved.lastObservation.modified, 200);
    state.dismissals = memory.loadDismissedState('test-user');
    assert.deepEqual(state.corrections.test, choice);
    assert.equal(state.dismissals.test.count, 1);
    memory.markDismissed('test', 1, 'fixed', null);
    assert.equal(state.corrections.test, undefined);
    state.historicalImport = true;
    memory.unmarkDismissed('test');
    memory.markDismissed('new', 1, 'ignored');
    assert.equal(state.dismissals.test.count, 1);
    assert.equal(state.dismissals.new, undefined);
    assert.equal(memory.saveDismissedState(), false);
    assert.equal(stored, JSON.stringify(saved));
});
test('corrupt future history is protected and old storage starts without invented observations', () => {
    const state = {}, storage = { stored: JSON.stringify({ version: 3, items: {} }) };
    const memory = load(['loadDismissedState', 'migrateDismissalBlob', 'legacyDismissalRecord', 'userStorageKey'], { state, localStorage: { getItem: () => storage.stored } });
    assert.deepEqual(memory.loadDismissedState('user'), {});
    assert.equal(state.savedObservation, null);
    for (const data of [
        { version: 5, items: {} },
        { version: 4, items: {}, corrections: { a: { kind: 'album', artist: 'A', name: '' } } },
        { version: 4, items: {}, lastObservation: { latestScrobble: '100', modified: 200, hash: 'a' } }
    ]) {
        storage.stored = JSON.stringify(data);
        memory.loadDismissedState('user');
        assert.equal(state.persistenceReadFailed, true);
    }
});
test('optional controls use raw choices, escape metadata, and do not imply a default winner', () => {
    const state = { view: 'active', corrections: {} };
    const ui = load(['correctionControlsHtml', 'correctionChoiceLabel', 'readCorrectionChoice', 'rememberedCorrectionHtml', 'correctionLabel', 'getMemberKey'], {
        state, escapeHtml: text => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    });
    const issue = trackIssue(), id = api.getIssueId(issue);
    const html = ui.correctionControlsHtml(issue, id, false);
    assert.match(html, /value="" selected/);
    assert.doesNotMatch(html, /Live.*selected/);
    assert.match(ui.correctionChoiceLabel({ name: 'A\u00a0B\u200b  C' }), /U\+00A0.*U\+200B.*2×SP/);
    state.corrections[id] = { kind: 'track', artist: 'A', name: '<script>"', memberKey: '["A","<script>\\\""]' };
    assert.doesNotMatch(ui.rememberedCorrectionHtml(id), /<script>/);
    const select = { value: encodeURIComponent('["A","Song (Live)"]') };
    const control = { dataset: { correctionId: id }, querySelector: selector => selector === '.correction-choice' ? select : null };
    const card = { querySelectorAll: () => [control] };
    assert.deepEqual(ui.readCorrectionChoice(card, id, issue), { kind: 'track', artist: 'A', name: 'Song (Live)', memberKey: '["A","Song (Live)"]' });
    select.value = 'custom';
    control.querySelector = selector => ({ '.correction-choice': select, '.correction-custom': { value: 'Song\u00a0' }, '.correction-custom-artist': { value: 'Different Artist' } })[selector] || null;
    assert.deepEqual(ui.readCorrectionChoice(card, id, issue), { kind: 'track', artist: 'Different Artist', name: 'Song\u00a0', memberKey: '["Different Artist","Song\u00a0"]' });
    state.historicalImport = true;
    assert.equal(ui.correctionControlsHtml(issue, id, false), '');
});
test('full import sequence records disappearance, rejects older observations, and reopens a lone recurrence', async () => {
    const state = { importSequence: 0, expandedIssues: new Set(), correctionDrafts: new Map() }, records = new Map();
    let finished;
    class FileReader {
        readAsText(file) { finished = this.onload({ target: { result: JSON.stringify(file) } }); }
    }
    const nodes = Object.fromEntries(['emptyState', 'loadingState', 'resultsContainer', 'progressText', 'progressFill'].map(name => [name, { style: {} }]));
    const globals = { ...api, ...nodes, state, FileReader, document: { getElementById: () => ({ style: {} }) },
        console: { log() {}, error(...errors) { throw errors[1] || new Error(errors[0]); } }, parseCSV: text => { const file = JSON.parse(text); return { username: file.username || 'test-user', rows: file.rows }; },
        hashString: text => JSON.parse(text).hash, sleep: () => Promise.resolve(), setView() {}, migrateOldDismissals() {},
        issueGrid: { innerHTML: '' },
        migrateIssueIdentities: items => ({ items, ambiguous: 0 }), showImportNotices() {}, displayResults() {}, escapeHtml: x => x,
        localStorage: { getItem: key => records.get(key), setItem: (key, value) => records.set(key, value) },
        findArtistVariations: () => [], findAlbumVariations: () => [], findInvisibleCharacterIssues: () => [], findMissingAlbums: () => [], findCompilations: () => [],
        findTrackVariations: rows => {
            const a = rows.filter(s => s.Track === 'Song').length, b = rows.filter(s => s.Track === 'Song (Live)').length;
            return a && b ? [trackIssue(a, b)] : [];
        }
    };
    const flow = load(['processFile', 'markDismissed', 'saveDismissedState', 'loadDismissedState', 'userStorageKey', 'migrateDismissalBlob', 'legacyDismissalRecord', 'decisionStatus'], globals);
    const upload = async file => { await flow.processFile(file); await finished; };
    const first = { hash: 'first', lastModified: 200, rows: [...S('A', 'B', 'Song', 10), ...S('A', 'B', 'Song (Live)', 10)] };
    await upload(first);
    const id = api.getIssueId(trackIssue()), badKey = '["A","Song (Live)"]';
    const target = { kind: 'track', artist: 'A', name: 'Song', memberKey: '["A","Song"]' };
    flow.markDismissed(id, api.currentBaseline(trackIssue()), 'fixed', target);
    flow.saveDismissedState();
    await upload({ hash: 'corrected', lastModified: 300, rows: S('A', 'B', 'Song', 20) });
    assert.equal(state.dismissals[id].observedMembers[badKey], 0);
    assert.equal(state.issues.length, 0);
    const saved = records.get('scrobble-analyzer-user-test-user');
    await upload(first);
    assert.equal(state.historicalImport, true);
    assert.equal(records.get('scrobble-analyzer-user-test-user'), saved);
    assert.equal(state.dismissals[id].observedMembers[badKey], 0);
    assert.equal(flow.decisionStatus(id, api.currentBaseline(trackIssue())), 'hidden');
    // Same contents with an older filesystem time must not lower the watermark.
    await upload({ hash: 'corrected', lastModified: 250, rows: S('A', 'B', 'Song', 20) });
    assert.equal(state.savedObservation.modified, 300);
    await upload({ hash: 'returned', lastModified: 400, rows: S('A', 'B', 'Song (Live)', 1) });
    assert.equal(state.historicalImport, false);
    assert.equal(state.issues.length, 1);
    assert.equal(flow.decisionStatus(id, api.currentBaseline(state.issues[0])), 'recurred');
    assert.match(api.recurrenceNote(state.dismissals[id], api.currentBaseline(state.issues[0]), false, target), /1 new play.*disappeared/);
    // Re-mark stamps a fresh baseline and does not forget the chosen spelling.
    flow.markDismissed(id, api.currentBaseline(state.issues[0]), 'fixed');
    flow.saveDismissedState();
    await upload({ hash: 'returned', lastModified: 400, rows: S('A', 'B', 'Song (Live)', 1) });
    assert.equal(flow.decisionStatus(id, { [badKey]: 1 }), 'hidden');
    assert.deepEqual(state.corrections[id], { ...target, sourceMembers: [badKey], normalizationVersion: 2 });
    // Account separation includes watermark and correction memory.
    await upload({ hash: 'other', lastModified: 1, username: 'other-user', rows: S('A', 'B', 'Song', 1) });
    assert.deepEqual(state.corrections, {});
    assert.equal(state.historicalImport, false);
});

(async () => {
    let passed = 0;
    try { api = load(names, { console: { log() {} } }); }
    catch (error) { console.error(error.message); process.exitCode = 1; return; }
    for (const [name, fn] of tests) {
        try { await fn(); passed++; }
        catch (error) { console.error(`FAIL: ${name}\n${error.stack}`); process.exitCode = 1; }
    }
    console.log(`Recurrence / correction contract: ${passed}/${tests.length} cases passed`);
})();
