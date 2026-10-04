import 'jasmine';
import { Angle } from 'nova_ecs/datatypes/angle';
import { Position } from 'nova_ecs/datatypes/position';
import { Vector } from 'nova_ecs/datatypes/vector';
import { Entity } from 'nova_ecs/entity';
import { MovementStateComponent } from 'nova_ecs/plugins/movement_plugin';
import { restoreWireWorldSnapshot, restoreWorld, snapshotWorld, SnapshotPoliciesResource, wireSnapshotWorld, WireWorldSnapshot } from 'nova_ecs/plugins/snapshot_plugin';
import { diffWorldHashes, hashWorld } from 'nova_ecs/plugins/world_hash';
import { World } from 'nova_ecs/world';
import { SYNTHETIC } from 'novaparse/synthetic/universe';
import { completeEntity, loadWireSnapshotGameData, NpcSpawnerComponent } from '../nova_plugin/spawn/index.js';
import { deriveEntityComponents, EntityDeriversResource } from '../nova_plugin/core/index.js';
import { BayFighterComponent } from '../nova_plugin/escorts/index.js';
import { makeNpc, NpcComponent } from '../nova_plugin/npc/index.js';
import { makeSystem } from '../nova_plugin/make_system.js';
import { MessageType } from './communicator_message.js';
import { compareWorlds, makeDeterminismWorld } from './determinism_harness.js';
import { PROTOCOL_VERSION } from './rollback_protocol.js';
import { applyInputRecords } from './simulation_input.js';
import { getSyntheticGameData } from './simulation_test_fixture.js';
import { decodeWireOrThrow } from './wire_codec.js';
import { liveWireCodec, WireMessage, WireMessageType } from './wire_schemas.js';

/**
 * On the synthetic data set. A Heron Warden and a Gannet Corsair at
 * close range: the corsair's guided missiles against the warden's point
 * defence, the warden's beam, turret bolts and bay-launched skiffs,
 * damage on both — every transient combat entity within a few hundred
 * ticks.
 */
async function addFightingShips(world: World) {
    const gameData = await getSyntheticGameData();
    const classes = [SYNTHETIC.ships.warden, SYNTHETIC.ships.corsair];
    for (const [i, x] of [-150, 150].entries()) {
        const data = await gameData.data.Ship.get(classes[i]);
        const npc = makeNpc(data!);
        const movement = npc.components.get(MovementStateComponent)!;
        movement.position = new Position(x, 0);
        movement.rotation = new Angle(i === 0 ? Math.PI / 2 : -Math.PI / 2);
        movement.velocity = new Vector(0, 0);
        await completeEntity(world, npc);
        world.entities.set(`fighter ${i}`, npc);
    }
}

/**
 * The completeness gate for wire snapshots: capture a mid-combat world
 * as JSON, restore it into a *different* world instance, and require
 * lockstep bit-identical simulation afterwards. Any simulation state a
 * wire snapshot fails to carry (or carries inexactly) diverges here.
 */
/** The fighting world before its first step, with held controls. */
async function fightingWorld(): Promise<World> {
    const source = await makeDeterminismWorld(0, 'worker', getSyntheticGameData());
    await addFightingShips(source);
    // Held-control state on the player ship crosses the wire too.
    applyInputRecords(source, [{
        peerId: 'test peer',
        tick: 1,
        inputs: [{
            kind: 'control',
            events: [
                { action: 'firePrimary', state: 'start' },
                { action: 'accelerate', state: 'start' },
            ],
        }],
    }]);
    return source;
}

/**
 * A mid-combat source world, captured ON a bay-launch tick: the
 * warden's skiffs launch at 240, so the capture holds fighters inserted
 * during the very step before it. That used to be stepped past, hiding
 * #134 (a launched fighter derived its components a step later than a
 * restore derived them); a launch tick is now part of the gate.
 */
async function midCombatWorld(): Promise<World> {
    const source = await fightingWorld();
    let launched: string[] = [];
    for (let i = 0; i < 240; i++) {
        launched = stepCollectingInsertions(source)
            .filter(([, entity]) => entity.components.has(BayFighterComponent))
            .map(([uuid]) => uuid);
    }
    expect(launched).withContext('fighters launched on the capture tick')
        .not.toEqual([]);
    // The capture must contain transient combat entities
    // (missiles, bolts), or this test proves nothing about them.
    expect(source.entities.size).toBeGreaterThan(8);
    return source;
}

