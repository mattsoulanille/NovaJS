/**
 * The title screen's modal dialogs, rendered as HTML overlays.
 *
 * The original's New Pilot / Open Pilot / Preferences panels are native
 * OS dialogs; HTML overlays are both the faithful analogue and the
 * accessible, headlessly-driveable choice in a browser. Each dialog
 * resolves a Promise with the player's choice and cleans itself up.
 *
 * All of this is client-only UI: nothing here touches sim state.
 */

import {
    bindControl, ControlsOverride, DisplaySettings, GameSettingsOverride,
    PilotProfile, primaryBinding,
} from './client_prefs.js';
import {
    formatScale, MAX_SCALE, MIN_SCALE, SCALE_STEP,
} from '../display/display_scale.js';
import { keyLabel } from './key_labels.js';
import { makeDescTextContext, playerGender, resolveConditionalBlocks }
    from '../nova_plugin/ncb/desc_text.js';
import {
    loadPilotControls, loadPilotSettings, savePilotControls,
    savePilotSettings,
} from './pilot_registry.js';

// ---------------------------------------------------------------------------
// Shared modal scaffolding.
// ---------------------------------------------------------------------------

interface Modal {
    backdrop: HTMLDivElement;
    panel: HTMLDivElement;
    close: () => void;
}

function makeModal(testid: string): Modal {
    const backdrop = document.createElement('div');
    backdrop.className = 'nova-title-modal-backdrop';
    backdrop.dataset.testid = `${testid}-backdrop`;
    Object.assign(backdrop.style, {
        position: 'fixed', inset: '0', display: 'flex',
        alignItems: 'center', justifyContent: 'center',
        background: 'rgba(0,0,0,0.35)', zIndex: '10000',
        fontFamily: '-apple-system, Geneva, "Helvetica Neue", sans-serif',
    } as Partial<CSSStyleDeclaration>);

    const panel = document.createElement('div');
    panel.className = 'nova-title-modal';
    panel.dataset.testid = testid;
    Object.assign(panel.style, {
        background: '#ececec', color: '#111', borderRadius: '8px',
        boxShadow: '0 12px 48px rgba(0,0,0,0.6)', padding: '18px 20px',
        minWidth: '360px', maxWidth: '640px', fontSize: '13px',
    } as Partial<CSSStyleDeclaration>);
    backdrop.appendChild(panel);
    document.body.appendChild(backdrop);

    const close = () => {
        if (backdrop.parentNode) {
            backdrop.parentNode.removeChild(backdrop);
        }
    };
    return { backdrop, panel, close };
}

function button(label: string, testid: string, primary: boolean):
    HTMLButtonElement {
    const btn = document.createElement('button');
    btn.textContent = label;
    btn.dataset.testid = testid;
    Object.assign(btn.style, {
        padding: '5px 16px', borderRadius: '6px', fontSize: '13px',
        cursor: 'pointer', marginLeft: '8px',
        border: primary ? 'none' : '1px solid #b0b0b0',
        background: primary ? '#2b6cff' : '#fbfbfb',
        color: primary ? '#fff' : '#111',
    } as Partial<CSSStyleDeclaration>);
    return btn;
}

function buttonRow(...buttons: HTMLButtonElement[]): HTMLDivElement {
    const row = document.createElement('div');
    Object.assign(row.style, {
        display: 'flex', justifyContent: 'flex-end', marginTop: '18px',
    } as Partial<CSSStyleDeclaration>);
    for (const b of buttons) {
        row.appendChild(b);
    }
    return row;
}

// ---------------------------------------------------------------------------
// About.
// ---------------------------------------------------------------------------

/**
 * Fallback credits, used only when the game data has no About text (a
 * plug-in-only or partial data set). The real text comes from the stock
 * dësc resources — see ABOUT_DESC_IDS in browser.ts.
 */
export const ABOUT_TEXT = [
    'Escape Velocity: Nova',
    '(c) 1996-2008 Ambrosia Software, Inc.',
    '',
    'Engine Programming:',
    '  Matt Burch',
    '',
    'Concepts, Plot, Dialogue, Scenario implementation, Graphics,',
    'Sound production & supervision:',
    '  ATMOS Software Productions',
    '',
    'NovaJS — a browser remake built on the original game resources.',
];

/**
 * The original's About box prints "Registered to: <REG>", substituting
 * the registration name at runtime. There is no registration in a
 * browser build, so the placeholder gets a truthful stand-in rather
 * than being shown raw.
 */
export function fillAboutPlaceholders(text: string): string {
    // Resolve any dësc conditionals first (stock 32766/32767 carry none,
    // but plugin credits dëscs may; gender comes from the pilot profile).
    const conditional = resolveConditionalBlocks(text,
        makeDescTextContext(new Set(), playerGender()));
    return conditional.replace(/<REG>/g, 'NovaJS (unregistered)');
}

