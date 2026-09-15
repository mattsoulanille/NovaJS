import 'jasmine';
import * as t from 'io-ts';
import { Component, UnknownComponent } from 'nova_ecs/component';
import { SerializerResource } from 'nova_ecs/plugins/serializer_plugin';
import { SnapshotPoliciesResource, wireSnapshotWorld, WireWorldSnapshot } from 'nova_ecs/plugins/snapshot_plugin';
import { MessageType } from './communicator_message.js';
import { avscReferenceCodec } from './avsc_reference.js';
import { makeDeterminismWorld } from './determinism_harness.js';
import { deriveAvroSchema } from './io_ts_to_avro.js';
import { ExplosionDataComponent } from '../nova_plugin/core/index.js';
import { Target } from '../nova_plugin/ship/index.js';
import { getSyntheticGameData } from './simulation_test_fixture.js';
import { avroWireCodec, AvroWireCodec, decodeWireOrThrow } from './wire_codec.js';
import { liveWireCodec, novaCodecHooks, WireMessage, WireMessageType } from './wire_schemas.js';
import {
    assertWireRegistryCovers, wireRegistryMissing, wireSnapshotRegistrySerializer,
} from './wire_snapshot_components.js';

/**
 * The typed wire-snapshot component list (issue #268): the live socket
 * schema types every component's data in a catchUp baseline / desync
 * dump through the world-independent registry
 * (wire_snapshot_components.ts), instead of carrying each one as an
 * opaque dynamic blob behind the toJsonSafe sentinels.
 */
