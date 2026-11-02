// --- Markdown Manager: Import Actions ---

const MDM_STATUS_ID = mdmId('status');

async function mdmSetStatus(text: string): Promise<void> {
    try {
        await api.v1.ui.updateParts([{ type: 'text', id: MDM_STATUS_ID, text }]);
    } catch {
        // The status line may not be mounted yet; the next render shows the final state
    }
}

/** Runs a story-changing action with the panel locked and errors reported */
async function mdmRunBusy(label: string, work: () => Promise<void>): Promise<void> {
    if (mdmState.busy) return;
    mdmState.busy = true;
    await mdmRender();
    await mdmSetStatus(label);
    try {
        await work();
    } catch (err: any) {
        api.v1.error(`Markdown Manager: ${label} failed`, err);
        await mdmNotify(`${label} failed: ${err?.message || String(err)}`, 'error');
    } finally {
        mdmState.busy = false;
        await mdmRender();
    }
}

function mdmLoadText(raw: string): MdmLoadedFile {
    const fm = mdmStripFrontmatter(raw);
    const parsed = mdmParseMarkdown(fm.text, mdmState.detection, mdmState.headingSplit);
    return {
        title: fm.title || parsed.docTitle || "Imported file",
        hasFrontmatter: fm.hasFrontmatter,
        sizeBytes: mdmUtf8Length(raw),
        chapters: parsed.chapters
    };
}

async function mdmPickFile(): Promise<void> {
    if (!(await mdmEnsurePermission('fileInput', 'Needed to read the Markdown file you pick.'))) return;
    try {
        const result = await api.v1.file.prompt({ accept: '.md,.markdown,.txt,text/markdown,text/plain', readAs: 'text' });
        if (typeof result !== 'string' || !result.trim()) return;
        mdmState.file = mdmLoadText(result);
        mdmState.manualTargets = {};
        await mdmScanEditor();
        await mdmRender();
        await mdmNotify(`Loaded "${mdmState.file.title}": ${mdmState.file.chapters.length} chapter(s).`, 'success');
    } catch (err: any) {
        api.v1.error("Markdown Manager: file read failed", err);
        await mdmNotify(`Couldn't read the file: ${err?.message || String(err)}`, 'error');
    }
}

function mdmCurrentMatches(): MdmChapterMatch[] {
    if (!mdmState.file) return [];
    return mdmResolveMatches(mdmState.file.chapters, mdmState.editorChapters, mdmState.manualTargets, mdmState.settings.import.appendUnmatched);
}

/** Lets the user pick where one imported chapter goes */
async function mdmChooseTarget(chapter: MdmFileChapter): Promise<void> {
    await mdmScanEditor();
    const options: { label: string; value: MdmTargetChoice; variant?: MdmButtonVariant; icon?: IconId }[] = [
        { label: 'Automatic match', value: { mode: 'auto' }, icon: 'zap', variant: 'subtle' },
        { label: 'Add as a new chapter at the end', value: { mode: 'append' }, icon: 'plus', variant: 'subtle' },
        { label: "Don't import this chapter", value: { mode: 'skip' }, icon: 'slash', variant: 'subtle' }
    ];
    for (const ed of mdmState.editorChapters) {
        options.push({ label: `Replace: ${ed.title} (${ed.wordCount.toLocaleString()}w)`, value: { mode: 'editor', key: ed.key }, icon: 'refresh-cw' });
    }
    const choice = await mdmChoose<MdmTargetChoice>(
        'Where should this chapter go?',
        `**${chapter.title}** (${chapter.wordCount.toLocaleString()} words)`,
        options,
        true
    );
    if (!choice) return;
    // Each story chapter can only be replaced once: free it from any other imported chapter
    if (choice.mode === 'editor') {
        for (const [id, other] of Object.entries(mdmState.manualTargets) as [string, MdmTargetChoice][]) {
            if (Number(id) !== chapter.id && other.mode === 'editor' && other.key === choice.key) {
                mdmState.manualTargets[Number(id)] = { mode: 'auto' };
            }
        }
    }
    mdmState.manualTargets[chapter.id] = choice;
    await mdmRender();
}

async function mdmImportAppendAll(): Promise<void> {
    const file = mdmState.file;
    if (!file) return;
    if (!(await mdmEnsurePermission('documentEdit', 'Needed to add the imported text to your story.'))) return;
    await mdmRunBusy('Adding to story', async () => {
        const atStart = await mdmDocumentIsEmpty();
        const paragraphs = mdmRenderFileChapters(file.chapters, mdmState.settings.import, atStart, mdmBreakToken());
        await mdmAppend(paragraphs, async (done: number, total: number) => mdmSetStatus(`Adding to story: ${Math.round(done / total * 100)}%`));
        await mdmScanEditor();
        const words = file.chapters.reduce((n: number, c: MdmFileChapter) => n + c.wordCount, 0);
        await mdmNotify(`Added ${words.toLocaleString()} words to the story.`, 'success');
    });
}

