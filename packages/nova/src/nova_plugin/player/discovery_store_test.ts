import 'jasmine';
import {
    DISCOVERY_ENTERED, DISCOVERY_LANDED, DISCOVERY_UNKNOWN,
} from './discovery.js';
import {
    defaultDiscoveryStore, DISCOVERY_MIGRATIONS, DISCOVERY_VERSION,
    discoveryEntries, discoveryKeyFor, discoveryLevel, DiscoveryStorage,
    DiscoveryStore, FIRST_DISCOVERY_VERSION, LEGACY_EXPLORED_KEY,
    markDiscovered, playerDiscovery, resetDiscovery, setDiscoveryStorageKey,
} from './discovery_store.js';

class FakeStorage implements DiscoveryStorage {
    readonly items = new Map<string, string>();
    getItem(key: string) { return this.items.get(key) ?? null; }
    setItem(key: string, value: string) { this.items.set(key, value); }
    removeItem(key: string) { this.items.delete(key); }
}

const LEGACY_KEY = 'novajs:save';
const OTHER_PILOT_KEY = 'novajs:save:pilot2';

/** The bytes this build writes for `entries`. */
function stored(entries: [string, number][]): string {
    return JSON.stringify({ version: DISCOVERY_VERSION, entries });
}

describe('the discovery store', () => {
    let storage: FakeStorage;
    let store: DiscoveryStore;

    beforeEach(() => {
        // A store of the spec's own, over a fresh storage: nothing an
        // earlier spec — or another spec file — did can reach it.
        storage = new FakeStorage();
        store = new DiscoveryStore(storage);
    });

    it('starts out knowing nothing', () => {
        expect(store.level('nova:130')).toBe(DISCOVERY_UNKNOWN);
        expect(store.systems()).toEqual([]);
    });

    it('records entering and then landing in a system', () => {
        expect(store.mark('nova:130', DISCOVERY_ENTERED)).toBeTrue();
        expect(store.level('nova:130')).toBe(DISCOVERY_ENTERED);
        expect(store.mark('nova:130', DISCOVERY_LANDED)).toBeTrue();
        expect(store.level('nova:130')).toBe(DISCOVERY_LANDED);
    });

    it('never lowers a level', () => {
        store.mark('nova:130', DISCOVERY_LANDED);
        // Flying back through a system you have landed in must not make
        // the map forget its shipyard.
        expect(store.mark('nova:130', DISCOVERY_ENTERED)).toBeFalse();
        expect(store.level('nova:130')).toBe(DISCOVERY_LANDED);
    });

    it('raises a batch at once (a map outfit\'s reach)', () => {
        store.mark('nova:131', DISCOVERY_LANDED);
        expect(store.markMany(['nova:130', 'nova:131', 'nova:132'],
            DISCOVERY_LANDED)).toBeTrue();
        expect(store.level('nova:130')).toBe(DISCOVERY_LANDED);
        expect(store.level('nova:132')).toBe(DISCOVERY_LANDED);
        // Nothing left to raise the second time round.
        expect(store.markMany(['nova:130', 'nova:131'], DISCOVERY_LANDED))
            .toBeFalse();
    });

    it('persists the instant something changes', () => {
        store.mark('nova:130', DISCOVERY_ENTERED);
        // Written straight through, without waiting for a save: entering a
        // system has to survive a crash before the next autosave.
        const raw = storage.getItem(discoveryKeyFor(LEGACY_KEY));
        expect(raw).not.toBeNull();
        expect(JSON.parse(raw!)).toEqual({
            version: DISCOVERY_VERSION,
            entries: [['nova:130', DISCOVERY_ENTERED]],
        });
    });

    it('reloads what it wrote', () => {
        store.mark('nova:130', DISCOVERY_LANDED);
        store.mark('nova:131', DISCOVERY_ENTERED);
        // A new store over the same storage is what a page reload is: no
        // in-memory copy, only what was persisted.
        const reloaded = new DiscoveryStore(storage);
        expect(reloaded.level('nova:130')).toBe(DISCOVERY_LANDED);
        expect(reloaded.level('nova:131')).toBe(DISCOVERY_ENTERED);
    });

    it('keeps each storage\'s record apart under the same key', () => {
        // The memoised record used to be one module-level map per KEY, so
        // a second storage under the same key read the first one's levels
        // — and specs had to toggle the key back and forth to flush it
        // (review finding #78). Now a store owns its storage.
        const otherStorage = new FakeStorage();
        const other = new DiscoveryStore(otherStorage);
        store.mark('nova:130', DISCOVERY_LANDED);
        expect(other.level('nova:130')).toBe(DISCOVERY_UNKNOWN);
        other.mark('nova:200', DISCOVERY_ENTERED);
        expect(store.level('nova:200')).toBe(DISCOVERY_UNKNOWN);
        expect(store.level('nova:130')).toBe(DISCOVERY_LANDED);
        expect(otherStorage.getItem(discoveryKeyFor(LEGACY_KEY)))
            .toBe(stored([['nova:200', DISCOVERY_ENTERED]]));
    });

    it('keeps each pilot\'s knowledge to themselves', () => {
        store.mark('nova:130', DISCOVERY_LANDED);
        store.setSaveKey(OTHER_PILOT_KEY);
        expect(store.level('nova:130')).toBe(DISCOVERY_UNKNOWN);
        store.mark('nova:200', DISCOVERY_ENTERED);
        store.setSaveKey(LEGACY_KEY);
        expect(store.level('nova:200')).toBe(DISCOVERY_UNKNOWN);
        expect(store.level('nova:130')).toBe(DISCOVERY_LANDED);
    });

    it('can be built pointed at a pilot', () => {
        store.mark('nova:130', DISCOVERY_LANDED);
        const pilot2 = new DiscoveryStore(storage, OTHER_PILOT_KEY);
        expect(pilot2.level('nova:130')).toBe(DISCOVERY_UNKNOWN);
        pilot2.mark('nova:200', DISCOVERY_ENTERED);
        expect(storage.getItem(discoveryKeyFor(OTHER_PILOT_KEY)))
            .toBe(stored([['nova:200', DISCOVERY_ENTERED]]));
    });

    describe('with no storage at all', () => {
        // Node, or a browser with localStorage disabled: the in-memory
        // record is the whole record.
        it('still coheres within the process', () => {
            const storeless = new DiscoveryStore();
            expect(storeless.storage).toBeUndefined();
            storeless.mark('nova:130', DISCOVERY_ENTERED);
            expect(storeless.level('nova:130')).toBe(DISCOVERY_ENTERED);
            expect(storeless.entries()).toEqual([['nova:130', DISCOVERY_ENTERED]]);
        });

        it('starts a switched-to pilot from nothing', () => {
            const storeless = new DiscoveryStore();
            storeless.mark('nova:130', DISCOVERY_ENTERED);
            storeless.setSaveKey(OTHER_PILOT_KEY);
            expect(storeless.level('nova:130')).toBe(DISCOVERY_UNKNOWN);
        });
    });

    describe('legacy `novajs:explored` migration', () => {
        it('adopts a pre-discovery pilot\'s explored set as "entered"', () => {
            storage.setItem(LEGACY_EXPLORED_KEY,
                JSON.stringify(['nova:130', 'nova:131']));
            const fresh = new DiscoveryStore(storage);
            expect(fresh.level('nova:130')).toBe(DISCOVERY_ENTERED);
            expect(fresh.level('nova:131')).toBe(DISCOVERY_ENTERED);
        });

        it('does not hand the old set to a pilot created later', () => {
            // The legacy key was client-GLOBAL. Only the legacy save slot
            // — the pilot that set migrated from — may inherit it.
            storage.setItem(LEGACY_EXPLORED_KEY, JSON.stringify(['nova:130']));
            store.setSaveKey(OTHER_PILOT_KEY);
            expect(store.level('nova:130')).toBe(DISCOVERY_UNKNOWN);
        });

        it('stops consulting it once the pilot has a record of their own', () => {
            // Migration is a one-time seed for a slot that has never
            // written discovery: once it has, the old set is stale and
            // must not resurrect systems the pilot has since forgotten
            // (a reset, a rollback to a fresh start).
            store.mark('nova:131', DISCOVERY_ENTERED);
            storage.setItem(LEGACY_EXPLORED_KEY, JSON.stringify(['nova:130']));
            const reloaded = new DiscoveryStore(storage);
            expect(reloaded.level('nova:131')).toBe(DISCOVERY_ENTERED);
            expect(reloaded.level('nova:130')).toBe(DISCOVERY_UNKNOWN);
        });
    });

    describe('the save round trip', () => {
        it('writes sorted [id, level] pairs', () => {
            store.mark('nova:131', DISCOVERY_ENTERED);
            store.mark('nova:130', DISCOVERY_LANDED);
            expect(store.entries()).toEqual([
                ['nova:130', DISCOVERY_LANDED],
                ['nova:131', DISCOVERY_ENTERED],
            ]);
        });

        it('merges a loaded save instead of replacing the record', () => {
            store.mark('nova:130', DISCOVERY_LANDED);
            store.merge([['nova:130', 1], ['nova:131', 2]]);
            // Restoring an older checkpoint must not un-learn nova:130.
            expect(store.level('nova:130')).toBe(DISCOVERY_LANDED);
            expect(store.level('nova:131')).toBe(DISCOVERY_LANDED);
        });

        it('leaves the record alone for a save with no discovery field', () => {
            store.mark('nova:130', DISCOVERY_ENTERED);
            store.merge(undefined);
            expect(store.level('nova:130')).toBe(DISCOVERY_ENTERED);
        });

        it('clamps a corrupt level rather than trusting it', () => {
            store.merge([['nova:130', 99], ['nova:131', -3]]);
            expect(store.level('nova:130')).toBe(DISCOVERY_LANDED);
            expect(store.level('nova:131')).toBe(DISCOVERY_UNKNOWN);
        });
    });

    it('survives unreadable stored data', () => {
        storage.setItem(discoveryKeyFor(LEGACY_KEY), 'not json');
        expect(new DiscoveryStore(storage).level('nova:130'))
            .toBe(DISCOVERY_UNKNOWN);
    });

    it('forgets everything on reset (a brand-new pilot)', () => {
        storage.setItem(LEGACY_EXPLORED_KEY, JSON.stringify(['nova:130']));
        store.mark('nova:131', DISCOVERY_LANDED);
        store.reset();
        expect(store.systems()).toEqual([]);
        // The legacy set would otherwise migrate itself straight back in.
        expect(storage.getItem(LEGACY_EXPLORED_KEY)).toBeNull();
    });

    it('exposes the NCB operators\' view of itself', () => {
        store.access.markVisited('nova:130');
        expect(store.access.level('nova:130')).toBe(DISCOVERY_ENTERED);
        store.mark('nova:130', DISCOVERY_LANDED);
        // Raises only: a visit never demotes a landing.
        store.access.markVisited('nova:130');
        expect(store.access.level('nova:130')).toBe(DISCOVERY_LANDED);
    });
});

