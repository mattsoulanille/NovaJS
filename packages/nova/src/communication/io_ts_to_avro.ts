import * as t from 'io-ts';
import { PositionType } from 'nova_ecs/datatypes/position';
import { AngleType, VectorType } from 'nova_ecs/datatypes/vector';
import { EncodedComponentList, markerType, Serializer } from 'nova_ecs/plugins/serializer_plugin';

/**
 * ============================================================================
 * io-ts → Avro schema reflection
 * ============================================================================
 *
 * Walks an io-ts codec at runtime and produces an Avro schema for the
 * codec's ENCODED form (what `codec.encode` emits and `codec.decode`
 * accepts — the JSON shape already on the wire today). There is no
 * second schema language: the io-ts codecs stay the one description of
 * every wire shape, and the Avro schema is a derived artifact rebuilt at
 * startup. io-ts `decode` remains the validation gate after any wire
 * decode; Avro only supplies the byte layout.
 *
 * Avro is a poor fit for a few JavaScript shapes, and the derivation
 * bridges them with ANNOTATIONS on the schema: a value transform
 * between the shape io-ts encodes and the shape Avro serializes, which
 * wire_codec.ts compiles into one pass before encoding and one after
 * decoding (avsc itself ignores the annotations). Records carry
 * `optional` — the fields absent from the value when they decode as
 * null, since Avro has no "absent field" and `t.partial` fields ride as
 * a nullable union with a null default — and `renamed`, mapping Avro
 * field names back to prop names Avro's identifier rules would not
 * allow. Every record decodes to a plain object (avsc otherwise hands
 * back instances of generated record classes). The nodes that need a
 * transform of their own are labelled with a `logicalType`:
 *
 *   `tuple`         `t.tuple`: a record with fields _0.._n, read and
 *                   written as an array. Avro has no heterogeneous
 *                   sequence type.
 *   `present`       the value of an optional field whose own type admits
 *                   null, wrapped `{value}` so that a present null and
 *                   an absent field stay distinct (Avro forbids a union
 *                   with two null branches).
 *   `kindUnion`     a union of records discriminated by a literal prop
 *                   (`{kind: 'inputs', ...} | {kind: 'tickSync', ...}`).
 *                   Avro unions of records are told apart by BRANCH,
 *                   not by a field value, so the logical type wraps
 *                   `{[branchName]: value}` on write from `value[discriminator]`
 *                   and unwraps on read. `branches` maps the literal
 *                   value (stringified) to the branch record's name.
 *   `opaque`        a node the schema cannot type: `t.unknown` (and
 *                   `t.any`, `t.UnknownRecord`, ...) or a custom codec
 *                   nothing maps. Carried as `bytes` holding a
 *                   self-describing (msgpack) encoding of the value.
 *                   Every one is reported in `failures`, so the list of
 *                   opaque nodes IS the list of what a schema'd wire
 *                   format does not yet cover.
 *   `componentUnion` the items of the ECS component list (`[name,
 *                   encoded][]`, nova_ecs EncodedComponentList) when a
 *                   Serializer is supplied: a union with one record
 *                   `{data}` per registered component, typed by that
 *                   component's own codec, so the union's branch index
 *                   names the component. `components` maps branch record
 *                   name → component name; `extra` names the `{name,
 *                   data}` branch for components the serializer lacks.
 *
 * What the walk does NOT map, and why, is reported rather than thrown
 * (`Derivation.failures`); the schema still builds, with the
 * unmappable node carried opaquely, so the wire format degrades to a
 * self-describing blob exactly where the codecs are untyped.
 */

// ---------------------------------------------------------------------------
// Avro schema shapes (the subset the walk emits)
// ---------------------------------------------------------------------------

export type AvroSchema = string | AvroSchemaNode | AvroSchema[];

export interface AvroField {
    name: string;
    type: AvroSchema;
    default?: unknown;
}