// There is deliberately NO showAboutDialog here any more. The About box is
// not native chrome in the original — title_screen/about.png shows the game's
// own desc+pict frame (PICT 8527) with the credits in its text well, the
// dësc's Graphic beside them and a red Okay under it — so browser.ts renders
// it with OfferPopup, the same widget the mission-text popups use. Only the
// pilot and Preferences dialogs (native OS windows in the original) keep
// their HTML stand-ins. ABOUT_TEXT and fillAboutPlaceholders above are still
// the text source and placeholder pass for that popup.

// ---------------------------------------------------------------------------
// New Pilot.
// ---------------------------------------------------------------------------

function field(labelText: string): { row: HTMLDivElement, label: HTMLDivElement } {
    const row = document.createElement('div');
    Object.assign(row.style, {
        display: 'flex', alignItems: 'center', margin: '8px 0',
    } as Partial<CSSStyleDeclaration>);
    const label = document.createElement('div');
    label.textContent = labelText;
    Object.assign(label.style, {
        width: '110px', textAlign: 'right', marginRight: '12px',
        color: '#333',
    } as Partial<CSSStyleDeclaration>);
    row.appendChild(label);
    return { row, label };
}

/** "Create a new pilot" — name, nickname, gender, strict play. Resolves
 * the entered profile, or null on Cancel. */
export function showNewPilotDialog(): Promise<PilotProfile | null> {
    return new Promise((resolve) => {
        const modal = makeModal('new-pilot-dialog');
        const title = document.createElement('div');
        title.textContent = 'Create a new pilot:';
        Object.assign(title.style, {
            fontWeight: '600', marginBottom: '12px',
        } as Partial<CSSStyleDeclaration>);
        modal.panel.appendChild(title);

        const nameField = field('Full Name:');
        const nameInput = document.createElement('input');
        nameInput.type = 'text';
        nameInput.value = 'Shane Merrol';
        nameInput.dataset.testid = 'new-pilot-name';
        nameInput.style.flex = '1';
        nameField.row.appendChild(nameInput);
        modal.panel.appendChild(nameField.row);

        const nickField = field('Nickname:');
        const nickInput = document.createElement('input');
        nickInput.type = 'text';
        nickInput.value = 'Hawkeye';
        nickInput.dataset.testid = 'new-pilot-nickname';
        nickInput.style.flex = '1';
        nickField.row.appendChild(nickInput);
        modal.panel.appendChild(nickField.row);

        const genderField = field('Gender:');
        const genderSelect = document.createElement('select');
        genderSelect.dataset.testid = 'new-pilot-gender';
        for (const [value, label] of [['male', 'Male'], ['female', 'Female']]) {
            const opt = document.createElement('option');
            opt.value = value; opt.textContent = label;
            genderSelect.appendChild(opt);
        }
        genderField.row.appendChild(genderSelect);
        modal.panel.appendChild(genderField.row);

        const strictRow = document.createElement('div');
        Object.assign(strictRow.style, {
            display: 'flex', alignItems: 'flex-start', margin: '10px 0 0 122px',
        } as Partial<CSSStyleDeclaration>);
        const strict = document.createElement('input');
        strict.type = 'checkbox';
        strict.dataset.testid = 'new-pilot-strict';
        strict.id = 'nova-strict-play';
        const strictLabel = document.createElement('label');
        strictLabel.htmlFor = 'nova-strict-play';
        strictLabel.style.marginLeft = '6px';
        strictLabel.innerHTML = 'Strict Play<br>' +
            '<span style="font-size:11px;color:#666">If you check this box, ' +
            'when you\'re dead, you\'re dead. No reincarnation allowed.</span>';
        strictRow.appendChild(strict);
        strictRow.appendChild(strictLabel);
        modal.panel.appendChild(strictRow);

        const cancel = button('Cancel', 'new-pilot-cancel', false);
        const ok = button('OK', 'new-pilot-ok', true);
        modal.panel.appendChild(buttonRow(cancel, ok));

        const cleanup = () => {
            document.removeEventListener('keydown', onKey);
            modal.close();
        };
        const submit = () => {
            const name = nameInput.value.trim() || 'Unnamed Pilot';
            cleanup();
            resolve({
                name,
                nickname: nickInput.value.trim(),
                gender: genderSelect.value,
                strict: strict.checked,
            });
        };
        const abort = () => { cleanup(); resolve(null); };
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Enter') { e.preventDefault(); submit(); }
            else if (e.key === 'Escape') { e.preventDefault(); abort(); }
        };
        ok.addEventListener('click', submit);
        cancel.addEventListener('click', abort);
        document.addEventListener('keydown', onKey);
        nameInput.focus();
        nameInput.select();
    });
}

// ---------------------------------------------------------------------------
// Open Pilot.
// ---------------------------------------------------------------------------

