/**
 * The multi-pilot registry: named pilot files, each with its own save,
 * control bindings and game settings.
 *
 * The original game keeps one file per pilot in a `Pilots` folder and
 * opens them through the OS file dialog. A browser build has no such
 * folder, so the registry below plays that role in localStorage:
 *
 *   novajs:pilots                  the registry (this module)
 *   novajs:save                    the legacy single slot — still the
 *                                  save key of the migrated first pilot
 *   novajs:save:pilot-<id>         every pilot created after migration
 *
 * Migration is deliberately non-destructive: the pre-existing single
 * save is NOT copied or moved, it is simply adopted as the first pilot's
 * `saveKey`. Nothing rewrites `novajs:save`, so a build without this
 * registry still finds that pilot's game exactly where it left it.
 *
 * This module is client-only UI/config bookkeeping; it never touches sim
 * state. It sits beside save_game.ts, which owns the save payload codec
 * and the quarantine discipline that import validation reuses here.
 */

import { isLeft } from 'fp-ts/lib/Either.js';
import * as t from 'io-ts';
import {
    decodeSave, SaveEnvelope, SAVE_KEY, setActiveSaveKey,
} from '../nova_plugin/save_game.js';
import {
    ControlsOverride, GameSettingsOverride, loadControlsOverride,
    loadGameSettings, loadPilotProfile, PilotProfile, PrefsStorage,
    saveControlsOverride, saveGameSettings,
} from './client_prefs.js';

/** localStorage key: the pilot registry. */
export const PILOT_REGISTRY_KEY = 'novajs:pilots';
/** Where an unreadable registry is parked instead of being dropped. */
export const PILOT_REGISTRY_QUARANTINE_KEY = 'novajs:pilots:quarantine';
/**
 * Registry schema version. Bump only on a non-additive change; readable
 * range is [MIN_READABLE_REGISTRY_VERSION, PILOT_REGISTRY_VERSION].
 */
export const PILOT_REGISTRY_VERSION = 1;
export const MIN_READABLE_REGISTRY_VERSION = 1;

/**
 * Save-key prefix for pilots created through the registry. The legacy
 * pilot keeps the bare `novajs:save`. The `pilot-` infix guarantees a
 * generated key can never collide with `novajs:save:quarantine`.
 */
export const PILOT_SAVE_KEY_PREFIX = 'novajs:save:pilot-';

/** Marker + version for the export file format. */
export const PILOT_FILE_FORMAT = 'novajs-pilot';
export const PILOT_FILE_VERSION = 1;

const PilotProfileCodec = t.intersection([
    t.type({
        name: t.string,
        nickname: t.string,
        gender: t.string,
        strict: t.boolean,
    }),
    t.partial({ shipNumber: t.number }),
]);

/**
 * A stored control override: action -> the `event.code` it is bound to.
 *
 * The list form exists for displacement (client_prefs.bindControl): when
 * a key is taken from an action that owned several, the survivors are
 * written out, and one of them may be modifier-gated. It mirrors
 * controls.json's own grammar so the two stay interchangeable.
 *
 * Note this is only ever written when an action keeps 2+ keys, or a
 * modifier-gated key, after losing one — which the stock controls.json
 * cannot produce (its one multi-key rebindable action, fireSecondary,
 * has exactly two bare keys, so a single survivor stays a plain string).
 */
const ControlsOverrideCodec = t.record(t.string, t.union([
    t.string,
    t.array(t.union([
        t.string,
        t.intersection([
            t.type({ key: t.string }),
            t.partial({ modifiers: t.array(t.string) }),
        ]),
    ])),
]));

/** One pilot file: identity plus where its save lives. */
export const PilotRecord = t.intersection([
    t.type({
        /** Stable registry id (also used to build `saveKey`). */
        id: t.string,
        /** Display name, unique within the registry. */
        name: t.string,
        /** localStorage key holding this pilot's SaveEnvelope. */
        saveKey: t.string,
    }),
    t.partial({
        profile: PilotProfileCodec,
        /** Per-pilot control bindings (action -> event.code). */
        controls: ControlsOverrideCodec,
        /** Per-pilot game settings. */
        settings: t.record(t.string, t.union([t.boolean, t.string])),
        created: t.number,
        updated: t.number,
    }),
]);
export type PilotRecord = t.TypeOf<typeof PilotRecord>;