export interface AvroSchemaNode {
    type: string | AvroSchema[];
    name?: string;
    fields?: AvroField[];
    items?: AvroSchema;
    values?: AvroSchema;
    symbols?: string[];
    logicalType?: string;
    /** `record`: fields absent from the value when they decode as null. */
    optional?: string[];
    /** `record`: Avro field name → original prop name, where they differ. */
    renamed?: Record<string, string>;
    /** `kindUnion`: the discriminating prop. */
    discriminator?: string;
    /** `kindUnion`: String(literal value) → branch record name. */
    branches?: Record<string, string>;
    /** `componentUnion`: branch record name → component name. */
    components?: Record<string, string>;
    /** `componentUnion`: the branch for components the serializer lacks. */
    extra?: string;
}

// ---------------------------------------------------------------------------
// Derivation results
// ---------------------------------------------------------------------------

export type DerivationFailureKind =
    /** A construct Avro cannot express faithfully; carried opaquely. */
    | 'unmapped'
    /** `t.unknown` and kin: untyped BY THE CODEC; carried opaquely. */
    | 'untyped'
    /** Mapped, but a distinction the encoded form makes is collapsed
     * (e.g. a literal union whose values are not Avro enum symbols is
     * carried as a plain string). */
    | 'lossy';

export interface DerivationFailure {
    kind: DerivationFailureKind;
    /** Dotted path from the root codec; `[]` marks array items. */
    path: string;
    /** The io-ts codec's own name at that node. */
    codec: string;
    reason: string;
}

export interface Derivation {
    schema: AvroSchema;
    failures: DerivationFailure[];
}

/**
 * A schema for a codec the walk cannot see into, keyed by codec
 * IDENTITY (custom `new t.Type` codecs expose nothing but a name). A
 * function hook receives the deriver so it can type its children.
 */
export type CodecHook = AvroSchema | ((derive: DeriveChild, path: string) => AvroSchema);
export type DeriveChild = (codec: t.Any, path: string, nameHint: string) => AvroSchema;
export type CodecHooks = Map<t.Any, CodecHook>;

export interface DerivationOptions {
    /** Name of the root record (when the root is one). Default 'Root'. */
    name?: string;
    hooks?: CodecHooks;
    /**
     * Types the ECS component list by the serializer's registered
     * component codecs (see `componentList` above). Without it the
     * list's data stays `t.unknown`, i.e. opaque.
     */
    serializer?: Serializer;
}

const AVRO_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** What `t.literal` accepts. */
type LiteralValue = string | number | boolean;

function sanitizeName(raw: string): string {
    const cleaned = raw.replace(/[^A-Za-z0-9_]/g, '_');
    return /^[0-9]/.test(cleaned) || cleaned === '' ? `_${cleaned}` : cleaned;
}

/** Nodes that occupy a name in the schema's namespace. */
function isNamed(schema: AvroSchema): schema is AvroSchemaNode & { name: string } {
    return typeof schema === 'object' && !Array.isArray(schema)
        && typeof schema.name === 'string';
}

/**
 * The name a union branch goes by in Avro: primitives and array/map by
 * their type name, named types by name. A union may not hold two
 * branches with the same one.
 */
function branchName(schema: AvroSchema): string {
    if (typeof schema === 'string') {
        return schema;
    }
    if (Array.isArray(schema)) {
        return 'union';
    }
    if (isNamed(schema)) {
        return schema.name;
    }
    return String(schema.type);
}

/**
 * The known custom codecs (bare `new t.Type` instances, invisible to
 * the walk) and their encoded shapes. Extended by `hooks`.
 */
function builtinHooks(): CodecHooks {
    const vectorLike = (name: string): AvroSchema => ({
        type: 'record', name, fields: [
            { name: 'x', type: 'double' },
            { name: 'y', type: 'double' },
        ],
    });
    return new Map<t.Any, CodecHook>([
        [PositionType, vectorLike('Position')],
        [VectorType, vectorLike('Vector')],
        [AngleType, {
            type: 'record', name: 'Angle',
            fields: [{ name: 'angle', type: 'double' }],
        }],
        // Encodes as null, decodes null (or undefined) to undefined.
        [markerType, 'null'],
    ]);
}

