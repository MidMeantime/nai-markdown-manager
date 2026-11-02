// --- Markdown Manager State, Settings & Document Helpers ---

const MDM_SETTINGS_KEY = mdmId('settings');
const MDM_KEY_FILENAME = mdmId('export.filename');
const MDM_KEY_AUTHOR = mdmId('export.author');
const MDM_BATCH_SIZE = 40;

const MDM_IMPORT_STYLES: MdmHeaderStyle[] = ['bracket', 'bracket_title', 'clean', 'markdown_h1', 'raw', 'none'];
const MDM_EXPORT_STYLES: MdmHeaderStyle[] = ['markdown_h1', 'markdown_h2', 'bracket', 'bracket_title', 'clean', 'raw', 'none'];

function mdmDefaultSettings(): MdmSettings {
    return {
        tab: 'import',
        import: {
            headerStyle: 'bracket',
            includeDivider: true,
            stripEmphasis: false,
            preserveBlankLines: false,
            appendUnmatched: true,
            target: 'document'
        },
        export: {
            headerStyle: 'markdown_h1',
            includeDivider: false,
            stripEmphasis: false,
            frontmatter: 'yaml',
            includeStats: true,
            includeMemory: false,
            includeAuthorsNote: false,
            stripAfterExport: false,
            scope: 'all'
        }
    };
}

const mdmState: MdmState = {
    settings: mdmDefaultSettings(),
    detection: uccdsHeaderOptions(uccdsNormalizeSettings(null)),
    chapterSource: 'embedded',
    dependencyVersion: "",
    headingSplit: 'auto',
    file: null,
    manualTargets: {},
    editorChapters: [],
    hasScanned: false,
    storyTitle: "",
    exportSelected: new Set<number>(),
    exportKnownKeys: new Set<number>(),
    busy: false
};

function mdmBreakToken(): string {
    return mdmState.detection.breakToken || '***';
}

async function mdmLoadConfigAndSettings(): Promise<void> {
    const getStr = async (name: string, fallback: string): Promise<string> => {
        try {
            const v = await api.v1.config.get(name);
            return (typeof v === 'string' && v.trim()) ? v.trim() : fallback;
        } catch {
            return fallback;
        }
    };
    const getBool = async (name: string, fallback: boolean): Promise<boolean> => {
        try {
            const v = await api.v1.config.get(name);
            return typeof v === 'boolean' ? v : fallback;
        } catch {
            return fallback;
        }
    };

    const defaults = mdmDefaultSettings();
    const importStyle = await getStr('default_import_header', 'bracket') as MdmHeaderStyle;
    const exportStyle = await getStr('default_export_header', 'markdown_h1') as MdmHeaderStyle;
    if (MDM_IMPORT_STYLES.includes(importStyle)) defaults.import.headerStyle = importStyle;
    if (MDM_EXPORT_STYLES.includes(exportStyle)) defaults.export.headerStyle = exportStyle;
    defaults.import.preserveBlankLines = await getBool('preserve_blank_lines', false);

    mdmState.headingSplit = (await getStr('import_heading_split', 'auto')) === 'all' ? 'all' : 'auto';

    // Panel choices saved from last time win over config defaults
    try {
        const saved = await api.v1.storage.get(MDM_SETTINGS_KEY);
        if (saved && typeof saved === 'object') {
            mdmState.settings = {
                tab: saved.tab === 'export' ? 'export' : 'import',
                import: { ...defaults.import, ...(saved.import || {}) },
                export: { ...defaults.export, ...(saved.export || {}) }
            };
            return;
        }
    } catch (err: any) {
        api.v1.log("Markdown Manager: could not read saved settings", err);
    }
    mdmState.settings = defaults;
}

async function mdmSaveSettings(): Promise<void> {
    try {
        await api.v1.storage.set(MDM_SETTINGS_KEY, mdmState.settings);
    } catch (err: any) {
        api.v1.log("Markdown Manager: could not save settings", err);
    }
}

async function mdmEnsurePermission(name: 'documentEdit' | 'storyEdit' | 'fileInput' | 'fileDownload', why: string): Promise<boolean> {
    if (await api.v1.permissions.has(name)) return true;
    const granted = await api.v1.permissions.request(name, why);
    if (!granted) await mdmNotify(`Permission "${name}" is needed for this.`, 'warning');
    return granted;
}

// --- Chapter detection (UCCDS dual) ---

/** Text before the first header must stay a chapter here, or exports and replacements would drop it */
const MDM_CHAPTER_OVERRIDES: Partial<UccdsSettings> = { openingText: 'chapter' };

/** Built-in chapter rules: this script's [Chapters] options (UCCDS names) */
async function mdmLoadChapterSettings(): Promise<UccdsSettings> {
    return { ...(await uccdsLoadSettings()), ...MDM_CHAPTER_OVERRIDES };
}