/** A selectable saved pilot for the Open Pilot dialog. */
export interface PilotEntry {
    /** Storage key / id to load. */
    id: string;
    /** Display name (pilot name, or a fallback). */
    name: string;
    /** Secondary line (ship / date), optional. */
    detail?: string;
}

/**
 * Pilot-file management hooks. The dialog owns no storage: the caller
 * (browser.ts) wires these to the pilot registry.
 */
export interface PilotDialogActions {
    /** Re-reads the pilot list after a mutating action. */
    refresh(): PilotEntry[];
    /** Downloads the pilot as a file. */
    onExport(id: string): void;
    /**
     * Validates and adds a pilot file from its bytes — a NovaJS JSON pilot
     * file or an ORIGINAL EV Nova pilot (Windows .plt, or extracted Mac
     * resource-fork data; the caller sniffs which). Resolves a message
     * to display.
     */
    onImport(bytes: Uint8Array, fileName: string):
        Promise<{ ok: boolean, message: string }>;
    /** Deletes a pilot and its save. */
    onDelete(id: string): void;
    /**
     * Opens the pilot's checkpoint history (the rollback view, drawn on
     * the game canvas under this dialog). The dialog hides itself and
     * stands down from the keyboard until the promise settles, then
     * refreshes with the returned status message. Optional: without it
     * the History button is not shown.
     */
    onRollback?(id: string): Promise<string>;
}

/**
 * "Open pilot" — the browser stand-in for the original's OS file dialog.
 *
 * The original opens a `Pilots` folder through the native Open panel, so
 * there is no in-game list art to copy; this is a plain list in the
 * existing title-dialog style, plus the file operations a browser needs
 * to make pilot files portable at all (import/export).
 *
 * Resolves the chosen entry id, or null on Cancel.
 */