interface Props { [key: string]: t.Any }

class Deriver {
    readonly failures: DerivationFailure[] = [];
    private readonly usedNames = new Set<string>();
    /** Named schemas already emitted, by codec identity. */
    private readonly named = new Map<t.Any, string>();
    /** Named schemas emitted for a hook, by hook identity. */
    private readonly namedHooks = new Map<CodecHook, string>();
    private readonly hooks: CodecHooks;

    constructor(private readonly options: DerivationOptions) {
        this.hooks = new Map([...builtinHooks(), ...(options.hooks ?? [])]);
    }

    private fail(kind: DerivationFailureKind, path: string, codec: t.Any,
        reason: string) {
        this.failures.push({ kind, path, codec: codec.name, reason });
    }

    private opaque(kind: 'unmapped' | 'untyped', path: string, codec: t.Any,
        reason: string): AvroSchema {
        this.fail(kind, path, codec, reason);
        return { type: 'bytes', logicalType: 'opaque' };
    }

    private uniqueName(hint: string): string {
        const base = sanitizeName(hint);
        let name = base;
        for (let i = 2; this.usedNames.has(name); i++) {
            name = `${base}_${i}`;
        }
        this.usedNames.add(name);
        return name;
    }

    /** A codec's own name when it is a usable Avro name, else the hint. */
    private nameFor(codec: t.Any, hint: string): string {
        return AVRO_NAME.test(codec.name) ? codec.name : hint;
    }

    /**
     * Emits `schema` under a fresh name and remembers it for `codec`, so
     * later uses of the same codec reference the name (Avro named-type
     * reuse) instead of redefining it.
     */
    private define(codec: t.Any, schema: AvroSchemaNode, hint: string): AvroSchema {
        schema.name = this.uniqueName(hint);
        this.named.set(codec, schema.name);
        this.namedKinds.set(schema.name, schema.type as string);
        return schema;
    }

    /** What kind of Avro type each emitted name stands for. */
    private readonly namedKinds = new Map<string, string>();

    /**
     * How a JavaScript value would pick this branch of an UNWRAPPED
     * union: records, tuples (records) and maps are all objects, so two
     * of them in one union cannot be told apart without a
     * discriminator, whatever their Avro names.
     */
    private jsBucket(schema: AvroSchema): string {
        if (typeof schema === 'string') {
            switch (schema) {
                case 'int': case 'long': case 'float': case 'double':
                    return 'number';
                case 'null': case 'boolean': case 'string': case 'bytes':
                    return schema;
                default: {
                    const kind = this.namedKinds.get(schema);
                    return kind === 'enum' ? 'string' : 'object';
                }
            }
        }
        if (Array.isArray(schema)) {
            return 'union';
        }
        switch (schema.type) {
            case 'enum':
                return 'string';
            case 'record': case 'map':
                return 'object';
            case 'bytes':
                return schema.logicalType === 'opaque' ? 'any' : 'bytes';
            default:
                return typeof schema.type === 'string' ? schema.type : 'union';
        }
    }

    /** Anonymous (array) schemas emitted for a codec, for reuse by reference. */
    private readonly listSchemas = new Map<t.Any, AvroSchemaNode>();

    readonly derive: DeriveChild = (codec, path, nameHint) => {
        const list = this.listSchemas.get(codec);
        if (list) {
            // The named records inside were defined at the first use;
            // Avro lets a later use reference them by name.
            return this.byReference(list);
        }
        const known = this.named.get(codec);
        if (known) {
            return known;
        }
        const hook = this.hooks.get(codec);
        if (hook !== undefined) {
            return this.applyHook(hook, path, codec);
        }
        if (codec === EncodedComponentList && this.options.serializer) {
            return this.componentList(this.options.serializer, path, codec);
        }
        return this.deriveByTag(codec, path, nameHint);
    };

