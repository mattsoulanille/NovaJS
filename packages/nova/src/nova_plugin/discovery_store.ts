import { Resource } from 'nova_ecs/resource';
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
 *
 * WHO OWNS IT. A {@link DiscoveryStore} is one storage + one active save
 * key + the in-memory copy of that pilot's record. The client has exactly
 * one, {@link defaultDiscoveryStore}, over localStorage: its lifetime is
 * the page, NOT a game session, because the record is the pilot's and must
 * still answer after an exit to the title and a re-entry (the cache is a
 * memo of storage; only where there is no storage at all is it the record
 * itself). The display world is handed it as {@link DiscoveryStoreResource}
 * (display_plugin.ts), so a spec can give a world a throwaway store; the
 * spaceport and save paths reach the client's through the module functions
 * below, which are a thin layer over that one object. Under jasmine, where
 * the process is the client, spec_support/fresh_client_state.ts resets it
 * before every spec so no file has to.
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

/** The default (legacy single-slot) save key; see setSaveKey. */
const DEFAULT_SAVE_KEY = 'novajs:save';

/** Where the levels for `saveKey`'s pilot live. */
export function discoveryKeyFor(saveKey: string): string {
    return `${saveKey}:discovery`;
}

/**
 * The in-memory copy of one pilot's record, tagged with the storage key it
 * was read under so a pilot switch (setSaveKey) simply misses.
 */
interface CacheEntry {
    key: string;
    levels: Map<string, DiscoveryLevel>;
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

/**
 * One pilot record over one storage. Construct one per storage: two stores
 * over different storages never see each other's levels (a single
 * module-level cache keyed only by the storage key once let them, review
 * finding #78); two stores over the SAME storage are consistent through it,
 * the way two tabs are — a fresh store reads what the last one wrote, which
 * is exactly what a page reload does.
 *
 * With no storage (node, or a browser with localStorage disabled) the
 * in-memory record is the whole record: marks still cohere within the
 * process, and switching pilots starts that pilot from nothing.
 */
export class DiscoveryStore {
    private storageKey: string;
    private cache: CacheEntry | undefined;

    constructor(readonly storage?: DiscoveryStorage,
        saveKey: string = DEFAULT_SAVE_KEY) {
        this.storageKey = discoveryKeyFor(saveKey);
    }

    /**
     * Points the store at the pilot whose save key this is (the client's
     * store is driven by save_game's setActiveSaveKey, which pilot_registry
     * drives). The cache remembers the key it was read under, so the next
     * read after a switch loads that pilot's record.
     */
    setSaveKey(saveKey: string | null | undefined) {
        this.storageKey = discoveryKeyFor(saveKey || DEFAULT_SAVE_KEY);
    }

    /** Whether the store is pointed at the legacy single save slot. */
    private onLegacySlot(): boolean {
        return this.storageKey === discoveryKeyFor(DEFAULT_SAVE_KEY);
    }