export const PilotRegistry = t.type({
    version: t.number,
    activeId: t.union([t.string, t.null]),
    pilots: t.array(PilotRecord),
});
export type PilotRegistry = t.TypeOf<typeof PilotRegistry>;

/** The on-disk shape of an exported pilot file. */
export const PilotFile = t.intersection([
    t.type({
        format: t.literal(PILOT_FILE_FORMAT),
        version: t.number,
        name: t.string,
    }),
    t.partial({
        profile: PilotProfileCodec,
        controls: ControlsOverrideCodec,
        settings: t.record(t.string, t.union([t.boolean, t.string])),
        /** The pilot's SaveEnvelope, or null for a pilot that never played. */
        save: t.union([SaveEnvelope, t.null]),
    }),
]);
export type PilotFile = t.TypeOf<typeof PilotFile>;

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

function emptyRegistry(): PilotRegistry {
    return { version: PILOT_REGISTRY_VERSION, activeId: null, pilots: [] };
}

/**
 * True when `novajs:save:pilot-<id>`'s slot already holds a save.
 *
 * A registry that was quarantined (or never written, after a failed
 * storage write) leaves saves behind that no record points at. Handing a
 * new pilot one of those ids would silently adopt a stranger's game —
 * and the callers that follow a mint with a reset or an import write
 * would then destroy it.
 */
function saveSlotOccupied(id: string, store?: PrefsStorage): boolean {
    if (!store) {
        return false;
    }
    try {
        return store.getItem(`${PILOT_SAVE_KEY_PREFIX}${id}`) != null;
    } catch {
        return false;
    }
}

/** A registry id that is stable, unique, and safe inside a storage key. */
function makePilotId(existing: readonly PilotRecord[],
    store?: PrefsStorage): string {
    const taken = new Set(existing.map(p => p.id));
    // Deterministic-enough for a client-local registry: time plus a
    // collision-avoiding counter. No Math.random (see determinism rules)
    // even though this never reaches the sim.
    const base = Date.now().toString(36);
    let id = base;
    let n = 1;
    while (taken.has(id) || saveSlotOccupied(id, store)) {
        id = `${base}-${n++}`;
    }
    return id;
}

/**
 * Makes `name` unique within `existing` by appending " (2)", " (3)", ...
 * Used by import so a colliding file is disambiguated, never silently
 * overwriting the pilot already in the registry.
 */
export function uniquePilotName(name: string,
    existing: readonly PilotRecord[]): string {
    const trimmed = name.trim() || 'Unnamed Pilot';
    const taken = new Set(existing.map(p => p.name));
    if (!taken.has(trimmed)) {
        return trimmed;
    }
    let n = 2;
    while (taken.has(`${trimmed} (${n})`)) {
        n++;
    }
    return `${trimmed} (${n})`;
}

/**
 * Builds the first-run registry from whatever single-slot data exists.
 *
 * The legacy save stays at `novajs:save`; the legacy controls/settings
 * overrides and pilot profile are folded into that pilot's record so a
 * player's existing bindings follow them rather than being lost.
 * Returns an empty registry when there is nothing to migrate.
 */
export function migrateLegacy(storage?: PrefsStorage): PilotRegistry {
    const store = getStorage(storage);
    const registry = emptyRegistry();
    if (!store) {
        return registry;
    }
    let legacySave: string | null = null;
    try {
        legacySave = store.getItem(SAVE_KEY);
    } catch {
        legacySave = null;
    }
    const profile = loadPilotProfile(storage);
    if (legacySave == null && !profile) {
        // Nothing to adopt: a genuinely fresh install.
        return registry;
    }
    const controls = loadControlsOverride(storage);
    const settings = loadGameSettings(storage);
    const now = Date.now();
    const record: PilotRecord = {
        id: makePilotId([]),
        name: profile?.name?.trim() || 'Pilot',
        // Deliberately the legacy key: adopt in place, never move.
        saveKey: SAVE_KEY,
        ...(profile ? { profile } : {}),
        ...(Object.keys(controls).length ? { controls } : {}),
        ...(Object.keys(settings).length
            ? { settings: settings as Record<string, boolean | string> } : {}),
        created: now,
        updated: now,
    };
    registry.pilots.push(record);
    registry.activeId = record.id;
    return registry;
}

