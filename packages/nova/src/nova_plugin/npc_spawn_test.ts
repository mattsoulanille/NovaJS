import 'jasmine';
import { getDefaultDudeData } from 'novadatainterface/dude_data';
import { getDefaultGovtData } from 'novadatainterface/govt_data';
import { MockGameData } from 'novadatainterface/mock_game_data';
import { getDefaultShipData } from 'novadatainterface/ship_data';
import { getDefaultSystemData } from 'novadatainterface/system_data';
import { Random } from 'nova_ecs/plugins/random_plugin';
import { getIntegrationGameData } from '../communication/simulation_test_fixture.js';
import { makeSystem } from './make_system.js';
import {
    buildNpcSpawnTable, fleetAllowedInSystem, MAX_NPC_POPULATION,
    persAllowedInSystem, PERS_SPAWN_CHANCE, pickPersEntry, pickWeighted,
    rollPopulationTarget,
} from './npc_spawn_plugin.js';

function govt(overrides: Partial<ReturnType<typeof getDefaultGovtData>>) {
    return { ...getDefaultGovtData(), ...overrides };
}

describe('pickWeighted', () => {
    it('is deterministic for a given seed', () => {
        const entries = [
            { weight: 10, name: 'a' },
            { weight: 20, name: 'b' },
            { weight: 70, name: 'c' },
        ];
        const picksA = [], picksB = [];
        const randomA = new Random(42), randomB = new Random(42);
        for (let i = 0; i < 50; i++) {
            picksA.push(pickWeighted(entries, randomA)!.name);
            picksB.push(pickWeighted(entries, randomB)!.name);
        }
        expect(picksA).toEqual(picksB);
        // All entries get picked over enough draws.
        expect(new Set(picksA)).toEqual(new Set(['a', 'b', 'c']));
    });

    it('consumes exactly one draw regardless of which entry wins', () => {
        const random = new Random(7);
        const reference = new Random(7);
        pickWeighted([{ weight: 1 }, { weight: 1 }, { weight: 1 }], random);
        reference.next();
        expect(random.next()).toEqual(reference.next());
    });

    it('never picks zero-weight entries', () => {
        const random = new Random(3);
        for (let i = 0; i < 100; i++) {
            const picked = pickWeighted([
                { weight: 0, name: 'never' },
                { weight: 5, name: 'always' },
            ] as const, random);
            expect(picked!.name).toBe('always');
        }
    });

    it('returns undefined for empty or all-zero tables', () => {
        const random = new Random(1);
        expect(pickWeighted([], random)).toBeUndefined();
        expect(pickWeighted([{ weight: 0 }], random)).toBeUndefined();
    });
});