export function showOpenPilotDialog(entries: PilotEntry[],
    actions?: PilotDialogActions): Promise<string | null> {
    return new Promise((resolve) => {
        const modal = makeModal('open-pilot-dialog');
        modal.panel.style.minWidth = '420px';
        const title = document.createElement('div');
        title.textContent = 'Open pilot:';
        Object.assign(title.style, {
            fontWeight: '600', marginBottom: '12px',
        } as Partial<CSSStyleDeclaration>);
        modal.panel.appendChild(title);

        const list = document.createElement('div');
        list.dataset.testid = 'open-pilot-list';
        Object.assign(list.style, {
            border: '1px solid #c4c4c4', borderRadius: '6px',
            background: '#fff', minHeight: '160px', maxHeight: '260px',
            overflowY: 'auto', padding: '4px',
        } as Partial<CSSStyleDeclaration>);
        modal.panel.appendChild(list);

        const status = document.createElement('div');
        status.dataset.testid = 'open-pilot-status';
        Object.assign(status.style, {
            minHeight: '16px', margin: '8px 2px 0', fontSize: '11px',
            color: '#444',
        } as Partial<CSSStyleDeclaration>);
        modal.panel.appendChild(status);

        let current: PilotEntry[] = entries;
        let selectedId: string | undefined;
        const rows = new Map<string, HTMLDivElement>();

        const open = button('Open', 'open-pilot-open', true);
        const cancel = button('Cancel', 'open-pilot-cancel', false);
        const exportBtn = button('Export', 'open-pilot-export', false);
        const importBtn = button('Import…', 'open-pilot-import', false);
        const deleteBtn = button('Delete', 'open-pilot-delete', false);
        const historyBtn = button('History…', 'open-pilot-history', false);
        // While the rollback view owns the screen, this dialog is hidden
        // and its Enter/Escape handling stands down.
        let suspended = false;

        const setEnabled = (btn: HTMLButtonElement, on: boolean) => {
            btn.disabled = !on;
            btn.style.opacity = on ? '1' : '0.5';
        };

        const select = (id: string | undefined) => {
            selectedId = id;
            for (const [rid, row] of rows) {
                row.style.background = rid === id ? '#2b6cff' : 'transparent';
                row.style.color = rid === id ? '#fff' : '#111';
            }
            for (const btn of [open, exportBtn, deleteBtn, historyBtn]) {
                setEnabled(btn, id !== undefined);
            }
        };

        const renderList = () => {
            list.innerHTML = '';
            rows.clear();
            if (current.length === 0) {
                const empty = document.createElement('div');
                empty.textContent = '(no saved pilots)';
                Object.assign(empty.style, {
                    color: '#888', padding: '12px', textAlign: 'center',
                } as Partial<CSSStyleDeclaration>);
                list.appendChild(empty);
                select(undefined);
                return;
            }
            for (const entry of current) {
                const row = document.createElement('div');
                row.dataset.testid = `open-pilot-entry-${entry.id}`;
                Object.assign(row.style, {
                    padding: '6px 10px', borderRadius: '4px', cursor: 'pointer',
                } as Partial<CSSStyleDeclaration>);
                const name = document.createElement('div');
                name.textContent = entry.name;
                name.style.fontWeight = '600';
                row.appendChild(name);
                if (entry.detail) {
                    const detail = document.createElement('div');
                    detail.textContent = entry.detail;
                    detail.style.fontSize = '11px';
                    detail.style.opacity = '0.8';
                    row.appendChild(detail);
                }
                row.addEventListener('click', () => select(entry.id));
                row.addEventListener('dblclick',
                    () => { select(entry.id); confirm(); });
                rows.set(entry.id, row);
                list.appendChild(row);
            }
            // Keep the selection if it survived, else preselect the first.
            select(current.some(e => e.id === selectedId)
                ? selectedId : current[0].id);
        };

        const refresh = (message: string) => {
            status.textContent = message;
            if (actions) {
                current = actions.refresh();
            }
            renderList();
        };

        // A hidden file input is the only way a browser can read a local
        // file; it is appended so a headless driver can set files on it.
        // The picker accepts NovaJS exports (.plt/.json) AND original EV
        // Nova pilots: Windows .plt files, and Mac pilots whose resource
        // fork was copied out (.rsrc/.rez, or any extension — a browser
        // only ever sees a file's data fork; see original_pilot_import.ts).
        // Read as BYTES; the importer sniffs JSON vs. binary.
        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = '.plt,.json,.rsrc,.rez,application/json';
        fileInput.dataset.testid = 'open-pilot-file';
        fileInput.style.display = 'none';
        modal.panel.appendChild(fileInput);
        fileInput.addEventListener('change', () => {
            const file = fileInput.files?.[0];
            if (!file || !actions) { return; }
            const reader = new FileReader();
            reader.onload = () => {
                const buffer = reader.result;
                const bytes = buffer instanceof ArrayBuffer
                    ? new Uint8Array(buffer) : new Uint8Array(0);
                status.textContent = 'Importing…';
                actions.onImport(bytes, file.name).then(
                    result => refresh(result.message),
                    e => {
                        console.warn('Pilot import failed:', e);
                        refresh('Could not import that file.');
                    });
            };
            reader.onerror = () => { status.textContent = 'Could not read that file.'; };
            reader.readAsArrayBuffer(file);
            fileInput.value = '';
        });

        if (actions) {
            exportBtn.addEventListener('click', () => {
                if (!selectedId) { return; }
                actions.onExport(selectedId);
                status.textContent = 'Exported.';
            });
            importBtn.addEventListener('click', () => fileInput.click());
            deleteBtn.addEventListener('click', () => {
                if (!selectedId) { return; }
                const entry = current.find(e => e.id === selectedId);
                const label = entry ? entry.name : 'this pilot';
                if (!window.confirm(
                    `Delete ${label}? This cannot be undone.`)) {
                    return;
                }
                actions.onDelete(selectedId);
                selectedId = undefined;
                refresh(`Deleted ${label}.`);
            });
            if (actions.onRollback) {
                const onRollback = actions.onRollback.bind(actions);
                historyBtn.addEventListener('click', () => {
                    if (!selectedId || suspended) { return; }
                    suspended = true;
                    modal.backdrop.style.display = 'none';
                    onRollback(selectedId).then(
                        message => refresh(message),
                        e => {
                            console.warn('Rollback view failed:', e);
                            refresh('Could not open the pilot history.');
                        },
                    ).finally(() => {
                        modal.backdrop.style.display = 'flex';
                        suspended = false;
                    });
                });
            }
        }

        // File operations only exist when the caller wired them up.
        const leftRow = document.createElement('div');
        Object.assign(leftRow.style, {
            display: 'flex', justifyContent: 'flex-start', marginTop: '12px',
        } as Partial<CSSStyleDeclaration>);
        if (actions) {
            const fileButtons = [importBtn, exportBtn, deleteBtn,
                ...(actions.onRollback ? [historyBtn] : [])];
            for (const b of fileButtons) {
                b.style.marginLeft = '0';
                b.style.marginRight = '8px';
                leftRow.appendChild(b);
            }
            modal.panel.appendChild(leftRow);
        }
        modal.panel.appendChild(buttonRow(cancel, open));

        const cleanup = () => {
            document.removeEventListener('keydown', onKey);
            modal.close();
        };
        const confirm = () => {
            if (!selectedId) { return; }
            cleanup();
            resolve(selectedId);
        };
        const abort = () => { cleanup(); resolve(null); };
        const onKey = (e: KeyboardEvent) => {
            if (suspended) { return; }
            if (e.key === 'Enter') { e.preventDefault(); confirm(); }
            else if (e.key === 'Escape') { e.preventDefault(); abort(); }
        };
        open.addEventListener('click', confirm);
        cancel.addEventListener('click', abort);
        document.addEventListener('keydown', onKey);
        renderList();
    });
}

