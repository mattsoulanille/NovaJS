import { Decoder, Encoder } from '@msgpack/msgpack';
import avro from 'avsc';
import { dynamicDecode, dynamicEncode } from './dynamic_encoding.js';
import { AvroSchema, AvroSchemaNode } from './io_ts_to_avro.js';
import { WireCodec } from './wire_codec.js';

/**
 * ============================================================================
 * Reference codecs (DEV ONLY: specs and the benchmark)
 * ============================================================================
 *
 * The in-house Avro codec (avro_binary.ts) must produce the standard
 * Avro binary encoding — nothing else guarantees a future reader, or a
 * peer built differently, decodes it. This module keeps an independent
 * implementation to hold it to: `avscReferenceCodec` encodes and
 * decodes through avsc over the same derived schema, with the shape
 * transforms the schema's annotations call for compiled into a value
 * PLAN run before avsc encodes and after it decodes (the prototype's
 * design, PR #221). The specs require both codecs to accept each
 * other's bytes and to produce the same bytes for every message.
 *
 * avsc is a dev dependency: it needs a Buffer polyfill in the browser
 * and last shipped in 2022. Nothing on a live path imports this module.
 * `msgpackWireCodec` is here for the benchmark's comparison column.
 */

function toBuffer(bytes: Uint8Array): Buffer {
    return Buffer.isBuffer(bytes) ? bytes
        : Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

// ---------------------------------------------------------------------------
// msgpack
// ---------------------------------------------------------------------------

const msgpackEncoder = new Encoder({ ignoreUndefined: true });
const msgpackDecoder = new Decoder();

/** A codec under comparison: the benchmark's row. */
export interface NamedCodec {
    readonly name: string;
    encode(message: unknown): Uint8Array;
    decode(bytes: Uint8Array): unknown;
}

/** A binary JSON with no schema. NOTE: −0 encodes as the integer 0. */
export const msgpackCodec: NamedCodec = {
    name: 'msgpack',
    encode: message => msgpackEncoder.encode(message),
    decode: bytes => msgpackDecoder.decode(bytes),
};

// ---------------------------------------------------------------------------
// The value plan
// ---------------------------------------------------------------------------

interface Plan {
    /** True when both directions are identity. */
    identity: boolean;
    encode(value: unknown): unknown;
    decode(value: unknown): unknown;
}

const IDENTITY: Plan = { identity: true, encode: v => v, decode: v => v };

const OPAQUE: Plan = {
    identity: false,
    encode: value => toBuffer(dynamicEncode(value)),
    decode: value => dynamicDecode(value as Buffer),
};

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
            if (Buffer.isBuffer(value)) {
                return 'bytes';
            }
            return Array.isArray(value) ? 'array' : 'object';
    }
}

interface Buckets {
    js: Bucket;
    avro: Bucket;
}

function schemaBuckets(schema: AvroSchema, named: Map<string, Buckets>): Buckets {
    const both = (bucket: Bucket): Buckets => ({ js: bucket, avro: bucket });
    if (typeof schema === 'string') {
        switch (schema) {
            case 'null':
                return both('null');
            case 'boolean':
                return both('boolean');
            case 'int': case 'long': case 'float': case 'double':
                return both('number');
            case 'string':
                return both('string');
            case 'bytes':
                return both('bytes');
            default:
                return named.get(schema) ?? both('string');
        }
    }
    if (Array.isArray(schema)) {
        throw new Error('nested union');
    }
    switch (schema.logicalType) {
        case 'opaque':
            return { js: 'any', avro: 'bytes' };
        case 'present':
            return { js: 'present', avro: 'object' };
        case 'tuple':
            return { js: 'array', avro: 'object' };
        case 'componentUnion':
            return { js: 'array', avro: 'object' };
    }
    switch (schema.type) {
        case 'array':
            return both('array');
        case 'enum':
            return both('string');
        case 'bytes':
            return both('bytes');
        case 'map': case 'record':
            return both('object');
        default:
            return schemaBuckets(schema.type as AvroSchema, named);
    }
}

class PlanCompiler {
    private readonly named = new Map<string, Plan>();
    private readonly namedBuckets = new Map<string, Buckets>();

