import 'jasmine';
import { MovementStateComponent } from 'nova_ecs/plugins/movement_plugin';
import { SYNTHETIC } from 'novaparse/synthetic/universe';
import { getSyntheticGameData } from '../../communication/simulation_test_fixture.js';
import { FiringGroupComponent } from '../ship/firing_group.js';
import { GovtComponent } from '../core/govt_component.js';
import { makeSystem } from '../make_system.js';
import { FormationComponent, NpcComponent } from './npc_ai_plugin.js';
import { NpcSpawnerComponent, spawnNpc } from '../spawn/npc_spawn_plugin.js';
import { IdFactoryResource } from '../core/id_factory.js';
import { ShipComponent } from '../ship/ship_plugin.js';
import { Entity } from 'nova_ecs/entity';
import { RandomResource } from 'nova_ecs/plugins/random_plugin';
import { World } from 'nova_ecs/world';

/**
 * NPC population against parsed Nova data — the synthetic set. Thessaly
 * Reach has AvgShips 6 and a two-entry dude table (Meridian traders in
 * skiffs, a Meridian patrol in wardens), so both trader and combat AI
 * types appear and every spawn is governed; Kestrel Drift adds a raider
 * dude and the Raider Wing fleet, so fleet spawns with escorts appear.
 */
describe('NPC spawning in a parsed system', () => {
    const THESSALY = SYNTHETIC.systems.thessaly;

    function npcs(world: World) {
        return [...world.entities]
            .filter(([, entity]) => entity.components.has(NpcComponent));
    }

    it('spawns a deterministic population: same seed, same ships',
        async () => {
            const gameData = await getSyntheticGameData();
            const worldA = await makeSystem(THESSALY, gameData);
            const worldB = await makeSystem(THESSALY, gameData);

            const describeNpcs = (world: World) => npcs(world)
                .map(([uuid, entity]) => ({
                    uuid,
                    ship: entity.components.get(ShipComponent)?.id,
                    govt: entity.components.get(GovtComponent)?.id,
                    aiType: entity.components.get(NpcComponent)?.aiType,
                    position: {
                        x: entity.components.get(MovementStateComponent)
                            ?.position.x,
                        y: entity.components.get(MovementStateComponent)
                            ?.position.y,
                    },
                }));

            const a = describeNpcs(worldA);
            expect(a.length).toBeGreaterThan(0);
            expect(a).toEqual(describeNpcs(worldB));

            // The spawner rolled the same target on both worlds.
            const spawner = (world: World) => world.entities
                .get('npc spawner')?.components.get(NpcSpawnerComponent);
            expect(spawner(worldA)?.targetCount)
                .toEqual(spawner(worldB)?.targetCount);
        }, 120_000);

    it('rolls the population target within AvgShips +/- 50%', async () => {
        const gameData = await getSyntheticGameData();
        const world = await makeSystem(THESSALY, gameData);
        const spawner = world.entities.get('npc spawner')!
            .components.get(NpcSpawnerComponent)!;
        // Thessaly Reach: AvgShips 6.
        expect(spawner.targetCount).toBeGreaterThanOrEqual(3);
        expect(spawner.targetCount).toBeLessThanOrEqual(9);
        expect(spawner.entries.length).toBeGreaterThan(0);
    }, 120_000);

    it('gives NPCs their dude class govt and a valid AI type', async () => {
        const gameData = await getSyntheticGameData();
        const world = await makeSystem(THESSALY, gameData);
        for (const [, entity] of npcs(world)) {
            const npc = entity.components.get(NpcComponent)!;
            expect(npc.aiType).toBeGreaterThanOrEqual(1);
            expect(npc.aiType).toBeLessThanOrEqual(4);
        }
        // Thessaly's dude table is entirely Meridian: every dude spawn
        // carries a GovtComponent. Fleet spawns need not in general (a
        // flët may fly under Govt -1); fleet membership is the
        // FiringGroupComponent every fleet spawn shares.
        for (const [, entity] of npcs(world)) {
            if (entity.components.has(FiringGroupComponent)) {
                continue;
            }
            expect(entity.components.get(GovtComponent))
                .toEqual({ id: SYNTHETIC.govts.meridian });
        }
    }, 120_000);

    it('traders pick planets and set off; ships stay simulated',
        async () => {
            const gameData = await getSyntheticGameData();
            const world = await makeSystem(THESSALY, gameData);

            // Step past the first decision interval.
            for (let i = 0; i < 120; i++) {
                world.step();
            }

            const states = npcs(world).map(([, entity]) =>
                entity.components.get(NpcComponent)!);
            expect(states.length).toBeGreaterThan(0);
            // Every NPC has decided something by now.
            for (const npc of states) {
                expect(npc.mode).toBeDefined();
            }
            const traders = states.filter(
                npc => npc.aiType === 1 || npc.aiType === 2);
            // Thessaly's table is trader-heavy; expect at least one, and
            // every trader to be working the planet loop (or already
            // fleeing/departing if a warship picked on it, which the
            // patrol, the traders' own government, does not).
            expect(traders.length).toBeGreaterThan(0);
            for (const trader of traders) {
                expect(['travel', 'dwell', 'depart'])
                    .toContain(trader.mode!);
                if (trader.mode === 'travel') {
                    expect(trader.destination).toMatch(/^planet /);
                }
            }
        }, 120_000);

    it('replaces departed NPCs at the system edge', async () => {
        const gameData = await getSyntheticGameData();
        const world = await makeSystem(THESSALY, gameData);
        const spawner = world.entities.get('npc spawner')!
            .components.get(NpcSpawnerComponent)!;
        const before = npcs(world).map(([uuid]) => uuid);

        // With the timer pushed out, a deleted NPC is NOT immediately
        // replaced: the interval gates the refill.
        spawner.nextSpawn = 10 * 60 * 1000;
        world.entities.delete(before[0]);
        for (let i = 0; i < 5; i++) {
            world.step();
        }
        expect(npcs(world).length).toBe(before.length - 1);
        // Fast-forward the timer: the spawner refills. The refill is
        // gated on population < targetCount, and the rolled target can
        // legitimately sit at or below the spawned population (fleet
        // rolls bring escorts along, overshooting the target), so set
        // the target explicitly rather than relying on the roll.
        spawner.targetCount = before.length + 1;
        spawner.nextSpawn = 0;
        for (let i = 0; i < 5; i++) {
            world.step();
        }
        const after = npcs(world);
        expect(after.length).toBeGreaterThanOrEqual(before.length);
        // The replacement jumped in at the edge (outside the no-jump
        // zone), not into the middle of the system.
        const fresh = after.filter(([uuid]) => !before.includes(uuid));
        expect(fresh.length).toBeGreaterThan(0);
        for (const [, entity] of fresh) {
            const movement = entity.components.get(MovementStateComponent)!;
            expect(movement.position.length).toBeGreaterThan(900);
        }
    }, 120_000);

    it('fleet escorts spawn in formation on their leader', async () => {
        const gameData = await getSyntheticGameData();
        // The invariant: every escort's leader exists and is an NPC of
        // the same government, sharing one firing group (friendly-fire
        // immunity; see firing_group.ts).
        function expectInFormation(world: World, entity: Entity) {
            const formation = entity.components.get(FormationComponent)!;
            const leader = world.entities.get(formation.leader);
            expect(leader).toBeDefined();
            expect(leader!.components.has(NpcComponent)).toBeTrue();
            expect(entity.components.get(GovtComponent)?.id)
                .toEqual(leader!.components.get(GovtComponent)?.id);
            expect(entity.components.get(FiringGroupComponent))
                .toEqual({ group: formation.leader });
            expect(leader!.components.get(FiringGroupComponent))
                .toEqual({ group: formation.leader });
        }
        // Holds for whatever the seeded genesis rolls drew, in every
        // system of the scenario...
        for (const systemId of Object.values(SYNTHETIC.systems)) {
            const world = await makeSystem(systemId, gameData);
            for (const [, entity] of npcs(world)) {
                if (entity.components.has(FormationComponent)) {
                    expectInFormation(world, entity);
                }
            }
        }
        // ...and is exercised for certain, not by hoping the 40% Raider
        // Wing entry won a roll: Kestrel Drift's spawn TABLE carries the
        // wing (a Corsair leading 1-2 Corsairs), so draw from that entry
        // alone with the world's own Random and id factory.
        const world = await makeSystem(SYNTHETIC.systems.kestrel, gameData);
        const spawner = world.entities.get('npc spawner')!
            .components.get(NpcSpawnerComponent)!;
        // (Twice: once from the sÿst DudeTypes entry, once as a roaming
        // LinkSyst fleet; both are the wing.)
        const wings = spawner.entries.filter(entry => entry.fleet);
        expect(wings.length).toBeGreaterThan(0);
        for (const { fleet } of wings) {
            expect(fleet!.leadShip).toBe(SYNTHETIC.ships.corsair);
            expect(fleet!.escorts).toEqual([
                { id: SYNTHETIC.ships.corsair, min: 1, max: 2 }]);
        }
        const before = new Set(npcs(world).map(([uuid]) => uuid));
        const spawned = spawnNpc(world, gameData,
            world.resources.get(IdFactoryResource)!,
            world.resources.get(RandomResource)!, [wings[0]], true);
        const fresh = npcs(world).filter(([uuid]) => !before.has(uuid));
        expect(fresh.length).toBe(spawned);
        const escorts = fresh.filter(([, entity]) =>
            entity.components.has(FormationComponent));
        expect(escorts.length).toBeGreaterThanOrEqual(1);
        expect(escorts.length).toBeLessThanOrEqual(2);
        expect(fresh.length).toBe(escorts.length + 1);
        for (const [, escort] of escorts) {
            expectInFormation(world, escort);
            expect(fresh.map(([uuid]) => uuid)).toContain(
                escort.components.get(FormationComponent)!.leader);
        }
    }, 240_000);
});
