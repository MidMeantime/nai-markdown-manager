// --- Markdown Manager Core (pure logic, no api calls) ---

const MDM_EST_CHARS_PER_TOKEN = 3.6;

function mdmUtf8Length(str: string): number {
    let bytes = 0;
    for (let i = 0; i < str.length; i++) {
        const code = str.charCodeAt(i);
        if (code < 0x80) bytes += 1;
        else if (code < 0x800) bytes += 2;
        else if (code >= 0xd800 && code <= 0xdbff) { bytes += 4; i++; }
        else bytes += 3;
    }
    return bytes;
}

function mdmFormatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function mdmEstimateTokens(chars: number): number {
    return Math.ceil(chars / MDM_EST_CHARS_PER_TOKEN);
}

function mdmSanitizeFileName(name: string): string {
    let clean = (name || "").replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').replace(/\s+/g, ' ').trim();
    if (!clean) clean = "Story Export";
    if (!/\.(md|txt)$/i.test(clean)) clean += ".md";
    return clean;
}

// --- Frontmatter ---

/** Reads a scalar value from a frontmatter line, removing matching quotes */
function mdmFrontmatterValue(block: string, key: string, assign: ':' | '='): string {
    const re = new RegExp(`^${key}\\s*${assign === ':' ? ':' : '='}\\s*(.+)$`, 'im');
    const m = block.match(re);
    if (!m) return "";
    let v = m[1].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    }
    return v.trim();
}

/** Strips YAML (---), TOML (+++) or /*--- *\/ frontmatter and returns the title it held */
function mdmStripFrontmatter(raw: string): { text: string; title: string; hasFrontmatter: boolean } {
    let text = (raw || "").replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
    const patterns: { re: RegExp; assign: ':' | '=' }[] = [
        { re: /^\/\*---\n([\s\S]*?)\n---\*\/[ \t]*(?:\n|$)/, assign: ':' },
        { re: /^---\n([\s\S]*?)\n---[ \t]*(?:\n|$)/, assign: ':' },
        { re: /^\+\+\+\n([\s\S]*?)\n\+\+\+[ \t]*(?:\n|$)/, assign: '=' }
    ];
    for (const p of patterns) {
        const m = text.match(p.re);
        if (m) {
            const title = mdmFrontmatterValue(m[1], 'title', p.assign) || mdmFrontmatterValue(m[1], 'name', p.assign);
            return { text: text.slice(m[0].length), title, hasFrontmatter: true };
        }
    }
    return { text, title: "", hasFrontmatter: false };
}

function mdmYamlString(value: string): string {
    return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`;
}

function mdmYamlBlock(key: string, value: string): string {
    return `${key}: |\n${value.split('\n').map((l: string) => `  ${l}`).join('\n')}`;
}

function mdmTomlString(value: string): string {
    return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`;
}

function mdmTomlBlock(key: string, value: string): string {
    return `${key} = """\n${value.replace(/\\/g, '\\\\').replace(/"""/g, '\\"""')}\n"""`;
}

// --- Header formatting (shared by import and export) ---

/**
 * Header line for a chapter in the chosen style. `raw` is the header as written in the source.
 * Returns "" for 'none' and for chapters without a header.
 */
function mdmFormatHeaderLine(header: ParsedHeader | null, raw: string, style: MdmHeaderStyle): string {
    if (!header || !header.isHeader) return "";
    const display = chDisplayTitle(header) || header.cleanName || raw.trim();
    switch (style) {
        case 'bracket': return `[ ${display} ]`;
        case 'bracket_title': return `[ ${header.cleanName || display} ]`;
        case 'markdown_h1': return `# ${display}`;
        case 'markdown_h2': return `## ${display}`;
        case 'clean': return display;
        case 'raw': return raw.trim();
        case 'none': return "";
    }
    return display;
}

// --- Importing: Markdown file -> chapters ---

function mdmMakeFileChapter(id: number, header: ParsedHeader | null, rawHeader: string, bodyLines: string[], fallbackTitle: string): MdmFileChapter {
    // Trim blank lines at both ends of the body
    let start = 0;
    let end = bodyLines.length;
    while (start < end && !bodyLines[start].trim()) start++;
    while (end > start && !bodyLines[end - 1].trim()) end--;
    const body = bodyLines.slice(start, end);
    return {
        id,
        header,
        rawHeader,
        title: header ? (chDisplayTitle(header) || rawHeader.trim()) : fallbackTitle,
        bodyLines: body,
        wordCount: chCountWords(body.join('\n'))
    };
}

