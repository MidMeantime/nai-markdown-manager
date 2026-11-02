// --- Markdown Manager: Panel Rendering ---

const MDM_PANEL_ID = mdmId('panel');

const MDM_IMPORT_STYLE_OPTIONS: { label: string; value: MdmHeaderStyle }[] = [
    { label: '[ Chapter 1: Title ]', value: 'bracket' },
    { label: '[ Title ]', value: 'bracket_title' },
    { label: 'Chapter 1: Title', value: 'clean' },
    { label: '# Heading', value: 'markdown_h1' },
    { label: 'As written', value: 'raw' },
    { label: 'No header', value: 'none' }
];

const MDM_EXPORT_STYLE_OPTIONS: { label: string; value: MdmHeaderStyle }[] = [
    { label: '# Heading 1', value: 'markdown_h1' },
    { label: '## Heading 2', value: 'markdown_h2' },
    { label: '[ Chapter 1: Title ]', value: 'bracket' },
    { label: '[ Title ]', value: 'bracket_title' },
    { label: 'Chapter 1: Title', value: 'clean' },
    { label: 'As written', value: 'raw' },
    { label: 'No header', value: 'none' }
];

/** Applies a settings change, saves it and re-renders (only ever called from button clicks) */
async function mdmUpdateSettings(change: (s: MdmSettings) => void): Promise<void> {
    change(mdmState.settings);
    await mdmSaveSettings();
    await mdmRender();
}

function mdmMatchLabel(m: MdmChapterMatch): string {
    if (m.action === 'skip') return 'skip';
    if (m.action === 'append') return 'add at end';
    const ed = mdmState.editorChapters.find((e: MdmEditorChapter) => e.key === m.editorKey);
    return `replaces **${ed ? ed.title : '?'}**${ed ? ` (${ed.wordCount.toLocaleString()}w)` : ''}`;
}

