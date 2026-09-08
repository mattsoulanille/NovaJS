import 'jasmine';
import * as t from 'io-ts';
import { map } from 'nova_ecs/datatypes/map';
import { Position, PositionType } from 'nova_ecs/datatypes/position';
import { set } from 'nova_ecs/datatypes/set';
import { EncodedEntity, markerType, SerializerResource } from 'nova_ecs/plugins/serializer_plugin';
import { TimeResource } from 'nova_ecs/plugins/time_plugin';
import { World } from 'nova_ecs/world';
import { openEnum } from '../common/open_enum.js';
import { makeDeterminismWorld } from './determinism_harness.js';
import { getSyntheticGameData } from './simulation_test_fixture.js';
import { AvroSchema, AvroSchemaNode, DerivationFailure, DerivationOptions, deriveAvroSchema } from './io_ts_to_avro.js';
import { DeltaFrameEncoder, SimulationFrame, SimulationFrameType } from './simulation_frame.js';
import { WireTick } from './simulation_input.js';
import { avroWireCodec, decodeWireOrThrow, jsonWireCodec } from './wire_codec.js';
import {
    communicatorMessageDerivation, liveWireCodec, liveWireFingerprint, novaCodecHooks,
    rollbackProtocolDerivation, RollbackEnvelopeType, roomMessageDerivation,
    simulationFrameDerivation, socketMessageDerivation, wireMessageDerivation,
    WireMessageType,
} from './wire_schemas.js';
import { MessageType } from './communicator_message.js';

/** Encode with avro, decode, validate with the codec: what a receiver sees. */
function roundTrip(codec: t.Any, value: unknown, options: DerivationOptions = {}): unknown {
    const { schema } = deriveAvroSchema(codec, { hooks: novaCodecHooks(), ...options });
    const wire = avroWireCodec(schema);
    return decodeWireOrThrow(wire, codec as t.Type<unknown, unknown, unknown>,
        wire.encode(codec.encode(value)));
}

function node(schema: AvroSchema): AvroSchemaNode {
    expect(typeof schema).toBe('object');
    expect(Array.isArray(schema)).toBeFalse();
    return schema as AvroSchemaNode;
}

/** A schema as a matcher subject (its recursive type defeats jasmine's generics). */
function plain(schema: unknown): jasmine.Matchers<unknown> {
    return expect(schema);
}

/**
 * What a frame looks like after any wire: an io-ts identity encoder
 * (Position, Vector, Angle) hands back the live class instance, and
 * `t.type` keeps `target: undefined` keys, so the "encoded" frame is
 * not plain data until it has been serialized once. JSON is the wire
 * today, so its view is the reference.
 */
function asJson<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
}

function summarize(failures: DerivationFailure[]): string[] {
    return failures.map(failure => `${failure.kind} ${failure.path}`).sort();
}

