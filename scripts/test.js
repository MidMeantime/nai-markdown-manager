// Markdown Manager tests: loads the real built bundle with a mock NovelAI story.
// Run from the Editorial folder: node markdown-manager/scripts/test.js  (builds first)
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { buildMarkdownManager } = require('./build.js');
const { loadBundle, settle, createRunner, findParts, createBus, createDocument } = require('../../shared/tools/harness.js');
const { uccdsServicePath } = require('../../shared/tools/uccds.js');

const { target } = buildMarkdownManager();
const CH8 = fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'chapter 8.md'), 'utf-8');
const t = createRunner("Mid's Markdown Manager");

/** Auto-clicks the modal button whose text matches `label` */
function clickModal(label) {
    return (handle, find) => {
        const btn = find(handle.opts.content, (p) => p.type === 'button' && label.test(p.text || ''))[0];
        if (!btn) throw new Error(`No modal button matching ${label}; got ${find(handle.opts.content, (p) => p.type === 'button').map((p) => p.text)}`);
        btn.callback();
    };
}

async function boot(options = {}) {
    const env = loadBundle(target, options);
    await settle();
    return env;
}
const plain = (v) => JSON.parse(JSON.stringify(v));
const det = { detectionMode: 'auto', detectBracketedTitles: true, breakToken: '***' };
const rules = {}; // UCCDS defaults
const importSettings = (over = {}) => Object.assign({ headerStyle: 'bracket', includeDivider: true, stripEmphasis: false, preserveBlankLines: false, appendUnmatched: true, target: 'document' }, over);

// ---------- Parsing ----------

t.test('chapter 8.md: frontmatter title, two chapters, no doubled scene breaks', async () => {
    const { run } = await boot();
    const file = plain(run('mdmLoadText')(CH8));
    assert.strictEqual(file.title, 'Sucksession!!! (1)');
    assert.strictEqual(file.hasFrontmatter, true);
    assert.deepStrictEqual(file.chapters.map((c) => c.title), ['Chapter 8', 'Chapter 9']);
    const ch8 = file.chapters[0];
    assert.notStrictEqual(ch8.bodyLines[ch8.bodyLines.length - 1].trim(), '***', 'divider before chapter 9 is not left in chapter 8');
    assert.ok(ch8.bodyLines.some((l) => l.trim() === '***'), 'in-chapter scene break kept');
    const paras = plain(run('mdmRenderFileChapters')(file.chapters, importSettings(), true, '***'));
    assert.strictEqual(paras[0], '[ Chapter 8 ]', 'old importer produced "[ Chapter: 8 ]"');
    const i9 = paras.indexOf('[ Chapter 9 ]');
    assert.ok(i9 > 0);
    assert.strictEqual(paras[i9 - 1], '***');
    assert.notStrictEqual(paras[i9 - 2], '***', 'exactly one divider above chapter 9');
});

t.test('strip emphasis never turns *** into *', async () => {
    const { run } = await boot();
    const file = plain(run('mdmLoadText')(CH8));
    const paras = plain(run('mdmRenderFileChapters')(file.chapters, importSettings({ stripEmphasis: true }), true, '***'));
    assert.ok(!paras.includes('*'));
    assert.ok(paras.includes('***'));
});

