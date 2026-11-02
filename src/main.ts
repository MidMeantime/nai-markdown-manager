// --- Markdown Manager: Startup & Hooks ---

async function mdmInit(): Promise<void> {
    try {
        await mdmLoadConfigAndSettings();
        await mdmStartChapterDetection();
        try {
            mdmState.storyTitle = ((await api.v1.story.title.get()) || "").trim();
        } catch {
            mdmState.storyTitle = "";
        }
        await mdmScanEditor();
        await mdmRender();
    } catch (err: any) {
        api.v1.error("Markdown Manager: initialization failed", err);
    }
}

mdmInit().catch((err: any) => api.v1.error("Markdown Manager: init error", err));

// Keep the export list current after generations and undo/redo
api.v1.hooks.register('onGenerationEnd', async () => {
    if (mdmState.busy || mdmState.settings.tab !== 'export') return;
    await mdmScanEditor();
    await mdmRender();
});

api.v1.hooks.register('onHistoryNavigated', async () => {
    if (mdmState.busy) return;
    await mdmScanEditor();
    await mdmRender();
});
