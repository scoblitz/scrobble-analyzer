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
const api = load(['getIssueId', 'getItemId', 'getMemberKey', 'currentBaseline', 'getVisibleString', 'inView', 'intentLabel', 'dismissalStatus', 'isKeptMember',
    'isCompilationAlbum', 'buildAlbumEvidence', 'rememberedAlbumEvidence', 'getAlbumCandidates', 'decodeDecisionId',
    'selectIssueRows', 'issuePage', 'freshNormalizationDecision'], { console: { log() {} } });
const tests = [], test = (name, fn) => tests.push([name, fn]);
// Native textContent/innerHTML escaping preserves quotes in text nodes.
// Attribute escaping must therefore handle quotes explicitly.
const textDocument = { createElement: () => ({ textContent: '', get innerHTML() {
    return String(this.textContent).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
} }) };
const card = (type, title, rows, artist = 'A') => ({ type, title, artist, normalized: title, totalCount: rows.reduce((n, r) => n + r.count, 0), variations: rows });
const rowCard = () => card('missing', 'A', [{ name: 'Hidden', count: 2000 }, { name: 'Wanted', count: 2 }, { name: 'Other', count: 5 }]);
function select(issues, options = {}, items = {}, choices = {}) {
    const status = (id, row) => api.dismissalStatus(items[api.getItemId(id, row.name)], row.count, choices[api.getItemId(id, row.name)]);
    return api.selectIssueRows(issues, { view: 'active', currentFilter: 'all', currentArtist: '', searchQuery: '', sortBy: 'count', ...options }, items, choices,
        (issue, id) => api.dismissalStatus(items[id], {}, choices[id]), status);
}
test('search narrows per-track rows and their impact; hidden rows cannot cause a hit', () => {
    const issue = rowCard(), id = api.getIssueId(issue), items = { [api.getItemId(id, 'Hidden')]: { intent: 'ignored' } };
    assert.equal(select([issue], { searchQuery: 'hidden' }, items).length, 0);
    const [found] = select([issue], { searchQuery: 'wanted' }, items);
    assert.deepEqual(found._visibleRows.map(r => r.name), ['Wanted']);
    assert.equal(found._visibleCount, 2);
    assert.equal(found._rowsInView, 1);
    assert.equal(issue.variations.length, 3);
});
test('artist and source-album searches preserve all rows in the chosen view', () => {
    const issue = rowCard(), id = api.getIssueId(issue), items = { [api.getItemId(id, 'Hidden')]: { intent: 'ignored' } };
    assert.equal(select([issue], { searchQuery: 'a' }, items)[0]._rowsInView, 2);
    const compilation = { ...issue, type: 'compilation', album: 'Greatest Hits', title: 'A - Greatest Hits' };
    assert.equal(select([compilation], { searchQuery: 'greatest' })[0]._rowsInView, 3);
});
test('impact and variation sorting use only visible rows', () => {
    const a = rowCard(), b = card('missing', 'B', [{ name: 'B song', count: 10 }], 'B'), id = api.getIssueId(a);
    const items = { [api.getItemId(id, 'Hidden')]: { intent: 'ignored' } };
    assert.equal(select([a, b], {}, items)[0].title, 'B');
    assert.equal(select([a, b], { sortBy: 'variations' }, items)[0].title, 'A');
});
test('Fixed and Ignored searches use only rows belonging to that view', () => {
    const issue = rowCard(), id = api.getIssueId(issue), items = {
        [api.getItemId(id, 'Hidden')]: { intent: 'ignored' },
        [api.getItemId(id, 'Wanted')]: { intent: 'fixed', count: 2 }
    };
    assert.equal(select([issue], { view: 'fixed', searchQuery: 'other' }, items).length, 0);
    assert.deepEqual(select([issue], { view: 'ignored' }, items)[0]._visibleRows.map(r => r.name), ['Hidden']);
});
test('ordinary variation search retains siblings for comparison and recognizes any artist member', () => {
    const issue = card('artist', 'Winner', [{ name: 'Winner', count: 10 }, { name: 'Alias', count: 2 }], '');
    const [found] = select([issue], { searchQuery: 'alias', currentArtist: 'Alias' });
    assert.equal(found._visibleRows.length, 2);
});
test('remembered row corrections are searchable without leaking hidden rows', () => {
    const issue = rowCard(), id = api.getIssueId(issue), choices = { [api.getItemId(id, 'Wanted')]: { name: 'Original Album' } };
    assert.deepEqual(select([issue], { searchQuery: 'original' }, {}, choices)[0]._visibleRows.map(r => r.name), ['Wanted']);
    assert.equal(select([issue], { searchQuery: 'original' }, { [api.getItemId(id, 'Wanted')]: { intent: 'ignored' } }, choices).length, 0);
});
test('follow-up triage prioritizes returned rows and includes quarantined child groups', () => {
    const a = rowCard(), b = card('track', 'B', [{ name: 'B', count: 100 }], 'B'), id = api.getIssueId(a);
    const items = { [api.getItemId(id, 'Wanted')]: { intent: 'fixed', count: 1 } };
    const result = select([a, b], { followupsOnly: true }, items);
    assert.equal(result.length, 1);
    assert.deepEqual(result[0]._visibleRows.map(r => r.name), ['Wanted']);
    assert.equal(select([a, b], { sortBy: 'followups' }, items)[0]._id, id);
    const target = api.getIssueId(b);
    assert.equal(select([b], { followupsOnly: true }, { orphan: { identityAmbiguous: true, normalizationTargets: [target] } }).length, 1);
});
test('follow-up restriction does not conceal Fixed and Ignored views', () => {
    const issue = rowCard(), id = api.getIssueId(issue), items = { [api.getItemId(id, 'Wanted')]: { intent: 'fixed', count: 2 } };
    assert.equal(select([issue], { view: 'fixed', followupsOnly: true }, items)[0]._rowsInView, 1);
});
test('resolved migration sources do not keep a deliberately restored child in follow-ups', () => {
    const issue = card('track', 'Child', [{ name: 'Child', count: 10 }]), id = api.getIssueId(issue);
    const items = { orphan: { identityAmbiguous: true, normalizationTargets: [id] } };
    const choices = { [id]: { normalizationVersion: 2, name: 'Child' } };
    assert.equal(select([issue], { followupsOnly: true }, items, choices).length, 0);
});
test('every card is reachable through bounded pages with accurate finding counts', () => {
    const cards = Array.from({ length: 211 }, (_, n) => ({ _id: String(n), type: n === 210 ? 'missing' : 'track', _rowsInView: n === 210 ? 4 : 0 }));
    const seen = [0, 1, 2].flatMap(page => api.issuePage(cards, page, 100).cards.map(c => c._id));
    assert.equal(new Set(seen).size, 211);
    const last = api.issuePage(cards, 2, 100);
    assert.equal(last.findings, 214);
    assert.equal(last.start, 201);
    assert.equal(last.end, 211);
    assert.equal(last.cards.length, 11);
});
test('page selection clamps after dismissal or an empty filter', () => {
    assert.equal(api.issuePage([{}], 3, 100).page, 0);
    assert.deepEqual(api.issuePage([], 3, 100), { cards: [], page: 0, pages: 0, start: 0, end: 0, findings: 0 });
});
const S = (Artist, Album, Track, n = 1) => Array.from({ length: n }, () => ({ Artist, Album, Track, AlbumId: 'unreliable' }));
test('album evidence is exact to artist and track, preserving distinct album editions', () => {
    const evidence = api.buildAlbumEvidence([...S('A', 'Original', 'Song', 2), ...S('A', 'Original (Deluxe)', 'Song', 1), ...S('B', 'Wrong', 'Song', 9), ...S('A', 'Live Album', 'Song (Live)', 9)]);
    const candidates = api.getAlbumCandidates(evidence, new Map(), 'A', 'Song', '');
    assert.deepEqual(candidates.map(c => [c.name, c.count]), [['Original', 2], ['Original (Deluxe)', 1]]);
});
test('compilation-like, empty and current source albums are excluded from library candidates', () => {
    const evidence = api.buildAlbumEvidence([...S('A', 'Greatest Hits', 'Song'), ...S('A', 'Gold: Greatest Hits', 'Song'), ...S('A', ' ', 'Song'), ...S('A', 'Original', 'Song')]);
    assert.deepEqual(api.getAlbumCandidates(evidence, new Map(), 'A', 'Song', 'Original'), []);
    assert.equal(api.isCompilationAlbum('Gold'), false);
    assert.equal(api.isCompilationAlbum('The Gold Experience'), false);
    assert.equal(api.isCompilationAlbum('Gold: Greatest Hits'), true);
});
test('memory for the same exact artist and track ranks first even after its old source disappears', () => {
    const issue = card('missing', 'A', [{ name: 'Song', count: 1 }]), id = api.getItemId(api.getIssueId(issue), 'Song');
    const memory = api.rememberedAlbumEvidence({ [id]: { kind: 'album', artist: 'A', name: 'Chosen Album' } });
    const evidence = api.buildAlbumEvidence(S('A', 'Popular Album', 'Song', 100));
    const candidates = api.getAlbumCandidates(evidence, memory, 'A', 'Song', '');
    assert.equal(candidates[0].name, 'Chosen Album');
    assert.equal(candidates[0].remembered, true);
    assert.equal(candidates[0].count, 0);
    assert.deepEqual(api.getAlbumCandidates(evidence, memory, 'B', 'Song', ''), []);
});
test('memory deduplicates across source issues and skips ambiguous choices', () => {
    const missing = card('missing', 'A', [{ name: 'Song', count: 1 }]), compilation = { ...missing, type: 'compilation', album: 'Greatest Hits' };
    const id = issue => api.getItemId(api.getIssueId(issue), 'Song');
    const memory = api.rememberedAlbumEvidence({ [id(missing)]: { kind: 'album', artist: 'A', name: 'Album' }, [id(compilation)]: { kind: 'album', artist: 'A', name: 'Album' } });
    assert.equal(api.getAlbumCandidates(new Map(), memory, 'A', 'Song', '').length, 1);
    assert.equal(api.rememberedAlbumEvidence({ [id(missing)]: { kind: 'album', artist: 'A', name: 'Album', normalizationAmbiguous: true } }).size, 0);
});
test('raw Unicode, delimiter and prototype-like names remain distinct evidence', () => {
    const evidence = api.buildAlbumEvidence([...S('constructor', '__proto__', 'Song|||'), ...S('constructor', 'Space\u00a0', 'Song'), ...S('constructor', 'Space', 'Song')]);
    assert.equal(api.getAlbumCandidates(evidence, new Map(), 'constructor', 'Song|||', '')[0].name, '__proto__');
    assert.equal(api.getAlbumCandidates(evidence, new Map(), 'constructor', 'Song', '').length, 2);
});
test('details toggling keeps visible state, accessibility state and expansion memory together', () => {
    const state = { expandedIssues: new Set() }, button = { setAttribute(key, value) { this[key] = value; } }, panel = {};
    const card = { dataset: { issueId: 'card' }, classList: { toggle(name, value) { this[name] = value; } },
        querySelector: selector => selector === '.details-toggle' ? button : panel };
    const { toggleIssueDetails } = load(['toggleIssueDetails'], { state });
    toggleIssueDetails(card);
    assert.equal(button['aria-expanded'], 'true');
    assert.equal(panel.hidden, false);
    assert.equal(state.expandedIssues.has('card'), true);
    toggleIssueDetails(card);
    assert.equal(button['aria-expanded'], 'false');
    assert.equal(panel.hidden, true);
});
test('paging focuses a usable top control without scrolling back to the bottom', () => {
    const state = { page: 0 }, content = { scrollTop: 4000 }, focused = [], rendered = [];
    const previous = { focus: options => focused.push(options) }, next = { disabled: true };
    const navigation = { querySelector: selector => selector.includes('not(:disabled)') ? previous : next };
    const { changeIssuePage } = load(['changeIssuePage'], { state, renderIssues: () => rendered.push(state.page),
        document: { querySelector: () => content, getElementById: id => { assert.equal(id, 'pagination-top'); return navigation; } } });
    changeIssuePage('next');
    assert.deepEqual(rendered, [1]);
    assert.equal(content.scrollTop, 0);
    assert.deepEqual(focused, [{ preventScroll: true }]);
});
test('unsaved raw album and custom-spelling fields survive rebuilding controls', () => {
    const state = { correctionDrafts: new Map() };
    const originalFields = { 'correction-choice': { value: 'custom' }, 'correction-custom': { value: 'Song\u00a0' }, 'correction-custom-artist': { value: 'A ' } };
    const control = { dataset: { correctionId: 'id' }, open: true, tagName: 'DETAILS', querySelector: selector => originalFields[selector.slice(1)] };
    const ui = load(['captureCorrectionDrafts', 'applyCorrectionDrafts'], { state, issueGrid: { querySelectorAll: () => [control] } });
    ui.captureCorrectionDrafts();
    const fields = { 'correction-choice': { value: '' }, 'correction-custom': { value: '' }, 'correction-custom-artist': { value: '' }, 'correction-custom-fields': { hidden: true } };
    const rebuilt = { ...control, open: false, querySelector: selector => fields[selector.slice(1)] };
    ui.applyCorrectionDrafts({ querySelectorAll: () => [rebuilt] });
    assert.equal(fields['correction-custom'].value, 'Song\u00a0');
    assert.equal(fields['correction-custom-artist'].value, 'A ');
    assert.equal(fields['correction-custom-fields'].hidden, false);
    assert.equal(rebuilt.open, true);
    originalFields['correction-album'] = { value: 'Album\u00a0' };
    ui.captureCorrectionDrafts();
    assert.equal(state.correctionDrafts.get('id').fields['correction-album'], 'Album\u00a0');
});
function rendering(issues, options = {}, items = {}) {
    const state = { issues, dismissals: items, corrections: {}, view: 'active', currentFilter: 'all', currentArtist: '', searchQuery: '', sortBy: 'count',
        page: 0, pageSize: 100, expandedIssues: new Set(), correctionDrafts: new Map(), albumEvidence: new Map(), albumMemory: new Map(), ...options };
    const node = () => ({ children: [], dataset: {}, style: {}, classList: { contains: () => false }, listeners: {},
        set innerHTML(value) { this.html = value; this.children = []; }, get innerHTML() { return this.html; },
        querySelectorAll: () => [], querySelector: () => null, addEventListener(name, fn) { this.listeners[name] = fn; },
        appendChild(child) { this.children.push(child); }, focus() {} });
    const issueGrid = node(), nodes = new Map(), get = id => { if (!nodes.has(id)) nodes.set(id, node()); return nodes.get(id); };
    let writes = 0;
    const globals = { ...api, ...load(['escapeHtml'], { document: textDocument }), state, issueGrid, console: { log() {} },
        document: { activeElement: null, getElementById: get, querySelector: () => ({ scrollTop: 0 }), createElement: node },
        cardStatus: (issue, id) => api.dismissalStatus(items[id], {}),
        itemStatus: (id, row) => api.dismissalStatus(items[api.getItemId(id, row.name)], row.count),
        confusableMarkChars: () => [], lookalikeQuoteChars: () => [], getLastFmUrl: () => 'https://www.last.fm/', getGoogleSearchUrl: () => '',
        variationsNeedLookup: () => false, rememberedCorrectionHtml: () => '', correctionControlsHtml: () => '',
        captureCorrectionDrafts() {}, applyCorrectionDrafts() {}, updateCounts() {}, readCorrectionChoice: () => null,
        markDismissed: (id, current, intent) => { items[id] = { intent, count: current }; }, unmarkDismissed: id => { delete items[id]; },
        saveDismissedState: () => { writes++; }, recurrenceNote: () => 'Returned', toggleIssueDetails() {} };
    const { renderIssues } = load(['renderIssues'], globals);
    renderIssues();
    return { state, nodes, issueGrid, renderIssues, writes: () => writes };
}
test('rendered pages expose details buttons, accurate counts and all cards beyond 100', () => {
    const issues = Array.from({ length: 205 }, (_, i) => card('track', String(i), [{ name: String(i), count: 1 }]));
    const ui = rendering(issues, { page: 2 });
    assert.equal(ui.issueGrid.children.length, 5);
    assert.match(ui.nodes.get('results-subtitle').textContent, /205 findings in 205 cards · showing cards 201–205/);
    assert.match(ui.issueGrid.children[0].innerHTML, /class="details-toggle" aria-expanded="false" aria-controls="issue-details-0"/);
    assert.match(ui.nodes.get('pagination-top').innerHTML, /Page 3 of 3/);
    assert.equal(ui.nodes.get('pagination-bottom').innerHTML, ui.nodes.get('pagination-top').innerHTML);
});
test('quarantined child cards explain why the previous decision needs review', () => {
    const issue = card('track', 'Child', [{ name: 'Child', count: 10 }]), id = api.getIssueId(issue);
    const ui = rendering([issue], {}, { orphan: { identityAmbiguous: true, normalizationTargets: [id] } });
    assert.match(ui.issueGrid.children[0].innerHTML, /Review the prior decision/);
});
test('a bulk action on a searched compilation affects only matching visible rows', () => {
    const issue = { ...rowCard(), type: 'compilation', album: 'Greatest Hits' }, id = api.getIssueId(issue);
    const ui = rendering([issue], { searchQuery: 'wanted' });
    const target = { dataset: { intent: 'ignored' }, classList: { contains: name => ['dismiss-all', 'dismiss-btn'].includes(name) }, closest: () => null };
    ui.issueGrid.children[0].listeners.click({ target });
    assert.equal(ui.state.dismissals[api.getItemId(id, 'Wanted')].intent, 'ignored');
    assert.equal(ui.state.dismissals[api.getItemId(id, 'Other')], undefined);
    assert.equal(ui.state.dismissals[api.getItemId(id, 'Hidden')], undefined);
    assert.equal(ui.writes(), 1);
});
test('row actions rebuild visible impact without parsing formatted counts or losing other drafts', () => {
    const issue = rowCard(), id = api.getIssueId(issue), items = { [api.getItemId(id, 'Hidden')]: { intent: 'ignored' } };
    const ui = rendering([issue], {}, items), targetId = api.getItemId(id, 'Wanted');
    ui.state.correctionDrafts.set('other', { fields: { 'correction-album': 'Unsaved' } });
    ui.state.correctionDrafts.set(targetId, { fields: { 'correction-album': 'Acted-on' } });
    const target = { dataset: { itemId: targetId, intent: 'fixed' }, classList: { contains: name => name === 'dismiss-btn-small' }, closest: () => null };
    ui.issueGrid.children[0].listeners.click({ target });
    assert.match(ui.issueGrid.children[0].innerHTML, /class="issue-count">5</);
    assert.equal(ui.state.correctionDrafts.has(targetId), false);
    assert.equal(ui.state.correctionDrafts.get('other').fields['correction-album'], 'Unsaved');
});
test('using an album candidate copies the exact name without saving or dismissing', () => {
    const ui = rendering([rowCard()]), input = { value: '', focus() { this.focused = true; } };
    const albumButton = { dataset: { album: 'Album\u00a0' }, closest: () => ({ querySelector: () => input }) };
    const target = { closest: selector => selector === '.use-album' ? albumButton : null };
    ui.issueGrid.children[0].listeners.click({ target });
    assert.equal(input.value, 'Album\u00a0');
    assert.equal(input.focused, true);
    assert.equal(ui.writes(), 0);
    assert.deepEqual(ui.state.dismissals, {});
});
test('candidate presentation escapes raw names, shows evidence and does not preselect a winner', () => {
    const issue = rowCard(), row = issue.variations[1];
    const state = { view: 'active', historicalImport: false, corrections: {}, albumEvidence: api.buildAlbumEvidence(S('A', '<Album>"', row.name)), albumMemory: new Map() };
    const ui = load(['albumCandidatesHtml', 'correctionControlsHtml', 'correctionChoiceLabel', 'escapeHtml'], { ...api, state, document: textDocument, getLastFmUrl: () => 'https://www.last.fm/' });
    const html = ui.correctionControlsHtml(issue, api.getItemId(api.getIssueId(issue), row.name), true, row);
    assert.match(html, /&lt;Album&gt;&quot;/);
    assert.match(html, /1 play of this exact track/);
    assert.match(html, /not a verified original release/);
    assert.match(html, /class="correction-album" type="text" value=""/);
});
test('metadata cannot break out of quoted attributes or inject markup', () => {
    const { escapeHtml } = load(['escapeHtml'], { document: textDocument });
    assert.equal(escapeHtml('" autofocus onfocus="evil()\'>&'), '&quot; autofocus onfocus=&quot;evil()&#39;&gt;&amp;');
});
for (const [name, fn] of tests) {
    try { fn(); }
    catch (error) { console.error(`FAIL: ${name}\n${error.stack}`); process.exitCode = 1; }
}
if (!process.exitCode) console.log(`Triage / album evidence contract: ${tests.length}/${tests.length} cases passed`);