/**
 * Loads the registry, migrating the legacy single slot on first run.
 *
 * An unreadable registry is parked at the quarantine key rather than
 * dropped, matching save_game's discipline, and this build then falls
 * back to migration so the player still reaches their legacy save.
 */
export function loadRegistry(storage?: PrefsStorage): PilotRegistry {
    const store = getStorage(storage);
    if (!store) {
        return emptyRegistry();
    }
    let raw: string | null;
    try {
        raw = store.getItem(PILOT_REGISTRY_KEY);
    } catch {
        return emptyRegistry();
    }
    if (raw == null) {
        const migrated = migrateLegacy(storage);
        if (migrated.pilots.length > 0) {
            saveRegistry(migrated, storage);
        }
        return migrated;
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        return quarantineRegistry(raw, store, storage);
    }
    const decoded = PilotRegistry.decode(parsed);
    if (isLeft(decoded)) {
        return quarantineRegistry(raw, store, storage);
    }
    const { version } = decoded.right;
    if (version < MIN_READABLE_REGISTRY_VERSION
        || version > PILOT_REGISTRY_VERSION) {
        return quarantineRegistry(raw, store, storage);
    }
    return decoded.right;
}

function quarantineRegistry(raw: string, store: PrefsStorage,
    storage?: PrefsStorage): PilotRegistry {
    try {
        store.setItem(PILOT_REGISTRY_QUARANTINE_KEY, raw);
        store.removeItem(PILOT_REGISTRY_KEY);
    } catch {
        // Best effort.
    }
    console.warn('Ignoring an unreadable pilot registry (moved to '
        + `'${PILOT_REGISTRY_QUARANTINE_KEY}').`);
    const migrated = migrateLegacy(storage);
    if (migrated.pilots.length > 0) {
        saveRegistry(migrated, storage);
    }
    return migrated;
}

/** Persists the registry. Never throws. */
export function saveRegistry(registry: PilotRegistry,
    storage?: PrefsStorage): void {
    const store = getStorage(storage);
    if (!store) {
        return;
    }
    try {
        store.setItem(PILOT_REGISTRY_KEY,
            JSON.stringify(PilotRegistry.encode(registry)));
    } catch (e) {
        console.warn('Failed to write the pilot registry', e);
    }
}

/** Every pilot in the registry, in creation order. */
export function listPilots(storage?: PrefsStorage): PilotRecord[] {
    return loadRegistry(storage).pilots;
}

/** The active pilot, or undefined when none is selected. */
export function getActivePilot(storage?: PrefsStorage):
    PilotRecord | undefined {
    const registry = loadRegistry(storage);
    return registry.pilots.find(p => p.id === registry.activeId);
}

/**
 * Selects a pilot and points the save layer at its key. Returns the
 * selected record, or undefined when the id is unknown.
 */
export function selectPilot(id: string, storage?: PrefsStorage):
    PilotRecord | undefined {
    const registry = loadRegistry(storage);
    const found = registry.pilots.find(p => p.id === id);
    if (!found) {
        return undefined;
    }
    registry.activeId = id;
    saveRegistry(registry, storage);
    setActiveSaveKey(found.saveKey);
    return found;
}

/**
 * Points the save layer at whichever pilot is active. Call once at
 * startup, before anything reads the save.
 */
export function applyActivePilot(storage?: PrefsStorage):
    PilotRecord | undefined {
    const active = getActivePilot(storage);
    setActiveSaveKey(active ? active.saveKey : SAVE_KEY);
    return active;
}

