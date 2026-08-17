import 'jasmine';
import { Random } from 'nova_ecs/plugins/random_plugin';
import {
    getIntegrationGameData,
    makeSimulationBridgeHarness,
} from '../communication/simulation_test_fixture.js';
import { IdFactory } from './id_factory.js';
import { PersComponent } from './pers_plugin.js';
import { DisabledComponent } from './disabled_component.js';
import { ArmorComponent, ShieldComponent } from './health_plugin.js';
import { ShipDataComponent } from './ship_plugin.js';
import { GOAL_RESCUE } from './mission_ship_state.js';
import { SystemHoldComponent } from './system_hold.js';
import {
    buildPersSpawnTable,
    PersSpawnEntry,
    spawnNpc,
} from './npc_spawn_plugin.js';

/**
 * përs spawning against real Nova data: table construction pins known
 * stock people, and the spawn path is deterministic (same seed, same
 * table => identical people at identical positions on every world).
 */
describe('përs spawning against real Nova data', () => {
    it('parses known stock people', async () => {
        const gameData = await getIntegrationGameData();
        // Jack Folstam, the Night-Master of Booster: a warship pilot
        // bound to sÿst nova:132.
        const jack = await gameData.data.Pers.get('nova:131');
        expect(jack.name).toBe('Jack Folstam');
        expect(jack.subtitle).toBe('Night-Master');
        expect(jack.linkSyst).toEqual({ type: 'system', id: 'nova:132' });
        expect(jack.ship).toBe('nova:279');
        expect(jack.govt).toBe('nova:149');
        expect(jack.aiType).toBe(3);
        // Matt Burch (the game's author, a stock easter-egg përs)
        // roams anywhere.
        const burch = await gameData.data.Pers.get('nova:161');
        expect(burch.name).toBe('Matt Burch');
        expect(burch.subtitle).toBe('31337');
        expect(burch.linkSyst).toEqual({ type: 'any' });
        // nova:128, by contrast, is bound away from one govt's space.
        const terrapin = await gameData.data.Pers.get('nova:128');
        expect(terrapin.name).toBe('Terrapin');
        expect(terrapin.linkSyst)
            .toEqual({ type: 'notGovtSystems', govt: 'nova:135' });
    }, 30_000);

    it("parses Sol's sÿst Person list", async () => {
        const gameData = await getIntegrationGameData();
        const sol = await gameData.data.System.get('nova:130');
        // The four AI-people Sol's Person fields name, with their
        // percent chances, in resource order.
        expect(sol.persons).toEqual([
            { id: 'nova:128', chance: 12 },   // Terrapin
            { id: 'nova:227', chance: 1 },    // Valkyrie
            { id: 'nova:156', chance: 2 },    // Drifting Derelict
            { id: 'nova:299', chance: 15 },   // Galadriel
        ]);
        const names = [];
        for (const { id } of sol.persons) {
            names.push((await gameData.data.Pers.get(id)).name);
        }
        expect(names).toEqual(
            ['Terrapin', 'Valkyrie', 'Drifting Derelict', 'Galadriel']);
    }, 60_000);

    it("draws a listing system's people from its Person fields only",
        async () => {
            const harness = await makeSimulationBridgeHarness();
            const gameData = await getIntegrationGameData();
            const sol = await gameData.data.System.get('nova:130');

            const table = await buildPersSpawnTable(
                harness.world, 'nova:130', sol);
            const again = await buildPersSpawnTable(
                harness.world, 'nova:130', sol);
            expect(table).toEqual(again);

            // Exactly the four listed people, at their listed chances.
            expect(table.map(entry => ({ id: entry.id, chance: entry.chance })))
                .toEqual([
                    { id: 'nova:128', chance: 12 },
                    { id: 'nova:227', chance: 1 },
                    { id: 'nova:156', chance: 2 },
                    { id: 'nova:299', chance: 15 },
                ]);

            // përs nova:180 is a Drifting Derelict Leviathan whose
            // LinkSyst covers every gövt nova:128 system — Sol included
            // — but Sol does not list it, so it can never appear there.
            // (Scanning LinkSyst instead of the Person list is what put
            // a derelict Leviathan at Sol near-constantly.)
            const leviathan = await gameData.data.Pers.get('nova:180');
            expect(leviathan.linkSyst)
                .toEqual({ type: 'govtSystems', govt: 'nova:128' });
            expect(sol.govt).toBe('nova:128');
            expect(table.some(entry => entry.id === 'nova:180')).toBeFalse();

            // LinkSyst does NOT veto an authored entry: Sol's Valkyrie
            // (përs nova:227) is bound to gövt nova:134's systems and
            // listed at Sol anyway — 160 of stock data's 228 Person
            // entries are like this, so ANDing the two would gut them.
            const valkyrie = await gameData.data.Pers.get('nova:227');
            expect(valkyrie.linkSyst)
                .toEqual({ type: 'govtSystems', govt: 'nova:134' });
            expect(table.some(entry => entry.id === 'nova:227')).toBeTrue();
        }, 120_000);

    it('falls back to the LinkSyst pool where no Person list is authored',
        async () => {
            const harness = await makeSimulationBridgeHarness();
            const gameData = await getIntegrationGameData();
            // Fomalhaut lists nobody — like 480 of the 545 stock
            // systems — so LinkSyst is all there is to go on.
            const systemData = await gameData.data.System.get('nova:136');
            expect(systemData.persons).toEqual([]);

            const table = await buildPersSpawnTable(
                harness.world, 'nova:136', systemData);
            const again = await buildPersSpawnTable(
                harness.world, 'nova:136', systemData);
            expect(table).toEqual(again);

            // The whole pool shares the Bible's flat 5% evenly.
            const total = table.reduce((sum, e) => sum + e.chance, 0);
            expect(total).toBeCloseTo(100, 6);
            expect(new Set(table.map(e => e.chance)).size).toBe(1);

            // The Terrapin nova:142 is bound to this very system and
            // named by no system's Person fields: without the fallback
            // it — and hundreds of stock përs like it — could never
            // appear anywhere.
            expect(table.find(entry => entry.id === 'nova:142')).toEqual(
                jasmine.objectContaining({
                    name: 'Terrapin',
                    subtitle: 'Standard',
                    ship: 'nova:136',
                    govt: 'nova:157',
                    aiType: 2,
                }));
            // People not bound to a single system are eligible too
            // (nova:128 is "anywhere except gövt nova:135 space", and
            // Fomalhaut is not in it).
            expect(table.some(entry => entry.id === 'nova:128')).toBeTrue();
            // People bound to other systems are not.
            for (const entry of table) {
                const pers = await gameData.data.Pers.get(entry.id);
                if (pers.linkSyst.type === 'system') {
                    expect(pers.linkSyst.id).toBe('nova:136');
                }
            }
        }, 120_000);

    it('excludes people whose ActiveOn needs a control bit', async () => {
        const harness = await makeSimulationBridgeHarness();
        const gameData = await getIntegrationGameData();

        // The shared-spawn constraint: a person whose ActiveOn needs a
        // set control bit (Jack Folstam, "b0 & !b8") is excluded even
        // when the system's Person fields name him, because per-player
        // bits cannot drive shared spawns (see the npc_spawn_plugin
        // module comment).
        const jackSystem = await gameData.data.System.get('nova:132');
        expect(jackSystem.persons).toContain({ id: 'nova:131', chance: 10 });
        expect((await gameData.data.Pers.get('nova:131')).activeOn)
            .toBe('b0 & !b8');

        const jackTable = await buildPersSpawnTable(
            harness.world, 'nova:132', jackSystem);
        expect(jackTable.some(entry => entry.id === 'nova:131')).toBeFalse();
        // The rest of that system's authored cast survives.
        expect(jackTable.length).toBe(jackSystem.persons.length - 1);
    }, 120_000);

    it('spawns people deterministically, at most one of each',
        async () => {
            const [a, b] = await Promise.all(
                [makeSimulationBridgeHarness(), makeSimulationBridgeHarness()]);
            const gameData = await getIntegrationGameData();
            const systemData =
                await gameData.data.System.get(a.systemId);

            const spawn = async (harness: typeof a) => {
                const table: PersSpawnEntry[] = await buildPersSpawnTable(
                    harness.world, harness.systemId, systemData);
                const random = new Random(1234);
                const ids = new IdFactory();
                // Empty dude table: every draw is purely the përs roll.
                for (let i = 0; i < 200; i++) {
                    spawnNpc(harness.world, gameData, ids, random,
                        [], true, table);
                }
                const people: Array<[string, string, string | undefined]> = [];
                for (const [uuid, entity] of harness.world.entities) {
                    const pers = entity.components.get(PersComponent);
                    if (pers) {
                        people.push([uuid, pers.id, entity.name]);
                    }
                }
                return people;
            };

            const peopleA = await spawn(a);
            const peopleB = await spawn(b);
            // The 5% roll fired at least once over 200 draws.
            expect(peopleA.length).toBeGreaterThan(0);
            // Identical on both worlds: same uuids, same people.
            expect(peopleA).toEqual(peopleB);
            // At most one living instance of each person.
            const ids = peopleA.map(([, id]) => id);
            expect(new Set(ids).size).toBe(ids.length);
        }, 240_000);

    it('consumes exactly one draw per spawn attempt', async () => {
        const harness = await makeSimulationBridgeHarness();
        const gameData = await getIntegrationGameData();
        const sol = await gameData.data.System.get('nova:130');
        const table = await buildPersSpawnTable(harness.world, 'nova:130', sol);
        const ids = new IdFactory();

        // The pers stage must not let transient state (an empty table,
        // a roll that picks nobody, a person already alive) change how
        // much of the PRNG stream it eats, or peers desync.
        const oneDraw = (persEntries: PersSpawnEntry[]) => {
            const random = new Random(4242);
            const reference = new Random(4242);
            spawnNpc(harness.world, gameData, ids, random, [], true,
                persEntries);
            reference.next();
            expect(random.getState()).toEqual(reference.getState());
        };
        oneDraw([]);                                  // no people here
        oneDraw(table.map(e => ({ ...e, chance: 0 })));  // nobody can win
        oneDraw(table);                               // a miss (98.5%)

        // Now with everyone alive: spawn from a saturated table until
        // every listed person exists, then every further attempt must
        // still cost exactly one draw even though its pick is a
        // duplicate that spawns nothing.
        const certain = table.map(e => ({ ...e, chance: 100 }));
        const random = new Random(99);
        const alive = () => [...harness.world.entities.values()]
            .filter(e => e.components.get(PersComponent)).length;
        for (let i = 0; i < 5_000 && alive() < table.length; i++) {
            spawnNpc(harness.world, gameData, ids, random, [], true, certain);
        }
        expect(alive()).toBe(table.length);
        for (let i = 0; i < 100; i++) {
            const before = random.getState();
            spawnNpc(harness.world, gameData, ids, random, [], true, certain);
            const probe = new Random(0);
            probe.setState(before);
            probe.next();
            expect(random.getState()).toEqual(probe.getState());
        }
    }, 120_000);

    it('spawns a Refuel Trader HELD in the system', async () => {
        // Matthew's ruling: "a ship shouldn't leave before being refuelled
        // if it offers a 'refuel me' mission". Sol's authored cast
        // includes përs nova:227 (Valkyrie), whose LinkMission is mïsn
        // nova:141 "Refuel Trader" — ShipGoal 5, "Rescue them" — so she is
        // stranded and must still be there when the player arrives.
        const harness = await makeSimulationBridgeHarness();
        const gameData = await getIntegrationGameData();
        const systemData = await gameData.data.System.get('nova:130');

        const valkyrie = await gameData.data.Pers.get('nova:227');
        expect(valkyrie.linkMission).toBe('nova:141');
        const refuel = await gameData.data.Mission.get('nova:141');
        expect(refuel.name).toBe('Refuel Trader');
        expect(refuel.shipGoal).toBe(GOAL_RESCUE);

        // The flag is resolved at GENESIS, where the mïsn can be awaited
        // — the spawner itself never touches mission data.
        const table = await buildPersSpawnTable(
            harness.world, 'nova:130', systemData);
        expect(table.find(entry => entry.id === 'nova:227')?.holdsForOffer)
            .toBeTrue();
        // ...and nobody else in Sol's cast is held: the Drifting Derelict
        // offers mïsn 134 (ShipGoal 1, "disable"), not a rescue.
        for (const entry of table) {
            if (entry.id !== 'nova:227') {
                expect(entry.holdsForOffer).withContext(entry.id).toBeFalsy();
            }
        }

        // Force her slice of the 5% window and spawn until she appears.
        const certain = table.map(entry => ({
            ...entry, chance: entry.id === 'nova:227' ? 100 : 0,
        }));
        const random = new Random(1234);
        const ids = new IdFactory();
        for (let i = 0; i < 2_000; i++) {
            spawnNpc(harness.world, gameData, ids, random, [], true, certain);
        }
        const spawned = [...harness.world.entities.values()].filter(
            entity => entity.components.get(PersComponent)?.id === 'nova:227');
        expect(spawned.length).toBeGreaterThan(0);
        for (const trader of spawned) {
            expect(trader.components.get(SystemHoldComponent))
                .toEqual({ reason: 'shipOffer' });
        }
    }, 120_000);

    it('spawns Drifting Derelicts already disabled', async () => {
        const harness = await makeSimulationBridgeHarness();
        const gameData = await getIntegrationGameData();
        const systemData = await gameData.data.System.get('nova:130');

        // The Drifting Derelict përs nova:156 is bound to sÿst nova:130
        // and belongs to the derelict govt (nova:160), whose gövt Flags1
        // 0x0800 ("Ships start disabled") makes its ships spawn disabled.
        const table = await buildPersSpawnTable(
            harness.world, 'nova:130', systemData);
        const derelict = table.find(entry => entry.id === 'nova:156');
        expect(derelict).toEqual(jasmine.objectContaining({
            name: 'Drifting Derelict',
            ship: 'nova:129',
            govt: 'nova:160',
        }));

        // Spawn from Sol's real table until the derelict's slice of the
        // 5% window comes up (2% of it => 0.1% per draw, so this needs
        // a lot of draws; deterministic seed, stable and repeatable).
        const random = new Random(1234);
        const ids = new IdFactory();
        for (let i = 0; i < 20_000; i++) {
            spawnNpc(harness.world, gameData, ids, random, [], true, table);
        }
        const hulks = [...harness.world.entities.values()].filter(
            entity => entity.components.get(PersComponent)?.id === 'nova:156');
        expect(hulks.length).toBeGreaterThan(0);

        for (const hulk of hulks) {
            // Disabled from spawn, with no self-repair scheduled, marked
            // as a hulk (disabled regardless of armor).
            const disabled = hulk.components.get(DisabledComponent);
            expect(disabled).toBeDefined();
            expect(disabled!.repairAt).toBeNull();
            expect(disabled!.hulk).toBeTrue();

            // FULL armor and shields: the original's derelicts read
            // "disabled" yet take a whole hull's worth of shots to
            // destroy (Matthew's playtest observation, 2026-08-14).
            const shipData = hulk.components.get(ShipDataComponent);
            const armor = hulk.components.get(ArmorComponent);
            const shield = hulk.components.get(ShieldComponent);
            expect(shipData).toBeDefined();
            expect(armor).toBeDefined();
            expect(armor!.current).toBe(armor!.max);
            expect(shield!.current).toBe(shield!.max);
        }
    }, 120_000);
});
