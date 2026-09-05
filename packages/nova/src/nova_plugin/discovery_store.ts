import {
    DISCOVERY_ENTERED, DISCOVERY_UNKNOWN, DiscoveryAccess, DiscoveryLevel,
    toDiscoveryLevel,
} from './discovery.js';

/**
 * The player's per-system knowledge (see discovery.ts for the three levels
 * and the evidence behind them).
 *
 * DELIBERATELY NOT SIMULATION STATE. Discovery only drives player-local UI —
 * which dots the star map draws, and how much of the info panel is filled
 * in — so it stays out of the synced component set entirely, exactly as the
 * explored set it replaces did. Nothing here is read by the simulation.
 *
 * WHERE IT LIVES. Two places, on purpose:
 *
 *  - localStorage, under `<active save key>:discovery`, written the instant
 *    anything changes. Entering a system has to survive a browser crash
 *    between the ~10s autosaves, which is why the store keeps its own key
 *    rather than waiting for the save. Keyed off the ACTIVE save key, so
 *    each pilot has their own record (the old `novajs:explored` key was
 *    client-global — one shared map for every pilot).
 *  - the pilot save itself (`SaveData.discovery`, additive/optional), so a
 *    save is a complete pilot: exporting, importing an original .plt, and
 *    restoring a rollback checkpoint all carry discovery with them.
 *
 * Levels only ever RISE (raise, never lower): knowledge is not lost by
 * loading an older checkpoint, and merging a save into the live store takes
 * the max of the two.
 */

/**
 * A minimal storage surface so this module is testable without a browser.
 * `localStorage` satisfies it. Structurally identical to save_game.ts's
 * SaveStorage; declared here so nothing in this module imports save_game
 * (save_game imports THIS, for the save round-trip).
 */
export interface DiscoveryStorage {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
}

/** The single client-global key the pre-discovery builds wrote. */
export const LEGACY_EXPLORED_KEY = 'novajs:explored';

/** The default (legacy single-slot) save key; see setDiscoveryStorageKey. */
const DEFAULT_SAVE_KEY = 'novajs:save';

/** Where the levels for `saveKey`'s pilot live. */
export function discoveryKeyFor(saveKey: string): string {
    return `${saveKey}:discovery`;
}

let storageKey = discoveryKeyFor(DEFAULT_SAVE_KEY);

/**
 * The in-memory copy of one storage's record, tagged with the key it was
 * read under so a pilot switch (setDiscoveryStorageKey) simply misses.
 */
interface CacheEntry {
    key: string;
    levels: Map<string, DiscoveryLevel>;
}

/**
 * One cache PER STORAGE INSTANCE, not one global cache per key. Every
 * read/write takes an optional `storage` (localStorage by default, an
 * in-memory fake in specs); a single module-level cache keyed only by the
 * storage key let two callers with different storages under the same key
 * see each other's levels — which is why the specs used to toggle the key
 * back and forth just to flush it (review finding #78). Weakly held, so a
 * spec's throwaway storage doesn't pin its record forever.
 */
const caches = new WeakMap<DiscoveryStorage, CacheEntry>();
/** The record when there is no storage at all (node without localStorage
 * and no explicit storage): still memoised so marks within one process
 * cohere, exactly as before. */
let storelessCache: CacheEntry | undefined;

/**
 * Points the store at the pilot whose save key this is (called by
 * save_game's setActiveSaveKey, which pilot_registry drives). Each cache
 * entry remembers the key it was read under, so the next read after a
 * switch reloads that pilot's record.
 */
export function setDiscoveryStorageKey(saveKey: string | null | undefined) {
    storageKey = discoveryKeyFor(saveKey || DEFAULT_SAVE_KEY);
}

/**
 * Drops the in-memory copy of `storage`'s record WITHOUT touching what is
 * stored — the next read loads it again, the way a page reload would. For
 * specs (resetDiscovery also deletes the stored record, so it can't play
 * this role).
 */
export function resetDiscoveryCache(storage?: DiscoveryStorage) {
    const store = storage ?? defaultStorage();
    if (store) {
        caches.delete(store);
    } else {
        storelessCache = undefined;
    }
}

function defaultStorage(): DiscoveryStorage | undefined {
    try {
        return typeof localStorage !== 'undefined' ? localStorage : undefined;
    } catch {
        // Accessing localStorage can throw (e.g. disabled cookies).
        return undefined;
    }
}