    /**
     * The pre-discovery builds stored a flat array of explored system ids
     * under one client-global key. Those pilots HAD entered every system in
     * it, so each becomes level 1 ("visited"): the map keeps showing
     * everything it showed before, and landing again is what upgrades a
     * system to level 2.
     *
     * ONLY for the legacy save slot. That set was written when there was one
     * pilot per browser, and the legacy slot is the one that pilot's save
     * migrated into (save_game's SAVE_KEY); letting it seed a pilot created
     * later would hand every new pilot the first one's galaxy.
     */
    private migrateLegacy(store: DiscoveryStorage,
        into: Map<string, DiscoveryLevel>) {
        if (!this.onLegacySlot()) {
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

    private load(): Map<string, DiscoveryLevel> {
        if (this.cache && this.cache.key === this.storageKey) {
            return this.cache.levels;
        }
        const levels = new Map<string, DiscoveryLevel>();
        this.cache = { key: this.storageKey, levels };
        const store = this.storage;
        if (!store) {
            return levels;
        }
        let raw: string | null = null;
        try {
            raw = store.getItem(this.storageKey);
        } catch {
            return levels;
        }
        if (!parseEntries(raw, levels)) {
            this.migrateLegacy(store, levels);
        }
        return levels;
    }

    /** Writes `levels` (the record load() returned) out. */
    private persist(levels: Map<string, DiscoveryLevel>) {
        const store = this.storage;
        if (!store) {
            return;
        }
        try {
            store.setItem(this.storageKey, JSON.stringify([...levels]));
        } catch (e) {
            console.warn('Failed to persist system discovery:', e);
        }
    }

    /** How much the player knows about `systemId`. */
    level(systemId: string): DiscoveryLevel {
        return this.load().get(systemId) ?? DISCOVERY_UNKNOWN;
    }

    /**
     * Raises `systemId` to at least `level` and persists. Never lowers it —
     * a pilot who landed in a system does not forget its shipyard by flying
     * through again. Returns whether anything changed.
     */
    mark(systemId: string, level: DiscoveryLevel): boolean {
        const levels = this.load();
        if ((levels.get(systemId) ?? DISCOVERY_UNKNOWN) >= level) {
            return false;
        }
        levels.set(systemId, level);
        this.persist(levels);
        return true;
    }

    /** Raises every id in `systemIds` to at least `level`, persisting once. */
    markMany(systemIds: Iterable<string>, level: DiscoveryLevel): boolean {
        const levels = this.load();
        let changed = false;
        for (const id of systemIds) {
            if ((levels.get(id) ?? DISCOVERY_UNKNOWN) < level) {
                levels.set(id, level);
                changed = true;
            }
        }
        if (changed) {
            this.persist(levels);
        }
        return changed;
    }

    /** Every system the player has at least entered. */
    systems(): string[] {
        return [...this.load().keys()];
    }

    /** The save payload: `[systemId, level]` pairs, sorted for a stable save. */
    entries(): [string, number][] {
        return [...this.load()]
            .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
    }

    /**
     * Merges a save's discovery into the record (taking the higher level
     * for each system) and persists. Absent/empty leaves the record alone,
     * so a save written before this field existed reads through to whatever
     * the storage already holds.
     */
    merge(entries: readonly (readonly [string, number])[] | undefined) {
        if (!entries || entries.length === 0) {
            return;
        }
        const levels = this.load();
        let changed = false;
        for (const [id, raw] of entries) {
            const level = toDiscoveryLevel(raw);
            if (level > (levels.get(id) ?? DISCOVERY_UNKNOWN)) {
                levels.set(id, level);
                changed = true;
            }
        }
        if (changed) {
            this.persist(levels);
        }
    }

    /** Forgets everything — a new pilot starts undiscovered (see resetSave). */
    reset() {
        this.cache = undefined;
        const store = this.storage;
        try {
            store?.removeItem(this.storageKey);
            if (this.onLegacySlot()) {
                // On the legacy slot the old client-global set would migrate
                // itself straight back in on the next read. Other pilots
                // never read it (see migrateLegacy), so theirs must not
                // delete it.
                store?.removeItem(LEGACY_EXPLORED_KEY);
            }
        } catch {
            // Ignore.
        }
    }

    /**
     * This record as the NCB `Exxx` / `Xxxx` operators see it (discovery.ts's
     * DiscoveryAccess). This is the ONE binding between the store and the
     * expression evaluators: mission_logic and cron_logic take the
     * interface, never this module, so the pure logic stays free of a
     * per-client, browser-storage-backed record.
     *
     * NOT A WORKING COPY, unlike everything else a MissionSession edits. The
     * store IS the durable record — it writes through to storage on every
     * change and rides the pilot save — precisely so that learning a system
     * survives a crash between autosaves (see the module header). A set
     * string's `X130` is the same kind of event as flying into Sol, and
     * neither waits for a commit.
     */
    readonly access: DiscoveryAccess = {
        level: id => this.level(id),
        markVisited: id => {
            this.mark(id, DISCOVERY_ENTERED);
        },
    };
}

/**
 * The display world's handle on the pilot's record: what the star map, the
 * gate map and the navigation readout read, and what entering a system
 * marks. display_plugin.ts sets it to the client's store unless the world
 * already carries one (a spec's throwaway).
 */
export const DiscoveryStoreResource = new Resource<DiscoveryStore>('DiscoveryStore');

function defaultStorage(): DiscoveryStorage | undefined {
    try {
        return typeof localStorage !== 'undefined' ? localStorage : undefined;
    } catch {
        // Accessing localStorage can throw (e.g. disabled cookies).
        return undefined;
    }
}

let clientStore: DiscoveryStore | undefined;

/**
 * The client's one store, over localStorage where there is one. Built on
 * first use and kept for the life of the page (see the module header on
 * why that, and not the game session, is its lifetime).
 */
export function defaultDiscoveryStore(): DiscoveryStore {
    return clientStore ??= new DiscoveryStore(defaultStorage());
}

// ---------------------------------------------------------------------------
// The client's store, as functions. A thin layer over defaultDiscoveryStore()
// for the many call sites (browser.ts, save_game, the spaceport venues, the
// mission session) that have no world to look a resource up on. Every one
// of these is `defaultDiscoveryStore().<method>`; anything with its own
// storage constructs a DiscoveryStore instead.
// ---------------------------------------------------------------------------

/** Points the client's store at a pilot (save_game's setActiveSaveKey). */
export function setDiscoveryStorageKey(saveKey: string | null | undefined) {
    defaultDiscoveryStore().setSaveKey(saveKey);
}

/** How much the player knows about `systemId`. */
export function discoveryLevel(systemId: string): DiscoveryLevel {
    return defaultDiscoveryStore().level(systemId);
}

/** {@link DiscoveryStore.mark} on the client's store. */
export function markDiscovered(systemId: string,
    level: DiscoveryLevel): boolean {
    return defaultDiscoveryStore().mark(systemId, level);
}

/** {@link DiscoveryStore.markMany} on the client's store. */
export function markManyDiscovered(systemIds: Iterable<string>,
    level: DiscoveryLevel): boolean {
    return defaultDiscoveryStore().markMany(systemIds, level);
}

/** Every system the player has at least entered. */
export function discoveredSystems(): string[] {
    return defaultDiscoveryStore().systems();
}

/** The save payload (see {@link DiscoveryStore.entries}). */
export function discoveryEntries(): [string, number][] {
    return defaultDiscoveryStore().entries();
}

/** Merges a save's discovery into the client's store. */
export function loadDiscoveryEntries(
    entries: readonly (readonly [string, number])[] | undefined) {
    defaultDiscoveryStore().merge(entries);
}

/**
 * The active pilot's record for the NCB operators (see
 * {@link DiscoveryStore.access}), bound to the client's store.
 */
export const playerDiscovery: DiscoveryAccess = {
    level: id => defaultDiscoveryStore().level(id),
    markVisited: id => {
        defaultDiscoveryStore().mark(id, DISCOVERY_ENTERED);
    },
};

/** Forgets everything the client's store knows (a brand-new pilot). */
export function resetDiscovery() {
    defaultDiscoveryStore().reset();
}