function mdmImportView(): UIPart[] {
    const s = mdmState.settings.import;
    const busy = mdmState.busy;
    const file = mdmState.file;
    const parts: UIPart[] = [];

    parts.push(mdmRow([
        mdmButton(file ? 'Choose another file' : 'Choose .md / .txt file', mdmPickFile, { icon: 'upload', variant: file ? 'default' : 'primary', disabled: busy, style: { flex: '1 1 auto' } }),
        ...(file ? [mdmButton('Clear', async () => {
            mdmState.file = null;
            mdmState.manualTargets = {};
            await mdmRender();
        }, { icon: 'x', variant: 'subtle', disabled: busy })] : [])
    ]));

    if (!file) {
        parts.push(mdmText("Load a Markdown or text file to add it to your story or Memory. Chapter headers in the file are matched to the chapters already in your story.", { muted: true }));
        return parts;
    }

    const rendered = mdmRenderFileChapters(file.chapters, s, false, mdmBreakToken());
    const renderedText = rendered.join('\n');
    const words = file.chapters.reduce((n: number, c: MdmFileChapter) => n + c.wordCount, 0);
    parts.push(mdmCard(null, [
        mdmText(`**${file.title}**${file.hasFrontmatter ? ' · frontmatter removed' : ''} · ${mdmFormatSize(file.sizeBytes)}`),
        mdmText(`**${file.chapters.length}** chapter(s) · **${words.toLocaleString()}** words · ~**${mdmEstimateTokens(renderedText.length).toLocaleString()}** tokens`, { muted: true })
    ]));

    parts.push(mdmSection('Formatting', 'import.format', [
        mdmText('Chapter header style', { muted: true }),
        mdmSegmented(MDM_IMPORT_STYLE_OPTIONS, s.headerStyle, async (v: MdmHeaderStyle) => mdmUpdateSettings((x: MdmSettings) => { x.import.headerStyle = v; }), busy),
        mdmToggle(`Put ${mdmBreakToken()} above each chapter header`, s.includeDivider, async (v: boolean) => mdmUpdateSettings((x: MdmSettings) => { x.import.includeDivider = v; }), busy),
        mdmToggle('Remove *italic* / **bold** markers', s.stripEmphasis, async (v: boolean) => mdmUpdateSettings((x: MdmSettings) => { x.import.stripEmphasis = v; }), busy),
        mdmToggle('Keep blank-line scene breaks', s.preserveBlankLines, async (v: boolean) => mdmUpdateSettings((x: MdmSettings) => { x.import.preserveBlankLines = v; }), busy)
    ], { icon: 'sliders' }));

    parts.push(mdmText('Send to', { muted: true, style: { marginTop: MDM_SPACE.sm } }));
    parts.push(mdmSegmented<MdmImportTarget>([{ label: 'Story', value: 'document' }, { label: 'Memory', value: 'memory' }], s.target,
        async (v: MdmImportTarget) => mdmUpdateSettings((x: MdmSettings) => { x.import.target = v; }), busy));

    if (s.target === 'memory') {
        parts.push(mdmCard('Memory', [
            mdmRow([
                mdmButton('Add to Memory', async () => mdmImportToMemory(false), { icon: 'file-plus', variant: 'primary', disabled: busy }),
                mdmButton('Overwrite Memory', async () => mdmImportToMemory(true), { icon: 'alert', variant: 'danger', disabled: busy })
            ])
        ]));
    } else {
        parts.push(mdmCard('Add to the end', [
            mdmText('Appends every chapter after the current story text.', { muted: true }),
            mdmButton(`Append ${file.chapters.length} chapter(s)`, mdmImportAppendAll, { icon: 'file-plus', variant: 'primary', disabled: busy })
        ]));

        const matches = mdmCurrentMatches();
        const replaceCount = matches.filter((m: MdmChapterMatch) => m.action === 'replace').length;
        const appendCount = matches.filter((m: MdmChapterMatch) => m.action === 'append').length;
        const rows: UIPart[] = [];
        if (!mdmState.hasScanned || mdmState.editorChapters.length === 0) {
            rows.push(mdmText('No chapters found in the story yet.', { muted: true }));
        }
        file.chapters.forEach((ch: MdmFileChapter, i: number) => {
            const m = matches[i];
            rows.push(mdmRow([
                mdmText(`**${ch.title}** (${ch.wordCount.toLocaleString()}w) ${mdmMatchLabel(m)}${m.confidence === 'manual' ? ' · *your pick*' : ''}`, { style: { flex: '1 1 140px' } }),
                mdmButton('Change', async () => mdmChooseTarget(ch), { icon: 'edit-2', variant: 'subtle', disabled: busy, style: { fontSize: '11px' } })
            ], { spacing: 'space-between' }));
        });
        parts.push(mdmCard('Replace matching chapters', [
            mdmText(`Story has **${mdmState.editorChapters.filter((e: MdmEditorChapter) => e.header).length}** chapter(s). Matched by title, then chapter number.`, { muted: true }),
            ...rows,
            mdmToggle('Add unmatched chapters at the end', s.appendUnmatched, async (v: boolean) => mdmUpdateSettings((x: MdmSettings) => { x.import.appendUnmatched = v; }), busy),
            mdmRow([
                mdmButton(`Apply (${replaceCount} replace, ${appendCount} add)`, mdmImportApplyMatches, { icon: 'check', variant: 'primary', disabled: busy || (replaceCount + appendCount === 0) }),
                mdmButton('Re-scan story', async () => { await mdmScanEditor(); await mdmRender(); }, { icon: 'refresh-cw', disabled: busy })
            ])
        ]));

        parts.push(mdmCard('Replace the entire story', [
            mdmText('Deletes all story text and writes the file in its place.', { muted: true }),
            mdmButton('Replace entire story', mdmImportReplaceStory, { icon: 'alert', variant: 'danger', disabled: busy })
        ], { danger: true }));
    }

    parts.push(mdmSection('Preview', 'import.preview', [
        mdmText(mdmPreviewText(renderedText) || '(empty)', { markdown: false, style: MDM_S.mono })
    ], { collapsed: true, icon: 'eye' }));
    return parts;
}