// ---------------------------------------------------------------------------
// Preferences.
// ---------------------------------------------------------------------------

/** A game-settings checkbox: label, the override key, and whether it
 * applies to a browser build (disabled/greyed when not). */
interface SettingToggle {
    label: string;
    key?: keyof GameSettingsOverride;
    /** false => shown greyed out (no effect in a browser build). */
    applicable: boolean;
    /** Default checked state when unset. */
    defaultOn: boolean;
}

const GAME_SETTINGS: SettingToggle[][] = [
    // Left column.
    [
        // These toggles persist to localStorage but are not yet wired to any
        // graphics/sound effect, so they are shown greyed-out (applicable:
        // false) rather than promising behavior the game does not deliver.
        // Flip back to applicable: true as each effect gets wired up.
        { label: 'Ship Animations', key: 'shipAnimations', applicable: false, defaultOn: true },
        { label: 'Engine Glows', key: 'engineGlows', applicable: false, defaultOn: true },
        { label: 'Running Lights', key: 'runningLights', applicable: false, defaultOn: true },
        { label: 'Weapon Effects', key: 'weaponEffects', applicable: false, defaultOn: true },
        { label: 'Smoke Trails', key: 'smokeTrails', applicable: false, defaultOn: true },
        { label: 'Parallax Starfield', key: 'parallaxStarfield', applicable: false, defaultOn: true },
        { label: 'Check For Updates', applicable: false, defaultOn: false },
    ],
    // Right column.
    [
        { label: 'Intro Music', key: 'introMusic', applicable: false, defaultOn: true },
        { label: 'Run in a window', applicable: false, defaultOn: false },
        { label: 'QuickTime Movies', applicable: false, defaultOn: true },
        { label: 'Ambient Sounds', key: 'ambientSounds', applicable: false, defaultOn: true },
        { label: 'Hyperspace Effects', key: 'hyperspaceEffects', applicable: false, defaultOn: false },
    ],
];

/** A rebindable control: its display label and the controls.json action
 * it maps to (undefined => shown greyed; no browser equivalent). */
interface ControlRow {
    label: string;
    action?: string;
}

const CONTROL_TABS: { name: string, rows: ControlRow[] }[] = [
    {
        name: 'Navigation Controls', rows: [
            { label: 'Accelerate', action: 'accelerate' },
            { label: 'Reverse Course', action: 'reverse' },
            { label: 'Rotate Right', action: 'turnRight' },
            { label: 'Rotate Left', action: 'turnLeft' },
            { label: 'Afterburner', action: 'afterburner' },
            { label: 'Autopilot', action: 'pointTo' },
            { label: 'Hyperspace Mode', action: 'smallMap' },
            { label: 'Hyper Select', action: undefined },
            { label: 'Hyper Jump', action: 'hyperjump' },
            { label: 'Nav System Off', action: 'resetNav' },
            { label: 'Communicate', action: 'hail' },
            { label: 'Land/Dock', action: 'land' },
        ],
    },
    {
        name: 'Battle Controls', rows: [
            { label: 'Fire Primary', action: 'firePrimary' },
            { label: 'Fire Secondary', action: 'fireSecondary' },
            { label: 'Select Secondary', action: 'nextSecondary' },
            { label: 'Weapon Safety', action: undefined },
            { label: 'Target Select', action: 'nextTarget' },
            { label: 'Closest Target', action: 'nearestTarget' },
        ],
    },
    {
        name: 'Escort Controls', rows: [
            { label: 'Escort Menu', action: 'escorts' },
            { label: 'Attack Target', action: 'attack' },
            { label: 'Defend Me', action: 'defend' },
            { label: 'Hold Position', action: 'holdPosition' },
            { label: 'Recall', action: 'formation' },
        ],
    },
    {
        name: 'Misc Controls', rows: [
            { label: 'Pause', action: undefined },
            { label: 'Acknowledge', action: undefined },
            { label: 'Board', action: 'board' },
            { label: 'Jettison Cargo', action: undefined },
            { label: 'Eject', action: undefined },
            { label: 'Self-Destruct', action: 'selfDestruct' },
            { label: 'Engage Cloak', action: 'cloak' },
            { label: 'Galaxy Map', action: 'map' },
            { label: 'Player Info', action: 'properties' },
            { label: 'Mission Info', action: 'missions' },
            { label: 'Show Framerate', action: undefined },
        ],
    },
];

/**
 * The display-scaling hotkeys. Not one of the original's control groups
 * (the original had no scaling), so they live on the Display tab beside
 * the sliders they move rather than in a tab of their own.
 */
