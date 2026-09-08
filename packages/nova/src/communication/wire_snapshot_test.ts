import 'jasmine';
import { Angle } from 'nova_ecs/datatypes/angle';
import { Position } from 'nova_ecs/datatypes/position';
import { Vector } from 'nova_ecs/datatypes/vector';
import { MovementStateComponent } from 'nova_ecs/plugins/movement_plugin';
import { restoreWireWorldSnapshot, SnapshotPoliciesResource, wireSnapshotWorld, WireWorldSnapshot } from 'nova_ecs/plugins/snapshot_plugin';
import { hashWorld } from 'nova_ecs/plugins/world_hash';
import { World } from 'nova_ecs/world';
import { SYNTHETIC } from 'novaparse/synthetic/universe';
import { completeEntity, loadWireSnapshotGameData } from '../nova_plugin/spawn/index.js';
import { deriveEntityComponents } from '../nova_plugin/core/index.js';
import { makeNpc } from '../nova_plugin/npc/index.js';
import { ShipComponent, ShipDataComponent } from '../nova_plugin/ship/index.js';
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
/**
 * A mid-combat source world with held controls, stepped past any
 * launch tick so a capture judges the wire alone (see the comment on
 * the derive-at-restore asymmetry below).
 */
async function midCombatWorld(): Promise<World> {
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
        for (let i = 0; i < 240; i++) {
            source.step();
        }
        // A ship spawned mid-tick (a bay fighter) gets its derived
        // components (ShipData, outfits, physics...) from the provider
        // systems on the NEXT step, whereas restoring a snapshot derives
        // them immediately. Capturing on a launch tick therefore hashes
        // the restored fighter with a ShipData the source's does not have
        // yet — an asymmetry of the derive-at-restore path, not of the
        // wire. Step past any such tick so the gate below judges the
        // wire alone. (Surfaced when the weapon reload floor moved the
        // carriers' launch ticks onto 240.)
        const undrivedShip = () => [...source.entities.values()].some(entity =>
            entity.components.has(ShipComponent)
            && !entity.components.has(ShipDataComponent));
        while (undrivedShip()) {
            source.step();
        }
        // The capture must contain transient combat entities
        // (missiles, bolts), or this test proves nothing about them.
        expect(source.entities.size).toBeGreaterThan(8);
        return source;
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
        expect(PROTOCOL_VERSION).toBe(7);
        await requireLockstep(source, rollback.baseline.snapshot);
    }, 120_000);
});
