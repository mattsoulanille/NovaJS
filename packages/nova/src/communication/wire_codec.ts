import { Decoder, Encoder } from '@msgpack/msgpack';
import avro from 'avsc';
import { Either, isLeft } from 'fp-ts/lib/Either.js';
import * as t from 'io-ts';
import { AvroSchema, AvroSchemaNode } from './io_ts_to_avro.js';

/**
 * ============================================================================
 * Wire codecs
 * ============================================================================
 *
 * How a message becomes bytes. Three interchangeable implementations:
 *
 *   json     what the WebSocket carries today (socket_channel_*.ts):
 *            `JSON.stringify`, UTF-8. Self-describing, no schema.
 *   msgpack  a binary JSON: same data model, fewer bytes, no schema.
 *            Undefined properties are dropped (JSON.stringify drops them
 *            too). NOTE: −0 encodes as the integer 0.
 *   avro     schema'd: field names never travel, numbers are fixed-width
 *            doubles/longs, enums are one byte. The schema is DERIVED
 *            from the io-ts codec at startup (io_ts_to_avro.ts) — no
 *            second schema language — and both ends of a socket derive
 *            it from the same build.
 *
 * None of them replaces validation. The io-ts `decode` that gates every
 * receiving boundary today (rollback_protocol.ts "Trust model" item 2)
 * runs AFTER the wire decode on every implementation: `decodeWire`.
 *
 * PROTOTYPE STATUS: only `json` is connected to a socket. Switching the
 * constant below is the switch for code that opts in via
 * `makeWireCodec`; nothing on the live paths reads it yet, and
 * PROTOCOL_VERSION is untouched. See wire_benchmark.ts for the
 * measurements behind the choice.
 */

export type WireEncoding = 'json' | 'msgpack' | 'avro';

/** The wire encoding a caller of `makeWireCodec` gets. */
export const WIRE_ENCODING: WireEncoding = 'json';

