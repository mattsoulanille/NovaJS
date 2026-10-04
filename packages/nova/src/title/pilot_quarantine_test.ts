import 'jasmine';
import { MockGameData } from 'novadatainterface/mock_game_data';
import { getDefaultShipData } from 'novadatainterface/ship_data';
import {
    canEnterGame, ClientStateSlot, enterFailed, enterGame,
} from '../client/client_state.js';
import { FleetLedger } from '../client/fleet_ledger.js';
import { preparePlayerStart } from '../client/player_start.js';
import type { ClientRuntime } from '../client/runtime.js';
import {
    describeMissingSaveContent, encodeSave, isMissingSaveContentError,
    MissingSaveContentError, quarantineKeyFor, SAVE_KEY, SaveData,
    saveDefaults, setActiveSaveKey,
} from '../nova_plugin/pilot/index.js';
import {
    OutfitsStateComponent, ShipComponent,
} from '../nova_plugin/ship/index.js';
import type { PilotProfile, PrefsStorage } from './client_prefs.js';
import {
    pilotQuarantineNote, quarantineOnEntryFailure,
    releaseActivePilotQuarantine,
} from './pilot_quarantine.js';
import {
    createPilot, getActivePilot, listPilots, loadRegistry, selectPilot,
} from './pilot_registry.js';

/**
 * ============================================================================
 * A SAVE NAMING AN UNINSTALLED PLUG-IN'S CONTENT (issue #131)
 * ============================================================================
 *
 * The game data aggregator rejects an id no source defines (#47). A save
 * written while a plug-in was installed keeps naming that plug-in's ship
 * and outfits after it is removed. The player start used to swallow a
 * missing SHIP silently — the chär's ship stood in, the save's credits
 * and missions went onto it, and the first save trigger wrote the
 * substitute over the pilot's own ship. Now the save is refused before
 * any of it is applied, and the title quarantines the pilot with a
 * message naming the plug-in and ids, keeps the save untouched, and
 * leaves the menu free to open or create another pilot.
 *
 * Headless: the registry and the save layer run on an in-memory store
 * (installed as the page's localStorage, which loadSave reads), and the
 * player start on MockGameData.
 */

class MemoryStorage implements PrefsStorage {
    private map = new Map<string, string>();
    getItem(key: string) { return this.map.get(key) ?? null; }
    setItem(key: string, value: string) { this.map.set(key, value); }
    removeItem(key: string) { this.map.delete(key); }
    get length() { return this.map.size; }
    key(i: number) { return [...this.map.keys()][i] ?? null; }
    clear() { this.map.clear(); }
    has(key: string) { return this.map.has(key); }
}

const STOCK_SHIP = 'nova:128';
const STOCK_OUTFIT = 'nova:128';
const MISSING_SHIP = 'missing-plugin:128';
const MISSING_OUTFIT = 'missing-plugin:130';

function profile(name: string): PilotProfile {
    return { name, nickname: '', gender: 'male', strict: false };
}

function gameData(extraShips: string[] = []): MockGameData {
    const data = new MockGameData();
    for (const id of [STOCK_SHIP, ...extraShips]) {
        data.data.Ship.map.set(id, { ...getDefaultShipData(), id });
    }
    data.data.Outfit.map.set(STOCK_OUTFIT,
        data.data.Outfit.defaultValue!);
    data.data.System.map.set('nova:130', data.data.System.defaultValue!);
    return data;
}

function runtimeFor(data: MockGameData) {
    const fleet = new FleetLedger();
    const saves = {
        controlBits: undefined as unknown,
        loadCheckpointBaseline() { /* no history in these specs */ },
        installCheckpointRecorder() { /* nothing records here */ },
    };
    return {
        runtime: { gameData: data, fleet, saves } as unknown as ClientRuntime,
        fleet,
    };
}

