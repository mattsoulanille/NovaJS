import { ByteReader, ByteWriter } from './avro_bytes.js';
import { readDynamic, writeDynamic } from './dynamic_encoding.js';
import { AvroSchema, AvroSchemaNode } from './io_ts_to_avro.js';

/**
 * ============================================================================
 * In-house Avro binary codec
 * ============================================================================
 *
 * Compiles a derived Avro schema (io_ts_to_avro.ts) into a writer and a
 * reader that produce and consume the STANDARD Avro binary encoding —
 * what any Avro implementation would emit for the same schema and the
 * same value — so the browser bundle carries no schema library (avsc
 * needs a Buffer polyfill and last shipped in 2022; it remains a dev
 * dependency that the specs decode our bytes with, and vice versa,
 * byte for byte).
 *
 * Avro's encoding, as written here:
 *
 *   null              nothing
 *   boolean           one byte
 *   int, long         zig-zag varint (avro_bytes.ts)
 *   float, double     IEEE 754, little-endian
 *   string, bytes     varint length + contents
 *   record            fields in schema order, nothing else
 *   enum              varint symbol index
 *   array, map        blocks: varint count, the items (map: string key
 *                     + value), ... , a zero count. Written as ONE block.
 *   union             varint branch index, then the branch's value
 *
 * The schema's annotations (io_ts_to_avro.ts documents each) are
 * honoured in the same pass rather than by a value transform before and
 * after — a tuple is written straight from the array, a discriminated
 * union picks its branch by the discriminator, a component-list pair
 * `[name, data]` by the component name, an optional field by
 * `undefined`, and an opaque node as `bytes` holding the dynamic
 * encoding (dynamic_encoding.ts) — so nothing is allocated on the way
 * in beyond the output buffer. Reads build plain objects: an optional
 * field that took the null branch is ABSENT (so `t.partial` accepts
 * it), a required nullable field is null.
 */

/** Writes `value` (which must conform to the schema) to `out`. */
export type AvroWriter = (value: unknown, out: ByteWriter) => void;
/** Reads one value from `input`. */
export type AvroReader = (input: ByteReader) => unknown;

/**
 * How an unwrapped union picks its branch from a JavaScript value: the
 * value's kind, since Avro has no other key. The deriver only emits
 * unions whose branches claim distinct kinds (io_ts_to_avro.ts
 * `buckets`); `any` is the opaque branch, which takes what no other
 * branch claims, and `present` the optional-field wrapper, which takes
 * everything but undefined.
 */
type Bucket = 'null' | 'boolean' | 'number' | 'string' | 'bytes' | 'array' | 'object'
    | 'any' | 'present';

function valueBucket(value: unknown): Bucket {
    if (value === null || value === undefined) {
        return 'null';
    }
    switch (typeof value) {
        case 'boolean':
            return 'boolean';
        case 'number':
            return 'number';
        case 'string':
            return 'string';
        default:
            if (value instanceof Uint8Array) {
                return 'bytes';
            }
            return Array.isArray(value) ? 'array' : 'object';
    }
}

interface Codec {
    write: AvroWriter;
    read: AvroReader;
    /** The JavaScript-side kind this branch claims in a union. */
    bucket: Bucket;
}

/** A union's branches, for the optional-field fast path in records. */
interface UnionCodec extends Codec {
    branches: Codec[];
    nullIndex: number;
}

/** A value the schema does not admit; the path is filled in on the way out. */
class AvroTypeError extends TypeError {
    readonly path: string[] = [];
}

function expected(what: string, value: unknown): Error {
    return new AvroTypeError(`avro: expected ${what}, got ${describe(value)}`);
}

/** Rethrows `error` with `segment` prepended to its path. */
function at(error: unknown, segment: string | number): never {
    if (error instanceof AvroTypeError) {
        error.path.unshift(String(segment));
    }
    throw error;
}

function describe(value: unknown): string {
    if (value === null) {
        return 'null';
    }
    if (typeof value === 'object') {
        return Array.isArray(value) ? 'an array' : `an object`;
    }
    return `${typeof value} ${String(value).slice(0, 40)}`;
}

const NULL: Codec = {
    bucket: 'null',
    write: value => {
        if (value !== null && value !== undefined) {
            throw expected('null', value);
        }
    },
    read: () => null,
};

const BOOLEAN: Codec = {
    bucket: 'boolean',
    write: (value, out) => {
        if (typeof value !== 'boolean') {
            throw expected('a boolean', value);
        }
        out.writeByte(value ? 1 : 0);
    },
    read: input => {
        const byte = input.readByte();
        if (byte > 1) {
            throw new RangeError(`avro: boolean byte ${byte}`);
        }
        return byte === 1;
    },
};