function parseEntries(raw: string | null,
    into: Map<string, DiscoveryLevel>): boolean {
    if (!raw) {
        return false;
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch (e) {
        console.warn('Failed to load system discovery:', e);
        return false;
    }
    if (!Array.isArray(parsed)) {
        return false;
    }
    for (const entry of parsed) {
        if (!Array.isArray(entry) || typeof entry[0] !== 'string') {
            continue;
        }
        const level = toDiscoveryLevel(entry[1]);
        if (level > (into.get(entry[0]) ?? DISCOVERY_UNKNOWN)) {
            into.set(entry[0], level);
        }
    }
    return true;
}

/** Whether the store is pointed at the legacy single save slot. */
function onLegacySlot(): boolean {
    return storageKey === discoveryKeyFor(DEFAULT_SAVE_KEY);
}

/**
 * The pre-discovery builds stored a flat array of explored system ids under
 * one client-global key. Those pilots HAD entered every system in it, so
 * each becomes level 1 ("visited"): the map keeps showing everything it
 * showed before, and landing again is what upgrades a system to level 2.
 *
 * ONLY for the legacy save slot. That set was written when there was one
 * pilot per browser, and the legacy slot is the one that pilot's save
 * migrated into (save_game's SAVE_KEY); letting it seed a pilot created
 * later would hand every new pilot the first one's galaxy.
 */
function migrateLegacy(store: DiscoveryStorage,
    into: Map<string, DiscoveryLevel>) {
    if (!onLegacySlot()) {
        return;
    }
    let raw: string | null;
    try {
        raw = store.getItem(LEGACY_EXPLORED_KEY);
    } catch {
        return;
    }
    if (!raw) {
        return;
    }
    try {
        const parsed: unknown = JSON.parse(raw);
        if (!Array.isArray(parsed)) {
            return;
        }
        for (const id of parsed) {
            if (typeof id === 'string' && !into.has(id)) {
                into.set(id, DISCOVERY_ENTERED);
            }
        }
    } catch (e) {
        console.warn('Failed to migrate the explored systems:', e);
    }
}

function load(storage?: DiscoveryStorage): Map<string, DiscoveryLevel> {
    const store = storage ?? defaultStorage();
    const cached = store ? caches.get(store) : storelessCache;
    if (cached && cached.key === storageKey) {
        return cached.levels;
    }
    const levels = new Map<string, DiscoveryLevel>();
    const entry = { key: storageKey, levels };
    if (store) {
        caches.set(store, entry);
    } else {
        storelessCache = entry;
        return levels;
    }
    let raw: string | null = null;
    try {
        raw = store.getItem(storageKey);
    } catch {
        return levels;
    }
    if (!parseEntries(raw, levels)) {
        migrateLegacy(store, levels);
    }
    return levels;
}

/** Writes `levels` (the record load() returned for this storage) out. */
function persist(levels: Map<string, DiscoveryLevel>,
    storage?: DiscoveryStorage) {
    const store = storage ?? defaultStorage();
    if (!store) {
        return;
    }
    try {
        store.setItem(storageKey, JSON.stringify([...levels]));
    } catch (e) {
        console.warn('Failed to persist system discovery:', e);
    }
}

/** How much the player knows about `systemId`. */
export function discoveryLevel(systemId: string,
    storage?: DiscoveryStorage): DiscoveryLevel {
    return load(storage).get(systemId) ?? DISCOVERY_UNKNOWN;
}

/**
 * Raises `systemId` to at least `level` and persists. Never lowers it —
 * a pilot who landed in a system does not forget its shipyard by flying
 * through again. Returns whether anything changed.
 */
export function markDiscovered(systemId: string, level: DiscoveryLevel,
    storage?: DiscoveryStorage): boolean {
    const levels = load(storage);
    if ((levels.get(systemId) ?? DISCOVERY_UNKNOWN) >= level) {
        return false;
    }
    levels.set(systemId, level);
    persist(levels, storage);
    return true;
}

/** Raises every id in `systemIds` to at least `level`, persisting once. */
export function markManyDiscovered(systemIds: Iterable<string>,
    level: DiscoveryLevel, storage?: DiscoveryStorage): boolean {
    const levels = load(storage);
    let changed = false;
    for (const id of systemIds) {
        if ((levels.get(id) ?? DISCOVERY_UNKNOWN) < level) {
            levels.set(id, level);
            changed = true;
        }
    }
    if (changed) {
        persist(levels, storage);
    }
    return changed;
}

/** Every system the player has at least entered. */
export function discoveredSystems(storage?: DiscoveryStorage): string[] {
    return [...load(storage).keys()];
}

/** The save payload: `[systemId, level]` pairs, sorted for a stable save. */
export function discoveryEntries(
    storage?: DiscoveryStorage): [string, number][] {
    return [...load(storage)]
        .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
}

/**
 * Merges a save's discovery into the live store (taking the higher level
 * for each system) and persists. Absent/empty leaves the store alone, so a
 * save written before this field existed reads through to whatever the
 * localStorage record already holds.
 */
export function loadDiscoveryEntries(
    entries: readonly (readonly [string, number])[] | undefined,
    storage?: DiscoveryStorage) {
    if (!entries || entries.length === 0) {
        return;
    }
    const levels = load(storage);
    let changed = false;
    for (const [id, raw] of entries) {
        const level = toDiscoveryLevel(raw);
        if (level > (levels.get(id) ?? DISCOVERY_UNKNOWN)) {
            levels.set(id, level);
            changed = true;
        }
    }
    if (changed) {
        persist(levels, storage);
    }
}

/**
 * The active pilot's record as the NCB `Exxx` / `Xxxx` operators see it
 * (discovery.ts's DiscoveryAccess). This is the ONE binding between the
 * store and the expression evaluators: mission_logic and cron_logic take
 * the interface, never this module, so the pure logic stays free of a
 * per-client, browser-storage-backed record.
 *
 * NOT A WORKING COPY, unlike everything else a MissionSession edits. The
 * store IS the durable record — it writes through to localStorage on every
 * change and rides the pilot save — precisely so that learning a system
 * survives a crash between autosaves (see the module header). A set
 * string's `X130` is the same kind of event as flying into Sol, and
 * neither waits for a commit.
 */
export const playerDiscovery: DiscoveryAccess = {
    level: id => discoveryLevel(id),
    markVisited: id => {
        markDiscovered(id, DISCOVERY_ENTERED);
    },
};

/** Forgets everything — a new pilot starts undiscovered (see resetSave). */
export function resetDiscovery(storage?: DiscoveryStorage) {
    resetDiscoveryCache(storage);
    const store = storage ?? defaultStorage();
    try {
        store?.removeItem(storageKey);
        if (onLegacySlot()) {
            // On the legacy slot the old client-global set would migrate
            // itself straight back in on the next read. Other pilots never
            // read it (see migrateLegacy), so theirs must not delete it.
            store?.removeItem(LEGACY_EXPLORED_KEY);
        }
    } catch {
        // Ignore.
    }
}