describe('pickPersEntry (sÿst Person chances inside the Bible 5%)', () => {
    /** Sol's own Person fields (sÿst nova:130), chances and all. */
    const sol = [
        { id: 'nova:128', chance: 12 },  // Terrapin
        { id: 'nova:227', chance: 1 },   // Valkyrie
        { id: 'nova:156', chance: 2 },   // Drifting Derelict (Heavy Shuttle)
        { id: 'nova:299', chance: 15 },  // Galadriel
    ];
    /** The roll at which entry `index`'s sub-interval starts. */
    const start = (index: number) => sol.slice(0, index)
        .reduce((sum, entry) => sum + entry.chance, 0)
        * PERS_SPAWN_CHANCE / 100;

    it('gives each listed person 5% x their own percent chance', () => {
        // Each person owns a sub-interval of width 5% x chance%, laid
        // end to end in table order: Terrapin [0, 0.6%), Valkyrie
        // [0.6%, 0.65%), the derelict [0.65%, 0.75%), Galadriel
        // [0.75%, 1.5%).
        for (let i = 0; i < sol.length; i++) {
            const middle = (start(i) + start(i + 1)) / 2;
            expect(pickPersEntry(sol, middle)).toBe(sol[i]);
        }
        // Sol's chances sum to 30, so 1.5% of draws create someone and
        // the other 98.5% create nobody.
        expect(pickPersEntry(sol, 0.0151)).toBeUndefined();
        expect(pickPersEntry(sol, 0.049)).toBeUndefined();
        expect(pickPersEntry(sol, 0.9)).toBeUndefined();
    });

    it("matches the Bible's flat 5% when the chances sum to 100", () => {
        const even = [{ chance: 50 }, { chance: 50 }];
        expect(pickPersEntry(even, 0)).toBe(even[0]);
        expect(pickPersEntry(even, 0.024)).toBe(even[0]);
        expect(pickPersEntry(even, 0.026)).toBe(even[1]);
        expect(pickPersEntry(even, PERS_SPAWN_CHANCE * 0.999)).toBe(even[1]);
        expect(pickPersEntry(even, PERS_SPAWN_CHANCE * 1.001)).toBeUndefined();
    });

    it('saturates the window when the chances sum past 100 '
        + '(stock data reaches 600)', () => {
            const crowded = Array.from({ length: 8 }, () => ({ chance: 75 }));
            expect(pickPersEntry(crowded, PERS_SPAWN_CHANCE * 0.999))
                .toBe(crowded[7]);
            // Never more than the Bible's 5%.
            expect(pickPersEntry(crowded, PERS_SPAWN_CHANCE * 1.001))
                .toBeUndefined();
        });

    it('gives an empty or all-zero table nobody', () => {
        expect(pickPersEntry([], 0)).toBeUndefined();
        expect(pickPersEntry([{ chance: 0 }], 0)).toBeUndefined();
        expect(pickPersEntry([{ chance: 0 }, { chance: 5 }], 0))
            .toEqual({ chance: 5 });
    });

    it('holds its stated frequencies over a seeded run', () => {
        const random = new Random(20260814);
        const counts = new Map<string, number>();
        const draws = 200_000;
        for (let i = 0; i < draws; i++) {
            const picked = pickPersEntry(sol, random.next());
            if (picked) {
                counts.set(picked.id, (counts.get(picked.id) ?? 0) + 1);
            }
        }
        for (const entry of sol) {
            const rate = (counts.get(entry.id) ?? 0) / draws;
            const expected = PERS_SPAWN_CHANCE * entry.chance / 100;
            // Within 20% of the analytic rate (the rarest, the 2%
            // derelict, is 0.1% per draw => ~200 hits here).
            expect(rate).toBeGreaterThan(expected * 0.8);
            expect(rate).toBeLessThan(expected * 1.2);
        }
        // Nobody who isn't listed: the derelict Leviathan përs nova:180
        // is not in Sol's Person fields, so it can never be picked.
        expect(counts.has('nova:180')).toBeFalse();
    });
});

describe('rollPopulationTarget', () => {
    it('is zero for an empty system', () => {
        expect(rollPopulationTarget(0, new Random(1))).toBe(0);
    });

    it('stays within the Bible average +/- 50%', () => {
        const random = new Random(99);
        for (let i = 0; i < 200; i++) {
            const target = rollPopulationTarget(6, random);
            expect(target).toBeGreaterThanOrEqual(3);
            expect(target).toBeLessThanOrEqual(9);
        }
    });

    it('caps runaway plugin AvgShips', () => {
        const random = new Random(5);
        for (let i = 0; i < 50; i++) {
            expect(rollPopulationTarget(50, random))
                .toBeLessThanOrEqual(MAX_NPC_POPULATION);
        }
    });
});