const INT: Codec = {
    bucket: 'number',
    write: (value, out) => {
        if (typeof value !== 'number' || !Number.isInteger(value)
            || value < -2147483648 || value > 2147483647) {
            throw expected('a 32-bit integer', value);
        }
        out.writeZigZag(value);
    },
    read: input => input.readZigZag(),
};

const LONG: Codec = {
    bucket: 'number',
    write: (value, out) => {
        if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
            throw expected('a safe integer', value);
        }
        out.writeZigZag(value);
    },
    read: input => input.readZigZag(),
};

const FLOAT: Codec = {
    bucket: 'number',
    write: (value, out) => {
        if (typeof value !== 'number') {
            throw expected('a number', value);
        }
        out.writeFloat(value);
    },
    read: input => input.readFloat(),
};

const DOUBLE: Codec = {
    bucket: 'number',
    write: (value, out) => {
        if (typeof value !== 'number') {
            throw expected('a number', value);
        }
        out.writeDouble(value);
    },
    read: input => input.readDouble(),
};

const STRING: Codec = {
    bucket: 'string',
    write: (value, out) => {
        if (typeof value !== 'string') {
            throw expected('a string', value);
        }
        out.writeString(value);
    },
    read: input => input.readString(),
};

const BYTES: Codec = {
    bucket: 'bytes',
    write: (value, out) => {
        if (!(value instanceof Uint8Array)) {
            throw expected('bytes', value);
        }
        out.writeBytes(value);
    },
    read: input => input.readBytes(),
};

const OPAQUE: Codec = {
    bucket: 'any',
    write: (value, out) => {
        // Length-prefixed like `bytes`: write the dynamic encoding to
        // a scratch, then copy. Opaque nodes are rare and small.
        const scratch = new ByteWriter(64);
        writeDynamic(value, scratch);
        out.writeBytes(scratch.bytes());
    },
    read: input => {
        const bytes = input.readBytes();
        const inner = new ByteReader(bytes);
        const value = readDynamic(inner);
        if (inner.remaining !== 0) {
            throw new RangeError('avro: trailing bytes in an opaque node');
        }
        return value;
    },
};

const PRIMITIVES: Record<string, Codec> = {
    null: NULL, boolean: BOOLEAN, int: INT, long: LONG, float: FLOAT,
    double: DOUBLE, string: STRING, bytes: BYTES,
};

/** Arrays and maps: a count this large is not a message, it is an attack. */
const MAX_ITEMS = 1 << 24;

class Compiler {
    /** Named codecs; a name used before its definition gets a stub. */
    private readonly named = new Map<string, Codec>();
    private readonly defined = new Set<string>();

    compile(schema: AvroSchema): Codec {
        if (typeof schema === 'string') {
            return PRIMITIVES[schema] ?? this.reference(schema);
        }
        if (Array.isArray(schema)) {
            return this.union(schema);
        }
        switch (schema.logicalType) {
            case 'opaque':
                return OPAQUE;
            case 'kindUnion':
                return this.kindUnion(schema);
            case 'componentUnion':
                return this.componentUnion(schema);
        }
        if (Array.isArray(schema.type)) {
            return this.union(schema.type);
        }
        switch (schema.type) {
            case 'record':
                return this.define(schema, () => this.record(schema));
            case 'enum':
                return this.define(schema, () => this.enumeration(schema));
            case 'array':
                return this.array(this.compile(schema.items!));
            case 'map':
                return this.map(this.compile(schema.values!));
            case 'fixed':
                throw new Error('avro: fixed is not supported');
            default:
                // A primitive with attributes ({type: 'bytes', ...}).
                return this.compile(schema.type);
        }
    }

    /** Every name referenced must have been defined somewhere. */
    check() {
        for (const name of this.named.keys()) {
            if (!this.defined.has(name)) {
                throw new Error(`avro: undefined type ${name}`);
            }
        }
    }

    private reference(name: string): Codec {
        let codec = this.named.get(name);
        if (!codec) {
            // Bound when the definition compiles (self-references in a
            // record's own fields, and every later use).
            const stub: Codec = {
                bucket: 'object',
                write: (value, out) => stub.write(value, out),
                read: input => stub.read(input),
            };
            codec = stub;
            this.named.set(name, stub);
        }
        return codec;
    }

