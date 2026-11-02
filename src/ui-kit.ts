// --- Markdown Manager UI Kit: tokens, presets, component factories, dialogs ---

const MDM_NS = 'mdm';
const mdmId = (name: string): string => `${MDM_NS}.${name}`;

const MDM_SPACE = { xs: '2px', sm: '4px', md: '8px', lg: '12px' } as const;
const MDM_RADIUS = { sm: '4px', md: '6px' } as const;

/** Semantic names for NovelAI theme tokens (no hardcoded hex colours) */
const MDM_COLOR = {
    canvas: 'bg0',
    surface: 'bg1',
    raised: 'bg2',
    selected: 'bg3',
    heading: 'textHeadings',
    body: 'textMain',
    muted: 'textDisabled',
    danger: 'warning'
} as const;

type MdmStyle = Record<string, string>;

const MDM_S: Record<string, MdmStyle> = {
    card: {
        backgroundColor: MDM_COLOR.surface,
        borderStyle: 'solid', borderWidth: '1px', borderColor: MDM_COLOR.raised,
        borderRadius: MDM_RADIUS.md,
        padding: MDM_SPACE.md,
        margin: `${MDM_SPACE.sm} 0`
    },
    heading: { color: MDM_COLOR.heading, fontWeight: 'bold', margin: `0 0 ${MDM_SPACE.sm} 0` },
    body: { color: MDM_COLOR.body, fontSize: '12px' },
    muted: { color: MDM_COLOR.muted, fontSize: '11px' },
    mono: { fontFamily: 'code', fontSize: '11px', whiteSpace: 'pre-wrap', color: MDM_COLOR.body }
};
MDM_S.cardDanger = { ...MDM_S.card, borderColor: MDM_COLOR.danger };

const mdmSx = (...styles: (MdmStyle | undefined | false)[]): MdmStyle =>
    Object.assign({}, ...styles.filter(Boolean));

type MdmButtonVariant = 'default' | 'primary' | 'danger' | 'subtle';
interface MdmButtonOpts { id?: string; icon?: IconId; variant?: MdmButtonVariant; disabled?: boolean; style?: MdmStyle }

const MDM_BUTTON_VARIANTS: Record<MdmButtonVariant, MdmStyle> = {
    default: { backgroundColor: MDM_COLOR.raised, color: MDM_COLOR.heading },
    primary: { backgroundColor: MDM_COLOR.selected, color: MDM_COLOR.heading, fontWeight: 'bold' },
    danger: { backgroundColor: MDM_COLOR.raised, color: MDM_COLOR.danger, border: `1px solid ${MDM_COLOR.danger}`, fontWeight: 'bold' },
    subtle: { backgroundColor: 'transparent', color: MDM_COLOR.body }
};

function mdmButton(text: string, onClick: () => void | Promise<void>, opts: MdmButtonOpts = {}): UIPart {
    return {
        type: 'button',
        id: opts.id,
        text,
        iconId: opts.icon,
        disabled: !!opts.disabled,
        disabledWhileCallbackRunning: true,
        callback: onClick,
        style: mdmSx({ margin: MDM_SPACE.xs, padding: `${MDM_SPACE.sm} ${MDM_SPACE.md}`, borderRadius: MDM_RADIUS.sm, fontSize: '12px' },
            MDM_BUTTON_VARIANTS[opts.variant || 'default'], opts.style)
    };
}

function mdmText(value: string, opts: { id?: string; muted?: boolean; markdown?: boolean; style?: MdmStyle } = {}): UIPart {
    return {
        type: 'text',
        id: opts.id,
        text: value,
        markdown: opts.markdown !== false,
        noTemplate: true,
        style: mdmSx(opts.muted ? MDM_S.muted : MDM_S.body, opts.style)
    };
}