t.test('auto heading split: lone # title, ## chapters, deeper headings stay in the text', async () => {
    const { run } = await boot();
    const parse = (text, mode = 'auto') => plain(run('mdmParseMarkdown')(text, det, mode));
    const a = parse('# My Book\n\n## The Start\nText.\n### A scene\nMore.\n## The End\nBye.');
    assert.strictEqual(a.docTitle, 'My Book');
    assert.deepStrictEqual(a.chapters.map((c) => c.title), ['The Start', 'The End']);
    assert.ok(a.chapters[0].bodyLines.includes('### A scene'));
    const b = parse('# Dawn\nx\n# Dusk\ny');
    assert.deepStrictEqual(b.chapters.map((c) => c.title), ['Dawn', 'Dusk']);
    // A bare number word is read as a chapter number, same as Chapter Linter
    assert.deepStrictEqual(parse('# One\nx\n# Two\ny').chapters.map((c) => c.title), ['Chapter One', 'Chapter Two']);
    const c = parse('# Part One\n### Chapter 3\nx\n### Notes\ny');
    assert.deepStrictEqual(c.chapters.map((x) => x.title), ['Part One', 'Chapter 3'], 'headings that name a chapter always split');
    const all = parse('# A\n## B\nx', 'all');
    assert.deepStrictEqual(all.chapters.map((x) => x.title), ['A', 'B']);
    const none = parse('Just some text.\n\nMore text.');
    assert.strictEqual(none.chapters.length, 1);
    assert.strictEqual(none.chapters[0].header, null);
});

t.test('ATTG lines and author notes in a file are not chapters', async () => {
    const { run } = await boot();
    const r = plain(run('mdmParseMarkdown')('[ Author: Me; Tags: x ]\n[ Chapter 1: Go ]\nText.', det, 'auto'));
    assert.deepStrictEqual(r.chapters.map((c) => c.title), ['Opening text', 'Chapter 1: Go']);
});

// ---------- Story scanning ----------

t.test('story scan: dividers go with the next chapter, headerless story is never auto-matched', async () => {
    const { run } = await boot();
    const build = (texts) => plain(run('mdmBuildEditorChapters')(texts.map((text, i) => ({ sectionId: i + 1, text })), rules));
    const ch = build(['Intro line.', '***', '', '[ Chapter 1 ]', 'A.', '***', 'Scene two.', '***', '[ Chapter 2: B ]', 'B.']);
    assert.deepStrictEqual(ch.map((c) => c.title), ['Opening text (before first chapter)', 'Chapter 1', 'Chapter 2: B']);
    assert.deepStrictEqual(ch[1].sectionIds, [2, 3, 4, 5, 6, 7]);
    assert.deepStrictEqual(ch[1].bodyTexts, ['A.', '***', 'Scene two.']);
    assert.strictEqual(ch[2].key, 9);
    const whole = build(['No headers here.', 'At all.']);
    assert.strictEqual(whole[0].title, 'Whole story (no chapter headers)');
    const file = plain(run('mdmLoadText')('# Chapter 1\nNew text.'));
    const m = plain(run('mdmResolveMatches')(file.chapters, whole, {}, true));
    assert.strictEqual(m[0].action, 'append', 'old importer matched "Chapter 1" to the whole story');
});

t.test('matching: title, number, similar title, manual pick, one replace per chapter', async () => {
    const { run } = await boot();
    const editor = plain(run('mdmBuildEditorChapters')(['# Chapter 1: Dawn', 'a', '# Chapter 2: Dusk', 'b', '# The Long Night Watch', 'c', 'Prologue', 'p']
        .map((text, i) => ({ sectionId: i + 1, text })), rules));
    const file = plain(run('mdmLoadText')('# Dawn\nx\n# Chapter 2\ny\n# Long Night Watch Again\nz\n# Prologue\nq\n# Brand New\nn'));
    const m = plain(run('mdmResolveMatches')(file.chapters, editor, {}, true));
    assert.deepStrictEqual(m.map((x) => [x.action, x.editorKey, x.confidence]), [
        ['replace', 1, 'exact'], ['replace', 3, 'number'], ['replace', 5, 'title'], ['replace', 7, 'exact'], ['append', null, 'none']
    ]);
    const manual = plain(run('mdmResolveMatches')(file.chapters, editor, { 4: { mode: 'editor', key: 1 }, 0: { mode: 'skip' } }, false));
    assert.deepStrictEqual(manual.map((x) => [x.action, x.editorKey]), [['skip', null], ['replace', 3], ['replace', 5], ['replace', 7], ['replace', 1]]);
});

// ---------- Import actions ----------

