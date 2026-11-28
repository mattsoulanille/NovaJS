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
    loadPerfStatsEnabled, PilotProfile, primaryControlBinding,
    savePerfStatsEnabled,
} from './client_prefs.js';
import {
    formatScale, MAX_SCALE, MIN_SCALE, SCALE_STEP,
} from '../display/display_scale.js';
import { bindingLabel } from './key_labels.js';
import { makeDescTextContext, playerGender, resolveConditionalBlocks }
    from '../nova_plugin/ncb/index.js';
import {
    loadPilotControls, loadPilotSettings, savePilotControls,
    savePilotSettings,
} from './pilot_registry.js';
import { ENHANCEMENTS, resolveEnhancements } from '../enhancements.js';
import {
    fullscreenShortcutLabel, wireFullscreenButton,
} from '../client/fullscreen.js';
import { isReturnPress } from '../input_focus.js';

// ---------------------------------------------------------------------------
// Shared modal scaffolding.
// ---------------------------------------------------------------------------

interface Modal {
    backdrop: HTMLDivElement;
    panel: HTMLDivElement;
    close: () => void;
}

/**
 * Where a modal sits. 'centre' is the default for the pilot dialogs (the
 * original's are native sheets with no fixed place to copy). The other
 * form pins the panel's top-left corner a fixed distance up and left of the
 * viewport's centre, which is where the original puts its native
 * Preferences window: the 1024x768 title art is centred, and the window's
 * corner sits 346 px above and 332 px left of the screen centre (628,194 on
 * a 1920x1080 screen; set_pref_1..5.png). Fixed offsets rather than flex
 * centring also keep an odd-width window on whole pixels.
 */
type ModalPlacement = 'centre' | { titleArtTop: number, titleArtLeft: number };

