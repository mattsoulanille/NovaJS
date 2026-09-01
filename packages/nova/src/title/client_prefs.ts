/**
 * Client-only preferences and pilot profile, persisted in localStorage.
 *
 * The server serves the base `settings.json` / `controls.json` read-only
 * (see setup_routes). A browser build can't write those back, so the
 * title screen's "Set Prefs" dialog persists the player's changes here
 * and the game start (browser.ts) layers them over the served defaults.
 *
 * This module never touches sim state: it is pure UI/config bookkeeping
 * kept beside the save (see save_game.ts).
 */
import { clampScale } from '../display/display_scale.js';

/** localStorage key: control-binding overrides (action -> event.code). */
export const CONTROLS_OVERRIDE_KEY = 'novajs:controls';
/** localStorage key: game-settings overrides (checkbox/volume state). */
export const SETTINGS_OVERRIDE_KEY = 'novajs:settings';
/** localStorage key: the current pilot's profile (name, nickname, ...). */
export const PILOT_PROFILE_KEY = 'novajs:pilot';
/**
 * localStorage key: display scaling (UI scale / global scale).
 *
 * Deliberately NOT part of the pilot's prefs and NOT in the save: how big
 * the HUD should be is a property of the screen you are sitting in front
 * of, not of the character you are playing. Kept machine-local so the
 * same pilot exported to another machine picks up that machine's scale.
 */
export const DISPLAY_SETTINGS_KEY = 'novajs:display';

/** A minimal storage surface so this is testable without a browser. */
export interface PrefsStorage {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
}

function getStorage(storage?: PrefsStorage): PrefsStorage | undefined {
    if (storage) {
        return storage;
    }
    try {
        return typeof localStorage !== 'undefined' ? localStorage : undefined;
    } catch {
        return undefined;
    }
}

function readJson<T>(key: string, storage?: PrefsStorage): T | undefined {
    const store = getStorage(storage);
    if (!store) {
        return undefined;
    }
    let raw: string | null;
    try {
        raw = store.getItem(key);
    } catch {
        return undefined;
    }
    if (raw == null) {
        return undefined;
    }
    try {
        return JSON.parse(raw) as T;
    } catch {
        return undefined;
    }
}

function writeJson(key: string, value: unknown, storage?: PrefsStorage): void {
    const store = getStorage(storage);
    if (!store) {
        return;
    }
    try {
        store.setItem(key, JSON.stringify(value));
    } catch {
        // Best effort; ignore quota / disabled-storage failures.
    }
}

/** The player-editable game settings shown on the "Game Settings" tab.
 * Keys mirror the original's toggles; values persist even when a given
 * toggle has no wired effect in this browser build yet. */
export interface GameSettingsOverride {
    shipAnimations?: boolean;
    engineGlows?: boolean;
    runningLights?: boolean;
    weaponEffects?: boolean;
    smokeTrails?: boolean;
    parallaxStarfield?: boolean;
    introMusic?: boolean;
    ambientSounds?: boolean;
    hyperspaceEffects?: boolean;
    /** 'muted' | 'quiet' | 'normal' | 'loud'. */
    soundVolume?: string;
}

/** Loads persisted game-settings overrides (empty object if none). */
export function loadGameSettings(storage?: PrefsStorage): GameSettingsOverride {
    return readJson<GameSettingsOverride>(SETTINGS_OVERRIDE_KEY, storage) ?? {};
}

/** Persists the game-settings overrides. */
export function saveGameSettings(settings: GameSettingsOverride,
    storage?: PrefsStorage): void {
    writeJson(SETTINGS_OVERRIDE_KEY, settings, storage);
}

/**
 * The machine-local display scaling preferences.
 *
 * `globalScale` magnifies the whole presentation (world view included, so
 * less of the system fits on screen); `uiScale` magnifies only the UI
 * layers on top of that. Both default to 1, which reproduces the
 * pre-setting rendering exactly.
 */
export interface DisplaySettings {
    uiScale: number;
    globalScale: number;
}

/** What a player who has never touched the setting gets. */
export const DEFAULT_DISPLAY_SETTINGS: DisplaySettings =
    { uiScale: 1, globalScale: 1 };

