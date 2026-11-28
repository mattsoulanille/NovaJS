/**
 * NovaJS Enhancements: the small, deliberate UI departures from the
 * original game, each behind a per-player toggle (Preferences >
 * "NovaJS Enhancements..."). ON is the NovaJS behaviour Matthew chose and
 * the default; OFF restores what the original does.
 *
 * EVERY TOGGLE HERE IS CLIENT-SIDE ONLY, with one ruled exception. A
 * toggle may change what this player sees, or which inputs their UI lets
 * them make, but never how the simulation runs: two peers with different
 * toggles must stay in lock step. A departure that changes a SIM rule
 * (capture odds, submunitions, repair, ...) is a room rule instead, and is
 * listed in docs/novajs_enhancements.md, not here.
 *
 * The exception (Matthew, 2026-11-27): `enhAccurateTurretAim` picks how
 * THIS player's own ship's turrets aim. It reaches the simulation only as
 * synced state on that ship (nova_plugin/player/turret_aim.ts), stamped on
 * the ship at every insertion and sent as a `setTurretAim` input record
 * when it changes (onEnhancementsChanged), so every peer still runs the
 * same simulation.
 *
 * The values persist per pilot beside the original's Game Settings
 * (GameSettingsOverride, saved with the pilot on the Preferences dialog's
 * OK). The game reads them live through {@link enhancementEnabled}, from a
 * cache the pilot registry clears whenever it is written.
 */

/** The persisted keys, one per enhancement (flat booleans: the pilot
 * registry's settings codec holds only booleans and strings). */
export type EnhancementKey =
    | 'enhMapAutoRoute'
    | 'enhLiveTargetView'
    | 'enhShieldArmorTotals'
    | 'enhShopScrollWheel'
    | 'enhTextScrollWheel'
    | 'enhShopSearch'
    | 'enhMiniMapHiddenNoClicks'
    | 'enhGateMapLanes'
    | 'enhSmoothMapZoom'
    | 'enhShipStorage'
    | 'enhAccurateTurretAim'
    | 'enhHailDCloses'
    | 'enhYesNoKeys';

/** One row of the NovaJS Enhancements dialog. */
export interface EnhancementSpec {
    readonly key: EnhancementKey;
    /** The short label beside the checkbox. */
    readonly label: string;
    /** One line: what NovaJS does with the box checked. */
    readonly novajs: string;
    /** One line: what the original does instead (the box unchecked). */
    readonly original: string;
}

/** Every enhancement, in the dialog's order. */
export const ENHANCEMENTS: readonly EnhancementSpec[] = [
    {
        key: 'enhMapAutoRoute',
        label: 'Map auto-routing',
        novajs: 'One shift-click plots a whole route, through unexplored '
            + 'systems the map draws.',
        original: 'Routes are built pin by pin; a shift-click past the '
            + 'next jump is ignored.',
    },
    {
        key: 'enhLiveTargetView',
        label: 'Live target view',
        novajs: 'The target display shows the target ship as it flies, '
            + 'turning with it.',
        original: 'A fixed picture of the ship class (its target PICT).',
    },
    {
        key: 'enhShieldArmorTotals',
        label: 'Shield and armor totals',
        novajs: 'Player Info shows each total beside its percentage, '
            + 'e.g. "100% (150)".',
        original: 'Only the percentage.',
    },
    {
        key: 'enhShopScrollWheel',
        label: 'Scroll wheel in shops',
        novajs: 'The wheel or a two-finger scroll moves the outfitter, '
            + 'shipyard and hire grids by rows.',
        original: 'The wheel does nothing; use the arrows or the keys.',
    },
    {
        // Also the shops' description panes (scroll_text_pane.ts
        // shopDescriptionPane): clipped either way, scrolling only on.
        key: 'enhTextScrollWheel',
        label: 'Scroll wheel in text',
        novajs: 'The wheel or a two-finger scroll moves a long mission '
            + 'offer or briefing text, or a shop description too long for '
            + 'its pane (which gets a scroll bar).',
        original: 'The wheel does nothing; use the arrows or the keys. A '
            + 'shop description too long for its pane is cut off.',
    },
    {
        key: 'enhShopSearch',
        label: 'Shop search',
        novajs: 'A search field filters the outfitter and shipyard by '
            + 'name.',
        original: 'No search field.',
    },
    {
        key: 'enhMiniMapHiddenNoClicks',
        label: 'Hidden h-map ignores clicks',
        novajs: 'Once the h minimap has faded, clicks there reach space.',
        original: 'Its hidden area still picks systems for about 8 s '
            + 'after it was shown.',
    },
    {
        // spaceport/gate_map.ts gateMapLaneColor.
        key: 'enhGateMapLanes',
        label: 'Jump lanes on the hypergate map',
        novajs: 'The hypergate map draws the hyperspace lanes in the '
            + 'star map\'s grey.',
        original: 'The lanes are drawn nearly black, all but invisible.',
    },
    {
        // spaceport/system_graph.ts smoothMapControls: the star map and
        // the hypergate map (the h minimap neither zooms nor pans).
        key: 'enhSmoothMapZoom',
        label: 'Smooth map zoom',
        novajs: 'The map zooms smoothly (the wheel and a pinch about the '
            + 'pointer); arrows pan 40 px, kept near the galaxy.',
        original: 'Seven fixed zoom levels; arrows pan 10 map units, '
            + 'with no limit.',
    },
    {
        // Hides the UI only: the stored ships stay stored, and the
        // landed transactions are the same for every peer either way
        // (docs/ship_storage.md).
        key: 'enhShipStorage',
        label: 'Ship storage',
        novajs: 'Shipyards keep your other ships: Your Ships, and '
            + 'Option-click Buy Ship to keep your old one.',
        original: 'No ship storage: you fly one ship and trade it in.',
    },
    {
        // Sim state on the player's own ship, synced through an input
        // record (nova_plugin/player/turret_aim.ts); NPC turrets always
        // lead the original's way.
        key: 'enhAccurateTurretAim',
        label: 'Accurate turret aim',
        novajs: 'Your ship\'s turrets aim where a moving target will be '
            + 'when the shot reaches it.',
        original: 'Your turrets lead to first order, as the original\'s '
            + 'do, and miss fast crossing targets.',
    },
    {
        // spaceport/hail_dialog.ts: 'depart' (KeyD) closes the channel.
        // Matthew 2026-11-27: Escape leaves browser fullscreen, so the
        // hail window needs a close key that stays in the game.
        key: 'enhHailDCloses',
        label: 'd closes the hail window',
        novajs: 'd closes the hail window, as Esc does; t still demands '
            + 'tribute.',
        original: 'd demands tribute at a planet and does nothing on a '
            + 'ship.',
    },
    {
        // spaceport/menu_controls.ts answerButtons / pressAnswerKey.
        // Matthew 2026-11-28: "`y` and `n` should apply to choice dialog
        // boxes (including when choices are renamed)". Whether the
        // original's offer dialog takes them is not yet measured
        // (docs/reference_experiments.md, "y / n in a mission offer").
        key: 'enhYesNoKeys',
        label: 'y and n answer dialogs',
        novajs: 'y presses a mission offer\'s accept button and n its '
            + 'refuse button, however they are named; also OK / Cancel on '
            + 'the jettison confirm and a hail price.',
        original: 'y and n do nothing in a dialog: click a button, or '
            + 'press Return for the default one.',
    },
];