const DISPLAY_CONTROL_ROWS: { name: string, rows: ControlRow[] } = {
    name: 'Display Controls', rows: [
        { label: 'UI Scale Up', action: 'uiScaleUp' },
        { label: 'UI Scale Down', action: 'uiScaleDown' },
        { label: 'Global Scale Up', action: 'globalScaleUp' },
        { label: 'Global Scale Down', action: 'globalScaleDown' },
        { label: 'Reset Scale', action: 'resetScale' },
    ],
};

/** Every action the editor lets the player rebind. Binding one of these
 * to an occupied key takes that key away from the others (bindControl). */
const REBINDABLE_ACTIONS: string[] = [...CONTROL_TABS, DISPLAY_CONTROL_ROWS]
    .flatMap(tab => tab.rows)
    .map(row => row.action)
    .filter((a): a is string => typeof a === 'string');

/**
 * How the preferences dialog reaches the live display scales. The client
 * owns them (browser.ts applies them to the renderer the moment they
 * change), so the dialog only reads and writes through this handle --
 * which is also what lets the sliders preview LIVE and Cancel put the
 * old values back.
 */
export interface DisplayScaleHandle {
    get(): DisplaySettings;
    set(next: Partial<DisplaySettings>): DisplaySettings;
}

/**
 * The "Set Prefs" panel: Game Settings, Display, plus the four
 * control-binding tabs. On OK it persists the game-settings toggles and
 * any changed bindings to localStorage (see client_prefs); the game start
 * layers them over the served defaults. Resolves when the dialog closes.
 *
 * The display scales are the odd one out: they are MACHINE-local rather
 * than per-pilot, they apply live rather than on OK, and they persist
 * themselves through the handle (see DisplayScaleHandle).
 */
export function showPreferencesDialog(baseControls: Record<string, unknown>,
    displayScale?: DisplayScaleHandle):
    Promise<void> {
    return new Promise((resolve) => {
        const modal = makeModal('preferences-dialog');
        modal.panel.style.minWidth = '560px';

        const title = document.createElement('div');
        title.textContent = 'Preferences';
        Object.assign(title.style, {
            fontWeight: '600', textAlign: 'center', marginBottom: '12px',
        } as Partial<CSSStyleDeclaration>);
        modal.panel.appendChild(title);

        // Working copies of the ACTIVE PILOT's prefs; committed only on OK.
        const settings: GameSettingsOverride = { ...loadPilotSettings() };
        const controlsOverride: ControlsOverride = { ...loadPilotControls() };

        const tabBar = document.createElement('div');
        Object.assign(tabBar.style, {
            display: 'flex', gap: '2px', marginBottom: '10px',
            borderBottom: '1px solid #c4c4c4',
        } as Partial<CSSStyleDeclaration>);
        modal.panel.appendChild(tabBar);

        const content = document.createElement('div');
        Object.assign(content.style, {
            minHeight: '210px',
        } as Partial<CSSStyleDeclaration>);
        modal.panel.appendChild(content);

        // The scales the dialog opened with, so Cancel can undo a live
        // preview. Untouched (and unrestored) when there is no handle.
        const scalesOnOpen = displayScale?.get();

        const tabNames = ['Game Settings', 'Display',
            ...CONTROL_TABS.map(t => t.name)];
        const tabButtons: HTMLButtonElement[] = [];
        let activeCapture: (() => void) | undefined;

        const showTab = (index: number) => {
            activeCapture?.();
            activeCapture = undefined;
            tabButtons.forEach((b, i) => {
                b.style.background = i === index ? '#2b6cff' : '#e4e4e4';
                b.style.color = i === index ? '#fff' : '#111';
            });
            content.innerHTML = '';
            if (index === 0) {
                content.appendChild(buildGameSettings(settings));
            } else if (index === 1) {
                content.appendChild(buildDisplayTab(displayScale,
                    baseControls, controlsOverride,
                    (release) => { activeCapture = release; }));
            } else {
                content.appendChild(buildControlTab(
                    CONTROL_TABS[index - 2], baseControls, controlsOverride,
                    (release) => { activeCapture = release; }));
            }
        };

        tabNames.forEach((name, index) => {
            const tab = document.createElement('button');
            tab.textContent = name;
            tab.dataset.testid = `prefs-tab-${index}`;
            Object.assign(tab.style, {
                padding: '5px 10px', fontSize: '12px', cursor: 'pointer',
                border: 'none', borderRadius: '5px 5px 0 0',
                background: '#e4e4e4',
            } as Partial<CSSStyleDeclaration>);
            tab.addEventListener('click', () => showTab(index));
            tabBar.appendChild(tab);
            tabButtons.push(tab);
        });

        const cancel = button('Cancel', 'prefs-cancel', false);
        const ok = button('OK', 'prefs-ok', true);
        modal.panel.appendChild(buttonRow(cancel, ok));

        const cleanup = () => {
            activeCapture?.();
            document.removeEventListener('keydown', onKey);
            modal.close();
        };
        const commit = () => {
            savePilotSettings(settings);
            savePilotControls(controlsOverride);
            cleanup();
            // The caller re-reads the live bindings from here (browser.ts
            // applyControls), so an edit takes effect without a reload.
            resolve();
        };
        const abort = () => {
            // Undo any live scale preview: the scales apply as the slider
            // moves, so Cancel has to put the opening values back.
            if (scalesOnOpen) {
                displayScale?.set(scalesOnOpen);
            }
            cleanup();
            resolve();
        };
        const onKey = (e: KeyboardEvent) => {
            // While capturing a key, let the capture handler consume it.
            if (activeCapture) { return; }
            if (e.key === 'Enter') { e.preventDefault(); commit(); }
            else if (e.key === 'Escape') { e.preventDefault(); abort(); }
        };
        ok.addEventListener('click', commit);
        cancel.addEventListener('click', abort);
        document.addEventListener('keydown', onKey);
        showTab(0);
    });
}