t.test('replace matching chapters in place: other chapters untouched, new ones appended', async () => {
    const story = ['Opening.', '***', '[ Chapter 7 ]', 'Seven stays.', '***', '[ Chapter 8 ]', 'Old eight.', 'Old eight more.', '***', '[ Chapter 10 ]', 'Ten stays.'];
    const env = await boot({ doc: story, filePrompt: CH8 });
    await env.run('mdmPickFile()');
    env.mock.ui.modalHandler = clickModal(/^Replace 1$/);
    await env.run('mdmImportApplyMatches()');
    await settle();
    const out = env.mock.doc.texts();
    assert.deepStrictEqual(out.slice(0, 5), story.slice(0, 5));
    assert.strictEqual(out[5], '[ Chapter 8 ]');
    assert.ok(!out.includes('Old eight.'));
    const i10 = out.indexOf('[ Chapter 10 ]');
    assert.deepStrictEqual(out.slice(i10 - 1, i10 + 2), ['***', '[ Chapter 10 ]', 'Ten stays.']);
    assert.strictEqual(out.filter((x) => x === '[ Chapter 9 ]').length, 1, 'chapter 9 appended once');
    assert.ok(out.indexOf('[ Chapter 9 ]') > i10);
    assert.ok(!env.mock.logs.some((l) => l[0] === 'error'), JSON.stringify(env.mock.logs));
});

t.test('replacing the first chapter of the story works (old code path special-cased it)', async () => {
    const env = await boot({ doc: ['[ Chapter 8 ]', 'Old.', '***', '[ Chapter 9 ]', 'Old nine.'], filePrompt: '# Chapter 8\nNew eight.' });
    await env.run('mdmPickFile()');
    env.mock.ui.modalHandler = clickModal(/^Replace 1$/);
    await env.run('mdmImportApplyMatches()');
    assert.deepStrictEqual(env.mock.doc.texts(), ['[ Chapter 8 ]', 'New eight.', '***', '[ Chapter 9 ]', 'Old nine.']);
});

t.test('manual "Change" target: picking a chapter frees it from other imported chapters', async () => {
    const env = await boot({ doc: ['# Chapter 1', 'a', '# Chapter 2', 'b'], filePrompt: '# Chapter 1\nx\n# Something\ny' });
    await env.run('mdmPickFile()');
    env.mock.ui.modalHandler = clickModal(/^Replace: Chapter 1/);
    await env.run('mdmChooseTarget(mdmState.file.chapters[1])');
    const m = plain(env.run('mdmCurrentMatches()'));
    // "Something" was pointed at Chapter 1 by hand, so the file's "Chapter 1" can't also take it
    assert.deepStrictEqual(m.map((x) => [x.action, x.confidence]), [['append', 'none'], ['replace', 'manual']]);
    assert.strictEqual(m[1].editorKey, env.mock.doc.sections[0].id);
});

t.test('append to an empty story has no leading divider; replace story; memory', async () => {
    const env = await boot({ doc: [''], filePrompt: '# Chapter 1\nHello.\n# Chapter 2\nBye.' });
    await env.run('mdmPickFile()');
    await env.run('mdmImportAppendAll()');
    assert.deepStrictEqual(env.mock.doc.texts().filter((x) => x), ['[ Chapter 1 ]', 'Hello.', '***', '[ Chapter 2 ]', 'Bye.']);

    const env2 = await boot({ doc: ['Old', 'story', 'text'], filePrompt: '# Chapter 1\nNew.' });
    await env2.run('mdmPickFile()');
    env2.mock.ui.modalHandler = clickModal(/^Replace story$/);
    await env2.run('mdmImportReplaceStory()');
    assert.deepStrictEqual(env2.mock.doc.texts(), ['[ Chapter 1 ]', 'New.']);

    const env3 = await boot({ memory: 'Existing.', filePrompt: 'Fact one.\nFact two.' });
    await env3.run('mdmPickFile()');
    await env3.run('mdmImportToMemory(false)');
    assert.strictEqual(env3.mock.story.memory, 'Existing.\n\nFact one.\nFact two.');
});

