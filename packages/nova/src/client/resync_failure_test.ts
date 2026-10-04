import 'jasmine';
import { Entity } from 'nova_ecs/entity';
import { World } from 'nova_ecs/world';
import { SAVE_KEY, setActiveSaveKey } from '../nova_plugin/pilot/index.js';
import { PlayerShipSelector } from '../nova_plugin/player/index.js';
import { ShipComponent } from '../nova_plugin/ship/index.js';
import {
    arrive, beginTransit, canExitToTitle, claimSystem, ClientState,
    ClientStateSlot, describeState, enterGame, IllegalTransitionError,
    isInGame, land, liveSystem, LiveSystem, loseSync,
} from './client_state.js';
import { FleetLedger } from './fleet_ledger.js';
import type { SimulationGameData } from './gamedata/simulation_game_data.js';
import { PlayerPersistence } from './player_save.js';
import { freezeOnResyncFailure } from './resync_failure.js';

/** localStorage, in memory. */
class MemoryStorage {
    private readonly items = new Map<string, string>();
    getItem(key: string): string | null {
        return this.items.get(key) ?? null;
    }
    setItem(key: string, value: string): void {
        this.items.set(key, value);
    }
    removeItem(key: string): void {
        this.items.delete(key);
    }
}

/**
 * Issue #333, the client half: when the simulation's resync gives up, the
 * client saves the last GOOD state, freezes the universe (the terminal
 * `desynced` state) and offers a reload. Headless: the dialog itself is
 * spaceport/desync_notice_test.ts.
 */
describe('losing sync for good (#333)', () => {
    const plan = { kind: 'startup' as const, from: undefined, to: 'A',
        uuid: 'player', entity: new Entity() };
    const inSpace = (system: LiveSystem): ClientState =>
        arrive(claimSystem(beginTransit(enterGame({ kind: 'title' }), plan),
            { systemId: 'A' }), system);

    describe('the desynced state', () => {
        const system = { systemId: 'A' } as unknown as LiveSystem;

        it('is entered from a live system, and holds it out of reach of '
            + 'the pump', () => {
            const frozen = loseSync(inSpace(system));
            expect(frozen).toEqual({ kind: 'desynced', frozen: system });
            expect(describeState(frozen)).toBe('desynced(A)');
            // Not live: nothing steps it, sends input to it, or saves it.
            expect(liveSystem(frozen)).toBeUndefined();
            expect(isInGame(frozen)).toBeTrue();
        });

        it('is entered from a docked state too (the sim runs while '
            + 'landed)', () => {
            const landing = land(inSpace(system),
                { uuid: 'player', entity: new Entity(), planetId: 'p' });
            expect(loseSync(landing).kind).toBe('desynced');
        });

        it('cannot be escaped to the title, and is entered only once',
            () => {
                const frozen = loseSync(inSpace(system));
                expect(canExitToTitle(frozen)).toBeFalse();
                for (const from of [frozen, { kind: 'title' } as ClientState,
                    beginTransit(enterGame({ kind: 'title' }), plan)]) {
                    expect(() => loseSync(from)).toThrowMatching(e =>
                        e instanceof IllegalTransitionError
                        && e.transition === 'loseSync');
                }
            });
    });

    describe('the save', () => {
        let store: MemoryStorage;
        let original: PropertyDescriptor | undefined;

        beforeEach(() => {
            store = new MemoryStorage();
            original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
            Object.defineProperty(globalThis, 'localStorage', {
                value: store, configurable: true, writable: true,
            });
            setActiveSaveKey(SAVE_KEY);
        });

        afterEach(() => {
            if (original) {
                Object.defineProperty(globalThis, 'localStorage', original);
            } else {
                delete (globalThis as { localStorage?: unknown }).localStorage;
            }
            setActiveSaveKey(SAVE_KEY);
        });

        function session(withPlayerShip: string | undefined) {
            const world = new World('display');
            if (withPlayerShip) {
                world.entities.set('player', new Entity('player')
                    .addComponent(ShipComponent, { id: withPlayerShip })
                    .addComponent(PlayerShipSelector, undefined));
            }
            const live = { systemId: 'A', world } as unknown as LiveSystem;
            const state = new ClientStateSlot(inSpace(live));
            const saves = new PlayerPersistence(state, new FleetLedger(),
                {} as SimulationGameData);
            return { world, live, state, saves };
        }

        const savedShip = () => {
            const raw = store.getItem(SAVE_KEY);
            return raw === null ? undefined
                : (JSON.parse(raw) as { data: { ship: string } }).data.ship;
        };

        it('writes the display world\'s player, then freezes so no later '
            + 'save can replace it', () => {
            const { world, live, state, saves } = session('nova:128');
            expect(freezeOnResyncFailure({ state, saves }, live))
                .toBe('saved');
            expect(savedShip()).toBe('nova:128');
            expect(state.state.kind).toBe('desynced');

            // The periodic / pagehide save after the freeze — the world
            // underneath is no longer trusted, whatever it now shows.
            world.entities.get('player')!.components.set(ShipComponent,
                { id: 'nova:999' });
            expect(saves.saveNow()).toBeFalse();
            world.entities.delete('player');
            expect(saves.saveNow()).toBeFalse();
            expect(savedShip()).toBe('nova:128');
        });

        it('keeps the last periodic save when there is no player ship to '
            + 'write (never a shipless pilot)', () => {
            // The last periodic save, from when the ship was in the world.
            const before = session('nova:128');
            expect(before.saves.saveNow()).toBeTrue();
            const periodic = store.getItem(SAVE_KEY);

            const { live, state, saves } = session(undefined);
            expect(freezeOnResyncFailure({ state, saves }, live))
                .toBe('keptLastSave');
            expect(store.getItem(SAVE_KEY)).toBe(periodic);
            expect(state.state.kind).toBe('desynced');
        });

        it('ignores a failure from a system the client has already left',
            () => {
                const { state, saves } = session('nova:128');
                const stale = { systemId: 'old', world: new World() } as
                    unknown as LiveSystem;
                expect(freezeOnResyncFailure({ state, saves }, stale))
                    .toBeUndefined();
                expect(state.state.kind).toBe('inSpace');
                expect(store.getItem(SAVE_KEY)).toBeNull();
            });
    });
});