    private define(schema: AvroSchemaNode, build: () => Codec): Codec {
        const name = schema.name;
        if (name === undefined) {
            return build();
        }
        if (this.defined.has(name)) {
            throw new Error(`avro: type ${name} defined twice`);
        }
        const stub = this.reference(name);
        this.defined.add(name);
        const codec = build();
        stub.bucket = codec.bucket;
        stub.write = codec.write;
        stub.read = codec.read;
        return stub;
    }

    private record(schema: AvroSchemaNode): Codec {
        if (schema.logicalType === 'tuple') {
            return this.tuple(schema);
        }
        if (schema.logicalType === 'present') {
            // The wrapper exists only so a present null and an absent
            // field take different union branches; on the wire it is
            // its one field.
            const inner = this.compile(schema.fields![0]!.type);
            return {
                bucket: 'present',
                write: inner.write,
                read: inner.read,
            };
        }
        const optional = new Set(schema.optional ?? []);
        const renamed = schema.renamed ?? {};
        const fields = schema.fields!.map(field => {
            const codec = this.compile(field.type);
            const union = 'branches' in codec ? codec as UnionCodec : undefined;
            if (optional.has(field.name) && (!union || union.nullIndex < 0)) {
                throw new Error(`avro: optional field ${field.name} is not nullable`);
            }
            return {
                key: renamed[field.name] ?? field.name,
                codec,
                // An optional field reads and writes its union's index
                // itself: undefined is the null branch, and the null
                // branch decodes as absent.
                optional: optional.has(field.name) ? union : undefined,
            };
        });
        return {
            bucket: 'object',
            write: (value, out) => {
                if (value === null || typeof value !== 'object') {
                    throw expected('a record', value);
                }
                const source = value as Record<string, unknown>;
                let current = '';
                try {
                    for (const field of fields) {
                        current = field.key;
                        const inner = source[field.key];
                        if (field.optional) {
                            writeOptional(field.optional, inner, out);
                        } else {
                            field.codec.write(inner, out);
                        }
                    }
                } catch (error) {
                    at(error, current);
                }
            },
            read: input => {
                const record: Record<string, unknown> = {};
                for (const field of fields) {
                    if (field.optional) {
                        const index = input.readZigZag();
                        if (index === field.optional.nullIndex) {
                            continue;
                        }
                        const branch = field.optional.branches[index];
                        if (!branch) {
                            throw new RangeError(`avro: union index ${index}`);
                        }
                        record[field.key] = branch.read(input);
                    } else {
                        record[field.key] = field.codec.read(input);
                    }
                }
                return record;
            },
        };
    }

    private tuple(schema: AvroSchemaNode): Codec {
        const items = schema.fields!.map(field => this.compile(field.type));
        const arity = items.length;
        return {
            bucket: 'array',
            write: (value, out) => {
                if (!Array.isArray(value) || value.length !== arity) {
                    throw expected(`a tuple of ${arity}`, value);
                }
                let i = 0;
                try {
                    for (; i < arity; i++) {
                        items[i]!.write(value[i], out);
                    }
                } catch (error) {
                    at(error, i);
                }
            },
            read: input => {
                const array = new Array<unknown>(arity);
                for (let i = 0; i < arity; i++) {
                    array[i] = items[i]!.read(input);
                }
                return array;
            },
        };
    }

    private enumeration(schema: AvroSchemaNode): Codec {
        const symbols = schema.symbols!;
        const indices = new Map(symbols.map((symbol, i) => [symbol, i]));
        return {
            bucket: 'string',
            write: (value, out) => {
                const index = typeof value === 'string' ? indices.get(value) : undefined;
                if (index === undefined) {
                    throw expected(`one of ${symbols.join('|')}`, value);
                }
                out.writeZigZag(index);
            },
            read: input => {
                const index = input.readZigZag();
                const symbol = symbols[index];
                if (symbol === undefined) {
                    throw new RangeError(`avro: enum index ${index}`);
                }
                return symbol;
            },
        };
    }

    private array(items: Codec): Codec {
        return {
            bucket: 'array',
            write: (value, out) => {
                if (!Array.isArray(value)) {
                    throw expected('an array', value);
                }
                if (value.length > 0) {
                    out.writeZigZag(value.length);
                    let i = 0;
                    try {
                        for (; i < value.length; i++) {
                            items.write(value[i], out);
                        }
                    } catch (error) {
                        at(error, i);
                    }
                }
                out.writeByte(0);
            },
            read: input => {
                const array: unknown[] = [];
                for (; ;) {
                    let count = input.readZigZag();
                    if (count === 0) {
                        return array;
                    }
                    if (count < 0) {
                        // A sized block: the byte size follows the count.
                        count = -count;
                        input.readZigZag();
                    }
                    if (count > MAX_ITEMS) {
                        throw new RangeError(`avro: array block of ${count}`);
                    }
                    for (let i = 0; i < count; i++) {
                        array.push(items.read(input));
                    }
                }
            },
        };
    }