function buildGameSettings(settings: GameSettingsOverride): HTMLElement {
    const wrap = document.createElement('div');
    Object.assign(wrap.style, {
        display: 'flex', gap: '32px', padding: '4px 8px',
    } as Partial<CSSStyleDeclaration>);
    for (const column of GAME_SETTINGS) {
        const col = document.createElement('div');
        for (const toggle of column) {
            const row = document.createElement('label');
            Object.assign(row.style, {
                display: 'flex', alignItems: 'center', margin: '6px 0',
                color: toggle.applicable ? '#111' : '#aaa',
                cursor: toggle.applicable ? 'pointer' : 'default',
            } as Partial<CSSStyleDeclaration>);
            const box = document.createElement('input');
            box.type = 'checkbox';
            box.disabled = !toggle.applicable;
            if (toggle.key) {
                box.dataset.testid = `prefs-setting-${toggle.key}`;
                const current = settings[toggle.key];
                box.checked = typeof current === 'boolean'
                    ? current : toggle.defaultOn;
                box.addEventListener('change', () => {
                    (settings[toggle.key!] as boolean) = box.checked;
                });
            } else {
                box.checked = toggle.defaultOn;
            }
            box.style.marginRight = '8px';
            row.appendChild(box);
            row.appendChild(document.createTextNode(toggle.label));
            col.appendChild(row);
        }
        wrap.appendChild(col);
    }
    // Sound Volume selector. Persisted but not yet wired to the audio engine,
    // so it is shown greyed-out/disabled like the other unwired toggles.
    const volRow = document.createElement('div');
    Object.assign(volRow.style, {
        marginTop: '12px', paddingLeft: '8px', color: '#aaa',
    } as Partial<CSSStyleDeclaration>);
    volRow.appendChild(document.createTextNode('Sound Volume: '));
    const vol = document.createElement('select');
    vol.dataset.testid = 'prefs-sound-volume';
    vol.disabled = true;
    for (const [value, label] of [['muted', 'Muted'], ['quiet', 'Quiet'],
    ['normal', 'Normal'], ['loud', 'Loud']]) {
        const opt = document.createElement('option');
        opt.value = value; opt.textContent = label;
        vol.appendChild(opt);
    }
    vol.value = settings.soundVolume ?? 'normal';
    vol.addEventListener('change', () => { settings.soundVolume = vol.value; });
    volRow.appendChild(vol);
    const outer = document.createElement('div');
    outer.appendChild(wrap);
    outer.appendChild(volRow);
    return outer;
}

/**
 * The Display tab: the two scale sliders, then the hotkeys that move
 * them.
 *
 * The sliders apply LIVE (the point of a display setting is seeing what
 * it does), and the client persists each move; Cancel restores whatever
 * they were when the dialog opened. Nothing here is per-pilot and nothing
 * reaches the save.
 */