/** Every enhancement's current state. */
export type Enhancements = Record<EnhancementKey, boolean>;

/** A stored settings record, as far as the enhancements read it (the
 * pilot's GameSettingsOverride, or anything hand-edited into one). */
export type StoredEnhancements = Partial<Record<EnhancementKey, unknown>>;

/** All ON: the NovaJS behaviour, and what a player who never opened the
 * dialog gets. */
export function defaultEnhancements(): Enhancements {
    const all = {} as Enhancements;
    for (const { key } of ENHANCEMENTS) {
        all[key] = true;
    }
    return all;
}

/**
 * The enhancement states a stored settings record describes: each key's
 * stored boolean, or ON when it is absent or not a boolean (a hand-edited
 * or older record).
 */
export function resolveEnhancements(
    settings: StoredEnhancements | undefined): Enhancements {
    const resolved = defaultEnhancements();
    for (const { key } of ENHANCEMENTS) {
        const value = settings?.[key];
        if (typeof value === 'boolean') {
            resolved[key] = value;
        }
    }
    return resolved;
}

/** Where the live values come from: the active pilot's settings. Set by
 * browser.ts (the title owns the registry); unset, every toggle is ON,
 * which is what the node specs and the worker see. */
let source: () => StoredEnhancements | undefined =
    () => undefined;
let cache: Enhancements | undefined;
/** Session-only overrides from the console / harness (never persisted). */
let overrides: Partial<Enhancements> = {};

/** Who hears that the live values may have changed. */
const listeners = new Set<() => void>();

/**
 * Calls `listener` whenever the live values may have changed (the source
 * repointed, the stored values rewritten, the overrides replaced); the
 * listener reads what it needs and compares. Returns the unsubscribe.
 * For the one toggle the simulation sees (enhAccurateTurretAim), whose
 * change must be sent as an input record.
 */
export function onEnhancementsChanged(listener: () => void): () => void {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
}

function notify() {
    for (const listener of [...listeners]) {
        try {
            listener();
        } catch (e) {
            console.error('Enhancements listener failed:', e);
        }
    }
}

/** Points the live values at a settings reader (the active pilot's). */
export function setEnhancementsSource(
    read: () => StoredEnhancements | undefined): void {
    source = read;
    cache = undefined;
    notify();
}

/** Drops the cached values so the next read sees the stored ones: called
 * whenever the pilot registry or the legacy settings slot is written. */
export function invalidateEnhancements(): void {
    cache = undefined;
    notify();
}

/**
 * Session-only overrides on top of the stored values, for the browser
 * console and the headless harness (`novaSettings.enhancements = {...}`).
 * Pass `{}` to drop them. Not persisted: the dialog is the only writer of
 * the stored values.
 */
export function overrideEnhancements(next: Partial<Enhancements>): void {
    overrides = { ...next };
    notify();
}

/** Every enhancement's live state (stored values plus overrides). */
export function currentEnhancements(): Enhancements {
    if (!cache) {
        let stored: StoredEnhancements | undefined;
        try {
            stored = source();
        } catch {
            stored = undefined;
        }
        cache = resolveEnhancements(stored);
    }
    return { ...cache, ...overrides };
}

/** Whether one enhancement is on right now. Cheap enough to call per
 * frame or per event: the stored values are read once and cached. */
export function enhancementEnabled(key: EnhancementKey): boolean {
    return overrides[key] ?? currentEnhancements()[key];
}