t.test('formatting changes keep manual picks (old code reset them on every toggle)', async () => {
    const env = await boot({ doc: ['# Chapter 1', 'a', '# Chapter 2', 'b'], filePrompt: '# Unrelated\nx' });
    await env.run('mdmPickFile()');
    env.mock.ui.modalHandler = clickModal(/^Replace: Chapter 2/);
    await env.run('mdmChooseTarget(mdmState.file.chapters[0])');
    await env.run("mdmUpdateSettings((s) => { s.import.headerStyle = 'clean'; })");
    assert.strictEqual(plain(env.run('mdmCurrentMatches()'))[0].confidence, 'manual');
});

// ---------- Export ----------

const STORY = ['Opening line.', '***', '# Chapter 1: Dawn', 'She said "hi".', '***', 'Later.', '***', '[ Chapter 2 ]', 'Two *bold* text.'];

t.test('export whole story: headings, scene breaks, escaped YAML frontmatter', async () => {
    const env = await boot({ doc: STORY, description: 'Line one\nwith "quotes"', title: 'My: Story' });
    await env.run('mdmRunExport()');
    const saved = env.mock.files.saved[0];
    assert.strictEqual(saved.name, 'My_ Story.md');
    assert.ok(saved.content.startsWith('---\ntitle: "My: Story"\n'));
    assert.ok(saved.content.includes('description: "Line one\\nwith \\"quotes\\""'));
    assert.ok(saved.content.includes('# Chapter 1: Dawn\n\nShe said "hi".\n\n***\n\nLater.'));
    assert.ok(saved.content.includes('# Chapter 2\n\nTwo *bold* text.'));
    assert.ok(saved.content.includes('Opening line.'));
});

t.test('selected scope with nothing ticked exports nothing (old code exported and stripped everything)', async () => {
    const env = await boot({ doc: STORY });
    await env.run("mdmUpdateSettings((s) => { s.export.scope = 'selected'; s.export.stripAfterExport = true; })");
    await env.run('mdmSetAllSelected(false)');
    await env.run('mdmRunExport()');
    assert.strictEqual(env.mock.files.saved.length, 0);
    assert.deepStrictEqual(env.mock.doc.texts(), STORY);
});

t.test('export one selected chapter: file name and strip remove only that chapter', async () => {
    const env = await boot({ doc: STORY, title: 'Tale' });
    await env.run("mdmUpdateSettings((s) => { s.export.scope = 'selected'; s.export.stripAfterExport = true; s.export.frontmatter = 'none'; })");
    await env.run('mdmSetAllSelected(false)');
    env.run('mdmState.exportSelected').add(env.mock.doc.sections[2].id);
    env.mock.ui.modalHandler = clickModal(/^Export & remove$/);
    await env.run('mdmRunExport()');
    const saved = env.mock.files.saved[0];
    assert.strictEqual(saved.name, 'Tale - Chapter 1_ Dawn.md');
    assert.ok(saved.content.startsWith('# Chapter 1: Dawn'));
    assert.deepStrictEqual(env.mock.doc.texts(), ['Opening line.', '***', '[ Chapter 2 ]', 'Two *bold* text.']);
});

t.test('export & strip the whole story leaves one empty paragraph', async () => {
    const env = await boot({ doc: STORY });
    await env.run("mdmUpdateSettings((s) => { s.export.stripAfterExport = true; })");
    env.mock.ui.modalHandler = clickModal(/^Export & remove$/);
    await env.run('mdmRunExport()');
    assert.deepStrictEqual(env.mock.doc.texts(), ['']);
});