describe('the typed wire-snapshot component list', () => {
    async function midCombatSnapshot(): Promise<WireWorldSnapshot> {
        const source = await makeDeterminismWorld(2, 'worker', getSyntheticGameData());
        for (let i = 0; i < 120; i++) {
            source.step();
        }
        const snapshot = wireSnapshotWorld(source);
        expect([...source.resources.get(SnapshotPoliciesResource)!.unhandledWire])
            .toEqual([]);
        return snapshot;
    }

    function catchUpWith(snapshot: WireWorldSnapshot): WireMessage {
        return {
            message: {
                type: MessageType.message, source: 'server', message: {
                    room: 'nova:129', message: {
                        rollback: {
                            kind: 'catchUp', tick: 120, records: [],
                            baseline: { tick: 120, snapshot },
                        },
                    },
                },
            },
        };
    }

    function snapshotOf(received: WireMessage): WireWorldSnapshot {
        const rollback = received.message?.type === MessageType.message
            ? received.message.message.message?.rollback : undefined;
        if (rollback?.kind !== 'catchUp' || !rollback.baseline) {
            throw new Error('the catch-up did not survive the wire');
        }
        return rollback.baseline.snapshot;
    }

    /** The pre-#268 live wire: the same schema, derived without the registry. */
    function opaqueWireCodec(): AvroWireCodec {
        return avroWireCodec(deriveAvroSchema(WireMessageType, {
            name: 'WireMessage', hooks: novaCodecHooks(),
        }).schema);
    }

    it('the registry covers every component a real simulation world registers', async () => {
        const real = await makeDeterminismWorld(2, 'worker', getSyntheticGameData());
        const realNames = new Set(
            real.resources.get(SerializerResource)!.componentsByName.keys());
        const registry = new Set(
            wireSnapshotRegistrySerializer().componentsByName.keys());
        const missing = [...realNames].filter(name => !registry.has(name)).sort();
        expect(missing).toEqual([]);
        expect(wireRegistryMissing(real)).toEqual([]);
    }, 60_000);

    it('does not carry ExplosionData: explosions are display-only (ruling #272)', async () => {
        // Explosions are sound and graphics — display-side entities
        // (display/explosion_plugin.ts) of the display world, which has
        // no serializer; area damage is the projectile's / beam's. No
        // simulation entity ever carries the component, so the
        // registry, the schema derived from it, a real stepped
        // simulation world's serializer and its snapshot policies all
        // leave it out (core/animation_plugin.ts, snapshot_policies.ts).
        expect(wireSnapshotRegistrySerializer().componentsByName.has('ExplosionData')).toBeFalse();
        const codec = liveWireCodec() as AvroWireCodec;
        expect(JSON.stringify(codec.schema)).not.toContain('Component_ExplosionData');
        const real = await makeDeterminismWorld(2, 'worker', getSyntheticGameData());
        for (let i = 0; i < 120; i++) {
            real.step();
        }
        expect(real.resources.get(SerializerResource)!.componentsByName.has('ExplosionData'))
            .toBeFalse();
        expect(real.resources.get(SnapshotPoliciesResource)!.components
            .has(ExplosionDataComponent as UnknownComponent)).toBeFalse();
        const carrying = [...real.entities]
            .filter(([, entity]) => entity.components.has(ExplosionDataComponent))
            .map(([uuid]) => uuid);
        expect(carrying).toEqual([]);
    }, 60_000);

    it('a component the registry lacks fails loudly, by name', async () => {
        // A registration the registry world's synchronous plugin build
        // does not reach would cross the wire through the schema's
        // opaque `extra` branch — correct bytes, silently untyped. The
        // check makeSystem runs on every simulation world names it.
        const world = await makeDeterminismWorld(0, 'worker', getSyntheticGameData());
        expect(() => assertWireRegistryCovers(world)).not.toThrow();
        world.resources.get(SerializerResource)!.addComponent(
            new Component<{ v: number }>('RogueComponent'), t.type({ v: t.number }));
        expect(wireRegistryMissing(world)).toEqual(['RogueComponent']);
        expect(() => assertWireRegistryCovers(world))
            .toThrowError(/registry lacks RogueComponent/);
    }, 60_000);

    it('the live wire schema types the snapshot lists, tag included', () => {
        const codec = liveWireCodec() as AvroWireCodec;
        const text = JSON.stringify(codec.schema);
        // One branch record per registered component, carrying the
        // pair's encoding tag as a one-byte enum.
        expect(text).toContain('"name":"Component_MovementState"');
        expect(text).toContain('"name":"WireComponentEncoding","symbols":["serializer","wire"]');
        // A schema change is a fingerprint change: the gate at room
        // join (rollback_relay joinRequest) refuses a peer on the
        // opaque wire.
        expect(codec.fingerprint).not.toBe(opaqueWireCodec().fingerprint);
    });

    it('a wire snapshot crosses the live wire as the sender captured it, −0/NaN/absent/null intact', async () => {
        const source = await midCombatSnapshot();
        const withMovement = source.entities.filter(entity =>
            entity.components.some(([name]) => name === 'MovementState'));
        expect(withMovement.length).toBeGreaterThan(1);
        const [first, second] = withMovement as [typeof withMovement[0], typeof withMovement[0]];
        const movementOf = (entity: typeof first) =>
            entity.components.find(([name]) => name === 'MovementState')![1] as Record<string, unknown>;
        // Every value JSON cannot carry, in the JSON-safe form the
        // capture produces, in schema'd fields: the sign of zero, the
        // non-finite doubles, a present null against an absent
        // optional (MovementState.turnTo), a present undefined
        // (Target.target — makeNpcShip stamps it).
        Object.assign(movementOf(first), {
            position: { x: { $negzero: true }, y: { $nonfinite: '+' } },
            velocity: { x: { $nonfinite: 'nan' }, y: { $nonfinite: '-' } },
            turnTo: null,
        });
        delete movementOf(second)['turnTo'];
        first.components.push(['TargetComponent', { target: { $undefined: true } }, 'serializer']);
        second.components.push(['TargetComponent', { target: 'first' }, 'serializer']);
        // A component the registry does not know rides the opaque
        // branch, sentinels and tag as they are.
        first.components.push(['RogueComponent', { v: { $negzero: true }, w: [1, { $undefined: true }] }, 'wire']);
        const sent = catchUpWith(source);

        const codec = liveWireCodec() as AvroWireCodec;
        const frame = codec.encode(WireMessageType.encode(sent));
        const text = new TextDecoder().decode(frame);
        // The schema'd fields hold the values natively: no sentinel
        // object crosses for them (the rogue component's do).
        expect(text.split('$negzero').length).toBe(2);
        expect(text).not.toContain('$nonfinite');
        expect(text.split('$undefined').length).toBe(2);

        const back = snapshotOf(decodeWireOrThrow(codec, WireMessageType, frame));
        const backFirst = back.entities.find(entity => entity.uuid === first.uuid)!;
        const backSecond = back.entities.find(entity => entity.uuid === second.uuid)!;
        expect(movementOf(backFirst)['position']).toEqual({ x: { $negzero: true }, y: { $nonfinite: '+' } });
        expect(movementOf(backFirst)['velocity']).toEqual({ x: { $nonfinite: 'nan' }, y: { $nonfinite: '-' } });
        expect(movementOf(backFirst)['turnTo']).toBeNull();
        expect('turnTo' in movementOf(backSecond)).toBeFalse();
        // A present undefined decodes as the absent key: the two are
        // one value to the component's codec (io-ts fills the key back
        // in), to the restore and to the hash, so the wire need not
        // tell them apart.
        const targetOf = (entity: typeof first) =>
            entity.components.find(([name]) => name === 'TargetComponent')!;
        expect(targetOf(backFirst)).toEqual(['TargetComponent', {}, 'serializer']);
        expect(Target.decode(targetOf(backFirst)[1])).toEqual(Target.decode({ target: undefined }));
        expect(targetOf(backSecond)).toEqual(['TargetComponent', { target: 'first' }, 'serializer']);
        expect(backFirst.components.find(([name]) => name === 'RogueComponent'))
            .toEqual(['RogueComponent', { v: { $negzero: true }, w: [1, { $undefined: true }] }, 'wire']);
        // Everything else, pair for pair, tag for tag.
        for (const entity of source.entities) {
            const received = back.entities.find(other => other.uuid === entity.uuid)!;
            expect(received.components.map(pair => [pair[0], pair[2]]))
                .withContext(entity.uuid).toEqual(entity.components.map(pair => [pair[0], pair[2]]));
        }
        expect(back.singleton).toEqual(source.singleton);
        expect(back.resources).toEqual(source.resources);

        // The bytes are standard Avro: the independent reference codec
        // produces the same bytes and reads ours back to the same value.
        const reference = avscReferenceCodec(codec.schema);
        const referenceFrame = reference.encode(WireMessageType.encode(sent));
        expect(referenceFrame.length).toBe(frame.length);
        expect(referenceFrame.every((byte, i) => byte === frame[i])).toBeTrue();
        expect(snapshotOf(decodeWireOrThrow(reference, WireMessageType, frame))).toEqual(back);

        // A desync dump's checkpoints are the same snapshot type, so
        // they cross the same way: what the server writes to disk for
        // analyze_desync.mjs is the JSON-safe form the peer captured.
        const dump: WireMessage = {
            message: {
                type: MessageType.message, destination: 'server', message: {
                    room: 'nova:129', message: {
                        rollback: {
                            kind: 'desyncDump', dump: {
                                tick: 180, desyncTick: 120, engine: 'spec',
                                checkpoints: [{ tick: 120, snapshot: source }],
                                rollbackLog: [{ event: 'spec', atTick: 120 }],
                            },
                        },
                    },
                },
            },
        };
        const dumpBack = decodeWireOrThrow(codec, WireMessageType, codec.encode(WireMessageType.encode(dump)));
        const rollback = dumpBack.message?.type === MessageType.message
            ? dumpBack.message.message.message?.rollback : undefined;
        if (rollback?.kind !== 'desyncDump') {
            throw new Error('the dump did not survive the wire');
        }
        expect(rollback.dump.checkpoints[0]!.snapshot).toEqual(back);
    }, 120_000);

    it('a typed catchUp frame is materially smaller than the opaque one it replaces', async () => {
        const sent = WireMessageType.encode(catchUpWith(await midCombatSnapshot()));
        const typed = liveWireCodec().encode(sent).length;
        const opaque = opaqueWireCodec().encode(sent).length;
        // Measured ~30% smaller on a mid-combat synthetic baseline; the
        // conservative end is asserted.
        expect(typed).withContext(`typed ${typed} vs opaque ${opaque}`).toBeLessThan(opaque * 0.85);
    }, 60_000);
});