    /** `schema` with every named definition replaced by its name. */
    private byReference(schema: AvroSchema): AvroSchema {
        if (typeof schema === 'string') {
            return schema;
        }
        if (Array.isArray(schema)) {
            return schema.map(branch => this.byReference(branch));
        }
        if (isNamed(schema)) {
            return schema.name;
        }
        const copy: AvroSchemaNode = { ...schema };
        if (schema.items) {
            copy.items = this.byReference(schema.items);
        }
        if (schema.values) {
            copy.values = this.byReference(schema.values);
        }
        if (Array.isArray(schema.type)) {
            copy.type = schema.type.map(branch => this.byReference(branch));
        }
        return copy;
    }

    private applyHook(hook: CodecHook, path: string, codec: t.Any): AvroSchema {
        const known = this.namedHooks.get(hook);
        if (known) {
            return known;
        }
        const schema = typeof hook === 'function' ? hook(this.derive, path) : hook;
        if (isNamed(schema)) {
            // A hook's literal schema may be shared between derivations
            // (module constants), so name a copy rather than the original.
            const copy: AvroSchemaNode = { ...schema };
            copy.name = this.uniqueName(schema.name);
            this.namedHooks.set(hook, copy.name);
            this.named.set(codec, copy.name);
            return copy;
        }
        return schema;
    }

    private deriveByTag(codec: t.Any, path: string, nameHint: string): AvroSchema {
        const tag = (codec as { _tag?: string })._tag;
        switch (tag) {
            case 'InterfaceType':
                return this.record((codec as t.InterfaceType<Props>).props, {}, codec,
                    path, nameHint);
            case 'PartialType':
                return this.record({}, (codec as t.PartialType<Props>).props, codec,
                    path, nameHint);
            case 'ExactType':
                return this.derive((codec as t.ExactType<t.Any>).type, path, nameHint);
            case 'ReadonlyType':
                return this.derive((codec as t.ReadonlyType<t.Any>).type, path, nameHint);
            case 'RefinementType': {
                const refinement = codec as t.RefinementType<t.Any>;
                // Refinements narrow a type's VALUES, which io-ts checks
                // on decode; the wire shape is the underlying type's.
                // `t.Int` narrows to a safe integer: a long on the wire.
                if (refinement.name === 'Int') {
                    return 'long';
                }
                return this.derive(refinement.type, path, nameHint);
            }
            case 'IntersectionType':
                return this.intersection(codec as t.IntersectionType<t.Any[]>, path,
                    nameHint);
            case 'UnionType':
                return this.union(codec as t.UnionType<t.Any[]>, path, nameHint);
            case 'ArrayType':
            case 'ReadonlyArrayType':
            case 'NovaSetType':
                return {
                    type: 'array',
                    items: this.derive((codec as t.ArrayType<t.Any>).type, `${path}[]`,
                        `${nameHint}_item`),
                };
            case 'NovaMapType': {
                const map = codec as unknown as { domain: t.Any, codomain: t.Any };
                return {
                    type: 'array',
                    items: this.tuple([map.domain, map.codomain], `${path}[]`,
                        `${nameHint}_entry`),
                };
            }
            case 'DictionaryType': {
                const dictionary = codec as t.DictionaryType<t.Any, t.Any>;
                const keyTag = (dictionary.domain as { _tag?: string })._tag;
                if (keyTag !== 'StringType' && keyTag !== 'KeyofType'
                    && keyTag !== 'LiteralType') {
                    return this.opaque('unmapped', path, codec,
                        `Avro map keys are strings; domain is ${dictionary.domain.name}`);
                }
                return {
                    type: 'map',
                    values: this.derive(dictionary.codomain, `${path}{}`,
                        `${nameHint}_value`),
                };
            }
            case 'TupleType':
                return this.tuple((codec as t.TupleType<t.Any[]>).types, path, nameHint);
            case 'LiteralType':
                return this.literal((codec as t.LiteralType<LiteralValue>).value);
            case 'KeyofType': {
                const keys = Object.keys((codec as t.KeyofType<Props>).keys);
                return this.enumeration(keys, path, codec, nameHint, codec);
            }
            case 'UndefinedType':
            case 'NullType':
            case 'VoidType':
                return 'null';
            case 'NumberType':
                return 'double';
            case 'StringType':
                return 'string';
            case 'BooleanType':
                return 'boolean';
            case 'UnknownType':
            case 'AnyType':
            case 'AnyDictionaryType':
            case 'AnyArrayType':
            case 'ObjectType':
                return this.opaque('untyped', path, codec,
                    'the codec admits any value; nothing to derive a schema from');
            case 'BigIntType':
                return this.opaque('unmapped', path, codec,
                    'bigint has no JSON encoding today, and Avro long is 64-bit at most');
            case 'FunctionType':
                return this.opaque('unmapped', path, codec, 'functions cannot cross a wire');
            case 'RecursiveType':
                return this.recursive(codec as t.RecursiveType<t.Any>, path, nameHint);
            default:
                return this.opaque('unmapped', path, codec,
                    `custom codec (${tag ?? 'no _tag'}); its encoded shape is not reflectable`
                    + ' — add a CodecHook for it');
        }
    }