describe('fleetAllowedInSystem (flët LinkSyst ranges)', () => {
    const federation = govt({
        id: 'nova:128', classes: [1], allies: [2], enemies: [3],
    });
    const ally = govt({ id: 'nova:131', classes: [2] });
    const enemy = govt({ id: 'nova:129', classes: [3] });
    const bystander = govt({ id: 'nova:132', classes: [9] });

    it('any: every system', () => {
        expect(fleetAllowedInSystem({ type: 'any' }, 'nova:130', null,
            undefined, undefined)).toBeTrue();
    });

    it('system: only the named system', () => {
        const link = { type: 'system', id: 'nova:130' } as const;
        expect(fleetAllowedInSystem(link, 'nova:130', null,
            undefined, undefined)).toBeTrue();
        expect(fleetAllowedInSystem(link, 'nova:131', null,
            undefined, undefined)).toBeFalse();
    });

    it("govtSystems: only the govt's own systems", () => {
        const link = { type: 'govtSystems', govt: 'nova:128' } as const;
        expect(fleetAllowedInSystem(link, 'nova:130', 'nova:128',
            federation, undefined)).toBeTrue();
        expect(fleetAllowedInSystem(link, 'nova:130', 'nova:129',
            enemy, undefined)).toBeFalse();
        expect(fleetAllowedInSystem(link, 'nova:130', null,
            undefined, undefined)).toBeFalse();
    });

    it("notGovtSystems: anywhere but the govt's systems", () => {
        const link = { type: 'notGovtSystems', govt: 'nova:128' } as const;
        expect(fleetAllowedInSystem(link, 'nova:130', 'nova:128',
            federation, undefined)).toBeFalse();
        expect(fleetAllowedInSystem(link, 'nova:130', 'nova:129',
            enemy, undefined)).toBeTrue();
        expect(fleetAllowedInSystem(link, 'nova:130', null,
            undefined, undefined)).toBeTrue();
    });

    it("allySystems: systems whose govt lists the linked govt's classes " +
        'among its allies', () => {
            const link = { type: 'allySystems', govt: 'nova:131' } as const;
            // Federation allies with class 2; nova:131 is class 2.
            expect(fleetAllowedInSystem(link, 'nova:130', 'nova:128',
                federation, ally)).toBeTrue();
            expect(fleetAllowedInSystem(link, 'nova:130', 'nova:132',
                bystander, ally)).toBeFalse();
            // A govt is its own ally.
            expect(fleetAllowedInSystem(
                { type: 'allySystems', govt: 'nova:128' },
                'nova:130', 'nova:128', federation, federation)).toBeTrue();
            // Independent systems have no allies.
            expect(fleetAllowedInSystem(link, 'nova:130', null,
                undefined, ally)).toBeFalse();
        });

    it("enemySystems: systems whose govt lists the linked govt's classes " +
        'among its enemies', () => {
            const link = { type: 'enemySystems', govt: 'nova:129' } as const;
            expect(fleetAllowedInSystem(link, 'nova:130', 'nova:128',
                federation, enemy)).toBeTrue();
            expect(fleetAllowedInSystem(link, 'nova:130', 'nova:132',
                bystander, enemy)).toBeFalse();
            // A govt is never its own enemy.
            expect(fleetAllowedInSystem(
                { type: 'enemySystems', govt: 'nova:128' },
                'nova:130', 'nova:128', federation, federation)).toBeFalse();
        });
});

describe('persAllowedInSystem (përs LinkSyst ranges)', () => {
    const federation = govt({ id: 'nova:128', classes: [1] });

    it('independentSystems: only ungoverned systems', () => {
        const link = { type: 'independentSystems' } as const;
        expect(persAllowedInSystem(link, 'nova:130', null,
            undefined, undefined)).toBeTrue();
        expect(persAllowedInSystem(link, 'nova:130', 'nova:128',
            federation, undefined)).toBeFalse();
    });

    it('delegates the shared ranges to the flët rules', () => {
        expect(persAllowedInSystem({ type: 'any' }, 'nova:130', null,
            undefined, undefined)).toBeTrue();
        expect(persAllowedInSystem({ type: 'system', id: 'nova:132' },
            'nova:132', null, undefined, undefined)).toBeTrue();
        expect(persAllowedInSystem({ type: 'system', id: 'nova:132' },
            'nova:130', null, undefined, undefined)).toBeFalse();
        expect(persAllowedInSystem(
            { type: 'govtSystems', govt: 'nova:128' },
            'nova:130', 'nova:128', federation, undefined)).toBeTrue();
    });
});

/**
 * shïp AppearOn — "Ships of this type will not show up in dude resources
 * if this expression evaluates to false" (EVN Bible ~:2594) — filters
 * each düde's ship list when the spawn table is built. It is read the way
 * flët AppearOn is read: at genesis, against an EMPTY bit set (the
 * module's multiplayer constraint), from data the table stages anyway,
 * so every peer computes the same table.
 */
