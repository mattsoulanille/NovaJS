import 'jasmine';
import { Angle } from 'nova_ecs/datatypes/angle';
import { Position } from 'nova_ecs/datatypes/position';
import { Vector } from 'nova_ecs/datatypes/vector';
import { MovementStateComponent } from 'nova_ecs/plugins/movement_plugin';
import { restoreWireWorldSnapshot, SnapshotPoliciesResource, wireSnapshotWorld, WireWorldSnapshot } from 'nova_ecs/plugins/snapshot_plugin';
import { hashWorld } from 'nova_ecs/plugins/world_hash';
import { World } from 'nova_ecs/world';
import { SYNTHETIC } from 'novaparse/synthetic/universe';
import { completeEntity, loadWireSnapshotGameData } from '../nova_plugin/spawn/entity_data_loader.js';
import { deriveEntityComponents } from '../nova_plugin/core/entity_factory.js';
import { makeNpc } from '../nova_plugin/npc/npc_plugin.js';
import { ShipComponent, ShipDataComponent } from '../nova_plugin/ship/ship_plugin.js';
import { compareWorlds, makeDeterminismWorld } from './determinism_harness.js';
import { applyInputRecords } from './simulation_input.js';
import { getSyntheticGameData } from './simulation_test_fixture.js';

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
describe('Wire snapshots', () => {
    it('a wire-restored world continues in lockstep with the original', async () => {
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

        const snapshot = wireSnapshotWorld(source);
        const policies = source.resources.get(SnapshotPoliciesResource)!;
        // An unhandled component is silently lost state.
        expect([...policies.unhandledWire]).toEqual([]);

        // The wire carries JSON, nothing richer.
        const onTheWire = JSON.parse(
            JSON.stringify(snapshot)) as WireWorldSnapshot;

        const target = await makeDeterminismWorld(0, 'worker', getSyntheticGameData());
        await loadWireSnapshotGameData(target, onTheWire);
        restoreWireWorldSnapshot(target, onTheWire, deriveEntityComponents);

        expect(hashWorld(target).hash).toEqual(hashWorld(source).hash);
        const result = await compareWorlds(source, target, 240, console.error);
        expect(result.divergedAtStep).toBeUndefined();
        expect(result.differences).toEqual([]);
    }, 120_000);
});