    compile(schema: AvroSchema): Plan {
        if (typeof schema === 'string') {
            return this.named.get(schema) ?? IDENTITY;
        }
        if (Array.isArray(schema)) {
            return this.union(schema);
        }
        switch (schema.logicalType) {
            case 'opaque':
                return OPAQUE;
            case 'kindUnion':
                return this.kindUnion(schema);
            case 'tuple':
                return this.register(schema, this.tuple(schema));
            case 'present':
                return this.register(schema, () => {
                    const inner = this.compile(schema.fields![0]!.type);
                    return {
                        identity: false,
                        encode: value => ({ value: inner.encode(value) }),
                        decode: value => inner.decode((value as { value: unknown }).value),
                    };
                });
            case 'componentUnion':
                return this.componentUnion(schema);
        }
        switch (schema.type) {
            case 'record':
                return this.register(schema, this.record(schema));
            case 'array': {
                const items = this.compile(schema.items!);
                return items.identity ? IDENTITY : {
                    identity: false,
                    encode: value => (value as unknown[]).map(items.encode),
                    decode: value => (value as unknown[]).map(items.decode),
                };
            }
            case 'map': {
                const values = this.compile(schema.values!);
                const mapValues = (transform: (value: unknown) => unknown) =>
                    (value: unknown) => {
                        const out: Record<string, unknown> = {};
                        for (const [key, inner] of Object.entries(value as object)) {
                            out[key] = transform(inner);
                        }
                        return out;
                    };
                return {
                    identity: false,
                    encode: values.identity ? v => v : mapValues(values.encode),
                    decode: values.identity ? v => v : mapValues(values.decode),
                };
            }
            case 'enum':
                return IDENTITY;
            default:
                return this.compile(schema.type as AvroSchema);
        }
    }

    private register(schema: AvroSchemaNode, build: () => Plan): Plan {
        const forward: Plan = {
            identity: false,
            encode: value => forward.encode(value),
            decode: value => forward.decode(value),
        };
        if (schema.name) {
            this.named.set(schema.name, forward);
            this.namedBuckets.set(schema.name, schemaBuckets(schema, this.namedBuckets));
        }
        const plan = build();
        forward.identity = plan.identity;
        forward.encode = plan.encode;
        forward.decode = plan.decode;
        return plan;
    }

    private record(schema: AvroSchemaNode): () => Plan {
        return () => {
            const optional = new Set(schema.optional ?? []);
            const renamed = schema.renamed ?? {};
            const fields = schema.fields!.map(field => ({
                avro: field.name,
                js: renamed[field.name] ?? field.name,
                optional: optional.has(field.name),
                plan: this.compile(field.type),
            }));
            const encodeIdentity = fields.every(field => field.plan.identity
                && field.avro === field.js);
            return {
                identity: false,
                encode: encodeIdentity ? value => value : value => {
                    const record: Record<string, unknown> = {};
                    const source = value as Record<string, unknown>;
                    for (const field of fields) {
                        const inner = source[field.js];
                        record[field.avro] = inner === undefined && field.optional
                            ? undefined : field.plan.encode(inner);
                    }
                    return record;
                },
                decode: value => {
                    const plain: Record<string, unknown> = {};
                    const source = value as Record<string, unknown>;
                    for (const field of fields) {
                        const inner = source[field.avro];
                        if (inner === null) {
                            if (!field.optional) {
                                plain[field.js] = null;
                            }
                            continue;
                        }
                        plain[field.js] = field.plan.identity ? inner : field.plan.decode(inner);
                    }
                    return plain;
                },
            };
        };
    }

    private tuple(schema: AvroSchemaNode): () => Plan {
        return () => {
            const items = schema.fields!.map(field => this.compile(field.type));
            const arity = items.length;
            return {
                identity: false,
                encode: value => {
                    const array = value as unknown[];
                    const record: Record<string, unknown> = {};
                    for (let i = 0; i < arity; i++) {
                        record[`_${i}`] = items[i]!.encode(array[i]);
                    }
                    return record;
                },
                decode: value => {
                    const record = value as Record<string, unknown>;
                    const array = new Array<unknown>(arity);
                    for (let i = 0; i < arity; i++) {
                        array[i] = items[i]!.decode(record[`_${i}`]);
                    }
                    return array;
                },
            };
        };
    }

    private union(schema: AvroSchema[]): Plan {
        const encodeByBucket = new Map<Bucket, Plan>();
        const decodeByBucket = new Map<Bucket, Plan>();
        let opaque: Plan | undefined;
        let present: Plan | undefined;
        const claimedJs = new Set<Bucket>();
        const claimedAvro = new Set<Bucket>();
        for (const branch of schema) {
            const plan = this.compile(branch);
            const buckets = schemaBuckets(branch, this.namedBuckets);
            if (claimedJs.has(buckets.js) || claimedAvro.has(buckets.avro)) {
                throw new Error(`ambiguous union: two branches would both be `
                    + `${claimedJs.has(buckets.js) ? buckets.js : `${buckets.avro} on the wire`}: `
                    + JSON.stringify(schema).slice(0, 200));
            }
            claimedJs.add(buckets.js);
            claimedAvro.add(buckets.avro);
            if (plan.identity) {
                continue;
            }
            if (buckets.js === 'any') {
                opaque = plan;
            } else if (buckets.js === 'present') {
                present = plan;
            } else {
                encodeByBucket.set(buckets.js, plan);
            }
            decodeByBucket.set(buckets.avro, plan);
        }
        if (present) {
            return {
                identity: false,
                encode: value => value === undefined ? null : present!.encode(value),
                decode: value => value === null ? null : present!.decode(value),
            };
        }
        if (encodeByBucket.size === 0 && !opaque) {
            return schema.includes('null') ? {
                identity: false,
                encode: value => value === undefined ? null : value,
                decode: value => value,
            } : IDENTITY;
        }
        return {
            identity: false,
            encode: value => {
                if (value === undefined) {
                    return null;
                }
                const bucket = valueBucket(value);
                const plan = encodeByBucket.get(bucket)
                    ?? (bucket === 'null' ? undefined : opaque);
                return plan ? plan.encode(value) : value;
            },
            decode: value => {
                const plan = decodeByBucket.get(valueBucket(value));
                return plan ? plan.decode(value) : value;
            },
        };
    }