/**
 * Creates a pilot from a New Pilot profile and makes it active. Its name
 * is disambiguated against the existing pilots. A fresh pilot carries no
 * `controls`, so it starts from the served controls.json defaults.
 */
export function createPilot(profile: PilotProfile, storage?: PrefsStorage):
    PilotRecord {
    const registry = loadRegistry(storage);
    const id = makePilotId(registry.pilots, getStorage(storage));
    const now = Date.now();
    const record: PilotRecord = {
        id,
        name: uniquePilotName(profile.name, registry.pilots),
        saveKey: `${PILOT_SAVE_KEY_PREFIX}${id}`,
        profile,
        created: now,
        updated: now,
    };
    registry.pilots.push(record);
    registry.activeId = id;
    saveRegistry(registry, storage);
    setActiveSaveKey(record.saveKey);
    return record;
}

/**
 * Deletes a pilot and its save data. If it was active, the first
 * remaining pilot becomes active (or none).
 */
export function deletePilot(id: string, storage?: PrefsStorage): void {
    const store = getStorage(storage);
    const registry = loadRegistry(storage);
    const found = registry.pilots.find(p => p.id === id);
    if (!found) {
        return;
    }
    registry.pilots = registry.pilots.filter(p => p.id !== id);
    if (registry.activeId === id) {
        registry.activeId = registry.pilots[0]?.id ?? null;
    }
    saveRegistry(registry, storage);
    if (store) {
        try {
            store.removeItem(found.saveKey);
        } catch {
            // Best effort.
        }
    }
    applyActivePilot(storage);
}

/** Applies a patch to one pilot record. */
export function updatePilot(id: string, patch: Partial<PilotRecord>,
    storage?: PrefsStorage): void {
    const registry = loadRegistry(storage);
    const index = registry.pilots.findIndex(p => p.id === id);
    if (index < 0) {
        return;
    }
    registry.pilots[index] = {
        ...registry.pilots[index], ...patch, updated: Date.now(),
    };
    saveRegistry(registry, storage);
}

// ---------------------------------------------------------------------------
// Per-pilot controls and settings.
// ---------------------------------------------------------------------------

/**
 * The active pilot's control overrides. Falls back to the legacy global
 * key when no pilot is selected yet, so the Preferences dialog still
 * works before a pilot exists.
 */
export function loadPilotControls(storage?: PrefsStorage): ControlsOverride {
    const active = getActivePilot(storage);
    if (!active) {
        return loadControlsOverride(storage);
    }
    return { ...(active.controls ?? {}) };
}

/** Persists control overrides onto the active pilot. */
export function savePilotControls(controls: ControlsOverride,
    storage?: PrefsStorage): void {
    const active = getActivePilot(storage);
    if (!active) {
        // No pilot yet: keep the legacy global slot so the choice is not
        // lost; the next created/migrated pilot picks it up.
        saveControlsOverride(controls, storage);
        return;
    }
    updatePilot(active.id, { controls: { ...controls } }, storage);
}

/** The active pilot's game settings, falling back to the legacy slot. */
export function loadPilotSettings(storage?: PrefsStorage):
    GameSettingsOverride {
    const active = getActivePilot(storage);
    if (!active) {
        return loadGameSettings(storage);
    }
    return { ...(active.settings ?? {}) } as GameSettingsOverride;
}

/** Persists game settings onto the active pilot. */
export function savePilotSettings(settings: GameSettingsOverride,
    storage?: PrefsStorage): void {
    const active = getActivePilot(storage);
    if (!active) {
        saveGameSettings(settings, storage);
        return;
    }
    updatePilot(active.id,
        { settings: { ...settings } as Record<string, boolean | string> },
        storage);
}

// ---------------------------------------------------------------------------
// Import / export.
// ---------------------------------------------------------------------------

/**
 * Serializes a pilot to the JSON text of an export file. Returns
 * undefined for an unknown id. The save envelope rides along verbatim —
 * escort blobs included — so a round trip is byte-identical.
 */