describe('buildNpcSpawnTable and shïp AppearOn', () => {
    const SYSTEM = 'test:system';

    function mockData(dudes: Array<{ id: string, ships: string[] }>,
        ships: Record<string, string>) {
        const gameData = new MockGameData();
        for (const [id, appearOn] of Object.entries(ships)) {
            gameData.data.Ship.map.set(id,
                { ...getDefaultShipData(), id, appearOn });
        }
        for (const { id, ships: dudeShips } of dudes) {
            gameData.data.Dude.map.set(id, {
                ...getDefaultDudeData(), id, aiType: 2, govt: null,
                ships: dudeShips.map(ship => ({ id: ship, weight: 1 })),
            });
        }
        const systemData = {
            ...getDefaultSystemData(), id: SYSTEM,
            dudes: dudes.map(({ id }) => ({ id, weight: 1 })),
        };
        gameData.data.System.map.set(SYSTEM, systemData);
        return { gameData, systemData };
    }

    async function tableFor(dudes: Array<{ id: string, ships: string[] }>,
        ships: Record<string, string>) {
        const { gameData, systemData } = mockData(dudes, ships);
        const world = await makeSystem(SYSTEM, gameData, undefined,
            { npcs: false });
        return buildNpcSpawnTable(world, SYSTEM, systemData);
    }

    it('drops a ship class whose AppearOn needs a bit nobody can have set',
        async () => {
            const entries = await tableFor(
                [{ id: 'test:dude', ships: ['test:plain', 'test:gated',
                    'test:negated'] }],
                { 'test:plain': '', 'test:gated': 'b1', 'test:negated': '!b1' });
            expect(entries.length).toBe(1);
            expect(entries[0].dude?.ships.map(({ id }) => id))
                .toEqual(['test:plain', 'test:negated']);
        });

    it('drops the düde altogether when every class is gated, so its weight '
        + 'goes to the rest of the table', async () => {
            const entries = await tableFor([
                { id: 'test:story', ships: ['test:gated', 'test:gated2'] },
                { id: 'test:common', ships: ['test:plain'] },
            ], { 'test:gated': 'b1', 'test:gated2': 'b2 & !b3',
                'test:plain': '' });
            expect(entries.map(entry => entry.dude?.ships.map(({ id }) => id)))
                .toEqual([['test:plain']]);
        });

    it('treats an unparseable AppearOn as false rather than crashing the '
        + 'table', async () => {
            const warn = spyOn(console, 'warn');
            const entries = await tableFor(
                [{ id: 'test:dude', ships: ['test:broken', 'test:plain'] }],
                { 'test:broken': 'b1 &', 'test:plain': '' });
            expect(entries[0].dude?.ships.map(({ id }) => id))
                .toEqual(['test:plain']);
            expect(warn).toHaveBeenCalled();
        });

    it('does not stage a class it filtered out', async () => {
        const { gameData, systemData } = mockData(
            [{ id: 'test:dude', ships: ['test:gated'] }],
            { 'test:gated': 'b1' });
        const world = await makeSystem(SYSTEM, gameData, undefined,
            { npcs: false });
        // Staging a class fetches its sprite sheet (entity_data_loader's
        // loadShipGameData); the filter runs first, so a gated class
        // never reaches it.
        const sheetGet = spyOn(gameData.data.SpriteSheet, 'get')
            .and.callThrough();
        expect(await buildNpcSpawnTable(world, SYSTEM, systemData))
            .toEqual([]);
        expect(sheetGet).not.toHaveBeenCalled();
    });

    it('filters the stock story variants out of real düdes', async () => {
        // düde nova:270 mixes four gated classes (nova:406/407 `b1307`,
        // nova:357 `... & b753`, nova:408 `b324`) with two `!b333` Auroran
        // capitals and an ungated Abomination (nova:246); düde nova:182
        // is four nova:406 and nothing else.
        const gameData = await getIntegrationGameData();
        const world = await makeSystem('nova:130', gameData, undefined,
            { npcs: false });
        const systemData = {
            ...await gameData.data.System.get('nova:130'),
            dudes: [{ id: 'nova:270', weight: 50 },
                { id: 'nova:182', weight: 50 }],
            fleets: [],
        };
        const entries = await buildNpcSpawnTable(world, 'nova:130',
            systemData);
        // (Roaming flëts bound to Sol by LinkSyst join the table too;
        // only the düde entries are under test.)
        expect(entries.filter(entry => entry.dude)
            .map(entry => entry.dude?.ships.map(({ id }) => id)))
            .toEqual([['nova:302', 'nova:255', 'nova:246']]);
    }, 120_000);
});
