/*---
compatibilityVersion: naiscript-1.0
id: cbca03f7-235d-4edc-b9e3-cebac44d21d8
name: Mid's Markdown Manager
createdAt: 1792807366033
updatedAt: 1792807366033
version: 1.1.0
author: MidMeantime
description: Import Markdown/text files into your story or Memory (append, replace matching chapters, or replace the whole story) and export your story or selected chapters to Markdown. Chapter detection by UCCDS (built in, or the UCCDS script's rules when it's enabled in the story). Replaces Mid's Markdown Menagerie importer + exporter.
memoryLimit: 8
permissions:
  - documentEdit
  - storyEdit
  - fileInput
  - fileDownload
config:
  - name: default_import_header
    prettyName: "[Import] Default Chapter Header Style"
    type: select
    options:
      - label: "[ Chapter 1: Title ]"
        value: "bracket"
      - label: "[ Title ]"
        value: "bracket_title"
      - label: "Chapter 1: Title (plain)"
        value: "clean"
      - label: "# Chapter 1: Title"
        value: "markdown_h1"
      - label: "As written in the file"
        value: "raw"
      - label: "No header"
        value: "none"
    description: "How chapter headers are written into the story on import. You can still change it in the panel."
  - name: import_heading_split
    prettyName: "[Import] Which Markdown Headings Start Chapters"
    type: select
    options:
      - label: "Auto (top heading level; a lone # title is skipped)"
        value: "auto"
      - label: "Every heading (#, ##, ### ...)"
        value: "all"
    description: "Auto splits on the highest heading level used in the file. A single '# Title' at the top of a file with ## chapters is treated as the file title. Headings that name a chapter ('### Chapter 3') always split."
  - name: preserve_blank_lines
    prettyName: "[Import] Keep Blank-Line Scene Breaks"
    type: boolean
    default: false
    description: "Keep an empty paragraph where the file has 2+ blank lines in a row. When off, paragraphs use normal spacing."
  - name: default_export_header
    prettyName: "[Export] Default Chapter Heading Style"
    type: select
    options:
      - label: "# Heading 1"
        value: "markdown_h1"
      - label: "## Heading 2"
        value: "markdown_h2"
      - label: "[ Chapter 1: Title ]"
        value: "bracket"
      - label: "Chapter 1: Title (plain)"
        value: "clean"
      - label: "As written in the story"
        value: "raw"
    description: "How chapter headers are written into exported Markdown. You can still change it in the panel."
  - name: chapter_detection_mode
    prettyName: "[Chapters] Header Style"
    type: select
    options:
      - label: "Auto (Headings, Brackets & Keywords)"
        value: "auto"
      - label: "Markdown Headings Only"
        value: "markdown_headings"
    description: "Which lines count as chapter headers, in the story and in imported files: 'auto' (Markdown #, [bracketed] titles and standalone 'Chapter X' / 'Prologue' / 'Part Two' lines) or Markdown # headings only. If the UCCDS script is enabled in this story, its rules are used instead of these [Chapters] options."
  - name: detect_bracketed_titles
    prettyName: "[Chapters] Detect Bracketed Titles"
    type: boolean
    default: true
    description: "Detect bracketed headers like [ Chapter 1: The Beginning ] or [ Title ]. Bracketed metadata such as [ Author: X; Tags: Y ] is always ignored."
  - name: chapter_break_token
    prettyName: "[Chapters] Break Token"
    type: string
    default: "***"
    description: "Scene break written above chapter headers on import and export (and recognised besides *** / --- / ___)."
  - name: chapter_only_break_token
    prettyName: "[Chapters] Only Use My Break Token"
    type: boolean
    default: false
    description: "Only the break token above counts as a divider, so a lone --- or ___ stays normal text."
  - name: chapter_boundary_mode
    prettyName: "[Chapters] Where Chapters Start"
    type: select
    options:
      - label: "At chapter headers (dividers are scene breaks)"
        value: "headers"
      - label: "At headers and at any divider without a header"
        value: "headers_and_dividers"
      - label: "Only at dividers (a header under one names the chapter)"
        value: "dividers"
    description: "What starts a new chapter in the story (for exporting selected chapters and for replacing chapters on import). The default keeps *** scene breaks inside chapters. Chapters without a header are exported without a heading and are never matched on import."
  - name: chapter_no_header_fallback
    prettyName: "[Chapters] Story Without Headers"
    type: select
    options:
      - label: "Treat the whole story as one chapter"
        value: "single"
      - label: "Split it on dividers"
        value: "dividers"
    description: "What to do when the story has no chapter headers at all."
  - name: chapter_custom_chapter_words
    prettyName: "[Chapters] My Chapter Words"
    type: string
    default: ""
    description: "Your own words that start a numbered chapter like 'Chapter' does, separated by commas. Example: Section, Episode, Scene. Works in the story and in imported files. A word here stops counting as a Part word (Section is one by default)."
  - name: chapter_custom_part_words
    prettyName: "[Chapters] My Part / Book Words"
    type: string
    default: ""
    description: "Your own words for headers that group chapters like 'Part' or 'Book', separated by commas. Example: Saga, Season, Cycle."
  - name: chapter_custom_unnumbered_words
    prettyName: "[Chapters] My Unnumbered Section Words"
    type: string
    default: ""
    description: "Your own words for unnumbered sections like 'Prologue', separated by commas. Example: Intro, Foreword, Afterword."
---*/
/**
 * Mid's Markdown Manager for NovelAI
 *
 * One sidebar panel with two tabs:
 * - Import: load a .md/.txt file, then append it, replace the matching chapters in place,
 *   replace the whole story, or add it to Memory.
 * - Export: save the whole story or selected chapters as Markdown, with optional frontmatter,
 *   Memory / Author's Note, and an option to remove exported chapters from the story.
 *
 * Chapter detection: UCCDS (dual) from Community Stuff/nai-chapter-detection-uccds: built in, or the
 * UCCDS script's rules when it's enabled in the story. Imported files are read with the same rules.
 * Built from: UCCDS DUAL_PARTS + markdown-manager/src/* (see Editorial/package.json).
 */