    private literal(value: LiteralValue): AvroSchema {
        if (typeof value === 'number') {
            return Number.isInteger(value) ? 'int' : 'double';
        }
        return typeof value === 'boolean' ? 'boolean' : 'string';
    }

    /**
     * `cacheKey` is the codec later uses may reference the enum by; a
     * union that is only PARTLY an enum has none (its identity stands
     * for the whole union, not the enum branch).
     */
    private enumeration(symbols: string[], path: string, codec: t.Any,
        nameHint: string, cacheKey: t.Any | undefined): AvroSchema {
        const invalid = symbols.filter(symbol => !AVRO_NAME.test(symbol));
        if (invalid.length > 0) {
            this.fail('lossy', path, codec, `enum symbols must be Avro names; `
                + `${JSON.stringify(invalid.slice(0, 3))} are not — carried as string`);
            return 'string';
        }
        const node: AvroSchemaNode = { type: 'enum', symbols };
        if (cacheKey) {
            return this.define(cacheKey, node, this.nameFor(codec, nameHint));
        }
        node.name = this.uniqueName(this.nameFor(codec, nameHint));
        return node;
    }

    private tuple(types: t.Any[], path: string, nameHint: string): AvroSchema {
        return {
            type: 'record',
            name: this.uniqueName(`${nameHint}_Tuple`),
            logicalType: 'tuple',
            fields: types.map((type, i) => ({
                name: `_${i}`,
                type: this.derive(type, `${path}[${i}]`, `${nameHint}_${i}`),
            })),
        };
    }

    /**
     * Collects the required and optional props of an intersection of
     * object codecs, the way io-ts's `t.exact(t.intersection([t.type,
     * t.partial]))` idiom spells a record with optional fields.
     */
    private collectProps(codec: t.Any, required: Props, optional: Props): boolean {
        const tag = (codec as { _tag?: string })._tag;
        switch (tag) {
            case 'InterfaceType':
                Object.assign(required, (codec as t.InterfaceType<Props>).props);
                return true;
            case 'PartialType':
                Object.assign(optional, (codec as t.PartialType<Props>).props);
                return true;
            case 'ExactType':
            case 'ReadonlyType':
                return this.collectProps((codec as t.ExactType<t.Any>).type, required, optional);
            case 'IntersectionType':
                return (codec as t.IntersectionType<t.Any[]>).types
                    .every(member => this.collectProps(member, required, optional));
            default:
                return false;
        }
    }

