import * as t from 'io-ts';
import { Serializer } from 'nova_ecs/plugins/serializer_plugin';
import { stat } from '../nova_plugin/core/index.js';
import { CommunicatorMessage, communicatorMessageType } from './communicator_message.js';
import { CodecHook, CodecHooks, Derivation, deriveAvroSchema } from './io_ts_to_avro.js';
import { RoomMessage, roomMessageType } from './multi_room_communicator.js';
import { RollbackProtocolMessageType } from './rollback_protocol.js';
import { SimulationFrameType } from './simulation_frame.js';
import { WireTick } from './simulation_input.js';
import { SocketMessage, socketMessageType } from './socket_message.js';
import { AvroWireCodec, avroWireCodec, makeWireCodec, WIRE_ENCODING, WireCodec } from './wire_codec.js';

/**
 * The Avro schemas for nova's real wire shapes, derived from the io-ts
 * codecs that already define them. The hooks cover the custom
 * (`new t.Type`) codecs that reflection cannot see into; everything
 * else is walked.
 */

/** Nova's custom codecs and their encoded shapes. */
export function novaCodecHooks(): CodecHooks {
    return new Map<t.Any, CodecHook>([
        // A non-negative safe integer: an Avro long (zig-zag varint, so
        // a tick costs 1-4 bytes rather than a double's 8).
        [WireTick, 'long'],
        [stat, {
            type: 'record', name: 'Stat', fields: [
                { name: 'current', type: 'double' },
                { name: 'recharge', type: 'double' },
                { name: 'max', type: 'double' },
                { name: 'min', type: 'double' },
            ],
        }],
    ]);
}

/** The rollback envelope as it rides the room channel: `{rollback: msg}`. */
export const RollbackEnvelopeType = t.type({ rollback: RollbackProtocolMessageType });

/**
 * The whole wire, typed end to end: the socket envelope, holding the
 * communicator envelope, holding the room envelope, holding the room
 * payload — which is the rollback protocol, the one thing that rides
 * the rooms. Each layer's runtime codec keeps its `t.unknown` payload
 * (the layer gates its own envelope and hands the payload up, exactly
 * as before); this composition exists so ONE schema covers every byte
 * the socket sends, and its fingerprint (`liveWireFingerprint`) is the
 * identity peers compare at room join.
 */
export const WireMessageType = socketMessageType(
    communicatorMessageType(roomMessageType(RollbackEnvelopeType)));
export type WireMessage = t.TypeOf<typeof WireMessageType>;

export function rollbackProtocolDerivation(serializer?: Serializer): Derivation {
    return deriveAvroSchema(RollbackEnvelopeType, {
        name: 'RollbackEnvelope', hooks: novaCodecHooks(), serializer,
    });
}

export function simulationFrameDerivation(serializer?: Serializer): Derivation {
    return deriveAvroSchema(SimulationFrameType, {
        name: 'SimulationFrame', hooks: novaCodecHooks(), serializer,
    });
}

export function socketMessageDerivation(): Derivation {
    return deriveAvroSchema(SocketMessage, { name: 'SocketMessage' });
}

export function communicatorMessageDerivation(): Derivation {
    return deriveAvroSchema(CommunicatorMessage, { name: 'CommunicatorMessage' });
}

export function roomMessageDerivation(): Derivation {
    return deriveAvroSchema(RoomMessage, { name: 'RoomMessage' });
}

/**
 * The live socket's schema. Derived WITHOUT a serializer: the socket is
 * built before any world exists, so the component lists inside
 * (addEntity records, wire-snapshot baselines) ride opaquely; the
 * serializer that decodes them validates them on the receiving world,
 * as it always did.
 *
 * The world-independent registry EXISTS now (wire_snapshot_components.ts:
 * wireSnapshotSchema / wireSnapshotCodec type and encode a whole wire
 * snapshot with every component's data typed, sentinels dropped on the
 * binary wire, ~30% smaller on a measured baseline) — but wiring it
 * into THIS schema is still open: the JSON-safe capture form wraps
 * undefined as `{$undefined:true}`, and a typed field for `T | undefined`
 * decodes an absent optional as a MISSING key, which io-ts `t.type`
 * rejects (TargetComponent{target:undefined} is common — makeNpcShip
 * stamps it). Switching the live wire over needs either a
 * present-undefined encoding on the typed path or a tolerant restore,
 * and is recorded in the issue rather than improvised here.
 */
export function wireMessageDerivation(): Derivation {
    return deriveAvroSchema(WireMessageType, {
        name: 'WireMessage', hooks: novaCodecHooks(),
    });
}

/** The synchronous form, for callers that cannot await. */
function wireMessageDerivationSync(): Derivation {
    return wireMessageDerivation();
}

let live: WireCodec | undefined;

/**
 * The codec the socket layer uses (socket_channel_*.ts), built once:
 * WIRE_ENCODING over the live wire schema.
 */
export function liveWireCodec(): WireCodec {
    if (!live) {
        live = makeWireCodec(WIRE_ENCODING, () => wireMessageDerivation().schema);
    }
    return live;
}

/**
 * The live wire schema's fingerprint, sent on joinRequest; undefined
 * when the wire is not schema'd (json).
 */
export function liveWireFingerprint(): string | undefined {
    const codec = liveWireCodec();
    return codec.encoding === 'avro' ? (codec as AvroWireCodec).fingerprint : undefined;
}

/** A schema'd codec over an arbitrary socket payload codec, for specs. */
export function socketCodecFor<A, O>(payload: t.Type<A, O, unknown>): AvroWireCodec {
    return avroWireCodec(deriveAvroSchema(socketMessageType(payload), {
        name: 'SocketMessage', hooks: novaCodecHooks(),
    }).schema);
}