/**
 * Steps `world` once and returns the entities the step inserted — the
 * mid-tick spawns (a map diff: an entity deleted in the same step is
 * not a spawn a capture can see).
 */
function stepCollectingInsertions(world: World): [string, Entity][] {
    const before = new Set(world.entities.keys());
    world.step();
    return [...world.entities].filter(([uuid]) => !before.has(uuid));
}

/**
 * The derivers an entity is still owed: its requirements are met, yet
 * the component it provides is missing. A world restored from a
 * snapshot runs every one of them at once (deriveEntityComponents), so
 * an entity the live world holds with any outstanding forks the two.
 */
function outstandingDerivers(world: World, entity: Entity): string[] {
    return (world.resources.get(EntityDeriversResource) ?? [])
        .filter(deriver => !entity.components.has(deriver.provided)
            && deriver.requires.every(
                component => entity.components.has(component)))
        .map(deriver => deriver.name);
}

/**
 * Steps `world` until a step inserts an entity `isSpawn` accepts, and
 * requires every entity inserted along the way to have been inserted
 * FULLY FORMED — no deriver outstanding — since a restore would derive
 * it on the spot. Returns the capture tick's spawns.
 */
function stepToSpawnTick(world: World,
    isSpawn: (entity: Entity) => boolean, maxSteps: number): string[] {
    for (let i = 0; i < maxSteps; i++) {
        const inserted = stepCollectingInsertions(world);
        for (const [uuid, entity] of inserted) {
            expect(outstandingDerivers(world, entity))
                .withContext(`derivers outstanding on ${uuid} after its spawn`)
                .toEqual([]);
        }
        const spawns = inserted.filter(([, entity]) => isSpawn(entity));
        if (spawns.length > 0) {
            return spawns.map(([uuid]) => uuid);
        }
    }
    throw new Error(`no spawn within ${maxSteps} steps`);
}

/**
 * The #134 gate: a world restored from `source`'s wire snapshot, taken
 * on a spawn tick, hashes as the live world at step 0 and step 1 — and
 * stays in lockstep a while after.
 */
async function requireSpawnTickRestore(source: World,
    makeTarget: () => Promise<World>) {
    const onTheWire = JSON.parse(JSON.stringify(
        wireSnapshotWorld(source))) as WireWorldSnapshot;
    const target = await makeTarget();
    await loadWireSnapshotGameData(target, onTheWire);
    restoreWireWorldSnapshot(target, onTheWire, deriveEntityComponents);

    expect(diffWorldHashes(hashWorld(source), hashWorld(target)))
        .withContext('step 0').toEqual([]);
    source.step();
    target.step();
    expect(diffWorldHashes(hashWorld(source), hashWorld(target)))
        .withContext('step 1').toEqual([]);
    const result = await compareWorlds(source, target, 60, console.error);
    expect(result.divergedAtStep).toBeUndefined();
}

/**
 * The rollback half of #134: restoring the in-memory checkpoint of a
 * spawn tick (restoreWorld, as the rollback driver does) and
 * resimulating must retrace the live timeline, step 0 and step 1.
 */
function requireSpawnTickRollback(world: World) {
    const checkpoint = snapshotWorld(world);
    const live0 = hashWorld(world);
    world.step();
    const live1 = hashWorld(world);

    restoreWorld(world, checkpoint, deriveEntityComponents);
    expect(diffWorldHashes(live0, hashWorld(world)))
        .withContext('step 0').toEqual([]);
    world.step();
    expect(diffWorldHashes(live1, hashWorld(world)))
        .withContext('step 1').toEqual([]);
}

/** Restores `onTheWire` into a fresh world and requires lockstep. */
async function requireLockstep(source: World, onTheWire: WireWorldSnapshot) {
    const target = await makeDeterminismWorld(0, 'worker', getSyntheticGameData());
    await loadWireSnapshotGameData(target, onTheWire);
    restoreWireWorldSnapshot(target, onTheWire, deriveEntityComponents);

    expect(hashWorld(target).hash).toEqual(hashWorld(source).hash);
    const result = await compareWorlds(source, target, 240, console.error);
    expect(result.divergedAtStep).toBeUndefined();
    expect(result.differences).toEqual([]);
}