function makeModal(testid: string, placement: ModalPlacement = 'centre'):
    Modal {
    const backdrop = document.createElement('div');
    backdrop.className = 'nova-title-modal-backdrop';
    backdrop.dataset.testid = `${testid}-backdrop`;
    Object.assign(backdrop.style, {
        position: 'fixed', inset: '0', display: 'flex',
        alignItems: 'center', justifyContent: 'center',
        background: 'rgba(0,0,0,0.35)', zIndex: '10000',
        fontFamily: '-apple-system, Geneva, "Helvetica Neue", sans-serif',
    } as Partial<CSSStyleDeclaration>);
    if (placement !== 'centre') {
        Object.assign(backdrop.style, {
            alignItems: 'flex-start', justifyContent: 'flex-start',
            paddingTop: `max(0px, calc(50vh - ${placement.titleArtTop}px))`,
            paddingLeft: `max(0px, calc(50vw - ${placement.titleArtLeft}px))`,
        } as Partial<CSSStyleDeclaration>);
    }

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
            if (isReturnPress(e)) { e.preventDefault(); submit(); }
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
            if (isReturnPress(e)) { e.preventDefault(); confirm(); }
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
 * has an effect in NovaJS yet (a tooltip says so when not). */
interface SettingToggle {
    label: string;
    key?: keyof GameSettingsOverride;
    /** false => no effect in NovaJS yet; still drawn enabled, as in the
     * original, with a tooltip saying so (see settingRow). */
    applicable: boolean;
    /** Default checked state when unset. */
    defaultOn: boolean;
}

const GAME_SETTINGS: SettingToggle[][] = [
    // Left column.
    [
        // These toggles persist to localStorage but are not yet wired to any
        // graphics/sound effect (applicable: false). They are drawn enabled
        // like the original's, with a tooltip saying they do nothing yet.
        // Flip to applicable: true as each effect gets wired up.
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
            { label: 'Show Framerate', action: 'toggleFpsMeter' },
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

// The original's Preferences window, measured on set_pref_1..5.png (1920x1080):
// a 663x305 native window, top at y 194; a 22 px title bar; the five-tab
// segmented control (y 228-248) straddling the top edge (y 238) of a grey
// group box inset 20 px (x 648-1271, down to y 448); Cancel (84x22) and the
// default OK button right-aligned under the box at y 459, 18 px from the
// bottom edge.
const PREFS_WIDTH = 663;
const PREFS_PLACEMENT = { titleArtTop: 346, titleArtLeft: 332 };
const PREFS_BOX_HEIGHT = 211;
/** Checkbox lefts at x 785 and 997: a 212 px left column, both centred. */
const PREFS_LEFT_COLUMN = 212;
const PREFS_ROW_PITCH = 20;
const AQUA_BLUE = 'linear-gradient(#6cb3fa, #1a82fb)';
const PREFS_VOLUMES: [string, string][] = [
    ['muted', 'Muted'], ['quiet', 'Quiet'], ['normal', 'Normal'],
    ['loud', 'Loud'],
];

/** The original's white rounded Cancel / blue default OK push buttons. */
function aquaButton(label: string, testid: string, primary: boolean):
    HTMLButtonElement {
    const btn = document.createElement('button');
    btn.textContent = label;
    btn.dataset.testid = testid;
    Object.assign(btn.style, {
        width: '84px', height: '22px', padding: '0', borderRadius: '5px',
        fontSize: '13px', fontFamily: 'inherit', cursor: 'pointer',
        border: primary ? '1px solid #3d8ff5' : '1px solid #c4c4c4',
        background: primary ? AQUA_BLUE : '#fff',
        color: primary ? '#fff' : '#111',
        boxShadow: '0 1px 1px rgba(0,0,0,0.12)',
    } as Partial<CSSStyleDeclaration>);
    return btn;
}

/**
 * The "Set Prefs" panel: Game Settings plus the four control-binding tabs,
 * in the original's order, then our extra Display tab LAST (the original
 * has no display scaling; putting it at the end keeps the first five tabs
 * where set_pref_1..5 have them). On OK it persists the game-settings
 * toggles and any changed bindings to localStorage (see client_prefs); the
 * game start layers them over the served defaults. Resolves when the
 * dialog closes.
 *
 * The display scales are the odd one out: they are MACHINE-local rather
 * than per-pilot, they apply live rather than on OK, and they persist
 * themselves through the handle (see DisplayScaleHandle).
 */
export function showPreferencesDialog(baseControls: Record<string, unknown>,
    displayScale?: DisplayScaleHandle):
    Promise<void> {
    return new Promise((resolve) => {
        const modal = makeModal('preferences-dialog', PREFS_PLACEMENT);
        Object.assign(modal.panel.style, {
            width: `${PREFS_WIDTH}px`, minWidth: '0', maxWidth: 'none',
            padding: '0 20px 18px', boxSizing: 'border-box',
            borderRadius: '5px', overflow: 'hidden',
            boxShadow: '0 10px 36px rgba(0,0,0,0.55), '
                + '0 0 0 1px rgba(0,0,0,0.25)',
        } as Partial<CSSStyleDeclaration>);

        // The native title bar: "Preferences", centred, in grey.
        const title = document.createElement('div');
        title.textContent = 'Preferences';
        Object.assign(title.style, {
            margin: '0 -20px', height: '22px', lineHeight: '22px',
            textAlign: 'center', color: '#4d4d4d',
            background: 'linear-gradient(#ebebeb, #d5d5d5)',
            borderBottom: '1px solid #c2c2c2', boxSizing: 'border-box',
        } as Partial<CSSStyleDeclaration>);
        modal.panel.appendChild(title);

        // Working copies of the ACTIVE PILOT's prefs; committed only on OK.
        const settings: GameSettingsOverride = { ...loadPilotSettings() };
        const controlsOverride: ControlsOverride = { ...loadPilotControls() };

        // The segmented tab control sits centred on the group box's top
        // edge: 12 px under the title bar, its middle on the box border.
        const frame = document.createElement('div');
        Object.assign(frame.style, {
            position: 'relative', marginTop: '12px', paddingTop: '10px',
        } as Partial<CSSStyleDeclaration>);
        modal.panel.appendChild(frame);

        const tabBar = document.createElement('div');
        Object.assign(tabBar.style, {
            position: 'absolute', top: '0', left: '50%',
            transform: 'translateX(-50%)', zIndex: '1', display: 'flex',
            height: '21px', boxSizing: 'border-box', whiteSpace: 'nowrap',
            border: '1px solid #c4c4c4', borderRadius: '5px',
            background: '#fff', overflow: 'hidden',
            boxShadow: '0 1px 1px rgba(0,0,0,0.08)',
        } as Partial<CSSStyleDeclaration>);
        frame.appendChild(tabBar);

        const content = document.createElement('div');
        Object.assign(content.style, {
            minHeight: `${PREFS_BOX_HEIGHT}px`, boxSizing: 'border-box',
            background: '#e2e2e2', border: '1px solid #d6d6d6',
            borderRadius: '4px', padding: '26px 0 8px',
        } as Partial<CSSStyleDeclaration>);
        frame.appendChild(content);

        // The scales the dialog opened with, so Cancel can undo a live
        // preview. Untouched (and unrestored) when there is no handle.
        const scalesOnOpen = displayScale?.get();
        // Likewise "Send performance stats", which also applies at once.
        const perfStatsOnOpen = loadPerfStatsEnabled();

        const tabNames = ['Game Settings', ...CONTROL_TABS.map(t => t.name),
            'Display'];
        const displayIndex = tabNames.length - 1;
        const tabButtons: HTMLButtonElement[] = [];
        let activeCapture: (() => void) | undefined;

        const showTab = (index: number) => {
            activeCapture?.();
            activeCapture = undefined;
            tabButtons.forEach((b, i) => {
                b.style.background = i === index ? AQUA_BLUE : 'transparent';
                b.style.color = i === index ? '#fff' : '#111';
            });
            content.innerHTML = '';
            if (index === 0) {
                content.appendChild(buildGameSettings(settings));
            } else if (index === displayIndex) {
                content.appendChild(buildDisplayTab(displayScale,
                    baseControls, controlsOverride,
                    (release) => { activeCapture = release; }));
            } else {
                content.appendChild(buildControlTab(
                    CONTROL_TABS[index - 1], baseControls, controlsOverride,
                    (release) => { activeCapture = release; }));
            }
        };

        tabNames.forEach((name, index) => {
            const tab = document.createElement('button');
            tab.textContent = name;
            tab.dataset.testid = `prefs-tab-${index}`;
            Object.assign(tab.style, {
                // 12 px a side in the original's five tabs; 9 here so our
                // sixth (Display) still fits across the window.
                padding: '0 9px', fontSize: '13px', fontFamily: 'inherit',
                cursor: 'pointer', border: 'none', borderRadius: '0',
                borderLeft: index === 0 ? 'none' : '1px solid #d0d0d0',
                background: 'transparent', lineHeight: '19px',
            } as Partial<CSSStyleDeclaration>);
            tab.addEventListener('click', () => showTab(index));
            tabBar.appendChild(tab);
            tabButtons.push(tab);
        });

        const cancel = aquaButton('Cancel', 'prefs-cancel', false);
        const ok = aquaButton('OK', 'prefs-ok', true);
        // NovaJS's own departures from the original get a sheet of their
        // own rather than a seventh tab: six already fill the window's
        // width. The button sits bottom-left, apart from Cancel / OK, as
        // a native window's secondary action does. Its edits land in the
        // same working copy, so this dialog's OK / Cancel commit or drop
        // them with everything else.
        const enhancements = aquaButton('NovaJS Enhancements…',
            'prefs-enhancements', false);
        Object.assign(enhancements.style, {
            width: 'auto', padding: '0 12px', marginRight: 'auto',
        } as Partial<CSSStyleDeclaration>);
        enhancements.addEventListener('click', () => {
            activeCapture?.();
            activeCapture = showEnhancementsSheet(settings, () => {
                activeCapture = undefined;
            });
        });
        const row = document.createElement('div');
        Object.assign(row.style, {
            display: 'flex', justifyContent: 'flex-end', gap: '13px',
            marginTop: '10px',
        } as Partial<CSSStyleDeclaration>);
        row.appendChild(enhancements);
        row.appendChild(cancel);
        row.appendChild(ok);
        modal.panel.appendChild(row);

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
            if (loadPerfStatsEnabled() !== perfStatsOnOpen) {
                savePerfStatsEnabled(perfStatsOnOpen);
            }
            cleanup();
            resolve();
        };
        const onKey = (e: KeyboardEvent) => {
            // While capturing a key, let the capture handler consume it.
            if (activeCapture) { return; }
            if (isReturnPress(e)) { e.preventDefault(); commit(); }
            else if (e.key === 'Escape') { e.preventDefault(); abort(); }
        };
        ok.addEventListener('click', commit);
        cancel.addEventListener('click', abort);
        document.addEventListener('keydown', onKey);
        showTab(0);
    });
}

/**
 * The "NovaJS Enhancements" sheet: one checkbox per deliberate departure
 * from the original (enhancements.ts), each with the one line saying what
 * the original does instead, which is what unchecking it brings back.
 *
 * It edits a copy of the Preferences dialog's working `settings`; its OK
 * copies the boxes back into them (the Preferences OK then persists them
 * with the pilot), its Cancel or Escape drops them. Returns a function
 * that closes it as a Cancel, which the Preferences dialog calls when it
 * closes first. `onClose` runs once, however it closes.
 */
export function showEnhancementsSheet(settings: GameSettingsOverride,
    onClose: () => void): () => void {
    const modal = makeModal('enhancements-dialog');
    Object.assign(modal.panel.style, {
        width: '560px', minWidth: '0', maxWidth: 'none',
        padding: '0 20px 18px', boxSizing: 'border-box',
        borderRadius: '5px', overflow: 'hidden',
        boxShadow: '0 10px 36px rgba(0,0,0,0.55), '
            + '0 0 0 1px rgba(0,0,0,0.25)',
    } as Partial<CSSStyleDeclaration>);
    modal.backdrop.style.background = 'rgba(0,0,0,0.2)';

    const title = document.createElement('div');
    title.textContent = 'NovaJS Enhancements';
    Object.assign(title.style, {
        margin: '0 -20px', height: '22px', lineHeight: '22px',
        textAlign: 'center', color: '#4d4d4d',
        background: 'linear-gradient(#ebebeb, #d5d5d5)',
        borderBottom: '1px solid #c2c2c2', boxSizing: 'border-box',
    } as Partial<CSSStyleDeclaration>);
    modal.panel.appendChild(title);

    const intro = document.createElement('div');
    intro.textContent = 'Small changes NovaJS makes to the original game. '
        + 'Uncheck one to get the original\'s behaviour back.';
    Object.assign(intro.style, {
        margin: '12px 0 10px', color: '#333',
    } as Partial<CSSStyleDeclaration>);
    modal.panel.appendChild(intro);

    const box = document.createElement('div');
    Object.assign(box.style, {
        background: '#e2e2e2', border: '1px solid #d6d6d6',
        borderRadius: '4px', padding: '6px 14px',
        // The list scrolls rather than pushing the title bar and the
        // buttons off a short window (the original's 800 x 600).
        maxHeight: 'calc(100vh - 170px)', overflowY: 'auto',
    } as Partial<CSSStyleDeclaration>);
    modal.panel.appendChild(box);

    const working = resolveEnhancements(settings);
    for (const spec of ENHANCEMENTS) {
        const row = document.createElement('label');
        row.dataset.testid = `enh-row-${spec.key}`;
        row.title = `NovaJS: ${spec.novajs}`;
        Object.assign(row.style, {
            display: 'flex', alignItems: 'flex-start', gap: '6px',
            padding: '5px 0', cursor: 'pointer',
        } as Partial<CSSStyleDeclaration>);
        const check = document.createElement('input');
        check.type = 'checkbox';
        check.dataset.testid = `enh-${spec.key}`;
        check.checked = working[spec.key];
        Object.assign(check.style, {
            width: '14px', height: '14px', margin: '1px 0 0',
            accentColor: '#3b99fc', flex: 'none',
        } as Partial<CSSStyleDeclaration>);
        check.addEventListener('change', () => {
            working[spec.key] = check.checked;
        });
        const text = document.createElement('div');
        const label = document.createElement('div');
        label.textContent = spec.label;
        label.style.color = '#111';
        const original = document.createElement('div');
        original.textContent = `Original: ${spec.original}`;
        Object.assign(original.style, {
            color: '#666', fontSize: '11px', marginTop: '1px',
        } as Partial<CSSStyleDeclaration>);
        text.appendChild(label);
        text.appendChild(original);
        row.appendChild(check);
        row.appendChild(text);
        box.appendChild(row);
    }

    const cancel = aquaButton('Cancel', 'enh-cancel', false);
    const ok = aquaButton('OK', 'enh-ok', true);
    const buttons = document.createElement('div');
    Object.assign(buttons.style, {
        display: 'flex', justifyContent: 'flex-end', gap: '13px',
        marginTop: '12px',
    } as Partial<CSSStyleDeclaration>);
    buttons.appendChild(cancel);
    buttons.appendChild(ok);
    modal.panel.appendChild(buttons);

    let closed = false;
    const close = (commit: boolean) => {
        if (closed) {
            return;
        }
        closed = true;
        if (commit) {
            for (const { key } of ENHANCEMENTS) {
                settings[key] = working[key];
            }
        }
        document.removeEventListener('keydown', onKey, true);
        modal.close();
        onClose();
    };
    // Capture phase, so the Preferences dialog underneath never sees the
    // Enter / Escape meant for this sheet.
    const onKey = (e: KeyboardEvent) => {
        if (isReturnPress(e)) {
            e.preventDefault();
            e.stopPropagation();
            close(true);
        } else if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            close(false);
        }
    };
    ok.addEventListener('click', () => close(true));
    cancel.addEventListener('click', () => close(false));
    document.addEventListener('keydown', onKey, true);
    return () => close(false);
}

/**
 * One Game Settings checkbox row. Every box looks ENABLED, as in the
 * original (blue when checked). A toggle with a settings key can be
 * changed and is saved with the pilot on OK; most are not wired to an
 * effect yet, which the row's tooltip says. A toggle without a key (no
 * browser equivalent) shows its default and ignores clicks.
 */
function settingRow(toggle: SettingToggle, settings: GameSettingsOverride):
    HTMLElement {
    const row = document.createElement('label');
    Object.assign(row.style, {
        display: 'flex', alignItems: 'center',
        height: `${PREFS_ROW_PITCH}px`, color: '#111', whiteSpace: 'nowrap',
        cursor: toggle.key ? 'pointer' : 'default',
    } as Partial<CSSStyleDeclaration>);
    const box = document.createElement('input');
    box.type = 'checkbox';
    Object.assign(box.style, {
        width: '14px', height: '14px', margin: '0 5px 0 0',
        accentColor: '#3b99fc',
    } as Partial<CSSStyleDeclaration>);
    if (toggle.key) {
        const key = toggle.key;
        box.dataset.testid = `prefs-setting-${key}`;
        const current = settings[key];
        box.checked = typeof current === 'boolean'
            ? current : toggle.defaultOn;
        box.addEventListener('change', () => {
            (settings[key] as boolean) = box.checked;
        });
    } else {
        box.checked = toggle.defaultOn;
        box.tabIndex = -1;
        box.addEventListener('click', e => e.preventDefault());
    }
    if (!toggle.applicable) {
        row.title = toggle.key
            ? 'Saved with the pilot; not used by NovaJS yet.'
            : 'Has no equivalent in a browser.';
    }
    row.appendChild(box);
    row.appendChild(document.createTextNode(toggle.label));
    return row;
}

function buildGameSettings(settings: GameSettingsOverride): HTMLElement {
    // Two columns, centred as a pair in the box (set_pref_1: checkboxes at
    // x 785 and 997, first row centred on y 283, 20 px rows).
    const wrap = document.createElement('div');
    Object.assign(wrap.style, {
        display: 'flex', justifyContent: 'center', paddingTop: '8px',
    } as Partial<CSSStyleDeclaration>);
    const [leftToggles, rightToggles] = GAME_SETTINGS;
    const left = document.createElement('div');
    left.style.width = `${PREFS_LEFT_COLUMN}px`;
    for (const toggle of leftToggles) {
        left.appendChild(settingRow(toggle, settings));
    }
    const right = document.createElement('div');
    for (const toggle of rightToggles) {
        right.appendChild(settingRow(toggle, settings));
    }
    right.appendChild(buildSoundVolume(settings));
    wrap.appendChild(left);
    wrap.appendChild(right);
    return wrap;
}

/**
 * "Sound Volume:" with the original's small up/down stepper and the
 * current level beside it, under the right column. Saved with the pilot
 * on OK; not wired to the audio engine yet (the tooltip says so, as for
 * the toggles).
 */
function buildSoundVolume(settings: GameSettingsOverride): HTMLElement {
    const wrap = document.createElement('div');
    wrap.title = 'Saved with the pilot; not used by NovaJS yet.';
    const label = document.createElement('div');
    label.textContent = 'Sound Volume:';
    Object.assign(label.style, {
        height: `${PREFS_ROW_PITCH}px`, lineHeight: `${PREFS_ROW_PITCH}px`,
        marginTop: '4px',
    } as Partial<CSSStyleDeclaration>);
    wrap.appendChild(label);

    const line = document.createElement('div');
    Object.assign(line.style, {
        display: 'flex', alignItems: 'center', gap: '8px', marginTop: '4px',
        marginLeft: '1px',
    } as Partial<CSSStyleDeclaration>);
    const stepper = document.createElement('div');
    stepper.dataset.testid = 'prefs-sound-volume';
    Object.assign(stepper.style, {
        display: 'flex', flexDirection: 'column', width: '12px',
        height: '22px', boxSizing: 'border-box', border: '1px solid #c4c4c4',
        borderRadius: '4px', background: '#fff', overflow: 'hidden',
    } as Partial<CSSStyleDeclaration>);
    const value = document.createElement('div');
    value.dataset.testid = 'prefs-sound-volume-value';

    let index = Math.max(0, PREFS_VOLUMES.findIndex(
        ([v]) => v === (settings.soundVolume ?? 'normal')));
    const render = () => {
        value.textContent = PREFS_VOLUMES[index][1];
        stepper.dataset.value = PREFS_VOLUMES[index][0];
    };
    const arrow = (glyph: string, testid: string, delta: number) => {
        const btn = document.createElement('button');
        btn.textContent = glyph;
        btn.dataset.testid = testid;
        Object.assign(btn.style, {
            flex: '1', padding: '0', border: 'none', background: 'none',
            fontSize: '6px', lineHeight: '9px', color: '#333',
            cursor: 'pointer',
        } as Partial<CSSStyleDeclaration>);
        btn.addEventListener('click', () => {
            index = Math.min(PREFS_VOLUMES.length - 1,
                Math.max(0, index + delta));
            settings.soundVolume = PREFS_VOLUMES[index][0];
            render();
        });
        stepper.appendChild(btn);
    };
    arrow('▲', 'prefs-sound-volume-up', 1);
    arrow('▼', 'prefs-sound-volume-down', -1);
    render();
    line.appendChild(stepper);
    line.appendChild(value);
    wrap.appendChild(line);
    return wrap;
}

/**
 * The Display tab's "Fullscreen" button (client/fullscreen.ts
 * wireFullscreenButton: its label follows the document's state), with the
 * shortcut beside it: Option+Return on a Mac, Alt+Enter elsewhere.
 */
function buildFullscreenRow(): HTMLDivElement {
    const row = document.createElement('div');
    Object.assign(row.style, {
        display: 'flex', alignItems: 'center', gap: '10px',
        margin: '0 0 8px',
    } as Partial<CSSStyleDeclaration>);
    const name = document.createElement('div');
    name.textContent = 'Fullscreen:';
    name.style.width = '110px';
    row.appendChild(name);

    const btn = aquaButton('Fullscreen', 'prefs-fullscreen', false);
    Object.assign(btn.style, {
        width: '120px', padding: '0 12px',
    } as Partial<CSSStyleDeclaration>);
    wireFullscreenButton(btn);
    if (btn.disabled) {
        btn.style.cursor = 'default';
        btn.style.color = '#bbb';
    }
    row.appendChild(btn);

    const hint = document.createElement('div');
    hint.dataset.testid = 'prefs-fullscreen-shortcut';
    hint.textContent = fullscreenShortcutLabel();
    Object.assign(hint.style, {
        color: '#777', fontSize: '11px',
    } as Partial<CSSStyleDeclaration>);
    row.appendChild(hint);
    return row;
}

/**
 * The Display tab's "Send performance stats" box (client/perf_telemetry.ts,
 * docs/perf_stats.md), with one line saying what goes. Machine-local and
 * live, like the scales: it is saved the moment it changes, and Cancel
 * puts it back.
 */
function buildPerfStatsRow(): HTMLElement {
    const wrap = document.createElement('div');
    Object.assign(wrap.style, {
        margin: '8px 0 2px',
    } as Partial<CSSStyleDeclaration>);
    const row = document.createElement('label');
    Object.assign(row.style, {
        display: 'flex', alignItems: 'center', cursor: 'pointer',
        color: '#111', whiteSpace: 'nowrap',
    } as Partial<CSSStyleDeclaration>);
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.dataset.testid = 'prefs-perf-stats';
    Object.assign(box.style, {
        width: '14px', height: '14px', margin: '0 5px 0 0',
        accentColor: '#3b99fc',
    } as Partial<CSSStyleDeclaration>);
    box.checked = loadPerfStatsEnabled();
    box.addEventListener('change', () => {
        savePerfStatsEnabled(box.checked);
    });
    row.appendChild(box);
    row.appendChild(document.createTextNode('Send performance stats'));
    wrap.appendChild(row);
    const hint = document.createElement('div');
    hint.dataset.testid = 'prefs-perf-stats-hint';
    hint.textContent = 'Frame rates, what is on screen, browser and GPU, '
        + 'to help fix slowdowns. No pilot name, chat or address.';
    Object.assign(hint.style, {
        color: '#777', fontSize: '11px', marginLeft: '19px',
        whiteSpace: 'normal',
    } as Partial<CSSStyleDeclaration>);
    wrap.appendChild(hint);
    return wrap;
}

/**
 * The Display tab: the Fullscreen button, the two scale sliders, "Send
 * performance stats", then the hotkeys that move the scales.
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
        padding: '0 20px',
    } as Partial<CSSStyleDeclaration>);
    wrap.appendChild(buildFullscreenRow());

    if (!displayScale) {
        const none = document.createElement('div');
        none.textContent = 'Display scaling is unavailable.';
        none.style.color = '#aaa';
        wrap.appendChild(none);
        wrap.appendChild(buildPerfStatsRow());
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

    wrap.appendChild(buildPerfStatsRow());

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
    // Two columns filled top-to-bottom, as the original lays its binding
    // rows out (set_pref_5: Pause..Self-Destruct left, Engage Cloak..Show
    // Framerate right): 21 px fields on a 30 px pitch, each right-aligned
    // 22 px in from its half of the box.
    const grid = document.createElement('div');
    Object.assign(grid.style, {
        display: 'grid', gridTemplateColumns: '1fr 1fr',
        gridAutoFlow: 'column',
        gridTemplateRows: `repeat(${Math.ceil(tab.rows.length / 2)}, 21px)`,
        rowGap: '9px',
    } as Partial<CSSStyleDeclaration>);

    // Rebinding can displace another row on this same tab, so every
    // button re-reads its binding after any capture.
    const renderers: (() => void)[] = [];
    const renderAll = () => { for (const r of renderers) { r(); } };

    for (const row of tab.rows) {
        const line = document.createElement('div');
        Object.assign(line.style, {
            display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
            gap: '8px', paddingRight: '22px', whiteSpace: 'nowrap',
        } as Partial<CSSStyleDeclaration>);
        const label = document.createElement('div');
        label.textContent = `${row.label}:`;
        label.style.color = row.action ? '#111' : '#aaa';
        line.appendChild(label);

        const capture = document.createElement('button');
        capture.dataset.testid = `prefs-bind-${row.action ?? row.label}`;
        Object.assign(capture.style, {
            width: '146px', height: '21px', padding: '0',
            boxSizing: 'border-box', borderRadius: '11px',
            border: '1px solid #c4c4c4', background: '#fff',
            fontSize: '12px', fontFamily: 'inherit', textAlign: 'center',
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
                bindingLabel(primaryControlBinding(action, baseControls, override))
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
