import 'jasmine';
import { Angle } from 'nova_ecs/datatypes/angle';
import { Position } from 'nova_ecs/datatypes/position';
import { Vector } from 'nova_ecs/datatypes/vector';
import { MovementStateComponent } from 'nova_ecs/plugins/movement_plugin';
import { restoreWireWorldSnapshot, restoreWorld, snapshotWorld, wireSnapshotWorld, WireWorldSnapshot } from 'nova_ecs/plugins/snapshot_plugin';
import { diffWorldHashes, hashWorld } from 'nova_ecs/plugins/world_hash';
import { World } from 'nova_ecs/world';
import { SYNTHETIC } from 'novaparse/synthetic/universe';
import { deriveEntityComponents } from '../nova_plugin/core/index.js';
import { makeNpc } from '../nova_plugin/npc/index.js';
import { deriveShipPhysics, OutfitsStateComponent, ShipDataComponent, ShipPhysicsComponent } from '../nova_plugin/ship/index.js';
import { completeEntity, loadWireSnapshotGameData } from '../nova_plugin/spawn/index.js';
import { GameDataAggregator } from '../server/parsing/game_data_aggregator.js';
import { compareWorlds, makeDeterminismWorld } from './determinism_harness.js';
import { makeSyntheticGameData } from './simulation_test_fixture.js';

/**
 * Desyncs 2026-11-28 (nova:483 two players + archive, nova:131 and
 * nova:319 single player, archive outvoted): ammo whose oütf carries
 * physics (the plug-in Singularity Torpedo, Accel -0.36 a round) was
 * spent IN PLACE (weapon_plugin consumeAmmo), so the live world kept the
 * ship's physics of its PREVIOUS round count, while every restore
 * (rollback, join, resync) re-derives ShipPhysics from the current count.
 * A peer that rolled back after the spend flew the NPC with more
 * acceleration than one that never restored: the rolled-back peer's
 * replay reproduces the convicted client's hash (7c3f7b98) exactly, and
 * the stale world the room's canonical one (06ecc01a).
 *
 * Here: the synthetic Harrier missile made heavy (Accel -2 a round, on a
 * fresh aggregator of its own), a Gannet Corsair firing it at a Heron
 * Warden.
 */
const HEAVY_AMMO_ACCELERATION = -2;
const AMMO = SYNTHETIC.outfits.missileAmmo;
const CORSAIR = 'corsair';

async function heavyAmmoGameData(): Promise<GameDataAggregator> {
    const gameData = makeSyntheticGameData();
    const ammo = await gameData.data.Outfit.get(AMMO);
    ammo.physics = { ...ammo.physics, acceleration: HEAVY_AMMO_ACCELERATION };
    return gameData;
}

async function corsairFightWorld(gameData: GameDataAggregator): Promise<World> {
    const world = await makeDeterminismWorld(0, 'worker', Promise.resolve(gameData));
    const classes = [SYNTHETIC.ships.warden, SYNTHETIC.ships.corsair];
    for (const [i, x] of [-150, 150].entries()) {
        const npc = makeNpc((await gameData.data.Ship.get(classes[i]))!);
        const movement = npc.components.get(MovementStateComponent)!;
        movement.position = new Position(x, 0);
        movement.rotation = new Angle(i === 0 ? Math.PI / 2 : -Math.PI / 2);
        movement.velocity = new Vector(0, 0);
        await completeEntity(world, npc);
        world.entities.set(i === 0 ? 'warden' : CORSAIR, npc);
    }
    return world;
}

function ammoLeft(world: World): number {
    return world.entities.get(CORSAIR)?.components
        .get(OutfitsStateComponent)?.get(AMMO)?.count ?? 0;
}

/** Steps until the corsair has spent a missile, then one tick more. */
function stepPastFirstSpend(world: World) {
    const full = ammoLeft(world);
    expect(full).withContext('missiles aboard').toBeGreaterThan(0);
    for (let i = 0; i < 600 && ammoLeft(world) === full; i++) {
        world.step();
    }
    expect(ammoLeft(world)).withContext('a missile spent').toBeLessThan(full);
    world.step();
}

describe('Ammo that carries physics', () => {
    let gameData: GameDataAggregator;
    beforeAll(async () => {
        gameData = await heavyAmmoGameData();
    });

    it('keeps the live ship physics equal to what a restore derives', async () => {
        const world = await corsairFightWorld(gameData);
        const corsair = world.entities.get(CORSAIR)!;
        const before = corsair.components.get(ShipPhysicsComponent)!.acceleration;
        stepPastFirstSpend(world);

        const live = corsair.components.get(ShipPhysicsComponent)!;
        const derived = deriveShipPhysics(
            corsair.components.get(ShipDataComponent)!, gameData,
            corsair.components.get(OutfitsStateComponent)!)!;
        expect(live).toEqual(derived);
        // A spent heavy round makes the ship faster.
        expect(live.acceleration).toBeGreaterThan(before);
    });

    it('a world wire-restored after the spend stays in lockstep', async () => {
        const source = await corsairFightWorld(gameData);
        stepPastFirstSpend(source);
        const onTheWire = JSON.parse(JSON.stringify(
            wireSnapshotWorld(source))) as WireWorldSnapshot;
        const target = await makeDeterminismWorld(0, 'worker',
            Promise.resolve(gameData));
        await loadWireSnapshotGameData(target, onTheWire);
        restoreWireWorldSnapshot(target, onTheWire, deriveEntityComponents);

        const result = await compareWorlds(source, target, 120, console.error);
        expect(result.divergedAtStep).toBeUndefined();
        expect(result.differences).toEqual([]);
    });

    it('a rollback onto a tick after the spend retraces the live timeline', async () => {
        const world = await corsairFightWorld(gameData);
        stepPastFirstSpend(world);
        const checkpoint = snapshotWorld(world);
        for (let i = 0; i < 60; i++) {
            world.step();
        }
        const live = hashWorld(world);

        restoreWorld(world, checkpoint, deriveEntityComponents);
        for (let i = 0; i < 60; i++) {
            world.step();
        }
        expect(diffWorldHashes(live, hashWorld(world))).toEqual([]);
    });
});
