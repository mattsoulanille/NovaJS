import { Either, isLeft, left, right } from 'fp-ts/lib/Either.js';
import * as t from 'io-ts';
import { formatIoTsErrors, Serializer } from 'nova_ecs/plugins/serializer_plugin';
import { stat } from '../nova_plugin/core/index.js';
import { EncodedActiveMissionType } from '../nova_plugin/missions/index.js';
import { ActiveMissionType } from '../nova_plugin/player/index.js';
import { CommunicatorMessage, communicatorMessageType, MessageType } from './communicator_message.js';
import { CodecHook, CodecHooks, Derivation, deriveAvroSchema } from './io_ts_to_avro.js';
import { RoomMessage, roomMessageType } from './multi_room_communicator.js';
import { RollbackProtocolMessageType } from './rollback_protocol.js';
import { SimulationFrameType } from './simulation_frame.js';
import { SimulationInput, WireTick } from './simulation_input.js';
import { SocketMessage, socketMessageType } from './socket_message.js';
import {
    AvroWireCodec, avroWireCodec, decodeWire, makeWireCodec, WIRE_ENCODING, WireCodec,
} from './wire_codec.js';
import { wireSnapshotRegistrySerializer } from './wire_snapshot_components.js';

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
        // The acceptMission record's mission payload: the ENCODED
        // ActiveMission, validated pass-through by the codec
        // (mission_accept.ts) and typed on the wire by the same schema
        // ActiveMissionType itself derives (#269). A function hook so
        // the record schema is derived once and referenced by name at
        // every use (`mission`, each missionsStarted entry).
        [EncodedActiveMissionType, (derive, path) =>
            derive(ActiveMissionType, path, 'ActiveMission')],
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
 * The live socket's schema. The socket is built before any world
 * exists, so the component lists inside — a catchUp baseline's or a
 * desync dump's wire snapshot, an addEntity record's entity — are
 * typed by the world-independent registry (wire_snapshot_components.ts:
 * every component codec the simulation plugin set registers, without
 * a world): each component's data crosses at its schema's width under
 * a one-byte branch index, and a wire snapshot's toJsonSafe sentinels
 * are unwrapped on the binary wire (io_ts_to_avro componentList). The
 * serializer that decodes them still validates them on the receiving
 * world, as it always did. What stays opaque is exactly what the
 * protocol leaves `t.unknown` (io_ts_to_avro_test pins the list).
 */
export function wireMessageDerivation(): Derivation {
    return deriveAvroSchema(WireMessageType, {
        name: 'WireMessage', hooks: novaCodecHooks(),
        serializer: wireSnapshotRegistrySerializer(),
    });
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

/**
 * `input` as the room receives it — or why the room's wire refuses it.
 * THE gate for this peer's own inputs (#295): the authoring host's
 * records never cross the receiving codecs — it schedules them straight
 * into its own timeline — so an input the wire refuses was applied here
 * while the room never saw it (the sender's socket throws on it, or
 * drops it in production, #272; or the relay's decode drops it), a
 * self-inflicted desync. SimulationBridgeHost.schedule runs this on
 * every input before it is applied or published.
 *
 * It is the wire itself, not a model of it: the input rides a one-input
 * `inputs` record inside the full socket envelope, through `codec` (the
 * live socket codec by default) exactly as publishInputs sends it —
 * `encode` is the sender's socket, which throws on what the schema
 * rejects — and back through `decodeWire` with WireMessageType, whose
 * innermost layer is RollbackProtocolMessageType: the relay's and every
 * peer's receiving gate (unwrapRollbackMessage). The record's own
 * fields (tick, seq, peerId) are the host's, always valid, so a record
 * of inputs this admits is one the room admits.
 *
 * What comes back (Right) is what every other peer applies: unknown
 * fields stripped by the strict codecs, an absent required nullable
 * sent as null. The host applies THAT, not the value it was handed, so
 * its own timeline holds exactly the input the room holds.
 */
export function inputThroughWire(input: SimulationInput,
    codec: WireCodec = liveWireCodec()): Either<string, SimulationInput> {
    const frame: WireMessage = {
        message: {
            type: MessageType.message,
            message: {
                room: '',
                message: { rollback: { kind: 'inputs', record: { tick: 0, inputs: [input] } } },
            },
        },
    };
    let bytes: Uint8Array;
    try {
        bytes = codec.encode(SocketMessage.encode(frame));
    } catch (error) {
        return left(`the ${codec.encoding} wire cannot carry it: ${String(error)}`);
    }
    const decoded = decodeWire(codec, WireMessageType, bytes);
    if (isLeft(decoded)) {
        return left('the room\'s codec refuses it: '
            + formatIoTsErrors(decoded.left).slice(0, 3).join('; '));
    }
    const communicator = decoded.right.message;
    const rollback = communicator?.type === MessageType.message
        ? communicator.message.message?.rollback : undefined;
    const received = rollback?.kind === 'inputs'
        ? rollback.record.inputs : undefined;
    if (received?.length !== 1) {
        // Unreachable: the codec decoded the frame it was handed.
        return left('the wire handed back a different message');
    }
    return right(received[0]!);
}

/** A schema'd codec over an arbitrary socket payload codec, for specs. */
export function socketCodecFor<A, O>(payload: t.Type<A, O, unknown>): AvroWireCodec {
    return avroWireCodec(deriveAvroSchema(socketMessageType(payload), {
        name: 'SocketMessage', hooks: novaCodecHooks(),
    }).schema);
}
