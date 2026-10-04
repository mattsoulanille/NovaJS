import 'jasmine';
import { getDefaultFleetData } from 'novadatainterface/fleet_data';
import { MockGameData } from 'novadatainterface/mock_game_data';
import { getDefaultPersData } from 'novadatainterface/pers_data';
import { getDefaultShipData } from 'novadatainterface/ship_data';
import { getDefaultSystemData } from 'novadatainterface/system_data';
import { Random } from 'nova_ecs/plugins/random_plugin';
import { makeSystem } from '../make_system.js';
import {
    buildNpcSpawnTable, buildPersSpawnTable, latchSpawnBits, NpcSpawnerType,
} from './npc_spawn_plugin.js';
import {
    effectiveNpcSpawnEntries, effectivePersEntries, NO_SPAWN_BITS,
    spawnTableBits,
} from './spawn_bits.js';

/**
 * The room's spawn bits (#140, spawn_bits.ts): the candidate tables, what
 * a bit set sees of them, and the latch that fixes the room's bits from
 * its first entrant.
 */
describe('room spawn bits', () => {
    const SYSTEM = 'test:system';
    const SHIP = 'test:ship';

    function mockGameData() {
        const gameData = new MockGameData();
        gameData.data.Ship.map.set(SHIP, { ...getDefaultShipData(), id: SHIP });
        return gameData;
    }

    describe('roaming fleets', () => {
        async function roamingTable(appearOns: Record<string, string>) {
            const gameData = mockGameData();
            for (const [id, appearOn] of Object.entries(appearOns)) {
                gameData.data.Fleet.map.set(id, {
                    ...getDefaultFleetData(), id, leadShip: SHIP,
                    escorts: [], govt: null, linkSyst: { type: 'any' },
                    appearOn,
                });
            }
            const systemData = { ...getDefaultSystemData(), id: SYSTEM };
            gameData.data.System.map.set(SYSTEM, systemData);
            const world = await makeSystem(SYSTEM, gameData, undefined,
                { npcs: false });
            return buildNpcSpawnTable(world, SYSTEM, systemData);
        }

        it('keep their fixed shares when nothing gates them', async () => {
            const entries = await roamingTable(
                { 'test:a': '', 'test:b': '', 'test:c': '' });
            expect(entries.map(entry => entry.weight)).toEqual([5, 5, 5]);
            expect(entries.some(entry => 'roamingShare' in entry
                || 'appearOn' in entry)).toBeFalse();
            // Ungated: the table IS what every bit set sees.
            expect(effectiveNpcSpawnEntries(entries, new Set([1])))
                .toBe(entries);
        });

        it('share the roaming weight among the fleets the bits admit',
            async () => {
                const entries = await roamingTable(
                    { 'test:open': '', 'test:story': 'b5' });
                expect(entries.map(entry => [entry.fleet?.leadShip,
                    entry.weight, entry.roamingShare, entry.appearOn]))
                    .toEqual([[SHIP, 15, true, undefined],
                        [SHIP, 15, true, 'b5']]);
                // The empty set: the one open fleet, the whole weight —
                // what the empty-set rule's table held.
                expect(effectiveNpcSpawnEntries(entries, NO_SPAWN_BITS)
                    .map(entry => entry.weight)).toEqual([15]);
                expect(effectiveNpcSpawnEntries(entries, new Set([5]))
                    .map(entry => entry.weight)).toEqual([7.5, 7.5]);
            });
    });

    it('spreads a LinkSyst përs pool over the people the bits admit',
        async () => {
            const gameData = mockGameData();
            for (const [id, activeOn] of [['test:a', ''], ['test:b', 'b7'],
                ['test:c', 'b8']] as const) {
                gameData.data.Pers.map.set(id, {
                    ...getDefaultPersData(), id, ship: SHIP,
                    linkSyst: { type: 'any' }, activeOn,
                });
            }
            const systemData = { ...getDefaultSystemData(), id: SYSTEM };
            gameData.data.System.map.set(SYSTEM, systemData);
            const world = await makeSystem(SYSTEM, gameData, undefined,
                { npcs: false });
            const entries = await buildPersSpawnTable(world, SYSTEM, systemData);
            expect(entries.every(entry => entry.evenShare)).toBeTrue();
            const chances = (bits: ReadonlySet<number>) =>
                effectivePersEntries(entries, bits)
                    .map(entry => [entry.id, entry.chance]);
            expect(chances(NO_SPAWN_BITS)).toEqual([['test:a', 100]]);
            expect(chances(new Set([7]))).toEqual(
                [['test:a', 50], ['test:b', 50]]);
            expect(spawnTableBits({ entries: [], persEntries: entries }))
                .toEqual([7, 8]);
        });

    describe('latchSpawnBits', () => {
        const gatedDude = () => ({
            weight: 1,
            dude: {
                aiType: 0, govt: null,
                ships: [{ id: SHIP, weight: 1, appearOn: 'b5' }],
            },
        });
        const spawner = (overrides: Partial<NpcSpawnerType> = {}):
            NpcSpawnerType => ({
                targetCount: 2,
                entries: [gatedDude()],
                nextSpawn: 0,
                persEntries: [],
                avgShips: 3,
                ...overrides,
            });
        const entrant = (uuid: string, bits?: number[]) =>
            [{ peerId: uuid }, bits ? new Set(bits) : undefined, uuid] as const;

        it('waits for an entrant', () => {
            const state = spawner();
            latchSpawnBits(state, [], new Random(1));
            expect(state.spawnBits).toBeUndefined();
        });

        it("keeps the first entrant's bits that the tables read", () => {
            const state = spawner();
            latchSpawnBits(state, [entrant('peer', [5, 999])], new Random(1));
            expect(state.spawnBits).toEqual([5]);
        });

        it('treats a player ship with no control bits as an entrant with '
            + 'none set', () => {
            const state = spawner();
            latchSpawnBits(state, [entrant('peer')], new Random(1));
            expect(state.spawnBits).toEqual([]);
        });

        it('breaks a same-tick tie by uuid, whatever the query order', () => {
            for (const order of [[entrant('z', [5]), entrant('a', [])],
                [entrant('a', []), entrant('z', [5])]]) {
                const state = spawner();
                latchSpawnBits(state, order, new Random(1));
                expect(state.spawnBits).toEqual([]);
            }
        });

        it('never rewrites a latch: a later entrant changes nothing', () => {
            const state = spawner();
            latchSpawnBits(state, [entrant('first', [5])], new Random(1));
            latchSpawnBits(state, [entrant('first', [5]),
                entrant('aaa-later', [])], new Random(1));
            latchSpawnBits(state, [entrant('aaa-later', [])], new Random(1));
            expect(state.spawnBits).toEqual([5]);
        });

        it('never latches a table no test gates (its state is unchanged)',
            () => {
                const state = spawner({
                    entries: [{ weight: 1, dude: { aiType: 0, govt: null,
                        ships: [{ id: SHIP, weight: 1 }] } }],
                });
                delete state.avgShips;
                const before = JSON.stringify(state);
                latchSpawnBits(state, [entrant('peer', [5])], new Random(1));
                expect(JSON.stringify(state)).toBe(before);
            });

        it('rolls a deferred population target, with one draw, only when '
            + 'the latch admits something an empty genesis could not', () => {
            const random = new Random(9);
            const reference = new Random(9);
            const admitted = spawner({ targetCount: 0 });
            latchSpawnBits(admitted, [entrant('peer', [5])], random);
            expect(admitted.targetCount).toBeGreaterThan(0);
            reference.next();
            expect(random.next()).toBe(reference.next());

            // Nothing admitted: no roll, no draw.
            const untouched = new Random(9);
            const refused = spawner({ targetCount: 0 });
            latchSpawnBits(refused, [entrant('peer', [])], untouched);
            expect(refused.targetCount).toBe(0);
            expect(untouched.next()).toBe(new Random(9).next());

            // A target genesis already rolled stands, and draws nothing.
            const steady = new Random(9);
            const rolled = spawner({ targetCount: 2 });
            latchSpawnBits(rolled, [entrant('peer', [5])], steady);
            expect(rolled.targetCount).toBe(2);
            expect(steady.next()).toBe(new Random(9).next());
        });
    });

    it('a düde row with only gated classes keeps its sÿst weight', () => {
        const entries = [
            { weight: 30, dude: { aiType: 0, govt: null,
                ships: [{ id: SHIP, weight: 1, appearOn: 'b5' }] } },
            { weight: 70, dude: { aiType: 0, govt: null,
                ships: [{ id: SHIP, weight: 1 }] } },
        ];
        expect(effectiveNpcSpawnEntries(entries, NO_SPAWN_BITS)
            .map(entry => entry.weight)).toEqual([70]);
        expect(effectiveNpcSpawnEntries(entries, new Set([5]))
            .map(entry => entry.weight)).toEqual([30, 70]);
    });
});
