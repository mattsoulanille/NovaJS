import { ByteReader, ByteWriter } from './avro_bytes.js';

/**
 * ============================================================================
 * Dynamic (self-describing) binary encoding
 * ============================================================================
 *
 * What an OPAQUE node of the derived Avro schema carries: a value the
 * io-ts codec left untyped (`t.unknown`), serialized with its own type
 * tags so the receiver can rebuild it without a schema. The data model
 * is JSON's — null, booleans, numbers, strings, arrays, string-keyed
 * objects — with one deliberate difference: numbers travel as IEEE
 * doubles (or exact zig-zag integers), so −0, NaN and ±Infinity survive
 * where `JSON.stringify` folds them. Undefined is treated as JSON does:
 * an undefined property is omitted, an undefined element or root is
 * null.
 *
 * Layout: one tag byte, then the payload.
 *
 *   0 null        1 false        2 true
 *   3 integer     Avro long (safe integers within ±2^31, never −0)
 *   4 double      8 bytes, little-endian IEEE 754
 *   5 string      Avro string (long byte length + UTF-8)
 *   6 array       long count + elements
 *   7 object      long count + (string key, value) pairs
 *
 * Used only in-house (avro_binary.ts, and the avsc reference codec in
 * specs); nothing else reads these bytes.
 */

const enum Tag {
    Null = 0,
    False = 1,
    True = 2,
    Integer = 3,
    Double = 4,
    String = 5,
    Array = 6,
    Object = 7,
}

const INT_LIMIT = 2 ** 31;

function writeValue(value: unknown, out: ByteWriter, path: string): void {
    if (value === null || value === undefined) {
        out.writeByte(Tag.Null);
        return;
    }
    switch (typeof value) {
        case 'boolean':
            out.writeByte(value ? Tag.True : Tag.False);
            return;
        case 'number':
            if (Number.isInteger(value) && !Object.is(value, -0)
                && value > -INT_LIMIT && value < INT_LIMIT) {
                out.writeByte(Tag.Integer);
                out.writeZigZag(value);
            } else {
                out.writeByte(Tag.Double);
                out.writeDouble(value);
            }
            return;
        case 'string':
            out.writeByte(Tag.String);
            out.writeString(value);
            return;
        case 'object':
            break;
        default:
            throw new Error(`dynamic encoding: a ${typeof value} at ${path} `
                + 'cannot cross the wire');
    }
    if (Array.isArray(value)) {
        out.writeByte(Tag.Array);
        out.writeZigZag(value.length);
        for (let i = 0; i < value.length; i++) {
            writeValue(value[i], out, `${path}[${i}]`);
        }
        return;
    }
    if (value instanceof Uint8Array || value instanceof Map || value instanceof Set) {
        throw new Error(`dynamic encoding: a ${value.constructor.name} at ${path} `
            + 'has no JSON form; encode it first');
    }
    // Own enumerable string keys, undefined omitted: JSON.stringify's
    // view of an object, class instances (Position) included.
    const record = value as Record<string, unknown>;
    const keys: string[] = [];
    for (const key in record) {
        if (Object.prototype.hasOwnProperty.call(record, key)
            && record[key] !== undefined) {
            keys.push(key);
        }
    }
    out.writeByte(Tag.Object);
    out.writeZigZag(keys.length);
    for (const key of keys) {
        out.writeString(key);
        writeValue(record[key], out, `${path}.${key}`);
    }
}

function readValue(input: ByteReader, depth: number): unknown {
    if (depth > 512) {
        throw new Error('dynamic encoding: nesting too deep');
    }
    const tag = input.readByte();
    switch (tag) {
        case Tag.Null:
            return null;
        case Tag.False:
            return false;
        case Tag.True:
            return true;
        case Tag.Integer:
            return input.readZigZag();
        case Tag.Double:
            return input.readDouble();
        case Tag.String:
            return input.readString();
        case Tag.Array: {
            const count = input.readCount();
            const array: unknown[] = [];
            for (let i = 0; i < count; i++) {
                array.push(readValue(input, depth + 1));
            }
            return array;
        }
        case Tag.Object: {
            const count = input.readCount();
            const record: Record<string, unknown> = {};
            for (let i = 0; i < count; i++) {
                const key = input.readString();
                record[key] = readValue(input, depth + 1);
            }
            return record;
        }
        default:
            throw new Error(`dynamic encoding: unknown tag ${tag}`);
    }
}

/** Appends `value` to `out` in the dynamic encoding. */
export function writeDynamic(value: unknown, out: ByteWriter): void {
    writeValue(value, out, '$');
}

/** Reads one dynamically encoded value from `input`. */
export function readDynamic(input: ByteReader): unknown {
    return readValue(input, 0);
}

export function dynamicEncode(value: unknown): Uint8Array {
    const out = new ByteWriter();
    writeDynamic(value, out);
    return out.bytes();
}

export function dynamicDecode(bytes: Uint8Array): unknown {
    const input = new ByteReader(bytes);
    const value = readDynamic(input);
    if (input.remaining !== 0) {
        throw new Error(`dynamic encoding: ${input.remaining} trailing bytes`);
    }
    return value;
}