t.test('memory and AN go into frontmatter; round trip export -> import replaces chapters 1:1', async () => {
    const env = await boot({ doc: STORY, memory: 'Mem line 1\nMem line 2', an: 'Note' });
    await env.run("mdmUpdateSettings((s) => { s.export.includeMemory = true; s.export.includeAuthorsNote = true; s.export.headerStyle = 'markdown_h1'; })");
    await env.run('mdmRunExport()');
    const md = env.mock.files.saved[0].content;
    assert.ok(md.includes('memory: |\n  Mem line 1\n  Mem line 2'));
    assert.ok(!md.includes('## Story Memory'));
    const file = plain(env.run('mdmLoadText')(md));
    assert.deepStrictEqual(file.chapters.map((c) => c.title), ['Opening text', 'Chapter 1: Dawn', 'Chapter 2']);
    const m = plain(env.run('mdmResolveMatches')(file.chapters.slice(1), plain(env.run('mdmState.editorChapters')), {}, true));
    assert.deepStrictEqual(m.map((x) => x.confidence), ['exact', 'exact']);
});

t.test('roman numerals and number words match (old exporter read IV as 6)', async () => {
    const { run } = await boot();
    const editor = plain(run('mdmBuildEditorChapters')([{ sectionId: 1, text: 'Chapter IV' }, { sectionId: 2, text: 'x' }], rules));
    assert.strictEqual(editor[0].header.number, 4);
    const file = plain(run('mdmLoadText')('# Chapter Four\nnew'));
    assert.strictEqual(plain(run('mdmResolveMatches')(file.chapters, editor, {}, true))[0].editorKey, 1);
});

t.test('books: Book 2 Chapter 1 never replaces Book 1 Chapter 1', async () => {
    const { run } = await boot();
    const editor = plain(run('mdmBuildEditorChapters')(['Book 1:', 'Chapter: 1', 'a', 'Book 2:', 'Chapter: 1', 'b']
        .map((text, i) => ({ sectionId: i + 1, text })), rules));
    const file = plain(run('mdmLoadText')('Book 2:\nChapter: 1\nnew b'));
    const m = plain(run('mdmResolveMatches')(file.chapters, editor, {}, true));
    const target = m.find((x) => x.action === 'replace' && file.chapters.find((c) => c.id === x.importId).header.kind === 'chapter');
    assert.strictEqual(target.editorKey, 5, 'Book 2 chapter');
    const inline = plain(run('mdmLoadText')('# Book 1: Chapter 1\nnew a'));
    const editor2 = plain(run('mdmBuildEditorChapters')(['Book 2: Chapter 1', 'x', 'Book 1: Chapter 1', 'y'].map((text, i) => ({ sectionId: i + 1, text })), rules));
    assert.strictEqual(plain(run('mdmResolveMatches')(inline.chapters, editor2, {}, true))[0].editorKey, 3);
});

// ---------- UI contract ----------