function mdmCard(title: string | null, children: UIPart[], opts: { danger?: boolean } = {}): UIPart {
    const content: UIPart[] = title ? [mdmText(title, { style: MDM_S.heading }), ...children] : children;
    return { type: 'container', style: opts.danger ? MDM_S.cardDanger : MDM_S.card, content };
}

function mdmRow(children: UIPart[], opts: { spacing?: UIPartRow['spacing']; wrap?: boolean } = {}): UIPart {
    return { type: 'row', alignment: 'center', spacing: opts.spacing || 'start', wrap: opts.wrap !== false, content: children };
}

/**
 * Collapsible section whose open/closed state is stored, so re-rendering the panel after a click
 * no longer snaps it shut (the "dropdown closes on its own" bug).
 */
function mdmSection(title: string, key: string, children: UIPart[], opts: { collapsed?: boolean; icon?: IconId } = {}): UIPart {
    return {
        type: 'collapsibleSection',
        title,
        iconId: opts.icon,
        initialCollapsed: !!opts.collapsed,
        storageKey: mdmId(`ui.collapsed.${key}`),
        content: children,
        style: { margin: `${MDM_SPACE.sm} 0` }
    };
}

/** A row of buttons where exactly one is active */
function mdmSegmented<T extends string>(options: { label: string; value: T }[], current: T, onPick: (value: T) => Promise<void>, disabled: boolean = false): UIPart {
    return mdmRow(options.map((o: { label: string; value: T }) => mdmButton(o.label, async () => {
        if (o.value !== current) await onPick(o.value);
    }, {
        variant: o.value === current ? 'primary' : 'default',
        disabled,
        style: { flex: '1 1 auto', fontSize: '11px' }
    })));
}

/** On/off option shown as a checkbox-style button (a button click can safely re-render) */
function mdmToggle(label: string, value: boolean, onToggle: (next: boolean) => Promise<void>, disabled: boolean = false): UIPart {
    return mdmButton(label, async () => { await onToggle(!value); }, {
        icon: value ? 'check-square' : 'square',
        variant: value ? 'primary' : 'subtle',
        disabled,
        style: { width: '100%', textAlign: 'left', fontWeight: 'normal', fontSize: '12px' }
    });
}

/** Yes/no dialog. Resolves before closing so the closed-handler fallback never wins. */
async function mdmConfirm(title: string, message: string, confirmText: string, danger: boolean = false): Promise<boolean> {
    const picked = await mdmChoose<boolean>(title, message, [
        { label: 'Cancel', value: false, variant: 'subtle' },
        { label: confirmText, value: true, variant: danger ? 'danger' : 'primary' }
    ]);
    return picked === true;
}

/** Shows a list of choices; resolves with the chosen value, or null if the dialog is closed */
async function mdmChoose<T>(
    title: string,
    message: string,
    options: { label: string; value: T; variant?: MdmButtonVariant; icon?: IconId }[],
    vertical: boolean = false
): Promise<T | null> {
    return new Promise<T | null>(async (resolve: (value: T | null) => void) => {
        let done = false;
        const finish = (value: T | null): void => {
            if (!done) {
                done = true;
                resolve(value);
            }
        };
        const buttons: UIPart[] = options.map((o: { label: string; value: T; variant?: MdmButtonVariant; icon?: IconId }) =>
            mdmButton(o.label, async () => { finish(o.value); await modal.close(); }, {
                variant: o.variant,
                icon: o.icon,
                style: vertical ? { width: '100%', textAlign: 'left' } : {}
            }));
        const modal = await api.v1.ui.modal.open({
            title,
            size: 'small',
            content: [
                mdmText(message),
                vertical ? { type: 'column', alignment: 'start', content: buttons } : mdmRow(buttons, { spacing: 'end' })
            ]
        });
        modal.closed.then(() => finish(null));
    });
}

async function mdmNotify(message: string, type: 'info' | 'success' | 'warning' | 'error' = 'info'): Promise<void> {
    await api.v1.ui.toast(message, { id: mdmId('toast'), type });
}