    private map(values: Codec): Codec {
        return {
            bucket: 'object',
            write: (value, out) => {
                if (value === null || typeof value !== 'object' || Array.isArray(value)) {
                    throw expected('a map', value);
                }
                const entries = Object.entries(value as Record<string, unknown>);
                if (entries.length > 0) {
                    out.writeZigZag(entries.length);
                    let current = '';
                    try {
                        for (const [key, inner] of entries) {
                            current = key;
                            out.writeString(key);
                            values.write(inner, out);
                        }
                    } catch (error) {
                        at(error, current);
                    }
                }
                out.writeByte(0);
            },
            read: input => {
                const record: Record<string, unknown> = {};
                for (; ;) {
                    let count = input.readZigZag();
                    if (count === 0) {
                        return record;
                    }
                    if (count < 0) {
                        count = -count;
                        input.readZigZag();
                    }
                    if (count > MAX_ITEMS) {
                        throw new RangeError(`avro: map block of ${count}`);
                    }
                    for (let i = 0; i < count; i++) {
                        const key = input.readString();
                        record[key] = values.read(input);
                    }
                }
            },
        };
    }

    private union(schema: AvroSchema[]): UnionCodec {
        const branches = schema.map(branch => {
            if (Array.isArray(branch)) {
                throw new Error('avro: a union branch may not itself be a union');
            }
            return this.compile(branch);
        });
        const byBucket = new Map<Bucket, number>();
        let nullIndex = -1;
        let opaqueIndex = -1;
        let presentIndex = -1;
        branches.forEach((branch, index) => {
            if (byBucket.has(branch.bucket)) {
                throw new Error(`avro: ambiguous union, two branches are ${branch.bucket}s`);
            }
            byBucket.set(branch.bucket, index);
            if (branch.bucket === 'null') {
                nullIndex = index;
            } else if (branch.bucket === 'any') {
                opaqueIndex = index;
            } else if (branch.bucket === 'present') {
                presentIndex = index;
            }
        });
        const pick = (value: unknown): number => {
            if (presentIndex >= 0) {
                // `['null', present]`: only undefined is absent; a
                // present null rides in the wrapper.
                return value === undefined ? nullIndex : presentIndex;
            }
            if (value === undefined || value === null) {
                if (nullIndex < 0) {
                    throw expected(`one of ${[...byBucket.keys()].join('|')}`, value);
                }
                return nullIndex;
            }
            const index = byBucket.get(valueBucket(value)) ?? opaqueIndex;
            if (index < 0) {
                throw expected(`one of ${[...byBucket.keys()].join('|')}`, value);
            }
            return index;
        };
        return {
            bucket: 'object',
            branches,
            nullIndex,
            write: (value, out) => {
                const index = pick(value);
                out.writeZigZag(index);
                branches[index]!.write(value, out);
            },
            read: input => {
                const index = input.readZigZag();
                const branch = branches[index];
                if (!branch) {
                    throw new RangeError(`avro: union index ${index}`);
                }
                return branch.read(input);
            },
        };
    }

    private kindUnion(schema: AvroSchemaNode): Codec {
        const discriminator = schema.discriminator!;
        const branchSchemas = schema.type as AvroSchema[];
        const branches = branchSchemas.map(branch => this.compile(branch));
        const nameToIndex = new Map<string, number>();
        branchSchemas.forEach((branch, index) => {
            const name = typeof branch === 'string' ? branch : (branch as AvroSchemaNode).name;
            if (name !== undefined) {
                nameToIndex.set(name, index);
            }
        });
        const nullIndex = nameToIndex.get('null') ?? -1;
        const byLiteral = new Map<string, number>();
        for (const [literal, branchName] of Object.entries(schema.branches!)) {
            const index = nameToIndex.get(branchName);
            if (index === undefined) {
                throw new Error(`avro: kindUnion branch ${branchName} is not in the union`);
            }
            byLiteral.set(literal, index);
        }
        return {
            bucket: 'object',
            write: (value, out) => {
                if (value === null || value === undefined) {
                    if (nullIndex < 0) {
                        throw expected('a discriminated record', value);
                    }
                    out.writeZigZag(nullIndex);
                    return;
                }
                if (typeof value !== 'object') {
                    throw expected('a discriminated record', value);
                }
                const key = String((value as Record<string, unknown>)[discriminator]);
                const index = byLiteral.get(key);
                if (index === undefined) {
                    throw new TypeError(`avro: no union branch for ${discriminator}=${key}`);
                }
                out.writeZigZag(index);
                branches[index]!.write(value, out);
            },
            read: input => {
                const index = input.readZigZag();
                const branch = branches[index];
                if (!branch) {
                    throw new RangeError(`avro: union index ${index}`);
                }
                return branch.read(input);
            },
        };
    }

