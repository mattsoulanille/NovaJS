import { Either, isLeft } from 'fp-ts/lib/Either.js';
import * as t from 'io-ts';
import { compileAvroSchema } from './avro_binary.js';
import { schemaFingerprint } from './avro_fingerprint.js';
import { AvroSchema } from './io_ts_to_avro.js';

/**
 * ============================================================================
 * Wire codecs
 * ============================================================================
 *
 * How a message becomes bytes. Two implementations:
 *
 *   json     `JSON.stringify`, UTF-8. Self-describing, no schema; what
 *            the socket carried until PROTOCOL_VERSION 7, and what the
 *            persisted forms (room archives, desync dumps, pilot files)
 *            still use.
 *   avro     schema'd, binary (avro_binary.ts): field names never
 *            travel, numbers are fixed-width doubles or varint longs,
 *            enums and union branches are one byte. The schema is
 *            DERIVED from the io-ts codec at startup (io_ts_to_avro.ts)
 *            — no second schema language — and both ends of a socket
 *            derive it from the same build; the schema's fingerprint
 *            (avro_fingerprint.ts) is checked at room join.
 *
 * Number fidelity: avro keeps −0, NaN and ±Infinity everywhere — IEEE
 * doubles in schema'd fields, and the same doubles inside an opaque node
 * (a `t.unknown` the schema could not type rides as a self-describing
 * dynamic encoding, dynamic_encoding.ts). json keeps none of them.
 *
 * Neither replaces validation. The io-ts `decode` that gates every
 * receiving boundary (rollback_protocol.ts "Trust model" item 2) runs
 * AFTER the wire decode on both: `decodeWire`.
 */

export type WireEncoding = 'json' | 'avro';

/** The wire encoding of the room protocol: what `makeWireCodec` builds
 * for the socket layer (socket_channel_*.ts, via wire_schemas.ts). */
export const WIRE_ENCODING: WireEncoding = 'avro';

export interface WireCodec {
    readonly encoding: WireEncoding;
    /** Throws on a message the encoding cannot carry (avro: one the
     * schema rejects). */
    encode(message: unknown): Uint8Array;
    /** Throws on bytes the codec cannot parse. */
    decode(bytes: Uint8Array): unknown;
}

// ---------------------------------------------------------------------------
// json
// ---------------------------------------------------------------------------

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export const jsonWireCodec: WireCodec = {
    encoding: 'json',
    encode: message => textEncoder.encode(JSON.stringify(message)),
    decode: bytes => JSON.parse(textDecoder.decode(bytes)) as unknown,
};

// ---------------------------------------------------------------------------
// avro
// ---------------------------------------------------------------------------

export interface AvroWireCodec extends WireCodec {
    readonly schema: AvroSchema;
    /** CRC-64-AVRO of the schema's canonical form: the wire format's identity. */
    readonly fingerprint: string;
    /**
     * Why `message` will not cross this wire as it is — the schema
     * rejects it, or a round trip hands back something else — or
     * undefined when it round-trips faithfully.
     */
    explain(message: unknown): string | undefined;
}

function formatValue(value: unknown): string {
    if (Object.is(value, -0)) {
        return '-0';
    }
    if (typeof value === 'number' || value === undefined) {
        return String(value);
    }
    return String(JSON.stringify(value)).slice(0, 80);
}

/**
 * The first place `actual` (a round trip of `expected`) differs from
 * `expected` as a wire value: numbers by `Object.is`, so a folded −0 or
 * NaN shows; undefined and null as one (an absent optional decodes as
 * neither, and a required nullable field sends undefined as null);
 * everything else structurally, by own enumerable properties (a Position
 * instance in, a plain `{x, y}` out). Undefined when they agree.
 */