/**
 * Loads the display scaling preferences, clamped and step-snapped.
 *
 * Anything unreadable — no storage, bad JSON, a hand-edited 500x — comes
 * back as the default rather than throwing: a bad value here would leave
 * the player with a window they cannot navigate to fix it.
 */
export function loadDisplaySettings(storage?: PrefsStorage): DisplaySettings {
    const raw = readJson<Partial<DisplaySettings>>(
        DISPLAY_SETTINGS_KEY, storage);
    return {
        uiScale: clampScale(raw?.uiScale),
        globalScale: clampScale(raw?.globalScale),
    };
}

/** Persists the display scaling preferences (clamped on the way out). */
export function saveDisplaySettings(settings: DisplaySettings,
    storage?: PrefsStorage): void {
    writeJson(DISPLAY_SETTINGS_KEY, {
        uiScale: clampScale(settings.uiScale),
        globalScale: clampScale(settings.globalScale),
    }, storage);
}

/**
 * One key an action is bound to, in controls.json's own grammar: a bare
 * `event.code`, or a code gated behind held modifiers.
 */
export type ControlBinding = string | { key: string; modifiers?: string[] };

/**
 * What an override says an action is bound to.
 *
 * Normally a single `event.code` — the editor captures one key. It is a
 * LIST when displacement had to take one key away from an action that
 * owned several (see bindControl): the survivors are written out so the
 * untouched ones keep working.
 *
 * `''` (and, equivalently, an empty list) means "explicitly unbound".
 */
export type ControlsOverrideValue = string | ControlBinding[];

/**
 * Control-binding overrides: action id -> what it is bound to.
 *
 * An empty-string value means "explicitly unbound": the player moved this
 * action's key onto another action, so the served default must NOT come
 * back. `mergeControls` turns it into an empty binding list.
 */
export type ControlsOverride = Record<string, ControlsOverrideValue>;

/** Loads persisted control-binding overrides (empty object if none). */
export function loadControlsOverride(storage?: PrefsStorage): ControlsOverride {
    return readJson<ControlsOverride>(CONTROLS_OVERRIDE_KEY, storage) ?? {};
}

/** Persists control-binding overrides. */
export function saveControlsOverride(controls: ControlsOverride,
    storage?: PrefsStorage): void {
    writeJson(CONTROLS_OVERRIDE_KEY, controls, storage);
}

/**
 * Merges control-binding overrides over a base `controls.json` object
 * (as served by the server). Each overridden action replaces that
 * action's binding with the single overridden key. Actions the player
 * never touched keep their served default. Returns a new object; the
 * base is not mutated.
 */
export function mergeControls(base: Record<string, unknown>,
    override: ControlsOverride): Record<string, unknown> {
    const merged: Record<string, unknown> = { ...base };
    for (const [action, value] of Object.entries(override)) {
        // '' means the player deliberately unbound this action (its key
        // was reassigned elsewhere). An empty list is a valid
        // ControlInputs value, so the action ends up with no key at all
        // rather than silently reverting to its served default.
        const unbound = Array.isArray(value) ? value.length === 0 : !value;
        merged[action] = unbound ? [] : value;
    }
    return merged;
}

/** A binding with its modifier list filled in, for comparison. */
interface NormalizedBinding {
    key: string;
    modifiers: string[];
}

/**
 * Every key a controls.json value (or an override value) binds, in the
 * same shapes the SavedControls codec accepts: a bare code, a list, or a
 * `{key, modifiers}` record. Unparseable / empty values bind nothing.
 */
function normalizeBindings(raw: unknown): NormalizedBinding[] {
    if (typeof raw === 'string') {
        return raw ? [{ key: raw, modifiers: [] }] : [];
    }
    if (Array.isArray(raw)) {
        return raw.flatMap(normalizeBindings);
    }
    if (raw && typeof raw === 'object'
        && typeof (raw as { key?: unknown }).key === 'string') {
        const { key, modifiers } = raw as { key: string; modifiers?: unknown };
        return [{
            key,
            modifiers: Array.isArray(modifiers)
                ? modifiers.filter((m): m is string => typeof m === 'string')
                : [],
        }];
    }
    return [];
}

/**
 * Every key `action` currently owns: its override if it has one
 * (including '' for explicitly unbound), else its served default.
 */