async function mdmExportView(): Promise<UIPart[]> {
    const s = mdmState.settings.export;
    const busy = mdmState.busy;
    const parts: UIPart[] = [];
    const { markdown, chapters } = await mdmBuildCurrentExport();

    parts.push(mdmCard(null, [
        mdmText(`**${mdmState.storyTitle || 'Untitled story'}**`),
        mdmText(mdmExportStatsText(markdown, chapters), { id: MDM_EXPORT_STATS_ID, muted: true }),
        mdmButton('Re-scan story', async () => { await mdmScanEditor(); await mdmRender(); }, { icon: 'refresh-cw', variant: 'subtle', disabled: busy })
    ]));

    if (mdmState.editorChapters.length === 0) {
        parts.push(mdmText('The story is empty, so there is nothing to export yet.', { muted: true }));
        return parts;
    }

    const chapterParts: UIPart[] = [
        mdmSegmented<MdmExportScope>([{ label: 'Whole story', value: 'all' }, { label: 'Selected chapters', value: 'selected' }], s.scope,
            async (v: MdmExportScope) => mdmUpdateSettings((x: MdmSettings) => { x.export.scope = v; }), busy)
    ];
    if (s.scope === 'selected') {
        chapterParts.push(mdmRow([
            mdmButton('Select all', async () => mdmSetAllSelected(true), { icon: 'check-square', variant: 'subtle', disabled: busy }),
            mdmButton('Deselect all', async () => mdmSetAllSelected(false), { icon: 'square', variant: 'subtle', disabled: busy })
        ]));
        for (const c of mdmState.editorChapters) {
            const key = c.key;
            chapterParts.push({
                type: 'checkboxInput',
                label: `${c.title} (${c.wordCount.toLocaleString()}w)`,
                storageKey: `temp:${mdmId(`export.sel.${key}`)}`,
                disabled: busy,
                onChange: async (value: boolean) => {
                    if (value) mdmState.exportSelected.add(key);
                    else mdmState.exportSelected.delete(key);
                    await mdmRefreshExportSummary();
                }
            });
        }
    }
    parts.push(mdmSection('Chapters', 'export.chapters', chapterParts, { icon: 'list' }));

    parts.push(mdmSection('Formatting', 'export.format', [
        mdmText('Chapter heading style', { muted: true }),
        mdmSegmented(MDM_EXPORT_STYLE_OPTIONS, s.headerStyle, async (v: MdmHeaderStyle) => mdmUpdateSettings((x: MdmSettings) => { x.export.headerStyle = v; }), busy),
        mdmToggle(`Put ${mdmBreakToken()} between chapters`, s.includeDivider, async (v: boolean) => mdmUpdateSettings((x: MdmSettings) => { x.export.includeDivider = v; }), busy),
        mdmToggle('Remove *italic* / **bold** markers', s.stripEmphasis, async (v: boolean) => mdmUpdateSettings((x: MdmSettings) => { x.export.stripEmphasis = v; }), busy)
    ], { icon: 'sliders' }));

    parts.push(mdmSection('Frontmatter & extras', 'export.extras', [
        mdmSegmented<MdmFrontmatter>([{ label: 'YAML ---', value: 'yaml' }, { label: 'TOML +++', value: 'toml' }, { label: 'None', value: 'none' }], s.frontmatter,
            async (v: MdmFrontmatter) => mdmUpdateSettings((x: MdmSettings) => { x.export.frontmatter = v; }), busy),
        mdmToggle('Word and chapter counts in frontmatter', s.includeStats, async (v: boolean) => mdmUpdateSettings((x: MdmSettings) => { x.export.includeStats = v; }), busy || s.frontmatter === 'none'),
        { type: 'textInput', label: 'Author', placeholder: 'Optional', storageKey: MDM_KEY_AUTHOR, disabled: busy },
        mdmToggle('Include Story Memory', s.includeMemory, async (v: boolean) => mdmUpdateSettings((x: MdmSettings) => { x.export.includeMemory = v; }), busy),
        mdmToggle("Include Author's Note", s.includeAuthorsNote, async (v: boolean) => mdmUpdateSettings((x: MdmSettings) => { x.export.includeAuthorsNote = v; }), busy),
        mdmText('With frontmatter on, Memory and Author\'s Note are saved inside it, so re-importing the file won\'t turn them into chapters.', { muted: true })
    ], { collapsed: true, icon: 'file-text' }));

    parts.push(mdmCard(s.stripAfterExport ? 'Export & remove' : 'Export', [
        { type: 'textInput', label: 'File name', placeholder: mdmDefaultFileName(mdmState.storyTitle, chapters, s.scope), storageKey: `temp:${MDM_KEY_FILENAME}`, disabled: busy },
        mdmToggle('Remove exported chapters from the story', s.stripAfterExport, async (v: boolean) => mdmUpdateSettings((x: MdmSettings) => { x.export.stripAfterExport = v; }), busy),
        ...(s.stripAfterExport ? [mdmText(s.scope === 'all'
            ? '**Whole story** is selected: exporting will empty the story. Ctrl+Z still works.'
            : 'Exported chapters are deleted from the story after the file is saved. Ctrl+Z still works.', { style: { color: MDM_COLOR.danger, fontSize: '11px' } })] : []),
        mdmButton(s.stripAfterExport ? 'Export & remove' : 'Export Markdown', mdmRunExport, {
            icon: s.stripAfterExport ? 'scissors' : 'download',
            variant: s.stripAfterExport ? 'danger' : 'primary',
            disabled: busy || chapters.length === 0,
            style: { width: '100%' }
        })
    ], { danger: s.stripAfterExport }));

    parts.push(mdmSection('Preview', 'export.preview', [
        mdmText(chapters.length > 0 ? mdmPreviewText(markdown) : 'Nothing selected.', { id: MDM_EXPORT_PREVIEW_ID, markdown: false, style: MDM_S.mono })
    ], { collapsed: true, icon: 'eye' }));
    return parts;
}