async function mdmImportApplyMatches(): Promise<void> {
    const file = mdmState.file;
    if (!file) return;
    if (!(await mdmEnsurePermission('documentEdit', 'Needed to replace chapters in your story.'))) return;

    // Plan against the story as it is now, not as it was when the panel was drawn
    const editor = await mdmScanEditor();
    const matches = mdmCurrentMatches();
    const replaces = matches.filter((m: MdmChapterMatch) => m.action === 'replace');
    const appends = matches.filter((m: MdmChapterMatch) => m.action === 'append');
    if (replaces.length === 0 && appends.length === 0) {
        await mdmNotify("Nothing to do: every chapter is set to skip.", 'warning');
        return;
    }

    const byKey = new Map<number, MdmEditorChapter>();
    editor.forEach((e: MdmEditorChapter) => byKey.set(e.key, e));
    const byId = new Map<number, MdmFileChapter>();
    file.chapters.forEach((c: MdmFileChapter) => byId.set(c.id, c));

    const lines: string[] = [];
    for (const m of replaces) {
        const ed = byKey.get(m.editorKey as number);
        lines.push(`- **${(byId.get(m.importId) as MdmFileChapter).title}** replaces **${ed ? ed.title : '?'}**`);
    }
    if (appends.length > 0) lines.push(`- ${appends.length} chapter(s) added at the end`);
    const ok = await mdmConfirm('Replace chapters?',
        `${lines.join('\n')}\n\nThe replaced chapters' current text is overwritten. You can undo with Ctrl+Z.`,
        replaces.length > 0 ? `Replace ${replaces.length}` : `Add ${appends.length}`, replaces.length > 0);
    if (!ok) return;

    await mdmRunBusy('Replacing chapters', async () => {
        const settings = mdmState.settings.import;
        // Bottom-up, so earlier chapters' sections are untouched while later ones change
        const ordered = replaces.slice().sort((a: MdmChapterMatch, b: MdmChapterMatch) =>
            (byKey.get(b.editorKey as number) as MdmEditorChapter).index - (byKey.get(a.editorKey as number) as MdmEditorChapter).index);
        let n = 0;
        for (const m of ordered) {
            const ed = byKey.get(m.editorKey as number) as MdmEditorChapter;
            const imp = byId.get(m.importId) as MdmFileChapter;
            n++;
            await mdmSetStatus(`Replacing "${ed.title}" (${n}/${ordered.length})`);
            await mdmReplaceSections(ed.sectionIds, mdmRenderFileChapter(imp, settings, ed.startsDocument, mdmBreakToken()));
            await api.v1.timers.sleep(30);
        }
        if (appends.length > 0) {
            await mdmSetStatus(`Adding ${appends.length} new chapter(s)`);
            const atStart = await mdmDocumentIsEmpty();
            const newChapters = appends.map((m: MdmChapterMatch) => byId.get(m.importId) as MdmFileChapter);
            await mdmAppend(mdmRenderFileChapters(newChapters, settings, atStart, mdmBreakToken()));
        }
        mdmState.manualTargets = {};
        await mdmScanEditor();
        const added = appends.length > 0 ? ` and added ${appends.length}` : '';
        await mdmNotify(`Replaced ${replaces.length} chapter(s)${added}.`, 'success');
    });
}

async function mdmImportReplaceStory(): Promise<void> {
    const file = mdmState.file;
    if (!file) return;
    if (!(await mdmEnsurePermission('documentEdit', 'Needed to replace your story text.'))) return;
    const ok = await mdmConfirm('Replace the entire story?',
        `Every paragraph in the story is replaced with **${file.title}** (${file.chapters.length} chapter(s)). You can undo with Ctrl+Z.`,
        'Replace story', true);
    if (!ok) return;
    await mdmRunBusy('Replacing story', async () => {
        const ids = await api.v1.document.sectionIds();
        const paragraphs = mdmRenderFileChapters(file.chapters, mdmState.settings.import, true, mdmBreakToken());
        if (ids.length === 0) {
            await mdmAppend(paragraphs);
        } else {
            await mdmReplaceSections(ids, paragraphs, async (done: number, total: number) => mdmSetStatus(`Writing story: ${Math.round(done / total * 100)}%`));
        }
        mdmState.manualTargets = {};
        await mdmScanEditor();
        await mdmNotify(`Story replaced with "${file.title}".`, 'success');
    });
}

async function mdmImportToMemory(overwrite: boolean): Promise<void> {
    const file = mdmState.file;
    if (!file) return;
    if (!(await mdmEnsurePermission('storyEdit', 'Needed to change Story Memory.'))) return;
    if (overwrite) {
        const ok = await mdmConfirm('Overwrite Memory?', "Your current Story Memory is replaced with the imported text.", 'Overwrite', true);
        if (!ok) return;
    }
    await mdmRunBusy('Updating Memory', async () => {
        const text = mdmRenderFileChapters(file.chapters, mdmState.settings.import, true, mdmBreakToken()).join('\n');
        if (overwrite) {
            await api.v1.memory.set(text);
        } else {
            const current = await api.v1.memory.get();
            await api.v1.memory.set(current && current.trim() ? `${current}\n\n${text}` : text);
        }
        await mdmNotify(overwrite ? "Memory overwritten." : "Added to Memory.", 'success');
    });
}