describe('a save naming an uninstalled plug-in (issue #131)', () => {
    let store: MemoryStorage;
    let original: PropertyDescriptor | undefined;

    beforeEach(() => {
        store = new MemoryStorage();
        original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
        Object.defineProperty(globalThis, 'localStorage', {
            value: store, configurable: true, writable: true,
        });
    });

    afterEach(() => {
        if (original) {
            Object.defineProperty(globalThis, 'localStorage', original);
        } else {
            delete (globalThis as { localStorage?: unknown }).localStorage;
        }
        setActiveSaveKey(SAVE_KEY);
    });

    /** Two pilots; the second (active) one flies a missing plug-in's ship. */
    function pilots(save: Partial<SaveData>, version?: number) {
        const other = createPilot(profile('Other Pilot'), store);
        store.setItem(other.saveKey, encodeSave({
            ...saveDefaults(), ship: STOCK_SHIP, outfits: [], system: 'nova:130',
        }));
        const stranded = createPilot(profile('Kestrel Vane'), store);
        const current = encodeSave({
            ...saveDefaults(), ship: STOCK_SHIP, outfits: [], system: 'nova:130',
            credits: 777_777, ...save,
        });
        // An OLDER build's save: the same payload under its version.
        const bytes = version === undefined ? current : JSON.stringify(
            { version, data: JSON.parse(current).data });
        store.setItem(stranded.saveKey, bytes);
        return { other, stranded, bytes };
    }

    it('refuses the save at the player start, naming the plug-in and id, '
        + 'before any of it is applied', async () => {
            const { stranded, bytes } = pilots({ ship: MISSING_SHIP });
            const { runtime, fleet } = runtimeFor(gameData());

            let error: unknown;
            await preparePlayerStart(runtime, new URLSearchParams(),
                () => 'peer-1').then(
                    start => fail('entered with a substitute ship: '
                        + start.ship.components.get(ShipComponent)?.id),
                    e => { error = e; });
            expect(isMissingSaveContentError(error)).toBeTrue();
            const refused = error as MissingSaveContentError;
            expect(refused.missing).toEqual([{ kind: 'ship', id: MISSING_SHIP }]);
            expect(refused.plugins).toEqual(['missing-plugin']);
            expect(refused.message).toContain('"missing-plugin"');
            expect(refused.message).toContain(MISSING_SHIP);
            // Nothing of the save was staged for the session.
            expect(fleet.restoredSave).toBeUndefined();
            // And nothing moved it: not deleted, not parked at :quarantine.
            expect(store.getItem(stranded.saveKey)).toBe(bytes);
            expect(store.has(quarantineKeyFor(stranded.saveKey))).toBeFalse();
        });

    it('refuses an outfit from the missing plug-in the same way', async () => {
        pilots({ outfits: [[STOCK_OUTFIT, 1], [MISSING_OUTFIT, 2]] });
        const { runtime } = runtimeFor(gameData());
        await expectAsync(preparePlayerStart(runtime, new URLSearchParams(),
            () => 'peer-1')).toBeRejectedWithError(MissingSaveContentError,
                /plug-in "missing-plugin" \(outfit missing-plugin:130\)/);
    });

    it('quarantines the pilot with the naming message, keeps the save, and '
        + 'leaves the title free to open or create another pilot', async () => {
            const { other, stranded, bytes } = pilots({ ship: MISSING_SHIP });
            const { runtime } = runtimeFor(gameData());
            // The title's Enter Ship, as startGame drives the machine: the
            // entry begins, preparePlayerStart rejects, and abandonEntry
            // puts the state back at the title (enterFailed).
            const state = new ClientStateSlot();
            state.apply(enterGame);
            const error = await preparePlayerStart(runtime,
                new URLSearchParams(), () => 'peer-1').then(() => undefined, e => e);
            state.apply(enterFailed);

            const notice = quarantineOnEntryFailure(error, store);
            expect(notice).toBeDefined();
            expect(notice).toContain('Kestrel Vane');
            expect(notice).toContain('"missing-plugin"');
            expect(notice).toContain(MISSING_SHIP);
            expect(notice).toContain('open another pilot or create a new one');

            // The pilot is quarantined in the registry, with the reason...
            const record = listPilots(store).find(p => p.id === stranded.id)!;
            expect(record.quarantine?.reason).toContain(MISSING_SHIP);
            expect(record.quarantine?.reason).toContain('"missing-plugin"');
            expect(pilotQuarantineNote(record)).toBeDefined();
            // ...which survives a reload of the registry,
            expect(loadRegistry(store).pilots
                .find(p => p.id === stranded.id)?.quarantine)
                .toEqual(record.quarantine);
            // ...and its save is exactly where and what it was.
            expect(store.getItem(stranded.saveKey)).toBe(bytes);
            expect(store.has(quarantineKeyFor(stranded.saveKey))).toBeFalse();
            expect(listPilots(store).map(p => p.id))
                .toEqual([other.id, stranded.id]);

            // The title is back in play: another pilot can be opened (and
            // flies), or a new one created.
            expect(canEnterGame(state.state)).toBeTrue();
            expect(selectPilot(other.id, store)?.id).toBe(other.id);
            const start = await preparePlayerStart(runtimeFor(gameData()).runtime,
                new URLSearchParams(), () => 'peer-1');
            expect(start.ship.components.get(ShipComponent)?.id)
                .toBe(STOCK_SHIP);
            const fresh = createPilot(profile('New Pilot'), store);
            expect(getActivePilot(store)?.id).toBe(fresh.id);
            expect(pilotQuarantineNote(fresh)).toBeUndefined();
        });

    it('lifts the quarantine once the plug-in is back and the save flies '
        + 'as it was', async () => {
            const { stranded } = pilots({ ship: MISSING_SHIP });
            const error = await preparePlayerStart(
                runtimeFor(gameData()).runtime, new URLSearchParams(),
                () => 'peer-1').then(() => undefined, e => e);
            quarantineOnEntryFailure(error, store);
            expect(getActivePilot(store)?.quarantine).toBeDefined();

            const start = await preparePlayerStart(
                runtimeFor(gameData([MISSING_SHIP])).runtime,
                new URLSearchParams(), () => 'peer-1');
            expect(start.ship.components.get(ShipComponent)?.id)
                .toBe(MISSING_SHIP);
            releaseActivePilotQuarantine(store);
            expect(listPilots(store).find(p => p.id === stranded.id)
                ?.quarantine).toBeUndefined();
        });

    it('leaves any other entry failure alone', () => {
        createPilot(profile('Kestrel Vane'), store);
        expect(quarantineOnEntryFailure(new Error('socket closed'), store))
            .toBeUndefined();
        expect(getActivePilot(store)?.quarantine).toBeUndefined();
    });

    // Issue #310: a plug-in's prefix used to stop at the first dot of its
    // name, so a save written then names "X 1.0"'s outfit as X 1:447. When
    // the old prefix is AMBIGUOUS — "X 1.0" and "X 1.1" are both installed,
    // both `X 1` under the old rule — the v4 -> v5 transition cannot say
    // which one was meant and leaves the ids alone (save_migrations.ts,
    // PLUGIN_PREFIX_RENAMES). The save is refused and kept, and the message
    // names both plug-ins instead of calling the content missing or
    // advising a reinstall.
    it('names the plug-ins an ambiguous pre-#310 prefix stood for instead '
        + 'of calling it missing', async () => {
            const { stranded, bytes } = pilots({
                outfits: [['X 1:447', 1]],
            }, 4);
            const data = gameData();
            for (const id of ['X 1.0:447', 'X 1.1:447']) {
                data.data.Outfit.map.set(id, data.data.Outfit.defaultValue!);
            }
            const error = await preparePlayerStart(runtimeFor(data).runtime,
                new URLSearchParams(), () => 'peer-1').then(() => undefined, e => e);
            expect(isMissingSaveContentError(error)).toBeTrue();
            expect((error as MissingSaveContentError).missing).toEqual([{
                kind: 'outfit', id: 'X 1:447', renamedAs: ['X 1.0', 'X 1.1'],
            }]);

            const notice = quarantineOnEntryFailure(error, store)!;
            expect(notice).toContain('"X 1" (outfit X 1:447), which is '
                + 'probably the installed "X 1.0" or "X 1.1" under the name '
                + 'older versions of the game gave it');
            expect(notice).not.toContain('reinstall');
            expect(notice).toContain('open another pilot or create a new one');
            expect(store.getItem(stranded.saveKey)).toBe(bytes);
        });

    // The one installed plug-in #310 renamed ("HypergatePassv1.0", keyed
    // HypergatePassv1 before) is in the transition's table: a v4 save
    // naming its outfit under the old prefix is re-keyed on load and flies.
    it('enters a v4 pilot owning the renamed plug-in\'s outfit under its '
        + 'pre-#310 prefix, re-keyed', async () => {
            const { stranded, bytes } = pilots({
                outfits: [[STOCK_OUTFIT, 1], ['HypergatePassv1:447', 1]],
                ranks: ['HypergatePassv1:159'],
            }, 4);
            const data = gameData();
            data.data.Outfit.map.set('HypergatePassv1.0:447',
                data.data.Outfit.defaultValue!);
            const start = await preparePlayerStart(runtimeFor(data).runtime,
                new URLSearchParams(), () => 'peer-1');
            expect([...start.ship.components.get(OutfitsStateComponent)!.keys()])
                .toEqual([STOCK_OUTFIT, 'HypergatePassv1.0:447']);
            expect(getActivePilot(store)?.quarantine).toBeUndefined();
            // Re-keyed in memory; the stored bytes change only when the
            // session next writes the save (as v5).
            expect(store.getItem(stranded.saveKey)).toBe(bytes);
        });

    it('says when a stock-prefixed id is what is missing', () => {
        expect(describeMissingSaveContent([
            { kind: 'ship', id: MISSING_SHIP },
            { kind: 'outfit', id: 'nova:999' },
        ])).toBe('needs content that is not installed: the plug-in '
            + '"missing-plugin" (ship missing-plugin:128); stock ids the game '
            + 'data does not define (outfit nova:999)');
    });
});