    private intersection(codec: t.IntersectionType<t.Any[]>, path: string,
        nameHint: string): AvroSchema {
        const required: Props = {};
        const optional: Props = {};
        if (!this.collectProps(codec, required, optional)) {
            return this.opaque('unmapped', path, codec,
                'intersection of non-object codecs has no Avro analogue');
        }
        return this.record(required, optional, codec, path, nameHint);
    }

    private record(required: Props, optional: Props, codec: t.Any, path: string,
        nameHint: string): AvroSchema {
        const node: AvroSchemaNode = {
            type: 'record', fields: [],
        };
        // Reserve the name first so a self-reference resolves.
        this.define(codec, node, this.nameFor(codec, nameHint));
        const optionalNames: string[] = [];
        const renamed: Record<string, string> = {};
        const emit = (prop: string, type: t.Any, isOptional: boolean) => {
            const fieldPath = `${path}.${prop}`;
            let fieldName = prop;
            if (!AVRO_NAME.test(prop)) {
                fieldName = sanitizeName(prop);
                renamed[fieldName] = prop;
            }
            let schema = this.derive(type, fieldPath, `${node.name}_${prop}`);
            const field: AvroField = { name: fieldName, type: schema };
            if (!isOptional && this.undefinedNotNull(type)) {
                // `x: string | undefined`: on the wire the key is absent
                // (JSON drops undefined), and the codec rejects null, so
                // it decodes like an optional field. The union already
                // has its null branch.
                optionalNames.push(fieldName);
                field.default = null;
            } else if (isOptional) {
                optionalNames.push(fieldName);
                field.type = ['null', this.presentWrapper(schema, `${node.name}_${prop}`)];
                field.default = null;
            }
            node.fields!.push(field);
        };
        for (const [prop, type] of Object.entries(required)) {
            if (!(prop in optional)) {
                emit(prop, type, false);
            }
        }
        for (const [prop, type] of Object.entries(optional)) {
            // A prop both required and optional (an intersection naming
            // it twice) is required.
            if (!(prop in required)) {
                emit(prop, type, true);
            }
        }
        if (optionalNames.length > 0) {
            node.optional = optionalNames;
        }
        if (Object.keys(renamed).length > 0) {
            node.renamed = renamed;
        }
        return node;
    }

    /**
     * The `present` branch of an optional field: `schema` itself when it
     * cannot be null (absent is then the union's null, unambiguously),
     * otherwise a one-field wrapper record, so that a present null
     * (`{value: null}`) and an absent field (null) stay distinct. The
     * distinction matters: hashWorld stringifies encoded state, and a
     * peer that restored `{turnTo: null}` from a wire that was sent
     * absent would hash differently from the sender.
     */
    private presentWrapper(schema: AvroSchema, nameHint: string): AvroSchema {
        const admitsNull = schema === 'null'
            || (Array.isArray(schema) && schema.includes('null'));
        if (!admitsNull) {
            return schema;
        }
        return {
            type: 'record', name: this.uniqueName(`${nameHint}_present`),
            logicalType: 'present', fields: [{ name: 'value', type: schema }],
        };
    }

    /** A union admitting undefined but not null (see `record`). */
    private undefinedNotNull(codec: t.Any): boolean {
        if ((codec as { _tag?: string })._tag !== 'UnionType') {
            return false;
        }
        const tags = (codec as t.UnionType<t.Any[]>).types
            .map(member => (member as { _tag?: string })._tag);
        return (tags.includes('UndefinedType') || tags.includes('VoidType'))
            && !tags.includes('NullType');
    }

    private recursive(codec: t.RecursiveType<t.Any>, path: string,
        nameHint: string): AvroSchema {
        // Avro names records, enums and fixeds only: a recursive codec
        // must bottom out in a record, and the name is reserved before
        // the body is derived so the inner self-reference resolves.
        const name = this.uniqueName(this.nameFor(codec, nameHint));
        this.named.set(codec, name);
        const inner = this.derive(codec.type, path, name);
        if (isNamed(inner) && inner.type === 'record') {
            this.usedNames.delete(inner.name);
            inner.name = name;
            return inner;
        }
        this.named.delete(codec);
        return this.opaque('unmapped', path, codec,
            'recursive codec whose body is not a record; Avro can only name records');
    }

