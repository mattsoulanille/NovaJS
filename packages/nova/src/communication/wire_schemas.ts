import * as t from 'io-ts';
import { Serializer } from 'nova_ecs/plugins/serializer_plugin';
import { stat } from '../nova_plugin/core/stat.js';
import { CommunicatorMessage } from './communicator_message.js';
import { CodecHook, CodecHooks, Derivation, deriveAvroSchema } from './io_ts_to_avro.js';
import { RoomMessage } from './multi_room_communicator.js';
import { RollbackProtocolMessageType } from './rollback_protocol.js';
import { SimulationFrameType } from './simulation_frame.js';
import { WireTick } from './simulation_input.js';
import { SocketMessage } from './socket_message.js';

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