export function firstDifference(expected: unknown, actual: unknown, path: string): string | undefined {
    if (expected === undefined || expected === null) {
        return actual === undefined || actual === null ? undefined
            : `${path}: ${formatValue(expected)} came back as ${formatValue(actual)}`;
    }
    if (typeof expected !== 'object') {
        return Object.is(expected, actual) ? undefined
            : `${path}: ${formatValue(expected)} came back as ${formatValue(actual)}`;
    }
    if (actual === null || typeof actual !== 'object') {
        return `${path}: ${formatValue(expected)} came back as ${formatValue(actual)}`;
    }
    if (expected instanceof Uint8Array || actual instanceof Uint8Array) {
        const same = expected instanceof Uint8Array && actual instanceof Uint8Array
            && expected.length === actual.length && expected.every((byte, i) => byte === actual[i]);
        return same ? undefined : `${path}: bytes came back different`;
    }
    if (Array.isArray(expected) || Array.isArray(actual)) {
        if (!Array.isArray(expected) || !Array.isArray(actual)) {
            return `${path}: ${formatValue(expected)} came back as ${formatValue(actual)}`;
        }
        if (expected.length !== actual.length) {
            return `${path}: ${expected.length} items came back as ${actual.length}`;
        }
        for (let i = 0; i < expected.length; i++) {
            const difference = firstDifference(expected[i], actual[i], `${path}[${i}]`);
            if (difference) {
                return difference;
            }
        }
        return undefined;
    }
    const left = expected as Record<string, unknown>;
    const right = actual as Record<string, unknown>;
    for (const key of new Set([...Object.keys(left), ...Object.keys(right)])) {
        const difference = firstDifference(left[key], right[key], `${path}.${key}`);
        if (difference) {
            return difference;
        }
    }
    return undefined;
}

export function avroWireCodec(schema: AvroSchema): AvroWireCodec {
    const binary = compileAvroSchema(schema);
    return {
        encoding: 'avro',
        schema,
        fingerprint: schemaFingerprint(schema),
        encode: message => binary.encode(message),
        decode: bytes => binary.decode(bytes),
        explain(message) {
            let back: unknown;
            try {
                back = binary.decode(binary.encode(message));
            } catch (error) {
                return `round trip failed: ${String(error)}`;
            }
            const difference = firstDifference(message, back, '$');
            return difference && `round trip is lossy: ${difference}`;
        },
    };
}

// ---------------------------------------------------------------------------
// Selection and the validation gate
// ---------------------------------------------------------------------------

/**
 * The codec for `encoding`. The schema is only derived for `avro`, so
 * callers pass a thunk and pay nothing for json.
 */
export function makeWireCodec(encoding: WireEncoding, schema: () => AvroSchema): WireCodec {
    switch (encoding) {
        case 'json':
            return jsonWireCodec;
        case 'avro':
            return avroWireCodec(schema());
    }
}

/**
 * The receiving boundary: wire decode, then the io-ts codec. Bytes the
 * wire codec cannot parse are a decode failure like any other, not an
 * exception (a hostile frame must not throw past the socket handler).
 */
export function decodeWire<A>(codec: WireCodec, type: t.Type<A, unknown, unknown>,
    bytes: Uint8Array): Either<t.Errors, A> {
    let raw: unknown;
    try {
        raw = codec.decode(bytes);
    } catch (error) {
        return t.failure(bytes, [{ key: '', type, actual: bytes }],
            `${codec.encoding} decode failed: ${String(error)}`);
    }
    return type.decode(raw);
}

/** `decodeWire`, for callers that treat a failure as a bug. */
export function decodeWireOrThrow<A>(codec: WireCodec, type: t.Type<A, unknown, unknown>,
    bytes: Uint8Array): A {
    const decoded = decodeWire(codec, type, bytes);
    if (isLeft(decoded)) {
        throw new Error(`wire decode (${codec.encoding}) failed validation: `
            + decoded.left.map(error => error.message ?? error.context
                .map(entry => entry.key).join('.')).slice(0, 3).join('; '));
    }
    return decoded.right;
}
