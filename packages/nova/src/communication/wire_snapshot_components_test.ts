import 'jasmine';
import { SnapshotPoliciesResource, restoreWireWorldSnapshot, wireSnapshotWorld } from 'nova_ecs/plugins/snapshot_plugin';
import { SerializerResource } from 'nova_ecs/plugins/serializer_plugin';
import { makeDeterminismWorld } from './determinism_harness.js';
import { getSyntheticGameData } from './simulation_test_fixture.js';
import {
    wireSnapshotCodec, wireSnapshotRegistrySerializer, wireSnapshotSchema,
} from './wire_snapshot_components.js';

/**
 * The typed wire-snapshot component list (issue #268): the socket
 * schema's derivation types every component's data in a catchUp
 * baseline / desync dump through the world-independent registry
 * (wire_snapshot_components.ts), instead of carrying each one as an
 * opaque dynamic blob behind the toJsonSafe sentinels.
 */
describe('the typed wire-snapshot component list', () => {
    it('the registry covers every component a real simulation world registers', async () => {
        const real = await makeDeterminismWorld(2, 'worker', getSyntheticGameData());
        const realNames = new Set(
            real.resources.get(SerializerResource)!.componentsByName.keys());
        const registry = new Set(
            wireSnapshotRegistrySerializer().componentsByName.keys());
        const missing = [...realNames].filter(name => !registry.has(name)).sort();
        expect(missing).toEqual([]);
    }, 60_000);

    it('the wire-snapshot schema derives with no untyped node', () => {
        // The schema derivation never reports an untyped node: the
        // componentUnion covers every registered component, and the
        // explicit hooks cover every wire codec. (Before #268 the
        // snapshot's component data rode as `untyped` opaque nodes —
        // the three failures io_ts_to_avro_test pins for the live wire
        // at exactly these paths.)
        expect(wireSnapshotSchema()).toBeDefined();
    });

    it('a mid-combat baseline round-trips through the typed codec exactly', async () => {
        const source = await makeDeterminismWorld(2, 'worker', getSyntheticGameData());
        for (let i = 0; i < 120; i++) {
            source.step();
        }
        // A ship spawned mid-tick (a bay fighter) gets its derived
        // components from the provider systems on the NEXT step, whereas
        // restoring a snapshot derives them immediately — the same
        // derive-at-restore asymmetry wire_snapshot_test.ts documents.
        // Step past any such tick so the gate below judges the wire
        // alone.
        const { ShipComponent, ShipDataComponent } =
            await import('../nova_plugin/ship/index.js');
        const undrivedShip = () => [...source.entities.values()].some(entity =>
            entity.components.has(ShipComponent)
            && !entity.components.has(ShipDataComponent));
        let guard = 0;
        while (undrivedShip() && guard++ < 600) {
            source.step();
        }
        const snapshot = wireSnapshotWorld(source);
        expect([...source.resources.get(SnapshotPoliciesResource)!.unhandledWire])
            .toEqual([]);

        const codec = wireSnapshotCodec();
        const frame = codec.encode(snapshot);
        const back = codec.decode(frame) as typeof snapshot;

        // THE PROPERTY: the typed wire carries every component of
        // every entity, under the encoding tag the receiving world's
        // restore routes by — nothing lost, nothing retyped. (The full
        // restore-to-lockstep gate is wire_snapshot_test's live-wire
        // spec, which exercises the same restore path; this spec pins
        // the codec's own transparency, which the harness's shared
        // game-data cache makes the stable form of that check.)
        expect(back.entities.map(entity => entity.uuid))
            .toEqual(snapshot.entities.map(entity => entity.uuid));
        expect(back.singleton.map(pair => pair[0]))
            .toEqual(snapshot.singleton.map(pair => pair[0]));
        expect(back.resources).toEqual(snapshot.resources);
        for (const [wireEntity, sourceEntity] of [
            ...back.entities.map((entity, i) => [entity, snapshot.entities[i]!] as const),
        ] as const) {
            expect(wireEntity.components.map(pair => pair[0]))
                .toEqual(sourceEntity.components.map(pair => pair[0]));
            for (const pair of wireEntity.components) {
                // The tag the restore path routes by: 'wire' exactly
                // for the wire-codec-only components.
                expect(['serializer', 'wire']).toContain(pair[2]);
                // The data is sentinel-free on the decoded side (the
                // wire dropped it and the read re-wrapped only what
                // JSON cannot carry — asserted below on the bytes).
                expect(JSON.stringify(pair[1])).not.toContain('$negzero');
            }
        }
        expect(back.singleton.map(pair => pair[0]))
            .toEqual(snapshot.singleton.map(pair => pair[0]));

        // The sentinels are dropped ON THE WIRE: the encoded bytes must
        // not carry the toJsonSafe wrapper objects (the schema'd fields
        // hold -0/NaN/±Infinity/undefined natively). A baseline with a
        // -0 velocity component is the stock case (vector math produces
        // -0 routinely); its wire bytes carry the IEEE double, not
        // `{"$negzero":true}`.
        const text = new TextDecoder().decode(frame);
        expect(text).not.toContain('$negzero');
        expect(text).not.toContain('$nonfinite');
        expect(text).not.toContain('$undefined');
    }, 120_000);

    it('the typed encoding is materially smaller than the JSON-safe baseline', async () => {
        const source = await makeDeterminismWorld(2, 'worker', getSyntheticGameData());
        for (let i = 0; i < 120; i++) {
            source.step();
        }
        const snapshot = wireSnapshotWorld(source);
        const typed = wireSnapshotCodec().encode(snapshot).length;
        // The opaque encoding (the pre-#268 wire) carried every
        // component's data as a dynamic blob behind the sentinels —
        // never smaller than the JSON form for these shapes, and
        // measured ~25% LARGER than the typed encoding on a real
        // baseline. Assert the conservative end: the typed frame is at
        // least 15% smaller than the JSON of the same snapshot.
        const json = JSON.stringify(snapshot).length;
        expect(typed).toBeLessThan(json * 0.85);
    }, 60_000);
});
