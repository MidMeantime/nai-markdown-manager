// Builds "Mid's Markdown Manager_v<version>.naiscript" into the markdown-manager folder.
// Usage (from the Editorial folder): node markdown-manager/scripts/build.js [outputPath]
const path = require('path');
const { buildProject } = require('../../shared/tools/bundle.js');
const { typecheck } = require('../../shared/tools/typecheck.js');
const { uccdsDualParts } = require('../../shared/tools/uccds.js');

const MARKDOWN_PROJECT = {
    name: "Mid's Markdown Manager",
    dir: 'markdown-manager',
    // Order matters: the /*--- header must come first; helpers before the code that uses them
    parts: [
        'markdown-manager/src/header.ts',
        // UCCDS (dual): header parser, chapter detector, client for the UCCDS script
        ...uccdsDualParts(),
        'markdown-manager/src/types.ts',
        'markdown-manager/src/core.ts',
        'markdown-manager/src/ui-kit.ts',
        'markdown-manager/src/state.ts',
        'markdown-manager/src/import.ts',
        'markdown-manager/src/export.ts',
        'markdown-manager/src/ui.ts',
        'markdown-manager/src/main.ts'
    ]
};

function buildMarkdownManager(outputPath) {
    const result = buildProject(MARKDOWN_PROJECT, outputPath);
    if (!typecheck(result.target)) process.exitCode = 1;
    return result;
}

if (require.main === module) {
    buildMarkdownManager(process.argv[2] ? path.resolve(process.argv[2]) : undefined);
}

module.exports = { buildMarkdownManager, MARKDOWN_PROJECT };