describe('io-ts to Avro derivation', () => {
    describe('constructs', () => {
        it('maps t.type and t.partial to a record with nullable optionals', () => {
            const codec = t.exact(t.intersection([
                t.type({ a: t.number, s: t.string, b: t.boolean }),
                t.partial({ o: t.string }),
            ]));
            const { schema, failures } = deriveAvroSchema(codec, { name: 'R' });
            expect(failures).toEqual([]);
            const record = node(schema);
            expect(record.type).toBe('record');
            expect(record.name).toBe('R');
            expect(record.fields!.map(field => field.name)).toEqual(['a', 's', 'b', 'o']);
            plain(record.fields![0]!.type).toBe('double');
            plain(record.fields![3]).toEqual({ name: 'o', type: ['null', 'string'], default: null });
            expect(record.optional).toEqual(['o']);

            expect(roundTrip(codec, { a: 1.5, s: 'x', b: true })).toEqual({ a: 1.5, s: 'x', b: true });
            expect(roundTrip(codec, { a: 1, s: '', b: false, o: 'y' }))
                .toEqual({ a: 1, s: '', b: false, o: 'y' });
        });

        it('keeps absent and null apart for an optional field that admits null', () => {
            const codec = t.partial({ x: t.union([t.number, t.null]) });
            const { schema, failures } = deriveAvroSchema(codec, { name: 'R' });
            expect(failures).toEqual([]);
            const field = node(schema).fields![0]!;
            expect(node((field.type as AvroSchema[])[1]!).logicalType).toBe('present');
            expect(Object.keys(roundTrip(codec, {}) as object)).toEqual([]);
            expect(roundTrip(codec, { x: null })).toEqual({ x: null });
            expect(roundTrip(codec, { x: 2 })).toEqual({ x: 2 });
        });

        it('treats a required `T | undefined` field like an optional one', () => {
            const codec = t.type({ target: t.union([t.string, t.undefined]) });
            const { schema } = deriveAvroSchema(codec, { name: 'R' });
            expect(node(schema).optional).toEqual(['target']);
            // (io-ts's own `t.type` decode puts the key back as an
            // explicit undefined; the wire carried no value.)
            expect((roundTrip(codec, { target: undefined }) as { target?: string }).target)
                .toBeUndefined();
            expect(roundTrip(codec, { target: 'a' })).toEqual({ target: 'a' });
        });

        it('maps a string-literal union to an enum, mixed literals to a union', () => {
            const state = t.union([t.literal(false), t.literal('start'), t.literal('repeat')]);
            const { schema, failures } = deriveAvroSchema(state, { name: 'State' });
            expect(failures).toEqual([]);
            plain(schema).toEqual(['boolean', { type: 'enum', name: 'State', symbols: ['start', 'repeat'] }]);
            for (const value of [false, 'start', 'repeat'] as const) {
                expect(roundTrip(state, value)).toBe(value);
            }
        });

        it('maps an open enum to a plain string so unknown members survive', () => {
            // common/open_enum.ts: the members are this build's; a newer
            // peer may send one this build does not know, and it must
            // round-trip untouched — an Avro enum would reject it.
            const reason = openEnum('Reason', ['shipOffer', 'rescue'] as const);
            const { schema, failures } = deriveAvroSchema(reason, { name: 'Reason' });
            expect(failures).toEqual([]);
            plain(schema).toBe('string');
            expect(roundTrip(reason, 'rescue')).toBe('rescue');
            expect(roundTrip(reason, 'fromANewerBuild' as never)).toBe('fromANewerBuild');
        });

        it('maps t.keyof to an enum and rejects symbols Avro cannot name', () => {
            plain(deriveAvroSchema(t.keyof({ up: null, down: null }), { name: 'K' }).schema)
                .toEqual({ type: 'enum', name: 'K', symbols: ['up', 'down'] });
            const dashed = deriveAvroSchema(t.keyof({ 'a-b': null, 'c': null }), { name: 'K' });
            plain(dashed.schema).toBe('string');
            expect(summarize(dashed.failures)).toEqual(['lossy $']);
        });

        it('maps a kind-discriminated union to a wrapped union of records', () => {
            const codec = t.union([
                t.strict({ kind: t.literal('a'), x: t.number }),
                t.strict({ kind: t.literal('b'), y: t.string }),
                t.exact(t.intersection([
                    t.type({ kind: t.literal('c') }),
                    t.partial({ z: t.boolean }),
                ])),
            ]);
            const { schema, failures } = deriveAvroSchema(codec, { name: 'Msg' });
            expect(failures).toEqual([]);
            const union = node(schema);
            expect(union.logicalType).toBe('kindUnion');
            expect(union.discriminator).toBe('kind');
            expect(union.branches).toEqual({ a: 'Msg_a', b: 'Msg_b', c: 'Msg_c' });
            expect(roundTrip(codec, { kind: 'a', x: 1 })).toEqual({ kind: 'a', x: 1 });
            expect(roundTrip(codec, { kind: 'b', y: 's' })).toEqual({ kind: 'b', y: 's' });
            expect(roundTrip(codec, { kind: 'c' })).toEqual({ kind: 'c' });
            expect(roundTrip(codec, { kind: 'c', z: true })).toEqual({ kind: 'c', z: true });
        });

        it('discriminates on a numeric literal too (CommunicatorMessage style)', () => {
            const codec = t.union([
                t.type({ type: t.literal(0), uuid: t.string }),
                t.type({ type: t.literal(2), peers: set(t.string) }),
            ]);
            expect(deriveAvroSchema(codec).failures).toEqual([]);
            expect(roundTrip(codec, { type: 2, peers: new Set(['a', 'b']) }))
                .toEqual({ type: 2, peers: new Set(['a', 'b']) });
        });

        it('cannot map a union of records without a discriminator', () => {
            const codec = t.union([t.type({ x: t.number }), t.type({ y: t.number })]);
            const { schema, failures } = deriveAvroSchema(codec, { name: 'U' });
            expect(node(schema).logicalType).toBe('opaque');
            expect(summarize(failures)).toEqual(['unmapped $']);
            // Opaque still round-trips: it is a self-describing blob.
            expect(roundTrip(codec, { y: 3 })).toEqual({ y: 3 });
        });

        it('cannot map an array beside a tuple: both are arrays to JavaScript', () => {
            // A tuple rides as an Avro record, so it looked distinct from
            // an array to a check that only asked Avro; to the encode
            // pass both are arrays, and whichever branch claimed the
            // bucket took every array — a three-element array through
            // a two-field tuple record came back as two elements, and
            // the io-ts gate accepted it. Either order.
            const array = t.array(t.number);
            const tuple = t.tuple([t.number, t.number]);
            for (const codec of [t.union([array, tuple]), t.union([tuple, array])]) {
                const { schema, failures } = deriveAvroSchema(codec, { name: 'U' });
                expect(node(schema).logicalType).toBe('opaque');
                expect(summarize(failures)).toEqual(['unmapped $']);
                expect(failures[0]!.reason).toContain('arrays');
                // Opaque is lossless, and explain agrees: the receiver
                // sees exactly what it sees over JSON today. (With the
                // tuple branch FIRST, io-ts's own tuple decode strips
                // [1, 2, 3] to [1, 2] on any wire — the codec's
                // semantics, not the wire's; hence the JSON reference.)
                const wire = avroWireCodec(schema);
                for (const value of [[1, 2, 3], [1, 2], []]) {
                    expect(wire.explain(value)).withContext(JSON.stringify(value)).toBeUndefined();
                    expect(wire.decode(wire.encode(value))).toEqual(value);
                    expect(decodeWireOrThrow(wire, codec, wire.encode(value)))
                        .toEqual(decodeWireOrThrow(jsonWireCodec, codec, jsonWireCodec.encode(value)));
                }
            }
            // The other side of the tuple: a record on the wire, so it
            // collides with records and maps there.
            for (const other of [t.type({ a: t.number }), t.record(t.string, t.number)]) {
                const { failures } = deriveAvroSchema(t.union([other, tuple]), { name: 'U' });
                expect(summarize(failures)).toEqual(['unmapped $']);
                expect(failures[0]!.reason).toContain('on the wire');
            }
            // And the plan compiler refuses the union the deriver must
            // never emit, instead of encoding one branch as the other.
            const tupleRecord: AvroSchemaNode = {
                type: 'record', name: 'Pair', logicalType: 'tuple',
                fields: [{ name: '_0', type: 'double' }, { name: '_1', type: 'double' }],
            };
            expect(() => avroWireCodec([{ type: 'array', items: 'double' }, tupleRecord]))
                .toThrowError(/ambiguous union.*array/);
            // (A map beside a tuple is unambiguous to the binary codec,
            // which reads the branch INDEX rather than the value's kind;
            // the deriver still refuses it, above, for the reference
            // plan's sake.)
        });

        it('maps tuples to records read and written as arrays', () => {
            const codec = t.tuple([t.string, t.number, t.boolean]);
            const { schema } = deriveAvroSchema(codec, { name: 'T' });
            expect(node(schema).logicalType).toBe('tuple');
            expect(node(schema).fields!.map(field => field.name)).toEqual(['_0', '_1', '_2']);
            expect(roundTrip(codec, ['a', 1, true])).toEqual(['a', 1, true]);
        });

        it('maps t.record to a map and arrays, Sets and Maps to arrays', () => {
            const codec = t.type({
                counts: t.record(t.string, t.number),
                names: t.array(t.string),
                ids: set(t.string),
                positions: map(t.string, PositionType),
            });
            const { schema, failures } = deriveAvroSchema(codec, { name: 'R' });
            expect(failures).toEqual([]);
            const fields = node(schema).fields!;
            plain(fields[0]!.type).toEqual({ type: 'map', values: 'double' });
            plain(fields[1]!.type).toEqual({ type: 'array', items: 'string' });
            plain(fields[2]!.type).toEqual({ type: 'array', items: 'string' });
            expect(node(node(fields[3]!.type).items!).logicalType).toBe('tuple');
            const value = {
                counts: { a: 1, b: 2 }, names: ['x'], ids: new Set(['p']),
                positions: new Map([['k', new Position(1, 2)]]),
            };
            expect(roundTrip(codec, value)).toEqual(value);
        });

        it('cannot map a t.record whose keys are not strings', () => {
            const { failures } = deriveAvroSchema(t.record(t.number, t.string));
            expect(summarize(failures)).toEqual(['unmapped $']);
        });

        it('carries t.unknown opaquely and reports it as untyped', () => {
            const codec = t.type({ payload: t.unknown, mission: t.unknown });
            const { failures } = deriveAvroSchema(codec, { name: 'R' });
            expect(summarize(failures)).toEqual(['untyped $.mission', 'untyped $.payload']);
            const value = { payload: { deep: [1, 'two', { three: null }] }, mission: null };
            expect(roundTrip(codec, value)).toEqual(value);
        });

        it('cannot see into a custom codec unless a hook names its shape', () => {
            const custom = new t.Type<number, string, unknown>('Custom',
                (u): u is number => typeof u === 'number',
                (u, c) => typeof u === 'string' ? t.success(Number(u)) : t.failure(u, c),
                n => String(n));
            const codec = t.type({ n: custom });
            const bare = deriveAvroSchema(codec, { name: 'R' });
            expect(summarize(bare.failures)).toEqual(['unmapped $.n']);
            plain(node(bare.schema).fields![0]!.type).toEqual({ type: 'bytes', logicalType: 'opaque' });

            const hooked = deriveAvroSchema(codec, { name: 'R', hooks: new Map([[custom, 'string']]) });
            expect(hooked.failures).toEqual([]);
            plain(node(hooked.schema).fields![0]!.type).toBe('string');
            expect(roundTrip(codec, { n: 4 }, { hooks: new Map([[custom, 'string']]) })).toEqual({ n: 4 });
        });

        it('knows the nova_ecs datatypes and nova\'s WireTick without help', () => {
            const codec = t.type({ tick: WireTick, at: PositionType, marker: markerType });
            const { schema, failures } = deriveAvroSchema(codec, { hooks: novaCodecHooks() });
            expect(failures).toEqual([]);
            const fields = node(schema).fields!;
            plain(fields[0]!.type).toBe('long');
            expect(node(fields[1]!.type).name).toBe('Position');
            plain(fields[2]!.type).toBe('null');
            expect(roundTrip(codec, { tick: 7, at: new Position(3, -4), marker: undefined }))
                .toEqual({ tick: 7, at: new Position(3, -4), marker: undefined });
        });

        it('defines a reused codec once and references it by name after', () => {
            const inner = t.type({ v: t.number });
            const { schema } = deriveAvroSchema(t.type({ a: inner, b: inner }), { name: 'R' });
            const fields = node(schema).fields!;
            expect(node(fields[0]!.type).name).toBe('R_a');
            plain(fields[1]!.type).toBe('R_a');
        });

        it('rejects a value the schema does not admit at encode time', () => {
            const { schema } = deriveAvroSchema(t.type({ tick: WireTick }),
                { hooks: novaCodecHooks() });
            const wire = avroWireCodec(schema);
            expect(() => wire.encode({ tick: 'seven' })).toThrow();
            expect(wire.explain({ tick: 'seven' })).toContain('tick');
            expect(wire.explain({ tick: 7 })).toBeUndefined();
        });

        it('explain judges the original message by its round trip', () => {
            // A message the schema admits can still come back changed.
            // An opaque node rides as the dynamic encoding, which keeps
            // −0 and NaN; what it cannot carry is a function.
            const codec = t.type({ tick: WireTick, payload: t.unknown });
            const { schema } = deriveAvroSchema(codec, { hooks: novaCodecHooks() });
            const wire = avroWireCodec(schema);
            expect(wire.explain({ tick: 7, payload: { z: -0 } })).toBeUndefined();
            expect(wire.explain({ tick: 7, payload: { n: NaN, list: [1, 'two', null] } })).toBeUndefined();
            expect(wire.explain({ tick: 7, payload: undefined })).toBeUndefined();
            expect(wire.explain({ tick: 7, payload: { f: () => 1 } })).toMatch(/round trip failed/);
            // Shapes the plan reshapes on purpose are not differences: a
            // Position instance comes back a plain object, an undefined
            // optional comes back absent, a tuple goes through a record.
            const shaped = t.type({
                at: PositionType, pair: t.tuple([t.string, t.number]),
                maybe: t.union([t.number, t.undefined]),
            });
            const shapedWire = avroWireCodec(deriveAvroSchema(shaped, { hooks: novaCodecHooks() }).schema);
            expect(shapedWire.explain({ at: new Position(1, 2), pair: ['a', 1], maybe: undefined }))
                .toBeUndefined();
        });
    });

    describe('over the real wire codecs', () => {
        it('types every envelope but the payload it carries', () => {
            // The socket, communicator and room layers each gate their
            // own envelope with an untyped `message` (the runtime
            // codecs); the payload is typed by threading its codec
            // through, below.
            expect(summarize(socketMessageDerivation().failures)).toEqual(['untyped $.message']);
            expect(summarize(communicatorMessageDerivation().failures))
                .toEqual(['untyped $<1>.message']);
            expect(summarize(roomMessageDerivation().failures)).toEqual(['untyped $.message']);
        });

        it('the live wire schema types the envelopes end to end', () => {
            // What is left opaque is exactly the rollback protocol's
            // own t.unknown nodes, plus the component lists (the socket
            // has no serializer; see wireMessageDerivation).
            const { failures } = wireMessageDerivation();
            expect(summarize(failures)).toEqual([
                'untyped $.message<1>.message.message.rollback<catchUp>.baseline.snapshot.entities[].components[][1]',
                'untyped $.message<1>.message.message.rollback<catchUp>.baseline.snapshot.resources[]',
                'untyped $.message<1>.message.message.rollback<catchUp>.baseline.snapshot.singleton[][1]',
                'untyped $.message<1>.message.message.rollback<inputs>.record.inputs[]<acceptMission>.accepted.mission',
                'untyped $.message<1>.message.message.rollback<inputs>.record.inputs[]<acceptMission>.accepted.missionsStarted[][1]',
                'untyped $.message<1>.message.message.rollback<inputs>.record.inputs[]<acceptMission>.accepted.ships[].entity',
                'untyped $.message<1>.message.message.rollback<inputs>.record.inputs[]<addEntity>.entity.components[][1]',
            ]);
            expect(liveWireCodec().encoding).toBe('avro');
            expect(liveWireFingerprint()).toMatch(/^[0-9a-f]{16}$/);
        });

        it('round-trips every envelope shape the socket sends through the live codec', () => {
            const codec = liveWireCodec();
            const messages: t.TypeOf<typeof WireMessageType>[] = [
                { ping: true },
                { pong: true },
                { message: { type: MessageType.uuid, uuid: 'u' } },
                { message: { type: MessageType.peers, peers: new Set(['a', 'b']) } },
                { message: { type: MessageType.message, source: 'server', message: { room: 'r', peers: new Set(['a']) } } },
                { message: { type: MessageType.message, destination: 'server', message: { room: 'r', inRoom: true } } },
                { message: { type: MessageType.message, destination: new Set(['x', 'y']), message: { room: 'r', getPeers: true } } },
                {
                    message: {
                        type: MessageType.message, destination: 'server', message: {
                            room: 'r', message: { rollback: { kind: 'inputs', record: { tick: 3, seq: 1, inputs: [{ kind: 'analogControl', heading: -0, throttle: NaN }] } } },
                        },
                    },
                },
                {
                    message: {
                        type: MessageType.message, source: 'server', message: {
                            room: 'r', message: { rollback: { kind: 'joinRefused', reason: 'no' } },
                        },
                    },
                },
            ];
            for (const message of messages) {
                const bytes = codec.encode(WireMessageType.encode(message));
                const back = decodeWireOrThrow(codec, WireMessageType, bytes);
                expect(back).withContext(JSON.stringify(WireMessageType.encode(message))).toEqual(message);
            }
        });

        it('leaves exactly the t.unknown nodes of the rollback protocol opaque', () => {
            const { failures } = rollbackProtocolDerivation();
            expect(summarize(failures)).toEqual([
                // A wire snapshot's component contents are validated by
                // the serializer on restore, not by the protocol codec.
                'untyped $.rollback<catchUp>.baseline.snapshot.entities[].components[][1]',
                'untyped $.rollback<catchUp>.baseline.snapshot.resources[]',
                'untyped $.rollback<catchUp>.baseline.snapshot.singleton[][1]',
                // The mission the client resolved (ActiveMission) and
                // the special ships it spawns, both deliberately untyped
                // at the input layer (mission_accept.ts).
                'untyped $.rollback<inputs>.record.inputs[]<acceptMission>.accepted.mission',
                'untyped $.rollback<inputs>.record.inputs[]<acceptMission>.accepted.missionsStarted[][1]',
                'untyped $.rollback<inputs>.record.inputs[]<acceptMission>.accepted.ships[].entity',
                // addEntity's component data, without a serializer.
                'untyped $.rollback<inputs>.record.inputs[]<addEntity>.entity.components[][1]',
            ]);
        });

        it('round-trips every rollback message kind through all three codecs', () => {
            const { schema } = rollbackProtocolDerivation();
            const avro = avroWireCodec(schema);
            const messages: t.TypeOf<typeof RollbackEnvelopeType>[] = [
                {
                    rollback: {
                        kind: 'inputs', record: {
                            peerId: 'p', tick: 12, seq: 3, inputs: [
                                { kind: 'control', events: [{ action: 'accelerate', state: 'start' }, { action: 'firePrimary', state: false }] },
                                { kind: 'analogControl', heading: 1.5, throttle: null },
                                { kind: 'setTarget', target: null },
                                { kind: 'setPlanetTarget', target: 'planet' },
                                { kind: 'hail', action: { kind: 'bribe', target: 'ship' } },
                                { kind: 'escortAction', action: { kind: 'queueUpgrade', target: 'e', toShip: 'nova:128' } },
                                { kind: 'addEntity', uuid: 'u', entity: { name: 'n', components: [['A', { x: 1 }], ['B', null]] } },
                                { kind: 'removeEntity', uuid: 'u' },
                                { kind: 'setJumpRoute', route: ['a', 'b'] },
                                { kind: 'removePeer', peerId: 'q' },
                                {
                                    kind: 'acceptMission', accepted: {
                                        missionId: 'm', mission: { anything: [1, 2] },
                                        autoAborted: true, ships: [{ uuid: 's', entity: { components: [] } }],
                                    },
                                },
                            ],
                        },
                    },
                },
                { rollback: { kind: 'inputs', record: { tick: 0, inputs: [] } } },
                { rollback: { kind: 'tickSync', tick: 100 } },
                { rollback: { kind: 'inputLogRequest', fromTick: 5 } },
                { rollback: { kind: 'inputLog', records: [{ tick: 1, inputs: [] }, { peerId: 'x', tick: 2, seq: 0, inputs: [] }] } },
                { rollback: { kind: 'joinRequest' } },
                { rollback: { kind: 'joinRequest', fresh: true, protocol: 5 } },
                { rollback: { kind: 'catchUp', tick: 30, records: [] } },
                {
                    rollback: {
                        kind: 'catchUp', tick: 30, records: [], baseline: {
                            tick: 30, snapshot: {
                                entities: [{ uuid: 'e', name: 'n', components: [['C', { v: 1 }, 'serializer'], ['W', [1, 2], 'wire']] }],
                                singleton: [['S', null, 'serializer']],
                                resources: [{ name: 'r', state: 1 }],
                            },
                        },
                    },
                },
                { rollback: { kind: 'stateHash', tick: 60, hash: 'abcd' } },
                { rollback: { kind: 'desync', tick: 60, hashes: [['a', 'h1'], ['b', 'h2']], canonical: 'h1' } },
                { rollback: { kind: 'desync', tick: 60, hashes: [] } },
                { rollback: { kind: 'desyncDumpRequest' } },
                {
                    rollback: {
                        kind: 'desyncDump', dump: {
                            tick: 120, desyncTick: 60, engine: 'node',
                            checkpoints: [{ tick: 60, snapshot: { entities: [], singleton: [], resources: [] } }],
                            rollbackLog: [{ event: 'rollback', atTick: 61, detail: { depth: 3, why: 'late' } }, { event: 'join', atTick: 0 }],
                        },
                    },
                },
            ];
            for (const message of messages) {
                for (const codec of [jsonWireCodec, avro]) {
                    const bytes = codec.encode(RollbackEnvelopeType.encode(message));
                    expect(decodeWireOrThrow(codec, RollbackEnvelopeType, bytes))
                        .withContext(`${message.rollback.kind} via ${codec.encoding}`)
                        .toEqual(message);
                }
            }
        });

        it('still validates: junk that decodes as bytes fails the io-ts gate', () => {
            const { schema } = rollbackProtocolDerivation();
            const avro = avroWireCodec(schema);
            const forged = avro.encode({ rollback: { kind: 'tickSync', tick: 5 } });
            forged[forged.length - 1] = 0xff; // a truncated varint
            expect(() => decodeWireOrThrow(avro, RollbackEnvelopeType, forged)).toThrow();
            expect(() => decodeWireOrThrow(jsonWireCodec, RollbackEnvelopeType,
                jsonWireCodec.encode({ rollback: { kind: 'tickSync', tick: -1 } }))).toThrow();
        });
    });

    describe('over a real world\'s serializer', () => {
        let world: World;
        let frame: SimulationFrame;

        beforeAll(async () => {
            world = await makeDeterminismWorld(2, 'worker',
                getSyntheticGameData());
            for (let i = 0; i < 20; i++) {
                world.step();
            }
            const serializer = world.resources.get(SerializerResource)!;
            frame = {
                ...new DeltaFrameEncoder().encode(world, serializer),
                time: world.resources.get(TimeResource),
                events: [{ name: 'ev', data: { any: 1 }, entityUuids: ['a'], tick: 20 }],
                pacing: { rate: 1, behindTicks: 0 },
            };
        }, 60000);

        it('types every registered component; only a bridge event\'s data stays opaque', () => {
            const serializer = world.resources.get(SerializerResource)!;
            const { failures, schema } = simulationFrameDerivation(serializer);
            // The components carrying PARSED GAME DATA cross as
            // references (nova_plugin/core/game_data_ref.ts), whose
            // codecs declare their wire shape; BeamState has its real
            // codec. Every simulation-state component is typed.
            expect(summarize(failures)).toEqual(['untyped $.events[].data']);
            // The reference records are shared, by name.
            const text = JSON.stringify(schema);
            expect(text).toContain('"name":"GameDataRef"');
            expect(text).toContain('"name":"AnimationRef"');
            expect(text.split('"name":"GameDataRef"').length).toBe(2);
        });

        it('round-trips a full frame and an addEntity through the typed component list', () => {
            const serializer = world.resources.get(SerializerResource)!;
            const avro = avroWireCodec(simulationFrameDerivation(serializer).schema);
            expect(frame.added.length).toBeGreaterThan(2);
            for (const codec of [jsonWireCodec, avro]) {
                const back = decodeWireOrThrow(codec, SimulationFrameType, codec.encode(frame));
                expect(asJson(back)).withContext(codec.encoding).toEqual(asJson(frame));
            }

            // The richest entity (a ship: dozens of components).
            const [uuid, entity] = frame.added.reduce((best, candidate) =>
                candidate[1].components.length > best[1].components.length ? candidate : best);
            expect(entity.components.length).toBeGreaterThan(15);
            const rollback = avroWireCodec(rollbackProtocolDerivation(serializer).schema);
            const message = { rollback: { kind: 'inputs' as const, record: { tick: 1, inputs: [{ kind: 'addEntity' as const, uuid, entity: entity as EncodedEntity }] } } };
            const back = decodeWireOrThrow(rollback, RollbackEnvelopeType, rollback.encode(message));
            expect(asJson(back)).toEqual(asJson(message));
        });

        it('preserves −0 and NaN in component state, which JSON does not', () => {
            const serializer = world.resources.get(SerializerResource)!;
            const avro = avroWireCodec(simulationFrameDerivation(serializer).schema);
            const [uuid, delta] = frame.added[0]!;
            const movement = delta.components.find(([name]) => name === 'MovementState')!;
            const state = movement[1] as { position: { x: number, y: number }, velocity: { x: number, y: number } };
            const tweaked: SimulationFrame = {
                added: [[uuid, {
                    components: [[movement[0], {
                        ...state,
                        position: { x: -0, y: state.position.y },
                        velocity: { x: NaN, y: state.velocity.y },
                    }]],
                }]],
                changed: [], removed: [], events: [],
            };
            const viaAvro = decodeWireOrThrow(avro, SimulationFrameType, avro.encode(tweaked));
            const back = viaAvro.added[0]![1].components[0]![1] as typeof state;
            expect(Object.is(back.position.x, -0)).toBeTrue();
            expect(Number.isNaN(back.velocity.x)).toBeTrue();

            const viaJson = decodeWireOrThrow(jsonWireCodec, SimulationFrameType, jsonWireCodec.encode(tweaked));
            const jsonBack = viaJson.added[0]![1].components[0]![1] as typeof state;
            expect(Object.is(jsonBack.position.x, -0)).toBeFalse();
            // JSON.stringify(NaN) is "null", which the codec then rejects.
            expect(jsonBack.velocity.x).toBeNull();
        });

        it('keeps −0 and NaN inside an opaque node too (the dynamic encoding)', () => {
            // A node the derivation could not type — here a bridge
            // event's `data`, which is `t.unknown` — rides as the
            // self-describing dynamic encoding, whose numbers are IEEE
            // doubles like the schema'd fields. The `failures` list is
            // therefore NOT a list of where −0 is lost: nothing on this
            // wire folds it.
            const serializer = world.resources.get(SerializerResource)!;
            const derivation = simulationFrameDerivation(serializer);
            expect(summarize(derivation.failures)).toContain('untyped $.events[].data');
            const avro = avroWireCodec(derivation.schema);
            const tweaked: SimulationFrame = {
                added: [], changed: [], removed: [],
                events: [{ name: 'ev', data: { z: -0, n: NaN, nested: [{ w: -0 }] } }],
            };
            expect(avro.explain(frame)).toBeUndefined();
            expect(avro.explain(tweaked)).toBeUndefined();
            const back = decodeWireOrThrow(avro, SimulationFrameType, avro.encode(tweaked));
            const data = back.events[0]!.data as { z: number, n: number, nested: [{ w: number }] };
            expect(Object.is(data.z, -0)).toBeTrue();
            expect(Number.isNaN(data.n)).toBeTrue();
            expect(Object.is(data.nested[0].w, -0)).toBeTrue();
        });
    });
});
