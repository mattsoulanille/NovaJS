import 'jasmine';
import {
    DISCOVERY_ENTERED, DISCOVERY_LANDED, DISCOVERY_UNKNOWN,
} from './discovery.js';
import {
    discoveredSystems, discoveryEntries, discoveryKeyFor, discoveryLevel,
    DiscoveryStorage, LEGACY_EXPLORED_KEY, loadDiscoveryEntries,
    markDiscovered, markManyDiscovered, resetDiscovery, resetDiscoveryCache,
    setDiscoveryStorageKey,
} from './discovery_store.js';

class FakeStorage implements DiscoveryStorage {
    readonly items = new Map<string, string>();
    getItem(key: string) { return this.items.get(key) ?? null; }
    setItem(key: string, value: string) { this.items.set(key, value); }
    removeItem(key: string) { this.items.delete(key); }
}

const LEGACY_KEY = 'novajs:save';
const OTHER_PILOT_KEY = 'novajs:save:pilot2';

describe('the discovery store', () => {
    let storage: FakeStorage;

    beforeEach(() => {
        // A fresh storage per spec: the store caches PER STORAGE INSTANCE
        // (and per key), so a new FakeStorage starts from an empty record
        // whatever an earlier spec — or another spec file — wrote.
        storage = new FakeStorage();
        setDiscoveryStorageKey(LEGACY_KEY);
        resetDiscovery(storage);
    });

    afterEach(() => {
        setDiscoveryStorageKey(LEGACY_KEY);
        resetDiscovery(storage);
    });

    it('starts out knowing nothing', () => {
        expect(discoveryLevel('nova:130', storage)).toBe(DISCOVERY_UNKNOWN);
        expect(discoveredSystems(storage)).toEqual([]);
    });

    it('records entering and then landing in a system', () => {
        expect(markDiscovered('nova:130', DISCOVERY_ENTERED, storage)).toBeTrue();
        expect(discoveryLevel('nova:130', storage)).toBe(DISCOVERY_ENTERED);
        expect(markDiscovered('nova:130', DISCOVERY_LANDED, storage)).toBeTrue();
        expect(discoveryLevel('nova:130', storage)).toBe(DISCOVERY_LANDED);
    });

    it('never lowers a level', () => {
        markDiscovered('nova:130', DISCOVERY_LANDED, storage);
        // Flying back through a system you have landed in must not make
        // the map forget its shipyard.
        expect(markDiscovered('nova:130', DISCOVERY_ENTERED, storage))
            .toBeFalse();
        expect(discoveryLevel('nova:130', storage)).toBe(DISCOVERY_LANDED);
    });

    it('raises a batch at once (a map outfit\'s reach)', () => {
        markDiscovered('nova:131', DISCOVERY_LANDED, storage);
        expect(markManyDiscovered(['nova:130', 'nova:131', 'nova:132'],
            DISCOVERY_LANDED, storage)).toBeTrue();
        expect(discoveryLevel('nova:130', storage)).toBe(DISCOVERY_LANDED);
        expect(discoveryLevel('nova:132', storage)).toBe(DISCOVERY_LANDED);
        // Nothing left to raise the second time round.
        expect(markManyDiscovered(['nova:130', 'nova:131'],
            DISCOVERY_LANDED, storage)).toBeFalse();
    });

    it('persists the instant something changes', () => {
        markDiscovered('nova:130', DISCOVERY_ENTERED, storage);
        // Written straight through, without waiting for a save: entering a
        // system has to survive a crash before the next autosave.
        const raw = storage.getItem(discoveryKeyFor(LEGACY_KEY));
        expect(raw).not.toBeNull();
        expect(JSON.parse(raw!)).toEqual([['nova:130', DISCOVERY_ENTERED]]);
    });

    it('reloads what it wrote', () => {
        markDiscovered('nova:130', DISCOVERY_LANDED, storage);
        markDiscovered('nova:131', DISCOVERY_ENTERED, storage);
        // Drop the in-memory cache without clearing storage, the way a
        // page reload would.
        resetDiscoveryCache(storage);
        expect(discoveryLevel('nova:130', storage)).toBe(DISCOVERY_LANDED);
        expect(discoveryLevel('nova:131', storage)).toBe(DISCOVERY_ENTERED);
    });

    it('keeps each storage\'s record apart under the same key', () => {
        // Every call takes its storage explicitly, but the memoised
        // record used to be one module-level map per KEY, so a second
        // storage under the same key read the first one's levels — and
        // specs had to toggle the key back and forth to flush it (review
        // finding #78).
        const other = new FakeStorage();
        markDiscovered('nova:130', DISCOVERY_LANDED, storage);
        expect(discoveryLevel('nova:130', other)).toBe(DISCOVERY_UNKNOWN);
        markDiscovered('nova:200', DISCOVERY_ENTERED, other);
        expect(discoveryLevel('nova:200', storage)).toBe(DISCOVERY_UNKNOWN);
        expect(discoveryLevel('nova:130', storage)).toBe(DISCOVERY_LANDED);
        expect(other.getItem(discoveryKeyFor(LEGACY_KEY)))
            .toBe(JSON.stringify([['nova:200', DISCOVERY_ENTERED]]));
    });

    it('keeps each pilot\'s knowledge to themselves', () => {
        markDiscovered('nova:130', DISCOVERY_LANDED, storage);
        setDiscoveryStorageKey(OTHER_PILOT_KEY);
        expect(discoveryLevel('nova:130', storage)).toBe(DISCOVERY_UNKNOWN);
        markDiscovered('nova:200', DISCOVERY_ENTERED, storage);
        setDiscoveryStorageKey(LEGACY_KEY);
        expect(discoveryLevel('nova:200', storage)).toBe(DISCOVERY_UNKNOWN);
        expect(discoveryLevel('nova:130', storage)).toBe(DISCOVERY_LANDED);
    });

    describe('legacy `novajs:explored` migration', () => {
        it('adopts a pre-discovery pilot\'s explored set as "entered"', () => {
            storage.setItem(LEGACY_EXPLORED_KEY,
                JSON.stringify(['nova:130', 'nova:131']));
            resetDiscoveryCache(storage);
            expect(discoveryLevel('nova:130', storage)).toBe(DISCOVERY_ENTERED);
            expect(discoveryLevel('nova:131', storage)).toBe(DISCOVERY_ENTERED);
        });

        it('does not hand the old set to a pilot created later', () => {
            // The legacy key was client-GLOBAL. Only the legacy save slot
            // — the pilot that set migrated from — may inherit it.
            storage.setItem(LEGACY_EXPLORED_KEY, JSON.stringify(['nova:130']));
            setDiscoveryStorageKey(OTHER_PILOT_KEY);
            expect(discoveryLevel('nova:130', storage)).toBe(DISCOVERY_UNKNOWN);
        });

        it('stops consulting it once the pilot has a record of their own', () => {
            // Migration is a one-time seed for a slot that has never
            // written discovery: once it has, the old set is stale and
            // must not resurrect systems the pilot has since forgotten
            // (a reset, a rollback to a fresh start).
            markDiscovered('nova:131', DISCOVERY_ENTERED, storage);
            storage.setItem(LEGACY_EXPLORED_KEY, JSON.stringify(['nova:130']));
            resetDiscoveryCache(storage);
            expect(discoveryLevel('nova:131', storage)).toBe(DISCOVERY_ENTERED);
            expect(discoveryLevel('nova:130', storage)).toBe(DISCOVERY_UNKNOWN);
        });
    });

    describe('the save round trip', () => {
        it('writes sorted [id, level] pairs', () => {
            markDiscovered('nova:131', DISCOVERY_ENTERED, storage);
            markDiscovered('nova:130', DISCOVERY_LANDED, storage);
            expect(discoveryEntries(storage)).toEqual([
                ['nova:130', DISCOVERY_LANDED],
                ['nova:131', DISCOVERY_ENTERED],
            ]);
        });

        it('merges a loaded save instead of replacing the record', () => {
            markDiscovered('nova:130', DISCOVERY_LANDED, storage);
            loadDiscoveryEntries([['nova:130', 1], ['nova:131', 2]], storage);
            // Restoring an older checkpoint must not un-learn nova:130.
            expect(discoveryLevel('nova:130', storage)).toBe(DISCOVERY_LANDED);
            expect(discoveryLevel('nova:131', storage)).toBe(DISCOVERY_LANDED);
        });

        it('leaves the record alone for a save with no discovery field', () => {
            markDiscovered('nova:130', DISCOVERY_ENTERED, storage);
            loadDiscoveryEntries(undefined, storage);
            expect(discoveryLevel('nova:130', storage)).toBe(DISCOVERY_ENTERED);
        });

        it('clamps a corrupt level rather than trusting it', () => {
            loadDiscoveryEntries([['nova:130', 99], ['nova:131', -3]], storage);
            expect(discoveryLevel('nova:130', storage)).toBe(DISCOVERY_LANDED);
            expect(discoveryLevel('nova:131', storage)).toBe(DISCOVERY_UNKNOWN);
        });
    });

    it('survives unreadable stored data', () => {
        storage.setItem(discoveryKeyFor(LEGACY_KEY), 'not json');
        resetDiscoveryCache(storage);
        expect(discoveryLevel('nova:130', storage)).toBe(DISCOVERY_UNKNOWN);
    });

    it('forgets everything on reset (a brand-new pilot)', () => {
        storage.setItem(LEGACY_EXPLORED_KEY, JSON.stringify(['nova:130']));
        markDiscovered('nova:131', DISCOVERY_LANDED, storage);
        resetDiscovery(storage);
        expect(discoveredSystems(storage)).toEqual([]);
        // The legacy set would otherwise migrate itself straight back in.
        expect(storage.getItem(LEGACY_EXPLORED_KEY)).toBeNull();
    });
});