export function exportPilot(id: string, storage?: PrefsStorage):
    string | undefined {
    const store = getStorage(storage);
    const registry = loadRegistry(storage);
    const record = registry.pilots.find(p => p.id === id);
    if (!record) {
        return undefined;
    }
    let save: unknown = null;
    if (store) {
        let raw: string | null = null;
        try {
            raw = store.getItem(record.saveKey);
        } catch {
            raw = null;
        }
        if (raw != null) {
            try {
                save = JSON.parse(raw);
            } catch {
                save = null;
            }
        }
    }
    const file: PilotFile = {
        format: PILOT_FILE_FORMAT,
        version: PILOT_FILE_VERSION,
        name: record.name,
        ...(record.profile ? { profile: record.profile } : {}),
        ...(record.controls ? { controls: record.controls } : {}),
        ...(record.settings ? { settings: record.settings } : {}),
        ...(save ? { save: save as PilotFile['save'] } : {}),
    };
    return JSON.stringify(file, null, 2);
}

/** A filesystem-safe filename for an exported pilot. */
export function exportFileName(name: string): string {
    const safe = name.trim().replace(/[^A-Za-z0-9 _-]+/g, '').trim()
        .replace(/\s+/g, '_');
    // The original game's pilot-file extension; the payload is JSON, and
    // import validates by CONTENT, so older .novapilot.json exports keep
    // importing (the picker accepts both).
    return `${safe || 'pilot'}.plt`;
}

export type ImportResult =
    | { ok: true; pilot: PilotRecord; renamed: boolean }
    | { ok: false; reason: string };

/**
 * Validates and adds an exported pilot file.
 *
 * The embedded save goes through save_game's own `decodeSave`, so the
 * version range and shape rules are exactly the ones the live save path
 * enforces. An undecodable save is REFUSED — nothing is written — rather
 * than imported and quarantined later. A name that collides with an
 * existing pilot is disambiguated, never overwritten.
 */
export function importPilot(text: string, storage?: PrefsStorage):
    ImportResult {
    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    } catch {
        return { ok: false, reason: 'That file is not valid JSON.' };
    }
    const decoded = PilotFile.decode(parsed);
    if (isLeft(decoded)) {
        return { ok: false, reason: 'That file is not a NovaJS pilot file.' };
    }
    const file = decoded.right;
    if (file.version < 1 || file.version > PILOT_FILE_VERSION) {
        return {
            ok: false,
            reason: `Pilot file version ${file.version} is not supported by `
                + `this build (expected 1 to ${PILOT_FILE_VERSION}).`,
        };
    }
    // Validate the payload through the live save path before writing —
    // from the RAW parsed JSON, not the io-ts-decoded `file.save`: the
    // codec turns Map/Set-typed fields (missions, cargo, control bits)
    // into live Maps, which JSON.stringify to "{}", so re-encoding the
    // decoded object made every pilot that had ever played unreadable.
    let saveText: string | undefined;
    const rawSave = (parsed as { save?: unknown }).save;
    if (file.save && rawSave) {
        saveText = JSON.stringify(rawSave);
        if (decodeSave(saveText) === undefined) {
            return {
                ok: false,
                reason: 'That pilot\'s saved game could not be read by this '
                    + 'build, so it was not imported.',
            };
        }
    }

    const store = getStorage(storage);
    const registry = loadRegistry(storage);
    const id = makePilotId(registry.pilots, store);
    const requested = file.name.trim() || 'Unnamed Pilot';
    const name = uniquePilotName(requested, registry.pilots);
    const now = Date.now();
    const record: PilotRecord = {
        id,
        name,
        saveKey: `${PILOT_SAVE_KEY_PREFIX}${id}`,
        ...(file.profile ? { profile: file.profile } : {}),
        ...(file.controls ? { controls: file.controls } : {}),
        ...(file.settings ? { settings: file.settings } : {}),
        created: now,
        updated: now,
    };
    if (saveText !== undefined && store) {
        try {
            store.setItem(record.saveKey, saveText);
        } catch (e) {
            return { ok: false, reason: 'Could not write the imported save.' };
        }
    }
    registry.pilots.push(record);
    saveRegistry(registry, storage);
    return { ok: true, pilot: record, renamed: name !== requested };
}