export interface WireCodec {
    readonly encoding: WireEncoding;
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
// msgpack
// ---------------------------------------------------------------------------

// One encoder/decoder pair: they keep a reusable working buffer
// (`encode` returns a copy of it, and clones itself if re-entered).
const msgpackEncoder = new Encoder({ ignoreUndefined: true });
const msgpackDecoder = new Decoder();

export const msgpackWireCodec: WireCodec = {
    encoding: 'msgpack',
    encode: message => msgpackEncoder.encode(message),
    decode: bytes => msgpackDecoder.decode(bytes),
};

// ---------------------------------------------------------------------------
// avro
// ---------------------------------------------------------------------------

function toBuffer(bytes: Uint8Array): Buffer {
    return Buffer.isBuffer(bytes) ? bytes
        : Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

/**
 * The shape transforms the derived schema's annotations call for
 * (io_ts_to_avro.ts documents each), as ONE pass before avsc encodes and
 * one after it decodes. They are deliberately not avsc logical types:
 * avsc validates every logical branch of an unwrapped union by running
 * its conversion, so a nullable record field would pay a deep validation
 * per encode and an opaque `bytes` branch would claim `null` too.
 *
 * A plan is identity wherever the value can go to avsc as it is (avsc
 * fills absent optional fields from their null default), so the encode
 * pass allocates only around tuples, discriminated unions, opaque
 * values and the component list. The decode pass rebuilds every record
 * as a plain object: avsc hands back instances of generated classes,
 * and optional fields that decoded as null must be absent for
 * `t.partial` to accept them.
 */
interface Plan {
    /** True when both directions are identity. */
    identity: boolean;
    encode(value: unknown): unknown;
    decode(value: unknown): unknown;
}

const IDENTITY: Plan = { identity: true, encode: v => v, decode: v => v };

const OPAQUE: Plan = {
    identity: false,
    encode: value => toBuffer(msgpackEncoder.encode(value)),
    decode: value => msgpackDecoder.decode(value as Buffer),
};

/**
 * How an unwrapped union's value picks its branch. A branch has a
 * JavaScript-side bucket (what the plan's encode sees: a tuple is an
 * array) and an Avro-side one (what avsc hands decode: that tuple is a
 * record object). `any` is the opaque branch, which takes whatever no
 * other branch claims.
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
                // A named type reference; enums are not registered.
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
            // Takes every value but undefined, null included.
            return { js: 'present', avro: 'object' };
        case 'tuple':
            return { js: 'array', avro: 'object' };
        case 'componentUnion':
            // A pair in, a wrapped branch out.
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
    /** Named plans, registered before their children compile (recursion). */
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
                    // avsc decodes maps to plain objects already.
                    decode: values.identity ? v => v : mapValues(values.decode),
                };
            }
            case 'enum':
                return IDENTITY;
            default:
                return this.compile(schema.type as AvroSchema);
        }
    }

    /**
     * Named nodes are compiled through a forward reference so a field
     * that names its own record (recursion) resolves; the reference is
     * filled once the body exists.
     */
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
                        // An absent optional takes the field's null
                        // default. Anything else, null included, is a
                        // value the plan must see (opaque encodes null;
                        // a required nullable field turns undefined into
                        // null).
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
        // The deriver only emits an unwrapped union whose branches a value
        // picks unambiguously on both sides (io_ts_to_avro.ts `buckets`);
        // a union that breaks that promise would encode one branch's
        // values as another's — silently, since the io-ts gate sees
        // well-formed data — so it is refused here, at schema compile
        // time, identity branches included.
        const claimedJs = new Set<Bucket>();
        const claimedAvro = new Set<Bucket>();
        for (const branch of schema) {
            // Compile first: a named branch registers its buckets there.
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
            // `['null', present]`: only undefined is the absent branch.
            return {
                identity: false,
                encode: value => value === undefined ? null : present!.encode(value),
                decode: value => value === null ? null : present!.decode(value),
            };
        }
        if (encodeByBucket.size === 0 && !opaque) {
            // undefined must still become null on the way in.
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
                // avsc hands a wrapped branch back as an object whose one
                // own property is the branch (its prototype carries
                // methods, so own keys only).
                const key = Object.keys(value as object)[0]!;
                const inner = (value as Record<string, unknown>)[key];
                const literal = String((inner as Record<string, unknown>)[discriminator]);
                return branches.get(literal)!.plan.decode(inner);
            },
        };
    }

    /**
     * One `[name, data]` pair of the component list as the wrapped
     * branch `{[Component_name]: {data}}`; the branch's record plan
     * types the data.
     */
    private componentUnion(schema: AvroSchemaNode): Plan {
        const components = schema.components ?? {};
        const extra = schema.extra!;
        const byComponent = new Map<string, { branch: string, plan: Plan }>();
        const byBranch = new Map<string, { component: string, plan: Plan }>();
        for (const branch of schema.type as AvroSchema[]) {
            // The branch is the `{data}` record, defined at the list's
            // first use and referenced by name after; its record plan
            // types the data either way.
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
 * union (its branch table is for the plan), and the annotations elsewhere
 * are attributes avsc ignores.
 */
function avscSchema(schema: AvroSchema): avro.Schema {
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

export interface AvroWireCodec extends WireCodec {
    readonly type: avro.Type;
    /** MD5 of the canonical schema: a compact identity for the wire format. */
    readonly fingerprint: string;
    /**
     * Why `message` will not cross this wire as it is — the schema
     * rejects it, or a round trip hands back something else (a −0 in an
     * opaque node, say) — or undefined when it round-trips faithfully.
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
function firstDifference(expected: unknown, actual: unknown, path: string): string | undefined {
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
    const type = avro.Type.forSchema(avscSchema(schema), { wrapUnions: 'auto' });
    const plan = new PlanCompiler().compile(schema);
    return {
        encoding: 'avro',
        type,
        fingerprint: type.fingerprint('md5').toString('hex'),
        encode: message => type.toBuffer(plan.encode(message)),
        decode: bytes => plan.decode(type.fromBuffer(toBuffer(bytes))),
        explain(message) {
            const problems: string[] = [];
            const encoded = plan.encode(message);
            type.isValid(encoded, {
                errorHook(path, value, expected) {
                    problems.push(`${path.join('.')}: ${JSON.stringify(value)?.slice(0, 80)} `
                        + `is not ${expected.toString().slice(0, 120)}`);
                },
            });
            if (problems.length > 0) {
                return problems.join('; ');
            }
            // The schema admits the plan-encoded value; that says nothing
            // about what the plan did to get there (a branch chosen for
            // the wrong value, an opaque node's own encoding), so judge
            // the ORIGINAL message by what a receiver would get back.
            let back: unknown;
            try {
                back = plan.decode(type.fromBuffer(type.toBuffer(encoded)));
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
 * callers pass a thunk and pay nothing for the others.
 */
export function makeWireCodec(encoding: WireEncoding, schema: () => AvroSchema): WireCodec {
    switch (encoding) {
        case 'json':
            return jsonWireCodec;
        case 'msgpack':
            return msgpackWireCodec;
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
