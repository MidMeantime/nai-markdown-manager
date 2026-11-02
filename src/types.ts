// --- Markdown Manager Types ---
// Header parsing and chapter types (ParsedHeader, HeaderDetectionOptions, UccdsSettings, UccdsResult,
// UccdsSource...) come from UCCDS, bundled in front of this file.

type MdmHeaderStyle = 'bracket' | 'bracket_title' | 'markdown_h1' | 'markdown_h2' | 'clean' | 'raw' | 'none';
type MdmFrontmatter = 'yaml' | 'toml' | 'none';
type MdmTab = 'import' | 'export';
type MdmImportTarget = 'document' | 'memory';
type MdmExportScope = 'all' | 'selected';
type MdmMatchConfidence = 'exact' | 'number' | 'title' | 'manual' | 'none';

/** A user override for where one imported chapter goes */
type MdmTargetChoice =
    | { mode: 'auto' }
    | { mode: 'editor'; key: number }
    | { mode: 'append' }
    | { mode: 'skip' };

/** One chapter parsed out of an imported Markdown file */
interface MdmFileChapter {
    id: number;
    /** null for text before the first header (or a file with no headers) */
    header: ParsedHeader | null;
    /** Header line exactly as written in the file */
    rawHeader: string;
    /** Display title, e.g. "Chapter 8" or "Opening text" */
    title: string;
    bodyLines: string[];
    wordCount: number;
}

interface MdmLoadedFile {
    title: string;
    hasFrontmatter: boolean;
    sizeBytes: number;
    chapters: MdmFileChapter[];
}

/** One chapter found in the story document */
interface MdmEditorChapter {
    /** Stable identity: the header's section id (or the first section id for untitled text) */
    key: number;
    index: number;
    header: ParsedHeader | null;
    rawHeader: string;
    title: string;
    /** Every section that belongs to the chapter, including a leading *** and empty lines */
    sectionIds: number[];
    /** Non-empty body paragraphs (no header, no leading divider) */
    bodyTexts: string[];
    wordCount: number;
    /** Nothing but empty lines comes before this chapter */
    startsDocument: boolean;
}

interface MdmChapterMatch {
    importId: number;
    action: 'replace' | 'append' | 'skip';
    editorKey: number | null;
    confidence: MdmMatchConfidence;
    reason: string;
}

interface MdmImportSettings {
    headerStyle: MdmHeaderStyle;
    includeDivider: boolean;
    stripEmphasis: boolean;
    preserveBlankLines: boolean;
    appendUnmatched: boolean;
    target: MdmImportTarget;
}

interface MdmExportSettings {
    headerStyle: MdmHeaderStyle;
    includeDivider: boolean;
    stripEmphasis: boolean;
    frontmatter: MdmFrontmatter;
    includeStats: boolean;
    includeMemory: boolean;
    includeAuthorsNote: boolean;
    stripAfterExport: boolean;
    scope: MdmExportScope;
}

interface MdmSettings {
    tab: MdmTab;
    import: MdmImportSettings;
    export: MdmExportSettings;
}

interface MdmState {
    settings: MdmSettings;
    /** Header rules of the last scan (the active UCCDS rules), also used to read imported files */
    detection: HeaderDetectionOptions;
    /** Where the story's chapters come from: built in, or the UCCDS script */
    chapterSource: UccdsSource;
    /** UCCDS script version while it's the source, else "" */
    dependencyVersion: string;
    headingSplit: 'auto' | 'all';
    file: MdmLoadedFile | null;
    manualTargets: Record<number, MdmTargetChoice>;
    editorChapters: MdmEditorChapter[];
    hasScanned: boolean;
    storyTitle: string;
    /** Chapter keys ticked for a "Selected" export */
    exportSelected: Set<number>;
    /** Keys seen by the export list, so new chapters start ticked and old ticks survive a re-scan */
    exportKnownKeys: Set<number>;
    busy: boolean;
}

/** Inputs for building an export file (gathered from the story at export time) */
interface MdmExportMeta {
    title: string;
    author: string;
    description: string;
    memory: string;
    authorsNote: string;
    date: string;
}