function bindingsFor(action: string, base: Record<string, unknown>,
    override: ControlsOverride): NormalizedBinding[] {
    if (Object.prototype.hasOwnProperty.call(override, action)) {
        return normalizeBindings(override[action]);
    }
    return normalizeBindings(base[action]);
}

/** Writes bindings back in the most compact shape that represents them. */
function encodeBindings(bindings: readonly NormalizedBinding[]):
    ControlsOverrideValue {
    if (bindings.length === 0) {
        return '';
    }
    if (bindings.length === 1 && bindings[0].modifiers.length === 0) {
        return bindings[0].key;
    }
    return bindings.map(({ key, modifiers }) =>
        modifiers.length ? { key, modifiers } : key);
}

/**
 * Records "bind `action` to `code`" in an override map, taking the key
 * away from whichever other rebindable action currently owns it.
 *
 * Without this displacement the new binding is unusable: `getActions`
 * returns every action bound to a code, so e.g. rebinding Fire Secondary
 * onto the Hyper Jump key made that key both fire and jump. Only actions
 * the editor itself exposes are displaced — menu/spaceport actions
 * (up/down/accept, bar/buy/sell, ...) intentionally share keys with
 * flight controls because they are live in different contexts.
 *
 * Two rules make this match what `getActions` actually fires:
 *
 *  - EVERY key an action owns counts, not just its first. Stock defaults
 *    are multi-key (fireSecondary is ControlLeft AND ShiftLeft), so
 *    checking only the first left the second key firing both actions.
 *  - Only the stolen key is removed; the action's other keys stay bound.
 *    Blanking fireSecondary outright because one of its two keys was
 *    taken punishes a key the player never touched. An action left with
 *    no keys becomes explicitly unbound ('').
 *
 * Collision is modifier-aware: `code` is a bare key (the editor captures
 * `event.code` with no modifiers), and a modifier-gated binding such as
 * Alt+Shift+Minus never fires on bare Minus, so a bare bind leaves it
 * alone. Should the editor ever capture modifiers, this must grow to an
 * exact code+modifiers match rather than staying bare-only.
 *
 * Returns a new map; the input is not mutated.
 */
export function bindControl(base: Record<string, unknown>,
    override: ControlsOverride, action: string, code: string,
    rebindableActions: readonly string[]): ControlsOverride {
    const next: ControlsOverride = { ...override, [action]: code };
    if (!code) {
        return next;
    }
    for (const other of rebindableActions) {
        if (other === action) {
            continue;
        }
        const owned = bindingsFor(other, base, next);
        const kept = owned.filter(
            binding => !(binding.key === code && !binding.modifiers.length));
        if (kept.length !== owned.length) {
            next[other] = encodeBindings(kept);
        }
    }
    return next;
}

/**
 * The event.code an action is currently bound to: the override if it has
 * one (including '' for explicitly unbound), else the served default.
 * Multi-key actions report their FIRST key — this is the editor's display
 * value, not the full binding.
 */
export function primaryBinding(action: string, base: Record<string, unknown>,
    override: ControlsOverride): string {
    return bindingsFor(action, base, override)[0]?.key ?? '';
}

/** A pilot's identity, entered in the "New Pilot" dialog. */
export interface PilotProfile {
    /** The pilot's full name (e.g. "Shane Merrol"). */
    name: string;
    /** The pilot's short nickname (e.g. "Hawkeye"). */
    nickname: string;
    /** 'male' | 'female'. */
    gender: string;
    /** Strict play: permadeath (no reincarnation). */
    strict: boolean;
    /** A stable ship hull number for the "Ship Name" display line. */
    shipNumber?: number;
}

/** Loads the current pilot profile, if one has been created. */
export function loadPilotProfile(storage?: PrefsStorage):
    PilotProfile | undefined {
    return readJson<PilotProfile>(PILOT_PROFILE_KEY, storage);
}

/** Persists the current pilot profile. */
export function savePilotProfile(profile: PilotProfile,
    storage?: PrefsStorage): void {
    writeJson(PILOT_PROFILE_KEY, profile, storage);
}

/** Clears the current pilot profile (new-pilot/reset). */
export function clearPilotProfile(storage?: PrefsStorage): void {
    const store = getStorage(storage);
    if (!store) {
        return;
    }
    try {
        store.removeItem(PILOT_PROFILE_KEY);
    } catch {
        // Ignore.
    }
}