describe('Wire snapshots', () => {
    it('a wire-restored world continues in lockstep with the original (JSON archive)', async () => {
        const source = await midCombatWorld();
        const snapshot = wireSnapshotWorld(source);
        const policies = source.resources.get(SnapshotPoliciesResource)!;
        // An unhandled component is silently lost state.
        expect([...policies.unhandledWire]).toEqual([]);

        // The persisted forms (room archives, desync dumps) carry
        // JSON, nothing richer; the toJsonSafe sentinels keep −0/NaN.
        const onTheWire = JSON.parse(
            JSON.stringify(snapshot)) as WireWorldSnapshot;
        await requireLockstep(source, onTheWire);
    }, 120_000);

    it('a world restored from a baseline received over the live Avro wire hashes as the sender', async () => {
        // The desync hash must agree between the peer that SENT a
        // catch-up and the peer that received it: the baseline crosses
        // as the live socket's bytes (every envelope, the rollback
        // protocol's catchUp, the wire snapshot inside it — whose
        // game-data components are references) and the receiver
        // stages, restores and hashes.
        const source = await midCombatWorld();
        const snapshot = wireSnapshotWorld(source);
        const sent: WireMessage = {
            message: {
                type: MessageType.message, source: 'server', message: {
                    room: 'nova:129', message: {
                        rollback: {
                            kind: 'catchUp', tick: 300, records: [],
                            baseline: { tick: 300, snapshot },
                        },
                    },
                },
            },
        };
        const codec = liveWireCodec();
        expect(codec.encoding).toBe('avro');
        const frame = codec.encode(WireMessageType.encode(sent));
        // Smaller than the JSON wire carried, with the references.
        expect(frame.length).toBeLessThan(JSON.stringify(sent).length);
        const received = decodeWireOrThrow(codec, WireMessageType, frame);
        const rollback = received.message?.type === MessageType.message
            ? received.message.message.message?.rollback : undefined;
        if (rollback?.kind !== 'catchUp' || !rollback.baseline) {
            throw new Error('the catch-up did not survive the wire');
        }
        expect(PROTOCOL_VERSION).toBe(8);
        await requireLockstep(source, rollback.baseline.snapshot);
    }, 120_000);
});

/**
 * #134 / #151: a ship spawned mid-tick must be inserted fully formed.
 * One the provider systems finished a step later held no ShipData,
 * outfits or physics at the end of its spawn tick, while a snapshot of
 * that tick restored it with all of them derived — so a late joiner
 * whose baseline landed there, or a peer rolling back onto it, hashed
 * differently from the live world at step 0 and then forked.
 */
describe('Snapshots taken on a spawn tick', () => {
    const isBayFighter = (entity: Entity) =>
        entity.components.has(BayFighterComponent);

    it('a bay launch: the wire-restored world hashes as the live one', async () => {
        const source = await fightingWorld();
        stepToSpawnTick(source, isBayFighter, 600);
        await requireSpawnTickRestore(source,
            () => makeDeterminismWorld(0, 'worker', getSyntheticGameData()));
    }, 120_000);

    it('a bay launch: a rollback onto the launch tick retraces the live timeline', async () => {
        const source = await fightingWorld();
        stepToSpawnTick(source, isBayFighter, 600);
        requireSpawnTickRollback(source);
    }, 120_000);

    /** Thessaly Reach (AvgShips 6), one respawn owed and due now. */
    async function respawningSystem(): Promise<World> {
        const world = await makeSystem(SYNTHETIC.systems.thessaly,
            await getSyntheticGameData(), 'worker');
        const spawner = world.entities.get('npc spawner')!
            .components.get(NpcSpawnerComponent)!;
        const live = [...world.entities.values()]
            .filter(entity => entity.components.has(NpcComponent)).length;
        spawner.targetCount = live + 1;
        spawner.nextSpawn = 0;
        return world;
    }
    const isNpc = (entity: Entity) => entity.components.has(NpcComponent);

    it('an npc spawn: the wire-restored world hashes as the live one', async () => {
        const source = await respawningSystem();
        stepToSpawnTick(source, isNpc, 60);
        await requireSpawnTickRestore(source, async () => makeSystem(
            SYNTHETIC.systems.thessaly, await getSyntheticGameData(), 'worker'));
    }, 120_000);

    it('an npc spawn: a rollback onto the spawn tick retraces the live timeline', async () => {
        const source = await respawningSystem();
        stepToSpawnTick(source, isNpc, 60);
        requireSpawnTickRollback(source);
    }, 120_000);
});