/** Is this line a scene divider under these rules (break token, only-my-break-token)? */
function mdmIsDivider(text: string, detection: HeaderDetectionOptions): boolean {
    return chIsDivider(text, detection.breakToken, !!detection.onlyBreakToken);
}

/**
 * Picks which markdown heading level starts a chapter. 'auto': the highest level used, except a
 * lone level-1 heading at the very top of a file that also has deeper headings (the file title).
 */
function mdmPickSplitLevel(lines: string[], mode: 'auto' | 'all', detection: HeaderDetectionOptions): { level: number; titleLine: number } {
    if (mode === 'all') return { level: 6, titleLine: -1 };
    const levels: { line: number; level: number }[] = [];
    for (let i = 0; i < lines.length; i++) {
        const m = lines[i].match(/^(#{1,6})\s+\S/);
        if (m) levels.push({ line: i, level: m[1].length });
    }
    if (levels.length === 0) return { level: 0, titleLine: -1 };
    const min = Math.min(...levels.map((l: { level: number }) => l.level));
    const atMin = levels.filter((l: { level: number }) => l.level === min);
    const firstContent = lines.findIndex((l: string) => l.trim().length > 0);
    const deeper = levels.filter((l: { level: number }) => l.level > min);
    // Only a plain title counts ("# My Book"); "# Part One" or "# Chapter 1" is real structure
    const isPlainTitle = atMin.length === 1 && chParseHeader(lines[atMin[0].line], detection).kind === 'title';
    if (isPlainTitle && atMin[0].line === firstContent && deeper.length > 0) {
        return { level: Math.min(...deeper.map((l: { level: number }) => l.level)), titleLine: atMin[0].line };
    }
    return { level: min, titleLine: -1 };
}

/**
 * Splits imported Markdown into chapters. A *** right before a header is dropped from the
 * previous chapter (the header style adds its own), so scene breaks are never doubled.
 */
function mdmParseMarkdown(
    text: string,
    detection: HeaderDetectionOptions,
    headingSplit: 'auto' | 'all'
): { docTitle: string; chapters: MdmFileChapter[] } {
    const lines = (text || "").replace(/\r\n?/g, '\n').split('\n');
    const split = mdmPickSplitLevel(lines, headingSplit, detection);
    let docTitle = "";

    const chapters: MdmFileChapter[] = [];
    let curHeader: ParsedHeader | null = null;
    let curRaw = "";
    let curLines: string[] = [];
    let sawHeader = false;

    const flush = (): void => {
        const hasContent = curLines.some((l: string) => l.trim() && !mdmIsDivider(l, detection));
        if (curHeader || hasContent) {
            chapters.push(mdmMakeFileChapter(chapters.length, curHeader, curRaw, curLines, sawHeader || curHeader ? "Untitled section" : "Opening text"));
        }
    };

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (i === split.titleLine) {
            const t = chParseHeader(line, detection);
            docTitle = t.isHeader ? (chDisplayTitle(t) || line.replace(/^#+\s*/, '')) : line.replace(/^#+\s*/, '');
            continue;
        }
        const parsed = chParseHeader(line, detection);
        let startsChapter = false;
        if (parsed.isHeader) {
            if (parsed.syntax === 'markdown') {
                const namesChapter = parsed.kind !== 'title';
                startsChapter = parsed.level <= split.level || namesChapter;
            } else {
                startsChapter = true;
            }
        }
        if (!startsChapter) {
            curLines.push(line);
            continue;
        }
        // Move a trailing divider (and blank lines) off the previous chapter
        let j = curLines.length - 1;
        while (j >= 0 && !curLines[j].trim()) j--;
        if (j >= 0 && mdmIsDivider(curLines[j], detection)) {
            curLines = curLines.slice(0, j);
        }
        flush();
        curHeader = parsed;
        curRaw = line.trim();
        curLines = [];
        sawHeader = true;
    }
    flush();

    if (chapters.length === 0 && text.trim()) {
        chapters.push(mdmMakeFileChapter(0, null, "", lines, "Imported text"));
    }
    return { docTitle, chapters };
}

/**
 * Turns body lines into story paragraphs: one paragraph per non-empty line, blank lines dropped
 * (or kept as one empty paragraph for 2+ blank lines when preserveBlankLines is on).
 */
function mdmBodyParagraphs(lines: string[], preserveBlankLines: boolean, stripEmphasis: boolean, breakToken?: string): string[] {
    const out: string[] = [];
    let blankRun = 0;
    for (const line of lines) {
        if (!line.trim()) {
            blankRun++;
            if (preserveBlankLines && blankRun === 2 && out.length > 0) out.push("");
            continue;
        }
        blankRun = 0;
        const text = line.trimEnd();
        out.push(stripEmphasis ? chStripEmphasis(text, breakToken) : text);
    }
    while (out.length > 0 && out[out.length - 1] === "") out.pop();
    return out;
}

/** Story paragraphs for one imported chapter */
function mdmRenderFileChapter(ch: MdmFileChapter, settings: MdmImportSettings, atDocumentStart: boolean, breakToken: string): string[] {
    const out: string[] = [];
    const headerLine = mdmFormatHeaderLine(ch.header, ch.rawHeader, settings.headerStyle);
    if (ch.header && settings.includeDivider && !atDocumentStart) out.push(breakToken || "***");
    if (headerLine) out.push(headerLine);
    out.push(...mdmBodyParagraphs(ch.bodyLines, settings.preserveBlankLines, settings.stripEmphasis, breakToken));
    return out;
}

/** Story paragraphs for several chapters, in order */
function mdmRenderFileChapters(chapters: MdmFileChapter[], settings: MdmImportSettings, atDocumentStart: boolean, breakToken: string): string[] {
    const out: string[] = [];
    chapters.forEach((ch: MdmFileChapter, i: number) => {
        out.push(...mdmRenderFileChapter(ch, settings, atDocumentStart && i === 0, breakToken));
    });
    return out;
}

// --- Story document -> chapters ---

/**
 * Story chapters from a UCCDS result (the built-in detector, or the UCCDS script when it's enabled).
 * `sections` is the document as scanned, to tell whether a chapter starts the document.
 */
function mdmEditorChaptersFromResult(result: UccdsResult, sections: UccdsSection[]): MdmEditorChapter[] {
    const position = new Map<number, number>();
    sections.forEach((s: UccdsSection, i: number) => position.set(s.sectionId, i));
    const firstContent = sections.findIndex((s: UccdsSection) => (s.text || "").trim().length > 0);
    return result.chapters.map((ch: UccdsChapter, index: number) => {
        const header = ch.header as ParsedHeader | null;
        const body = ch.paragraphs.filter((t: string) => t.trim().length > 0);
        let title: string;
        if (header) title = chDisplayTitle(header) || ch.rawHeader;
        else if (ch.kind === 'opening') title = "Opening text (before first chapter)";
        else if (!result.hasHeaders && result.chapters.length === 1) title = "Whole story (no chapter headers)";
        else title = ch.title; // split on dividers: "Chapter 3"
        const start = position.get(ch.startSectionId);
        return {
            key: ch.key,
            index,
            header,
            rawHeader: ch.rawHeader,
            title,
            sectionIds: ch.sectionIds.slice(),
            bodyTexts: body,
            wordCount: chCountWords(body.join('\n')),
            startsDocument: start !== undefined && (firstContent === -1 || start <= firstContent)
        };
    });
}

/**
 * Story chapters for plain sections with the given chapter rules (built-in detector). Text before
 * the first header always stays a chapter, so exports and replacements never lose it.
 */
function mdmBuildEditorChapters(sections: UccdsSection[], settings?: Partial<UccdsSettings> | null): MdmEditorChapter[] {
    const list = sections.map((s: UccdsSection) => ({ sectionId: s.sectionId, text: s.text || "" }));
    return mdmEditorChaptersFromResult(uccdsDetectChapters(list, { ...(settings || {}), openingText: 'chapter' }), list);
}

// --- Matching imported chapters to story chapters ---

function mdmTitleTokens(text: string): string[] {
    return chNormalizeTitle(text).split(' ').filter((w: string) => w.length >= 3);
}

function mdmTitleSimilarity(a: string, b: string): number {
    const ta = new Set<string>(mdmTitleTokens(a));
    const tb = new Set<string>(mdmTitleTokens(b));
    if (ta.size === 0 || tb.size === 0) return 0;
    let shared = 0;
    ta.forEach((w: string) => { if (tb.has(w)) shared++; });
    return shared / (ta.size + tb.size - shared);
}

/**
 * Decides, for every imported chapter, whether it replaces a story chapter, is appended, or is
 * skipped. Manual choices win; each story chapter is replaced at most once; untitled story text
 * (no header) is never auto-matched.
 */
function mdmResolveMatches(
    imported: MdmFileChapter[],
    editor: MdmEditorChapter[],
    manual: Record<number, MdmTargetChoice>,
    appendUnmatched: boolean
): MdmChapterMatch[] {
    const byKey = new Map<number, MdmEditorChapter>();
    editor.forEach((e: MdmEditorChapter) => byKey.set(e.key, e));
    const used = new Set<number>();
    const result = new Map<number, MdmChapterMatch>();

    // 0. Manual choices
    for (const imp of imported) {
        const choice = manual[imp.id];
        if (!choice || choice.mode === 'auto') continue;
        if (choice.mode === 'editor') {
            const ed = byKey.get(choice.key);
            if (ed && !used.has(ed.key)) {
                used.add(ed.key);
                result.set(imp.id, { importId: imp.id, action: 'replace', editorKey: ed.key, confidence: 'manual', reason: 'Chosen by you' });
            }
            // A target that disappeared from the story falls through to automatic matching
        } else if (choice.mode === 'append') {
            result.set(imp.id, { importId: imp.id, action: 'append', editorKey: null, confidence: 'manual', reason: 'Chosen by you: add as a new chapter' });
        } else {
            result.set(imp.id, { importId: imp.id, action: 'skip', editorKey: null, confidence: 'manual', reason: 'Chosen by you: skip' });
        }
    }

    const candidates = editor.filter((e: MdmEditorChapter) => e.header !== null);
    // Book/Part of each chapter, so Book 2's "Chapter 1" never replaces Book 1's
    const impDivision = new Map<number, string>();
    chDivisionContext(imported.map((c: MdmFileChapter) => c.header)).forEach((d: string, i: number) => impDivision.set(imported[i].id, chNormalizeTitle(d)));
    const edDivision = new Map<number, string>();
    chDivisionContext(editor.map((c: MdmEditorChapter) => c.header)).forEach((d: string, i: number) => edDivision.set(editor[i].key, chNormalizeTitle(d)));
    const sameDivision = (imp: MdmFileChapter, ed: MdmEditorChapter): boolean => {
        const a = impDivision.get(imp.id) || "";
        const b = edDivision.get(ed.key) || "";
        return !a || !b || a === b;
    };
    const claim = (imp: MdmFileChapter, test: (ed: MdmEditorChapter) => boolean, confidence: MdmMatchConfidence, reason: string): void => {
        if (result.has(imp.id) || !imp.header) return;
        const ed = candidates.find((e: MdmEditorChapter) => !used.has(e.key) && sameDivision(imp, e) && test(e));
        if (!ed) return;
        used.add(ed.key);
        result.set(imp.id, { importId: imp.id, action: 'replace', editorKey: ed.key, confidence, reason });
    };

    // 1. Same title
    for (const imp of imported) {
        const impTitle = chNormalizeTitle(imp.title);
        const impName = imp.header ? chNormalizeTitle(imp.header.cleanName) : "";
        claim(imp, (ed: MdmEditorChapter) => {
            const edHeader = ed.header as ParsedHeader;
            const edName = chNormalizeTitle(edHeader.cleanName);
            return (impTitle !== "" && impTitle === chNormalizeTitle(ed.title)) || (impName !== "" && impName === edName);
        }, 'exact', 'Same title');
    }
    // 2. Same chapter number (or both prologue / both epilogue)
    for (const imp of imported) {
        const h = imp.header;
        if (!h) continue;
        claim(imp, (ed: MdmEditorChapter) => {
            const eh = ed.header as ParsedHeader;
            if (h.kind === 'prologue' || h.kind === 'epilogue') return eh.kind === h.kind;
            return h.kind === eh.kind && h.number !== null && h.number === eh.number;
        }, 'number', h.number !== null ? `Same number (${h.number})` : `Both ${h.kind}`);
    }
    // 3. Similar title words
    for (const imp of imported) {
        const name = imp.header ? imp.header.cleanName : "";
        if (!name) continue;
        claim(imp, (ed: MdmEditorChapter) => mdmTitleSimilarity(name, (ed.header as ParsedHeader).cleanName) >= 0.6, 'title', 'Similar title');
    }

    return imported.map((imp: MdmFileChapter) => result.get(imp.id) || {
        importId: imp.id,
        action: appendUnmatched ? 'append' : 'skip',
        editorKey: null,
        confidence: 'none',
        reason: appendUnmatched ? 'No match: will be added at the end' : 'No match: skipped'
    } as MdmChapterMatch);
}

// --- Exporting: story chapters -> Markdown ---

function mdmBuildExportMarkdown(chapters: MdmEditorChapter[], settings: MdmExportSettings, meta: MdmExportMeta, breakToken: string): string {
    const blocks: string[] = [];
    const words = chapters.reduce((n: number, c: MdmEditorChapter) => n + c.wordCount, 0);
    const memory = settings.includeMemory ? meta.memory.trim() : "";
    const an = settings.includeAuthorsNote ? meta.authorsNote.trim() : "";
    const clean = (t: string): string => settings.stripEmphasis ? chStripEmphasis(t, breakToken) : t;

    if (settings.frontmatter === 'yaml') {
        const fm: string[] = ["---", `title: ${mdmYamlString(meta.title || "NovelAI Story")}`];
        if (meta.author.trim()) fm.push(`author: ${mdmYamlString(meta.author.trim())}`);
        if (meta.description.trim()) fm.push(`description: ${mdmYamlString(meta.description.trim())}`);
        fm.push(`date: ${mdmYamlString(meta.date)}`);
        if (settings.includeStats) {
            fm.push(`words: ${words}`);
            fm.push(`chapters: ${chapters.length}`);
        }
        // Memory / AN go in the frontmatter so re-importing the file doesn't turn them into chapters
        if (memory) fm.push(mdmYamlBlock('memory', memory));
        if (an) fm.push(mdmYamlBlock('authors_note', an));
        fm.push("---");
        blocks.push(fm.join('\n'));
    } else if (settings.frontmatter === 'toml') {
        const fm: string[] = ["+++", `title = ${mdmTomlString(meta.title || "NovelAI Story")}`];
        if (meta.author.trim()) fm.push(`author = ${mdmTomlString(meta.author.trim())}`);
        if (meta.description.trim()) fm.push(`description = ${mdmTomlString(meta.description.trim())}`);
        fm.push(`date = ${mdmTomlString(meta.date)}`);
        if (settings.includeStats) {
            fm.push(`words = ${words}`);
            fm.push(`chapters = ${chapters.length}`);
        }
        if (memory) fm.push(mdmTomlBlock('memory', memory));
        if (an) fm.push(mdmTomlBlock('authors_note', an));
        fm.push("+++");
        blocks.push(fm.join('\n'));
    } else {
        if (memory) blocks.push(`## Story Memory\n\n${clean(memory)}`);
        if (an) blocks.push(`## Author's Note\n\n${clean(an)}`);
    }

    let headed = 0;
    for (const ch of chapters) {
        const heading = mdmFormatHeaderLine(ch.header, ch.rawHeader, settings.headerStyle);
        const body = ch.bodyTexts.map((p: string) => clean(p.trim())).filter((p: string) => p.length > 0).join('\n\n');
        const parts: string[] = [];
        if (heading) {
            if (settings.includeDivider && headed > 0) parts.push(breakToken || "***");
            parts.push(heading);
            headed++;
        }
        if (body) parts.push(body);
        if (parts.length > 0) blocks.push(parts.join('\n\n'));
    }
    return blocks.join('\n\n').trim() + '\n';
}

/** Suggested file name for an export */
function mdmDefaultFileName(storyTitle: string, chapters: MdmEditorChapter[], scope: MdmExportScope): string {
    const story = storyTitle || "Story";
    if (scope === 'selected' && chapters.length === 1) {
        return mdmSanitizeFileName(`${story} - ${chapters[0].title}`);
    }
    return mdmSanitizeFileName(story);
}
