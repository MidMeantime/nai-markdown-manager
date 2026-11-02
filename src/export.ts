// --- Markdown Manager: Export Actions ---

const MDM_EXPORT_STATS_ID = mdmId('export.stats');
const MDM_EXPORT_PREVIEW_ID = mdmId('export.preview');
const MDM_PREVIEW_CHARS = 600;

function mdmExportTargets(): MdmEditorChapter[] {
    if (mdmState.settings.export.scope === 'all') return mdmState.editorChapters;
    return mdmState.editorChapters.filter((c: MdmEditorChapter) => mdmState.exportSelected.has(c.key));
}

async function mdmGatherExportMeta(): Promise<MdmExportMeta> {
    const safe = async (get: () => Promise<string>): Promise<string> => {
        try {
            return (await get()) || "";
        } catch {
            return "";
        }
    };
    const settings = mdmState.settings.export;
    const title = await safe(() => api.v1.story.title.get());
    mdmState.storyTitle = title.trim();
    return {
        title: title.trim(),
        author: String((await api.v1.storage.get(MDM_KEY_AUTHOR)) || ""),
        description: await safe(() => api.v1.story.description.get()),
        memory: settings.includeMemory ? await safe(() => api.v1.memory.get()) : "",
        authorsNote: settings.includeAuthorsNote ? await safe(() => api.v1.an.get()) : "",
        date: new Date().toISOString().split('T')[0]
    };
}

async function mdmBuildCurrentExport(): Promise<{ markdown: string; chapters: MdmEditorChapter[] }> {
    const chapters = mdmExportTargets();
    const meta = await mdmGatherExportMeta();
    return { markdown: mdmBuildExportMarkdown(chapters, mdmState.settings.export, meta, mdmBreakToken()), chapters };
}

function mdmExportStatsText(markdown: string, chapters: MdmEditorChapter[]): string {
    const total = mdmState.editorChapters.length;
    if (chapters.length === 0) return `**0** of ${total} chapters selected. Tick at least one chapter to export.`;
    const words = chCountWords(markdown);
    return `**${chapters.length}** of ${total} chapters · **${words.toLocaleString()}** words · ~**${mdmEstimateTokens(markdown.length).toLocaleString()}** tokens`;
}

function mdmPreviewText(markdown: string): string {
    if (markdown.length <= MDM_PREVIEW_CHARS) return markdown;
    return `${markdown.slice(0, MDM_PREVIEW_CHARS)}\n… ${(markdown.length - MDM_PREVIEW_CHARS).toLocaleString()} more characters`;
}

/** Refreshes only the stats line and preview (no full re-render, so ticking boxes stays smooth) */
async function mdmRefreshExportSummary(): Promise<void> {
    try {
        const { markdown, chapters } = await mdmBuildCurrentExport();
        await api.v1.ui.updateParts([
            { type: 'text', id: MDM_EXPORT_STATS_ID, text: mdmExportStatsText(markdown, chapters) },
            { type: 'text', id: MDM_EXPORT_PREVIEW_ID, text: chapters.length > 0 ? mdmPreviewText(markdown) : "Nothing selected." }
        ]);
    } catch (err: any) {
        api.v1.log("Markdown Manager: export summary refresh failed", err);
    }
}

async function mdmSetAllSelected(selected: boolean): Promise<void> {
    for (const c of mdmState.editorChapters) {
        if (selected) mdmState.exportSelected.add(c.key);
        else mdmState.exportSelected.delete(c.key);
        // Bound checkboxes follow their storage key
        await api.v1.tempStorage.set(mdmId(`export.sel.${c.key}`), selected);
    }
    await mdmRefreshExportSummary();
}

async function mdmRunExport(): Promise<void> {
    const settings = mdmState.settings.export;
    if (!(await mdmEnsurePermission('fileDownload', 'Needed to save the Markdown file.'))) return;
    if (settings.stripAfterExport && !(await mdmEnsurePermission('documentEdit', 'Needed to remove exported chapters from the story.'))) return;

    // Build from a fresh scan so the file and the strip step both match the story right now
    await mdmScanEditor();
    const { markdown, chapters } = await mdmBuildCurrentExport();
    if (chapters.length === 0) {
        await mdmNotify("Select at least one chapter to export.", 'warning');
        await mdmRender();
        return;
    }

    const allSections = await api.v1.document.sectionIds();
    const stripIds = new Set<number>();
    chapters.forEach((c: MdmEditorChapter) => c.sectionIds.forEach((id: number) => stripIds.add(id)));
    const wipesStory = settings.stripAfterExport && allSections.every((id: number) => stripIds.has(id) || false);

    if (settings.stripAfterExport) {
        const ok = await mdmConfirm('Export and remove from story?',
            `After saving, **${chapters.length} chapter(s)** are removed from the story${wipesStory ? ' (that is the whole story)' : ''}. You can undo with Ctrl+Z.`,
            'Export & remove', true);
        if (!ok) return;
    }

    const typed = String((await api.v1.tempStorage.get(MDM_KEY_FILENAME)) || "").trim();
    const fileName = typed ? mdmSanitizeFileName(typed) : mdmDefaultFileName(mdmState.storyTitle, chapters, settings.scope);

    await mdmRunBusy('Exporting', async () => {
        await api.v1.file.save(fileName, markdown);
        const words = chCountWords(markdown).toLocaleString();
        if (!settings.stripAfterExport) {
            await mdmNotify(`Exported ${words} words to "${fileName}".`, 'success');
            return;
        }
        await mdmSetStatus('Removing exported chapters');
        const ids = allSections.filter((id: number) => stripIds.has(id));
        if (wipesStory && ids.length > 0) {
            // The editor always keeps one paragraph: blank the first instead of deleting it
            await mdmRemove(ids.slice(1));
            await api.v1.document.updateParagraph(ids[0], { text: "" });
        } else {
            await mdmRemove(ids);
        }
        await mdmScanEditor();
        await mdmNotify(`Exported ${words} words to "${fileName}" and removed ${chapters.length} chapter(s) from the story.`, 'success');
    });
}