describe('the client\'s discovery store', () => {
    // The module functions, playerDiscovery and defaultDiscoveryStore() are
    // one object: what the spaceport marks through the functions, a display
    // world reads through the store (and vice versa). Every spec starts
    // with it empty (spec_support/fresh_client_state.ts).

    it('is one store behind the module functions', () => {
        expect(defaultDiscoveryStore()).toBe(defaultDiscoveryStore());
        expect(discoveryLevel('nova:130')).toBe(DISCOVERY_UNKNOWN);
        markDiscovered('nova:130', DISCOVERY_ENTERED);
        expect(defaultDiscoveryStore().level('nova:130'))
            .toBe(DISCOVERY_ENTERED);
        playerDiscovery.markVisited('nova:131');
        expect(discoveryEntries()).toEqual([
            ['nova:130', DISCOVERY_ENTERED], ['nova:131', DISCOVERY_ENTERED],
        ]);
    });

    it('follows the active save key', () => {
        markDiscovered('nova:130', DISCOVERY_LANDED);
        setDiscoveryStorageKey(OTHER_PILOT_KEY);
        expect(discoveryLevel('nova:130')).toBe(DISCOVERY_UNKNOWN);
        setDiscoveryStorageKey(LEGACY_KEY);
        resetDiscovery();
        expect(discoveryLevel('nova:130')).toBe(DISCOVERY_UNKNOWN);
    });
});