function buildDisplayTab(displayScale: DisplayScaleHandle | undefined,
    baseControls: Record<string, unknown>, override: ControlsOverride,
    setCapture: (release: (() => void) | undefined) => void): HTMLElement {
    const wrap = document.createElement('div');
    Object.assign(wrap.style, {
        padding: '4px 8px',
    } as Partial<CSSStyleDeclaration>);

    if (!displayScale) {
        const none = document.createElement('div');
        none.textContent = 'Display scaling is unavailable.';
        none.style.color = '#aaa';
        wrap.appendChild(none);
        return wrap;
    }

    const slider = (label: string, testid: string,
        key: 'uiScale' | 'globalScale', help: string) => {
        const row = document.createElement('div');
        Object.assign(row.style, {
            display: 'flex', alignItems: 'center', gap: '10px',
            margin: '8px 0 2px',
        } as Partial<CSSStyleDeclaration>);
        const name = document.createElement('div');
        name.textContent = `${label}:`;
        name.style.width = '110px';
        row.appendChild(name);

        const input = document.createElement('input');
        input.type = 'range';
        input.dataset.testid = testid;
        input.min = String(MIN_SCALE);
        input.max = String(MAX_SCALE);
        input.step = String(SCALE_STEP);
        input.value = String(displayScale.get()[key]);
        input.style.flex = '1';
        row.appendChild(input);

        const readout = document.createElement('div');
        readout.dataset.testid = `${testid}-value`;
        readout.style.width = '54px';
        readout.style.textAlign = 'right';
        readout.textContent = formatScale(displayScale.get()[key]);
        row.appendChild(readout);

        // 'input' rather than 'change' so dragging previews continuously.
        input.addEventListener('input', () => {
            const applied = displayScale.set(
                { [key]: Number(input.value) } as Partial<DisplaySettings>);
            readout.textContent = formatScale(applied[key]);
            input.value = String(applied[key]);
        });
        wrap.appendChild(row);

        const hint = document.createElement('div');
        hint.textContent = help;
        Object.assign(hint.style, {
            color: '#777', fontSize: '11px', marginLeft: '120px',
            marginBottom: '6px',
        } as Partial<CSSStyleDeclaration>);
        wrap.appendChild(hint);
    };

    slider('UI Scale', 'prefs-ui-scale', 'uiScale',
        'Status bar, spaceport, dialogs and text only.');
    slider('Global Scale', 'prefs-global-scale', 'globalScale',
        'Everything, including the flight view — a bigger view shows '
        + 'less of the system.');

    const note = document.createElement('div');
    note.textContent = 'These are saved for this browser, not for this '
        + 'pilot, and take effect immediately.';
    Object.assign(note.style, {
        color: '#777', fontSize: '11px', margin: '10px 0 4px',
    } as Partial<CSSStyleDeclaration>);
    wrap.appendChild(note);

    wrap.appendChild(buildControlTab(DISPLAY_CONTROL_ROWS, baseControls,
        override, setCapture));
    return wrap;
}

function buildControlTab(tab: { name: string, rows: ControlRow[] },
    baseControls: Record<string, unknown>, override: ControlsOverride,
    setCapture: (release: (() => void) | undefined) => void): HTMLElement {
    const grid = document.createElement('div');
    Object.assign(grid.style, {
        display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 24px',
        padding: '4px 8px',
    } as Partial<CSSStyleDeclaration>);

    // Rebinding can displace another row on this same tab, so every
    // button re-reads its binding after any capture.
    const renderers: (() => void)[] = [];
    const renderAll = () => { for (const r of renderers) { r(); } };

    for (const row of tab.rows) {
        const line = document.createElement('div');
        Object.assign(line.style, {
            display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
            gap: '8px',
        } as Partial<CSSStyleDeclaration>);
        const label = document.createElement('div');
        label.textContent = `${row.label}:`;
        label.style.color = row.action ? '#111' : '#aaa';
        line.appendChild(label);

        const capture = document.createElement('button');
        capture.dataset.testid = `prefs-bind-${row.action ?? row.label}`;
        Object.assign(capture.style, {
            width: '92px', padding: '4px 0', borderRadius: '12px',
            border: '1px solid #c0c0c0', background: '#fff',
            fontSize: '12px', textAlign: 'center',
            cursor: row.action ? 'pointer' : 'default',
            color: row.action ? '#111' : '#bbb',
        } as Partial<CSSStyleDeclaration>);

        if (!row.action) {
            capture.textContent = '—';
            capture.disabled = true;
            line.appendChild(capture);
            grid.appendChild(line);
            continue;
        }
        const action = row.action;
        const render = () => {
            capture.textContent =
                keyLabel(primaryBinding(action, baseControls, override))
                || '·';
        };
        renderers.push(render);
        render();

        capture.addEventListener('click', () => {
            capture.textContent = 'press…';
            capture.style.background = '#fff6cc';
            const onCapture = (e: KeyboardEvent) => {
                e.preventDefault();
                e.stopPropagation();
                if (e.key !== 'Escape') {
                    // Take the key away from any other rebindable action
                    // that owns it, then record the new binding. Copied
                    // onto the shared working map rather than replacing
                    // it, so the other tabs see the change too.
                    const next = bindControl(baseControls, override, action,
                        e.code, REBINDABLE_ACTIONS);
                    for (const [k, v] of Object.entries(next)) {
                        override[k] = v;
                    }
                }
                release();
            };
            const release = () => {
                document.removeEventListener('keydown', onCapture, true);
                capture.style.background = '#fff';
                renderAll();
                // Clear the active capture (not a truthy no-op) so the dialog's
                // key handler resumes handling Enter/Escape immediately.
                setCapture(undefined);
            };
            document.addEventListener('keydown', onCapture, true);
            setCapture(release);
        });
        line.appendChild(capture);
        grid.appendChild(line);
    }
    return grid;
}