    /**
     * One `[name, data]` pair of a component list: the branch index is
     * the component, the branch record's one field is the data.
     */
    private componentUnion(schema: AvroSchemaNode): Codec {
        const components = schema.components ?? {};
        const extra = schema.extra!;
        const byComponent = new Map<string, { index: number, data: Codec }>();
        const byIndex: { component: string, data: Codec }[] = [];
        let extraIndex = -1;
        (schema.type as AvroSchema[]).forEach((branch, index) => {
            // The branch record `{data}` is defined at the list's first
            // use and referenced by name after. Its one field is written
            // directly; the record itself is registered under its name
            // (compiled once, from the field codec) so the reference
            // resolves.
            const name = typeof branch === 'string' ? branch : (branch as AvroSchemaNode).name!;
            if (name === extra) {
                if (typeof branch !== 'string') {
                    this.compile(branch);
                }
                extraIndex = index;
                return;
            }
            const data = this.componentBranch(name,
                typeof branch === 'string' ? undefined : branch as AvroSchemaNode);
            const component = components[name]!;
            byComponent.set(component, { index, data });
            byIndex[index] = { component, data };
        });
        return {
            bucket: 'array',
            write: (value, out) => {
                if (!Array.isArray(value) || value.length !== 2 || typeof value[0] !== 'string') {
                    throw expected('a [name, data] pair', value);
                }
                const [name, data] = value as [string, unknown];
                const entry = byComponent.get(name);
                if (entry === undefined) {
                    out.writeZigZag(extraIndex);
                    out.writeString(name);
                    OPAQUE.write(data, out);
                    return;
                }
                out.writeZigZag(entry.index);
                try {
                    entry.data.write(data, out);
                } catch (error) {
                    at(error, name);
                }
            },
            read: input => {
                const index = input.readZigZag();
                if (index === extraIndex) {
                    const name = input.readString();
                    return [name, OPAQUE.read(input)];
                }
                const entry = byIndex[index];
                if (!entry) {
                    throw new RangeError(`avro: component index ${index}`);
                }
                return [entry.component, entry.data.read(input)];
            },
        };
    }

    /** The data codec of each component branch record, by branch name. */
    private readonly componentBranches = new Map<string, Codec>();

    private componentBranch(name: string, node: AvroSchemaNode | undefined): Codec {
        const known = this.componentBranches.get(name);
        if (known) {
            return known;
        }
        if (!node) {
            throw new Error(`avro: component branch ${name} referenced before its definition`);
        }
        const data = this.compile(node.fields![0]!.type);
        this.define(node, () => ({
            bucket: 'object',
            write: (value, out) => data.write((value as { data: unknown }).data, out),
            read: input => ({ data: data.read(input) }),
        }));
        this.componentBranches.set(name, data);
        return data;
    }
}

function writeOptional(union: UnionCodec, value: unknown, out: ByteWriter) {
    if (value === undefined) {
        out.writeZigZag(union.nullIndex);
        return;
    }
    union.write(value, out);
}

export interface AvroBinaryCodec {
    write: AvroWriter;
    read: AvroReader;
    encode(value: unknown): Uint8Array;
    /** Throws on malformed bytes, and on bytes left over after the value. */
    decode(bytes: Uint8Array): unknown;
}

/** Compiles `schema` (a derived schema, annotations included). */
export function compileAvroSchema(schema: AvroSchema): AvroBinaryCodec {
    const compiler = new Compiler();
    const codec = compiler.compile(schema);
    compiler.check();
    return {
        write: codec.write,
        read: codec.read,
        encode(value) {
            const out = new ByteWriter(256);
            try {
                codec.write(value, out);
            } catch (error) {
                if (error instanceof AvroTypeError) {
                    throw new TypeError(`${error.message} at $.${error.path.join('.')}`);
                }
                throw error;
            }
            return out.bytes();
        },
        decode(bytes) {
            const input = new ByteReader(bytes);
            const value = codec.read(input);
            if (input.remaining !== 0) {
                throw new RangeError(`avro: ${input.remaining} trailing bytes`);
            }
            return value;
        },
    };
}