/** UCCDS dual: the built-in detector, or the UCCDS script's rules when it's enabled. Doesn't wait for it */
async function mdmStartChapterDetection(): Promise<void> {
    await uccdsDualStart({ loadSettings: mdmLoadChapterSettings, onChange: mdmOnChapterSourceChange, dependencyOverrides: MDM_CHAPTER_OVERRIDES });
}

/** The UCCDS script turned up / went away, or saw the chapters change: refresh the lists */
async function mdmOnChapterSourceChange(_reason: UccdsDualChangeReason): Promise<void> {
    if (mdmState.busy) return;
    await mdmScanEditor();
    await mdmRender();
}

/** Fresh read of the story's chapters */
async function mdmScanEditor(): Promise<MdmEditorChapter[]> {
    const sections = await uccdsScanSections();
    let result: UccdsResult;
    if (uccdsDualSource() === 'embedded') {
        await uccdsDualReloadSettings();
        result = uccdsDetectChapters(sections, uccdsDualSettings());
    } else {
        // Falls back to the built-in detector by itself if the UCCDS script stopped answering
        result = await uccdsDualGetChapters();
    }
    mdmState.chapterSource = uccdsDualSource();
    const info = uccdsDualDependencyInfo();
    mdmState.dependencyVersion = info ? info.version : "";
    mdmState.detection = uccdsHeaderOptions(result.settings);
    const chapters = mdmEditorChaptersFromResult(result, sections);
    mdmState.editorChapters = chapters;
    mdmState.hasScanned = true;
    // New chapters start ticked for export; ticks on chapters that still exist are kept
    const live = new Set<number>(chapters.map((c: MdmEditorChapter) => c.key));
    for (const c of chapters) {
        if (!mdmState.exportKnownKeys.has(c.key)) {
            mdmState.exportKnownKeys.add(c.key);
            mdmState.exportSelected.add(c.key);
        }
    }
    mdmState.exportSelected.forEach((k: number) => { if (!live.has(k)) mdmState.exportSelected.delete(k); });
    return chapters;
}

async function mdmDocumentIsEmpty(): Promise<boolean> {
    const scanned = await api.v1.document.scan();
    return !(scanned || []).some((s: { section: Section }) => s.section && s.section.text && s.section.text.trim().length > 0);
}

/** Inserts paragraphs after `anchorId` in batches, keeping their order */
async function mdmInsertAfter(anchorId: number, paragraphs: string[], onProgress?: (done: number, total: number) => Promise<void>): Promise<void> {
    let anchor = anchorId;
    for (let i = 0; i < paragraphs.length; i += MDM_BATCH_SIZE) {
        const batch = paragraphs.slice(i, i + MDM_BATCH_SIZE);
        await api.v1.document.insertParagraphsAfter(anchor, batch.map((text: string) => ({ text })));
        if (i + MDM_BATCH_SIZE < paragraphs.length) {
            const ids = await api.v1.document.sectionIds();
            const at = ids.indexOf(anchor);
            if (at === -1) throw new Error("Lost track of the insert position in the story.");
            anchor = ids[at + batch.length];
            await api.v1.timers.sleep(30);
        }
        if (onProgress) await onProgress(Math.min(i + MDM_BATCH_SIZE, paragraphs.length), paragraphs.length);
    }
}

async function mdmAppend(paragraphs: string[], onProgress?: (done: number, total: number) => Promise<void>): Promise<void> {
    for (let i = 0; i < paragraphs.length; i += MDM_BATCH_SIZE) {
        const batch = paragraphs.slice(i, i + MDM_BATCH_SIZE);
        await api.v1.document.appendParagraphs(batch.map((text: string) => ({ text })));
        if (onProgress) await onProgress(Math.min(i + MDM_BATCH_SIZE, paragraphs.length), paragraphs.length);
        if (i + MDM_BATCH_SIZE < paragraphs.length) await api.v1.timers.sleep(30);
    }
}

async function mdmRemove(ids: number[]): Promise<void> {
    for (let i = 0; i < ids.length; i += 100) {
        await api.v1.document.removeParagraphs(ids.slice(i, i + 100));
        if (i + 100 < ids.length) await api.v1.timers.sleep(30);
    }
}

/**
 * Replaces a run of sections with new paragraphs in place. The first section is kept as the
 * anchor (updated, not deleted), so this works the same at the top of the story, in the middle,
 * and for the whole document.
 */
async function mdmReplaceSections(ids: number[], paragraphs: string[], onProgress?: (done: number, total: number) => Promise<void>): Promise<void> {
    if (ids.length === 0) throw new Error("Nothing to replace.");
    const paras = paragraphs.length > 0 ? paragraphs : [""];
    const anchor = ids[0];
    if (ids.length > 1) await mdmRemove(ids.slice(1));
    await api.v1.document.updateParagraph(anchor, { text: paras[0] });
    if (paras.length > 1) await mdmInsertAfter(anchor, paras.slice(1), onProgress);
}