    // -----------------------------------------------------------------------
    // Unions
    // -----------------------------------------------------------------------

    private unwrapObject(codec: t.Any): t.Any | undefined {
        const tag = (codec as { _tag?: string })._tag;
        switch (tag) {
            case 'InterfaceType':
            case 'PartialType':
            case 'IntersectionType':
                return codec;
            case 'ExactType':
            case 'ReadonlyType':
                return this.unwrapObject((codec as t.ExactType<t.Any>).type);
            default:
                return undefined;
        }
    }

    /** The prop that is a distinct literal in every member, if any. */
    private discriminator(members: t.Any[]): string | undefined {
        const propsOf = (member: t.Any): Props | undefined => {
            const required: Props = {};
            const optional: Props = {};
            return this.collectProps(member, required, optional) ? required : undefined;
        };
        const allProps = members.map(propsOf);
        const first = allProps[0];
        if (!first || allProps.some(props => props === undefined)) {
            return undefined;
        }
        for (const candidate of Object.keys(first)) {
            const values = new Set<LiteralValue>();
            const distinct = allProps.every(props => {
                const prop = props![candidate];
                if (!prop || (prop as { _tag?: string })._tag !== 'LiteralType') {
                    return false;
                }
                const value = (prop as t.LiteralType<LiteralValue>).value;
                if (values.has(value)) {
                    return false;
                }
                values.add(value);
                return true;
            });
            if (distinct) {
                return candidate;
            }
        }
        return undefined;
    }

    private union(codec: t.UnionType<t.Any[]>, path: string, nameHint: string): AvroSchema {
        const branches: AvroSchema[] = [];
        let hasNull = false;
        const stringLiterals: string[] = [];
        const objectMembers: t.Any[] = [];
        const others: t.Any[] = [];

        for (const member of codec.types) {
            const tag = (member as { _tag?: string })._tag;
            if (tag === 'NullType' || tag === 'UndefinedType' || tag === 'VoidType') {
                hasNull = true;
            } else if (tag === 'LiteralType') {
                const value = (member as t.LiteralType<LiteralValue>).value;
                if (typeof value === 'string') {
                    stringLiterals.push(value);
                } else {
                    branches.push(this.literal(value));
                }
            } else if (this.unwrapObject(member)) {
                objectMembers.push(member);
            } else {
                others.push(member);
            }
        }
        if (stringLiterals.length > 0) {
            const wholeUnion = stringLiterals.length === codec.types.length;
            branches.push(this.enumeration(stringLiterals, path, codec,
                this.nameFor(codec, nameHint), wholeUnion ? codec : undefined));
        }

        let kindUnion: AvroSchemaNode | undefined;
        const discriminator = objectMembers.length >= 2
            ? this.discriminator(objectMembers) : undefined;
        if (discriminator !== undefined) {
            const branchNames: Record<string, string> = {};
            const records: AvroSchema[] = [];
            for (const member of objectMembers) {
                const required: Props = {};
                this.collectProps(member, required, {});
                const value = (required[discriminator] as t.LiteralType<LiteralValue>).value;
                const hint = `${this.nameFor(codec, nameHint)}_${String(value)}`;
                const record = this.derive(member, `${path}<${String(value)}>`, hint);
                branchNames[String(value)] = branchName(record);
                records.push(record);
            }
            kindUnion = {
                type: records, logicalType: 'kindUnion', discriminator,
                branches: branchNames,
            };
        } else {
            for (const member of objectMembers) {
                branches.push(this.derive(member, path, nameHint));
            }
        }
        for (const member of others) {
            branches.push(this.derive(member, path, nameHint));
        }