/**
 * The record's version marker (see the STORAGE SHAPE note in
 * discovery_store.ts): the bare list every earlier build wrote is
 * version 0 and still reads; a newer build's record is refused and
 * parked, never guessed at.
 */
describe('the discovery store\'s versioned record', () => {
    let storage: FakeStorage;
    const key = discoveryKeyFor(LEGACY_KEY);

    beforeEach(() => {
        storage = new FakeStorage();
    });

    it('derives its version from the migration list, from 0', () => {
        expect(FIRST_DISCOVERY_VERSION).toBe(0);
        expect(DISCOVERY_MIGRATIONS.map(m => [m.from, m.to])).toEqual([[0, 1]]);
        expect(DISCOVERY_VERSION).toBe(1);
    });

    it('reads the bare list the previous builds wrote as version 0', () => {
        // Byte for byte what those builds persisted.
        storage.setItem(key, JSON.stringify(
            [['nova:130', DISCOVERY_LANDED], ['nova:131', DISCOVERY_ENTERED]]));
        const store = new DiscoveryStore(storage);
        expect(store.level('nova:130')).toBe(DISCOVERY_LANDED);
        expect(store.level('nova:131')).toBe(DISCOVERY_ENTERED);
        // The next write upgrades the record in place.
        store.mark('nova:132', DISCOVERY_ENTERED);
        expect(storage.getItem(key)).toBe(stored([
            ['nova:130', DISCOVERY_LANDED], ['nova:131', DISCOVERY_ENTERED],
            ['nova:132', DISCOVERY_ENTERED],
        ]));
        expect(storage.getItem(`${key}:quarantine`)).toBeNull();
    });

    it('reads back what it writes', () => {
        storage.setItem(key, stored([['nova:130', DISCOVERY_LANDED]]));
        expect(new DiscoveryStore(storage).level('nova:130'))
            .toBe(DISCOVERY_LANDED);
    });

    it('refuses a record from a newer build, parks it, and says why', () => {
        const future = JSON.stringify(
            { version: DISCOVERY_VERSION + 1, entries: [['nova:130', 2]] });
        storage.setItem(key, future);
        const warn = spyOn(console, 'warn');
        const store = new DiscoveryStore(storage);
        expect(store.level('nova:130')).toBe(DISCOVERY_UNKNOWN);
        expect(storage.getItem(`${key}:quarantine`)).toBe(future);
        expect(storage.getItem(key)).toBeNull();
        expect(warn).toHaveBeenCalledTimes(1);
        expect(warn.calls.mostRecent().args[0]).toContain('newer build');
        expect(warn.calls.mostRecent().args[0])
            .toContain(`version ${DISCOVERY_VERSION + 1}`);
    });

    it('parks a corrupt record rather than overwriting it on the next mark', () => {
        storage.setItem(key, '{"version":1,"entries":"nope"}');
        spyOn(console, 'warn');
        const store = new DiscoveryStore(storage);
        store.mark('nova:130', DISCOVERY_ENTERED);
        expect(storage.getItem(`${key}:quarantine`))
            .toBe('{"version":1,"entries":"nope"}');
        expect(storage.getItem(key)).toBe(stored([['nova:130', DISCOVERY_ENTERED]]));
    });

    it('re-seeds the legacy slot from `novajs:explored` after parking a '
        + 'corrupt record, and no other slot', () => {
            // A parked record is an absent one from then on, legacy seeding
            // included: the old set is the legacy-slot pilot's own entered
            // systems (a subset of what the unreadable record held), so it
            // recovers true knowledge. Any other pilot never inherits it.
            storage.setItem(LEGACY_EXPLORED_KEY, JSON.stringify(['nova:131']));
            storage.setItem(key, '{"version":1,"entries":"nope"}');
            storage.setItem(discoveryKeyFor(OTHER_PILOT_KEY),
                '{"version":1,"entries":"nope"}');
            spyOn(console, 'warn');
            const legacy = new DiscoveryStore(storage);
            expect(legacy.level('nova:131')).toBe(DISCOVERY_ENTERED);
            expect(storage.getItem(`${key}:quarantine`))
                .toBe('{"version":1,"entries":"nope"}');
            const other = new DiscoveryStore(storage);
            other.setSaveKey(OTHER_PILOT_KEY);
            expect(other.level('nova:131')).toBe(DISCOVERY_UNKNOWN);
            expect(storage.getItem(`${discoveryKeyFor(OTHER_PILOT_KEY)}:quarantine`))
                .toBe('{"version":1,"entries":"nope"}');
        });
});
