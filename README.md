# Mid's Markdown Manager

One NovelAI sidebar panel ("Markdown") for getting Markdown in and out of your story. It replaces the two separate scripts *Mid's Markdown Menagerie* (importer) and *Mid's Markdown Menagerie Exporter*.

## Who it's for
Writers who draft or back up chapters outside NovelAI (Obsidian, Google Docs → Markdown, AO3 exports) and want to move them in and out without copy-pasting chapter by chapter.

## Import tab
1. **Choose a .md / .txt file.** YAML (`---`), TOML (`+++`) and `/*--- ---*/` frontmatter is stripped and its `title` is used as the file name.
2. **Formatting:** pick the chapter header style written into the story (`[ Chapter 1: Title ]`, `[ Title ]`, `Chapter 1: Title`, `# Heading`, as written, or none), whether a `***` goes above each header, whether to remove `*italic*` / `**bold**` markers, and whether 2+ blank lines become an empty paragraph.
3. **Send to Story or Memory.**
   - **Append**: adds every chapter after the current story text.
   - **Replace matching chapters**: each chapter in the file is matched to a story chapter by title, then by chapter number (digits, Roman numerals and number words all count), then by similar title words. Use **Change** on any row to pick the target yourself, add it as a new chapter, or skip it. Matched chapters are replaced in place and the rest of the story is untouched.
   - **Replace entire story**: swaps all story text for the file (asks first).
   - **Memory**: add to or overwrite Story Memory.

Chapter headers in the file are read with the same rules as the story (UCCDS, below), so `[ Chapter 8 ]`, `# Chapter IV: Echoes`, `Chapter Twenty-One` and `[ 1: Sandor ]` are all recognised, and ATTG lines like `[ Author: X; Tags: Y ]` never are. How a *file* splits into chapters (which `#` levels, a lone `# Title` at the top) is still Markdown Manager's own logic.

## Chapter detection (UCCDS)
The story's chapters come from [UCCDS](../../Community%20Stuff/nai-chapter-detection-uccds), bundled in its **dual** form:
- **On its own**, Markdown Manager uses the built-in UCCDS detector with its own `[Chapters]` options.
- **With the UCCDS script enabled in the same story**, it picks it up (also when it's enabled later) and the user's UCCDS rules decide what a chapter is, for the story and for reading imported files, so Markdown Manager, Chapter Linter and the Menagerie all agree. Its own `[Chapters]` options are ignored then. If UCCDS is disabled, the next scan goes back to the built-in rules.
- Text before the first header is always kept as an "Opening text" chapter, even if UCCDS is set to leave it out, so exports and replacements never drop it.

The line under the tabs says which one is in use.

## Export tab
- **Whole story** or **Selected chapters** (with Select all / Deselect all).
- Heading style (`#`, `##`, bracket, plain, as written, none) and optional `***` between chapters.
- YAML / TOML / no frontmatter, with optional word and chapter counts and an author field. Story Memory and Author's Note are saved inside the frontmatter, so re-importing the file doesn't turn them into chapters.
- File name field (left blank, it uses the story title, or "Story - Chapter title" for a single chapter).
- **Remove exported chapters from the story** after saving (asks first; Ctrl+Z still works).

## Config (User Scripts → Config)
Default import and export header styles, which Markdown headings start chapters (auto / every heading), blank-line scene breaks, and the `[Chapters]` options (UCCDS names, shared with Chapter Linter and the Menagerie): header style, bracket detection, break token, only-my-break-token, where chapters start, stories without headers, and your own chapter / Part / unnumbered header words.

## Known caveats
- NovelAI's own bold/italic formatting isn't converted to Markdown on export yet (only `*`/`**` typed as text are kept).
- Word counts and the token estimate (~3.6 characters per token) are approximate.
- "Selected chapters" replaced the old exporter's separate "Single Chapter" mode. Tick one chapter for the same result.

## Development
Source lives in `src/`. UCCDS's `DUAL_PARTS` are pulled straight from `NAI_Dev/Community Stuff/nai-chapter-detection-uccds` at build time (`../shared/tools/uccds.js`). The tests also load UCCDS's built dependency script (`dist/UCCDS_v*.naiscript`; run `npm run build` in the UCCDS folder first). From the `Editorial` folder:

```
npm install                 # once, for TypeScript
npm run build:markdown      # builds + strict type-checks "Mid's Markdown Manager_v<version>.naiscript"
npm test                    # shared parser, Chapter Linter and Markdown Manager tests
```

Tests load the real built script with a mock `api.v1` and a fake story (`../shared/tools/harness.js`), including `fixtures/chapter 8.md`.

## Changelog
### v1.1.0
- **Chapter detection moved to UCCDS** (dual: built in, or the UCCDS script when it's enabled in the story; its rules win, for the story and for imported files). Default rules are the same as before.
- New `[Chapters]` options from UCCDS: **Only Use My Break Token**, **Where Chapters Start** (headers / headers and dividers / dividers only), **Story Without Headers** (one chapter / split on dividers), and your own **chapter**, **Part/Book** and **unnumbered** header words (`Episode`, `Saga`, `Afterword`...), which also work in imported files.
- The detection options are now called `[Chapters] ...` (same option names, so your settings carry over).
- A line under the tabs says where chapters come from; the lists refresh by themselves when the UCCDS script turns up or reports changed chapters.
- Opening text is always kept as a chapter, so it can't fall out of an export.

### v1.0.2
- Books/Parts: `Chapter: 1` is read as chapter 1, and matching only pairs chapters from the same Book/Part (so an imported Book 2 Chapter 1 never replaces Book 1's).

### v1.0.1
- Shared header parser update: Interlude / Prelude, Section / Arc part headers, `Act II: Prologue`, `Part 1, Chapter 3`, and bracketed asides like `[He looked away.]` are no longer chapters.

### v1.0.0
First merged release. Compared with the old importer (v1.1.0) and exporter (v1.0.0):
- Fixed: chunked insert/remove crashed on the worker's missing global `setTimeout`.
- Fixed: the importer's config options never loaded (header used `id:` instead of `name:`/`prettyName:`).
- Fixed: collapsible sections snapped shut on every click; their open state is now stored.
- Fixed: `[ Chapter 8 ]` imported as `[ Chapter: 8 ]`; titles like `Chapter 3: The Fall` became `3: The Fall`.
- Fixed: a `***` before a chapter header was doubled on import.
- Fixed: "strip formatting" turned `***` scene breaks into `*` and stripped underscores inside words.
- Fixed: a story with no chapter headers was auto-matched as "Chapter 1", so importing a chapter could silently target the whole story.
- Fixed: changing any formatting option reset your manual chapter targets; two imported chapters could target the same story chapter.
- Fixed: exporter read Roman numerals wrong (IV = 6), ignored the single-chapter file name, and with "Selected" + nothing ticked exported (and stripped) everything.
- Fixed: YAML descriptions containing line breaks broke the frontmatter.
- New: one panel with Import / Export tabs, a "Change" picker per chapter instead of a grid of buttons, confirmation dialogs for anything destructive, Select all / Deselect all, settings remembered between sessions, no emoji, and theme colours only.