/** Where the story's chapters come from */
function mdmChapterSourceLine(): string {
    if (mdmState.chapterSource === 'dependency') {
        const version = mdmState.dependencyVersion ? ` v${mdmState.dependencyVersion}` : "";
        return `Chapters: from the UCCDS script${version} (its rules apply)`;
    }
    return `Chapters: built-in UCCDS v${UCCDS_VERSION} ([Chapters] options in Config)`;
}

async function mdmRender(): Promise<void> {
    try {
        const tab = mdmState.settings.tab;
        const content: UIPart[] = [
            mdmSegmented<MdmTab>([{ label: 'Import', value: 'import' }, { label: 'Export', value: 'export' }], tab, async (v: MdmTab) => {
                if (v === 'export') await mdmScanEditor();
                await mdmUpdateSettings((x: MdmSettings) => { x.tab = v; });
            }, mdmState.busy),
            mdmText(mdmState.busy ? 'Working…' : '', { id: MDM_STATUS_ID, muted: true }),
            mdmText(mdmChapterSourceLine(), { muted: true, style: { fontSize: '10px' } })
        ];
        if (tab === 'export') {
            // Keep bound checkboxes in step with the selection before drawing them
            for (const c of mdmState.editorChapters) {
                await api.v1.tempStorage.set(mdmId(`export.sel.${c.key}`), mdmState.exportSelected.has(c.key));
            }
            content.push(...(await mdmExportView()));
        } else {
            content.push(...mdmImportView());
        }
        await api.v1.ui.update([{ type: 'sidebarPanel', id: MDM_PANEL_ID, name: 'Markdown', iconId: 'file-text', content }]);
    } catch (err: any) {
        api.v1.error("Markdown Manager: render failed", err);
    }
}