    private kindUnion(schema: AvroSchemaNode): Plan {
        const discriminator = schema.discriminator!;
        const branches = new Map<string, { name: string, plan: Plan }>();
        for (const branch of schema.type as AvroSchema[]) {
            if (branch === 'null') {
                continue;
            }
            const plan = this.compile(branch);
            const name = typeof branch === 'string' ? branch : (branch as AvroSchemaNode).name!;
            const literal = Object.entries(schema.branches!)
                .find(([, branchName]) => branchName === name)?.[0];
            if (literal === undefined) {
                throw new Error(`kindUnion branch ${name} has no literal`);
            }
            branches.set(literal, { name, plan });
        }
        return {
            identity: false,
            encode: value => {
                if (value === null || value === undefined) {
                    return null;
                }
                const key = String((value as Record<string, unknown>)[discriminator]);
                const branch = branches.get(key);
                if (!branch) {
                    throw new Error(`no union branch for ${discriminator}=${key}`);
                }
                return { [branch.name]: branch.plan.encode(value) };
            },
            decode: value => {
                if (value === null) {
                    return null;
                }
                const key = Object.keys(value as object)[0]!;
                const inner = (value as Record<string, unknown>)[key];
                const literal = String((inner as Record<string, unknown>)[discriminator]);
                return branches.get(literal)!.plan.decode(inner);
            },
        };
    }

    private componentUnion(schema: AvroSchemaNode): Plan {
        const components = schema.components ?? {};
        const extra = schema.extra!;
        const byComponent = new Map<string, { branch: string, plan: Plan }>();
        const byBranch = new Map<string, { component: string, plan: Plan }>();
        for (const branch of schema.type as AvroSchema[]) {
            const name = typeof branch === 'string' ? branch : (branch as AvroSchemaNode).name!;
            const plan = this.compile(branch);
            if (name === extra) {
                continue;
            }
            const component = components[name]!;
            byComponent.set(component, { branch: name, plan });
            byBranch.set(name, { component, plan });
        }
        return {
            identity: false,
            encode: value => {
                const [name, data] = value as [string, unknown];
                const entry = byComponent.get(name);
                if (entry === undefined) {
                    return { [extra]: { name, data: OPAQUE.encode(data) } };
                }
                return { [entry.branch]: entry.plan.encode({ data }) };
            },
            decode: value => {
                const branch = Object.keys(value as object)[0]!;
                const record = (value as Record<string, Record<string, unknown>>)[branch]!;
                if (branch === extra) {
                    return [record['name'], OPAQUE.decode(record['data'])];
                }
                const entry = byBranch.get(branch)!;
                return [entry.component, (entry.plan.decode(record) as { data: unknown }).data];
            },
        };
    }
}

/**
 * The derived schema as avsc reads it: a `kindUnion` node is the bare
 * union, and the annotations elsewhere are attributes avsc ignores.
 */
export function avscSchema(schema: AvroSchema): avro.Schema {
    if (typeof schema === 'string') {
        return schema;
    }
    if (Array.isArray(schema)) {
        return schema.map(avscSchema) as avro.Schema;
    }
    if (schema.logicalType === 'kindUnion' || schema.logicalType === 'componentUnion') {
        return avscSchema(schema.type as AvroSchema[]);
    }
    const { logicalType: _logicalType, ...rest } = schema;
    const node: Record<string, unknown> = { ...rest };
    if (schema.fields) {
        node['fields'] = schema.fields.map(field => ({
            ...field, type: avscSchema(field.type),
        }));
    }
    if (schema.items) {
        node['items'] = avscSchema(schema.items);
    }
    if (schema.values) {
        node['values'] = avscSchema(schema.values);
    }
    if (typeof schema.type !== 'string') {
        node['type'] = avscSchema(schema.type);
    }
    return node as avro.Schema;
}

export interface AvscReferenceCodec extends WireCodec {
    readonly type: avro.Type;
    /** avsc's canonical schema JSON (`Type#schema()`), for comparison
     * with avro_fingerprint.ts's canonical form. */
    canonicalJson(): string;
}

export function avscReferenceCodec(schema: AvroSchema): AvscReferenceCodec {
    const type = avro.Type.forSchema(avscSchema(schema), { wrapUnions: 'auto' });
    const plan = new PlanCompiler().compile(schema);
    return {
        encoding: 'avro',
        type,
        canonicalJson: () => JSON.stringify(type.schema()),
        encode: message => type.toBuffer(plan.encode(message)),
        decode: bytes => plan.decode(type.fromBuffer(toBuffer(bytes))),
    };
}