t.test('panel: collapsibles keep state, no emoji / hex colours / CSS vars, tabs render', async () => {
    const env = await boot({ doc: STORY, filePrompt: CH8 });
    await env.run('mdmPickFile()');
    const check = () => {
        const panel = env.mock.ui.panels.get('mdm.panel');
        assert.ok(panel, 'panel rendered');
        const json = JSON.stringify(panel);
        assert.ok(!/[☀-➿\u{1F300}-\u{1FAFF}]/u.test(json), 'no emoji');
        assert.ok(!/#[0-9a-fA-F]{6}\b|rgba?\(/.test(json), 'no hardcoded colours');
        assert.ok(!/var\(--/.test(json), 'no CSS variables');
        const sections = findParts(panel.content, (p) => p.type === 'collapsibleSection');
        assert.ok(sections.length >= 2);
        assert.ok(sections.every((s) => typeof s.storageKey === 'string' && s.storageKey.startsWith('mdm.ui.collapsed.')));
        return panel;
    };
    check();
    await env.run("mdmUpdateSettings((s) => { s.tab = 'export'; s.export.scope = 'selected'; })");
    const panel = check();
    const boxes = findParts(panel.content, (p) => p.type === 'checkboxInput');
    assert.strictEqual(boxes.length, 3);
    assert.ok(boxes.every((b) => b.storageKey.startsWith('temp:mdm.export.sel.')));
    assert.ok(findParts(panel.content, (p) => p.type === 'button' && p.text === 'Select all').length === 1);
});

t.test('settings persist across reloads; config header uses name/prettyName', async () => {
    const env = await boot();
    await env.run("mdmUpdateSettings((s) => { s.import.headerStyle = 'clean'; })");
    const saved = env.mock.storage.map.get('mdm.settings');
    assert.strictEqual(saved.import.headerStyle, 'clean');
    const src = fs.readFileSync(target, 'utf-8');
    assert.ok(src.startsWith('/*---'));
    const header = src.slice(0, src.indexOf('---*/'));
    assert.ok(!/^\s+- id:/m.test(header), 'old importer used "id:" keys, which NovelAI ignores');
    assert.strictEqual((header.match(/^\s+- name:/gm) || []).length, (header.match(/prettyName:/g) || []).length);
    assert.ok(!/\bsetTimeout\(/.test(src.replace(/timers\.setTimeout/g, '')), 'no global setTimeout');
});

t.test('config defaults are honoured', async () => {
    const env = await boot({ config: { default_import_header: 'markdown_h1', default_export_header: 'clean', chapter_detection_mode: 'markdown_headings' } });
    assert.strictEqual(env.run('mdmState.settings.import.headerStyle'), 'markdown_h1');
    assert.strictEqual(env.run('mdmState.settings.export.headerStyle'), 'clean');
    assert.strictEqual(env.run('mdmState.detection.detectionMode'), 'markdown_headings');
});

// ---------- UCCDS (dual): built-in rules, and the UCCDS script's when it's enabled ----------

const titlesOf = (env) => plain(env.run('mdmState.editorChapters')).map((c) => c.title);
const sourceLine = (env) => {
    const panel = env.mock.ui.panels.get('mdm.panel');
    return findParts(panel.content, (p) => p.type === 'text').map((p) => p.text).find((x) => /^Chapters: /.test(x || '')) || '';
};
async function waitFor(fn, ms = 4000) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
        if (await fn()) return;
        await new Promise((r) => setTimeout(r, 25));
    }
    throw new Error('waitFor timed out');
}
/** Markdown Manager and the UCCDS script on one story and one messaging bus */
async function withUccds(docTexts, { mdmConfig = {}, uccdsConfig = {}, filePrompt } = {}) {
    const bus = createBus();
    const doc = createDocument(docTexts);
    loadBundle(uccdsServicePath(), { bus, sharedDoc: doc, scriptId: 'uccds-service', config: uccdsConfig });
    await settle();
    const env = loadBundle(target, { bus, sharedDoc: doc, scriptId: 'markdown-manager', config: mdmConfig, filePrompt });
    await settle();
    await waitFor(() => env.run('uccdsDualSource()') === 'dependency');
    await env.run('mdmScanEditor()');
    return { env, bus, doc };
}

t.test('custom chapter words apply to the story and to imported files alike', async () => {
    const story = ['Episode 1: Rain', 'a', '***', 'Episode 2: Sun', 'b'];
    const env = await boot({ doc: story, config: { chapter_custom_chapter_words: 'Episode' }, filePrompt: 'Episode 2: Sun\nnew b' });
    assert.deepStrictEqual(titlesOf(env), ['Episode 1: Rain', 'Episode 2: Sun']);
    await env.run('mdmPickFile()');
    const m = plain(env.run('mdmCurrentMatches()'));
    assert.deepStrictEqual(m.map((x) => [x.action, x.editorKey, x.confidence]), [['replace', env.mock.doc.sections[3].id, 'exact']]);
    const without = await boot({ doc: story });
    assert.deepStrictEqual(titlesOf(without), ['Whole story (no chapter headers)']);
});

t.test('only-my-break-token: a lone --- in a file stays text; where-chapters-start splits the story', async () => {
    const strict = await boot({ config: { chapter_break_token: '~~~', chapter_only_break_token: true } });
    const a = plain(strict.run('mdmLoadText')('Chapter 1\nx\n---\nChapter 2\ny'));
    assert.deepStrictEqual(a.chapters[0].bodyLines, ['x', '---'], '--- is not a divider, so it is not moved off');
    const loose = await boot();
    const b = plain(loose.run('mdmLoadText')('Chapter 1\nx\n---\nChapter 2\ny'));
    assert.deepStrictEqual(b.chapters[0].bodyLines, ['x']);
    const split = await boot({ doc: ['# Chapter 1', 'a', '***', 'b'], config: { chapter_boundary_mode: 'headers_and_dividers' } });
    assert.deepStrictEqual(titlesOf(split), ['Chapter 1', 'Chapter 2']);
    assert.strictEqual(plain(split.run('mdmState.editorChapters'))[1].header, null);
});

t.test('alone: built-in UCCDS, and the panel says so', async () => {
    const env = await boot({ doc: STORY });
    assert.strictEqual(env.run('mdmState.chapterSource'), 'embedded');
    assert.ok(/^Chapters: built-in UCCDS v1\.0\.0/.test(sourceLine(env)), sourceLine(env));
});

t.test('UCCDS script enabled: its rules decide the story chapters and how files are read', async () => {
    const { env } = await withUccds(['# Chapter 1: Dawn', 'a', 'Scene 2', 'b'], {
        mdmConfig: { chapter_detection_mode: 'markdown_headings' },
        uccdsConfig: { chapter_custom_chapter_words: 'Scene', chapter_break_token: '~~~' },
        filePrompt: 'Scene 2\nnew b'
    });
    assert.strictEqual(env.run('mdmState.chapterSource'), 'dependency');
    assert.deepStrictEqual(titlesOf(env), ['Chapter 1: Dawn', 'Scene 2']);
    assert.strictEqual(env.run('mdmBreakToken()'), '~~~');
    await env.run('mdmPickFile()');
    assert.deepStrictEqual(plain(env.run('mdmCurrentMatches()')).map((x) => x.confidence), ['exact']);
    await env.run('mdmRender()');
    assert.ok(/from the UCCDS script v1\.0\.0/.test(sourceLine(env)), sourceLine(env));
});

t.test('UCCDS set to leave out opening text: Markdown Manager still exports it', async () => {
    const { env } = await withUccds(['A preface.', '# Chapter 1: Dawn', 'a'], { uccdsConfig: { chapter_opening_text: 'ignore' } });
    assert.deepStrictEqual(titlesOf(env), ['Opening text (before first chapter)', 'Chapter 1: Dawn']);
    await env.run('mdmRunExport()');
    assert.ok(env.mock.files.saved[0].content.includes('A preface.'));
});

t.test('UCCDS script disabled mid-session: the next scan falls back to the built-in rules', async () => {
    const { env, bus } = await withUccds(['# Chapter 1: Dawn', 'a', 'Scene 2', 'b'], { uccdsConfig: { chapter_custom_chapter_words: 'Scene' } });
    assert.strictEqual(titlesOf(env).length, 2);
    bus.subs.splice(0, bus.subs.length, ...bus.subs.filter((x) => x.scriptId !== 'uccds-service'));
    await env.run('mdmScanEditor()');
    assert.strictEqual(env.run('mdmState.chapterSource'), 'embedded');
    assert.deepStrictEqual(titlesOf(env), ['Chapter 1: Dawn']);
});

t.test('the chapter lists refresh by themselves when the UCCDS script turns up', async () => {
    const bus = createBus();
    const doc = createDocument(['# Chapter 1: Dawn', 'a', 'Scene 2', 'b']);
    const env = loadBundle(target, { bus, sharedDoc: doc, scriptId: 'markdown-manager' });
    await settle();
    assert.strictEqual(titlesOf(env).length, 1);
    loadBundle(uccdsServicePath(), { bus, sharedDoc: doc, scriptId: 'uccds-service', config: { chapter_custom_chapter_words: 'Scene' } });
    await waitFor(() => titlesOf(env).length === 2, 6000);
    assert.strictEqual(env.run('mdmState.chapterSource'), 'dependency');
});

t.run();