        // An unwrapped union's branch is chosen by the VALUE's kind, so
        // two of a kind (two records without a discriminator, two
        // doubles) cannot be encoded without a wrapper we have no key
        // for. (Avro itself would also reject two branches of one name.)
        const seen = new Set<string>();
        const seenNames = new Set<string>();
        const distinctBranches: AvroSchema[] = [];
        for (const branch of branches) {
            const bucket = this.jsBucket(branch);
            const name = branchName(branch);
            if (seen.has(bucket) || seenNames.has(name)) {
                // Two literals of one primitive (`1 | 2`) are one branch.
                if (typeof branch === 'string' && seenNames.has(name)) {
                    continue;
                }
                return this.opaque('unmapped', path, codec,
                    `ambiguous union: two branches would both be ${bucket}s`);
            }
            if (bucket === 'union') {
                return this.opaque('unmapped', path, codec,
                    'a union branch is itself a union, which Avro forbids');
            }
            seen.add(bucket);
            seenNames.add(name);
            distinctBranches.push(branch);
        }
        branches.length = 0;
        branches.push(...distinctBranches);

        if (kindUnion) {
            if (branches.length > 0) {
                return this.opaque('unmapped', path, codec,
                    'discriminated records mixed with other branches');
            }
            if (hasNull) {
                kindUnion.type = ['null', ...(kindUnion.type as AvroSchema[])];
            }
            return kindUnion;
        }
        if (hasNull) {
            branches.unshift('null');
        }
        return branches.length === 1 ? branches[0]! : branches;
    }

    // -----------------------------------------------------------------------
    // ECS component list
    // -----------------------------------------------------------------------

    /**
     * `[name, encoded][]` as an array whose items are a union of one
     * record per registered component, `{data: <component schema>}`.
     * The union's branch index carries the component's identity in one
     * byte, and a record adds no bytes of its own, so a list costs its
     * length plus one byte per component over the data itself; a
     * record-with-83-nullable-fields shape was measured to cost ~84
     * bytes per entity in absent markers. List order is preserved.
     */
    private componentList(serializer: Serializer, path: string, codec: t.Any): AvroSchema {
        const union: AvroSchemaNode = {
            type: [], logicalType: 'componentUnion', components: {},
        };
        const branches = union.type as AvroSchema[];
        const componentNames = [...serializer.componentsByName.keys()].sort();
        for (const componentName of componentNames) {
            const component = serializer.componentsByName.get(componentName)!;
            const componentType = serializer.componentTypes.get(component);
            if (!componentType) {
                continue;
            }
            const branchName = this.uniqueName(`Component_${componentName}`);
            union.components![branchName] = componentName;
            const schema = this.derive(componentType, `${path}[].${componentName}`,
                componentName);
            branches.push({
                type: 'record', name: branchName,
                fields: [{ name: 'data', type: schema }],
            });
        }
        // A component the serializer does not know, by name.
        const extra = this.uniqueName('Component_extra');
        union.extra = extra;
        branches.push({
            type: 'record', name: extra, fields: [
                { name: 'name', type: 'string' },
                { name: 'data', type: { type: 'bytes', logicalType: 'opaque' } },
            ],
        });
        const list: AvroSchemaNode = { type: 'array', items: union };
        // Arrays are anonymous in Avro; remember the list by codec so a
        // second use references the branch records by name.
        this.listSchemas.set(codec, list);
        return list;
    }
}

/**
 * Derives an Avro schema for `codec`'s encoded form. Never throws for a
 * construct it cannot map: the node is carried opaquely and listed in
 * `failures`.
 */
export function deriveAvroSchema(codec: t.Any, options: DerivationOptions = {}): Derivation {
    const deriver = new Deriver(options);
    const schema = deriver.derive(codec, '$', options.name ?? 'Root');
    return { schema, failures: deriver.failures };
}

/** One line per failure, for reports and spec messages. */
export function formatDerivationFailures(failures: DerivationFailure[]): string[] {
    return failures.map(failure =>
        `${failure.kind.padEnd(8)} ${failure.path}: ${failure.reason} [${failure.codec}]`);
}
