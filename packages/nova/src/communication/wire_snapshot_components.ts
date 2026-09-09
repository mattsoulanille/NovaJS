import * as t from 'io-ts';
import { Serializer, SerializerResource } from 'nova_ecs/plugins/serializer_plugin';
import { SnapshotPoliciesResource } from 'nova_ecs/plugins/snapshot_plugin';
import { Random, RandomResource } from 'nova_ecs/plugins/random_plugin';
import { TimeResource } from 'nova_ecs/plugins/time_plugin';
import { World } from 'nova_ecs/world';
import {
    AvroSchema, AvroSchemaNode, CodecHook,
    CodecHooks, deriveAvroSchema,
} from './io_ts_to_avro.js';
import { avroWireCodec, AvroWireCodec } from './wire_codec.js';
import { MissileGuidanceResource } from '../nova_plugin/combat/index.js';
import { MultiplayerData, MultiplayerDataType } from 'nova_ecs/plugins/multiplayer_plugin';
import {
    AnalogControlComponent, ControlledByComponent, ControlledByType,
    ShipControlStateComponent,
} from '../nova_plugin/player/index.js';
import {
    BlastDamageComponent, BlastIgnoreComponent, ExplodingComponent,
    ShipExplosionComponent, SourceComponent,
} from '../nova_plugin/ship/index.js';
import {
    BlastDoneComponent, DecoyTargetComponent, GuidanceComponent,
    SubCounts, TargetIndexComponent, WeaponsComponent,
} from '../nova_plugin/combat/index.js';
import {
    BayFighterComponent, ReturnWhenTargetRemovedComponent,
} from '../nova_plugin/escorts/index.js';
import {
    CollisionHitterComponent, CollisionVulnerabilityComponent, CreateTime,
    HitboxHullComponent, HurtboxHullComponent, IdFactory, IdFactoryResource,
    ProjectileBlastHull, SimulationGameDataResource,
    SystemIdResource,
} from '../nova_plugin/core/index.js';
import { SystemPlugin } from '../nova_plugin/system_plugin.js';
import { configureSnapshotPolicies } from '../nova_plugin/snapshot_policies.js';
import {
    WireComponentListType, WireComponentTupleType,
} from './wire_component_list.js';
import type { WireWorldSnapshot } from 'nova_ecs/plugins/snapshot_plugin';

/**
 * ============================================================================
 * The world-independent component registry for wire snapshots
 * ============================================================================
 *
 * A wire snapshot's component list (`[name, data, encoding][]`) used to
 * be typed `t.unknown` per entry: the socket schema is derived before
 * any world exists, so there was no serializer to type the list with,
 * and every component's data rode the binary wire as an opaque
 * self-describing blob (io_ts_to_avro's dynamic encoding) behind the
 * toJsonSafe sentinels the JSON-safe capture form needs.
 *
 * This module is that world-independence. `wireSnapshotRegistryWorld`
 * builds a bare world — stub game data, no entities, nothing stepped —
 * and runs the full simulation plugin set on it, which registers every
 * component codec the simulation ever registers, with ZERO duplication
 * of the codecs themselves: the registry IS the real registrations. Two
 * registrations happen outside the plugin set's synchronous build
 * (ControlledBy, in ship_controller_plugin after its internal await;
 * MultiplayerData, in makeSystem after the plugin set), so they are
 * repeated here explicitly; a spec pins the registry against a real
 * stepped world so a future registration cannot be missed.
 *
 * From that registry the socket schema types each component's data by
 * its own codec (io_ts_to_avro's componentUnion), which:
 *   - carries the component identity in the union's branch index (one
 *     byte) instead of a length-prefixed name string per entry,
 *   - encodes each field at its schema'd width (a double is 8 bytes,
 *     not a dynamic-encoding tag plus 8), and
 *   - drops the toJsonSafe sentinels on the binary wire: the schema'd
 *     fields are IEEE doubles and nullable unions, which hold -0, NaN,
 *     ±Infinity and undefined natively, so the `{$negzero}` /
 *     `{$nonfinite}` / `{$undefined}` wrapper objects are unwrapped
 *     before the write and re-wrapped after the read. The JSON wire and
 *     the PERSISTED forms (room archives, desync dumps on disk) are
 *     untouched: they still carry the sentinel-wrapped JSON-safe shape,
 *     and restore's fromJsonSafe still runs on both.
 *
 * The `encoding` tag of each pair is DROPPED on the binary wire: which
 * of a component's two codecs captured the data is a property of the
 * SENDING world's snapshot policies, not of the data, and the receiving
 * world decodes through its own policies (restoreWireComponents) — the
 * tag was never consulted on the way back in. The io-ts runtime codec
 * (rollback_protocol.ts WireComponentType) keeps accepting it, so the
 * JSON wire and the persisted forms are unchanged.
 */

/**
 * A bare world that has run the whole simulation plugin set, for its
 * serializer registrations alone. Nothing is stepped and no entity is
 * inserted; the stub resources satisfy the plugin builds' resource
 * checks (addSystem validates that every queried resource exists).
 *
 * Built SYNCHRONOUSLY: the plugin set's builds register synchronously
 * (the one `await` inside ship_controller_plugin is in its build body,
 * which `addPlugin` runs to completion before the registrations after
 * it — but those registrations are exactly the two repeated below, so
 * the synchronous prefix carries everything else). A spec pins the
 * registry against a real stepped world so a future registration
 * cannot be missed.
 */
function buildRegistryWorld(): World {
    const world = new World('wire-snapshot-registry');
    world.resources.set(SimulationGameDataResource, {} as never);
    world.resources.set(SystemIdResource, 'wire-snapshot-registry');
    world.resources.set(RandomResource, new Random(0));
    world.resources.set(IdFactoryResource, new IdFactory('wire-snapshot-registry'));
    world.resources.set(MissileGuidanceResource, { mode: 'smart' });
    world.resources.set(TimeResource,
        { time: 0, delta_s: 0, delta_ms: 0, frame: 0 });
    // addPlugin returns a promise but its build body runs synchronously
    // up to the first await; the registrations we need all happen in
    // that synchronous prefix (verified by the registry spec, which
    // compares against a fully-built real world).
    void world.addPlugin(SystemPlugin);
    const serializer = world.resources.get(SerializerResource)!;
    // Registered by ship_controller_plugin AFTER its internal await, so
    // the synchronous prefix does not carry it.
    serializer.addComponent(ControlledByComponent, ControlledByType);
    // Registered by makeSystem after the plugin set (every simulation
    // world carries it).
    serializer.addComponent(MultiplayerData, MultiplayerDataType);
    // The wire snapshot policies (makeSystem calls this on every
    // simulation world); the wire-codec-only component enumeration
    // below reads them.
    configureSnapshotPolicies(world);
    return world;
}

let registrySerializer: Serializer | undefined;

/**
 * The component codecs of a simulation world, without a world: built
 * once from the registry world's registrations and memoized. A COPY of
 * the maps, so the (discarded) registry world is not retained and the
 * returned serializer cannot be mutated by a caller.
 */
export function wireSnapshotRegistrySerializer(): Serializer {
    if (!registrySerializer) {
        const source = buildRegistryWorld().resources.get(SerializerResource)!;
        const serializer = new Serializer();
        for (const [name, component] of source.componentsByName) {
            const type = source.componentTypes.get(component);
            if (type) {
                serializer.addComponent(component, type);
            }
        }
        registrySerializer = serializer;
    }
    return registrySerializer;
}

/** The async form; see wireSnapshotRegistrySerializer. */
export async function wireSnapshotSerializer(): Promise<Serializer> {
    return wireSnapshotRegistrySerializer();
}

/** The wire shape of one hull shape (collisions_plugin encodeShape). */
const WIRE_SHAPE: AvroSchemaNode = {
    type: 'record', name: 'WireShape', fields: [
        {
            name: 'circle', type: ['null', {
                type: 'record', name: 'WireCircle', fields: [
                    { name: 'r', type: 'double' },
                ],
            }],
        },
        {
            name: 'polygon', type: ['null', {
                type: 'record', name: 'WirePolygon', fields: [
                    {
                        name: 'points', type: {
                            type: 'array', items: {
                                type: 'record', name: 'WirePoint',
                                logicalType: 'tuple', fields: [
                                    { name: '_0', type: 'double' },
                                    { name: '_1', type: 'double' },
                                ],
                            },
                        },
                    },
                ],
            }],
        },
    ],
};

/** The wire form of a hull (collisions_plugin WireHull). */
const WIRE_HULL: AvroSchemaNode = {
    type: 'record', name: 'WireHull', fields: [
        {
            name: 'frames', type: ['null', {
                type: 'array', items: { type: 'array', items: WIRE_SHAPE },
            }],
        },
        {
            name: 'shapes', type: ['null', {
                type: 'array', items: WIRE_SHAPE,
            }],
        },
    ],
};

/** WeaponsComponent's per-weapon local state (fire_weapon_plugin). */
const WEAPON_LOCAL_STATE: AvroSchemaNode = {
    type: 'record', name: 'WeaponLocalState', fields: [
        { name: 'lastFired', type: 'double' },
        { name: 'burstCount', type: 'double' },
        { name: 'reloadingBurst', type: 'boolean' },
        { name: 'wasFiring', type: 'boolean' },
        { name: 'exitIndex', type: 'double' },
    ],
};

/** A `[string, value]` map entry, as the map wire codecs encode. */
function mapEntry(value: AvroSchema): AvroSchemaNode {
    return {
        type: 'record', name: 'MapEntry', logicalType: 'tuple', fields: [
            { name: '_0', type: 'string' },
            { name: '_1', type: value },
        ],
    };
}

/** ShipControlStateComponent's `[action, state]` entries. */
const CONTROL_STATE_ENTRY: AvroSchemaNode = {
    type: 'record', name: 'ControlStateEntry', logicalType: 'tuple', fields: [
        { name: '_0', type: 'string' },
        // false | 'start' | 'repeat' | true.
        { name: '_1', type: ['boolean', 'string'] },
    ],
};

/**
 * The wire codecs snapshot_policies registers for components the
 * serializer does not cover, as schema hooks: their ENCODED shapes are
 * ordinary JSON (hull geometry, map/set entries, plain values), so the
 * reflection types them directly.
 */
export function wireSnapshotComponentHooks(): CodecHooks {
    const hooks: CodecHooks = new Map();
    const hook = (component: unknown, schema: CodecHook) =>
        hooks.set(component as t.Any, schema);
    hook(HitboxHullComponent, WIRE_HULL);
    hook(HurtboxHullComponent, WIRE_HULL);
    hook(ProjectileBlastHull, WIRE_HULL);
    // CreateTime's wire codec is a passthrough over the number.
    hook(CreateTime, 'double');
    hook(SourceComponent, 'string');
    hook(BlastDamageComponent, {
        type: 'record', name: 'BlastDamage', fields: [
            { name: 'shield', type: 'double' },
            { name: 'armor', type: 'double' },
            { name: 'ionization', type: 'double' },
            { name: 'ionizationColor', type: 'double' },
            { name: 'passThroughShield', type: 'double' },
            { name: 'knockback', type: 'double' },
            { name: 'disableOnly', type: ['null', 'boolean'] },
        ],
    });
    hook(GuidanceComponent, {
        type: 'record', name: 'Guidance', fields: [
            { name: 'guidance', type: 'double' },
        ],
    });
    hook(DecoyTargetComponent, {
        type: 'record', name: 'DecoyTarget', fields: [
            { name: 'weight', type: 'double' },
        ],
    });
    hook(ExplodingComponent, 'double');
    hook(TargetIndexComponent, {
        type: 'record', name: 'TargetIndex', fields: [
            { name: 'index', type: 'double' },
        ],
    });
    hook(BlastDoneComponent, {
        type: 'record', name: 'BlastDone', fields: [
            { name: 'done', type: 'boolean' },
        ],
    });
    hook(ShipExplosionComponent, {
        type: 'record', name: 'ShipExplosion', fields: [
            { name: 'mass', type: 'double' },
        ],
    });
    hook(BayFighterComponent, {
        type: 'record', name: 'BayFighter', fields: [
            { name: 'bayWeaponId', type: 'string' },
        ],
    });
    // ReturnWhenTargetRemoved encodes to null (a marker).
    hook(ReturnWhenTargetRemovedComponent, 'null');
    hook(CollisionHitterComponent, { type: 'array', items: 'string' });
    hook(CollisionVulnerabilityComponent, { type: 'array', items: 'string' });
    hook(BlastIgnoreComponent, { type: 'array', items: 'string' });
    hook(WeaponsComponent, {
        type: 'array', items: mapEntry(WEAPON_LOCAL_STATE),
    });
    hook(SubCounts, { type: 'array', items: mapEntry('double') });
    hook(ShipControlStateComponent, {
        type: 'array', items: CONTROL_STATE_ENTRY,
    });
    hook(AnalogControlComponent, {
        type: 'record', name: 'AnalogControl', fields: [
            { name: 'heading', type: ['null', 'double'] },
            { name: 'throttle', type: ['null', 'double'] },
        ],
    });
    return hooks;
}

let derivation: { schema: AvroSchema } | undefined;

/**
 * The io-ts codec of a wire snapshot's structure, over the SHARED
 * component-list codec (wire_component_list.ts) so the reflection
 * recognises the lists by identity and types their data.
 */
const WireSnapshotType: t.Type<WireWorldSnapshot, unknown> = t.type({
    entities: t.array(t.intersection([
        t.type({
            uuid: t.string,
            components: WireComponentListType,
        }),
        t.partial({ name: t.string }),
    ])),
    singleton: WireComponentListType,
    resources: t.array(t.unknown),
});

/**
 * The Avro schema of a wire snapshot, with every component's data
 * typed by the registry (io_ts_to_avro's componentUnion). The
 * component list's items are a union with one `{data}` record per
 * registered component plus an `extra` branch carrying `{name, data}`
 * opaquely for a component the registry lacks — so a schema'd peer can
 * always carry a list, typed where it can and opaque where it cannot.
 */
export function wireSnapshotSchema(): AvroSchema {
    if (!derivation) {
        derivation = { schema: deriveAvroSchema(WireSnapshotType, {
            name: 'WireWorldSnapshot',
            hooks: wireSnapshotComponentHooks(),
            serializer: registrySerializer,
        }).schema };
    }
    return derivation.schema;
}

/**
 * Unwraps the toJsonSafe sentinels (`{$undefined}`, `{$nonfinite}`,
 * `{$negzero}`) from a captured wire snapshot, so the binary wire
 * carries the plain values its schema'd fields hold natively. Applied
 * before the schema'd write; the inverse after the read. The JSON wire
 * and the persisted forms do NOT run this: they keep the JSON-safe
 * shape, and restore's fromJsonSafe handles both.
 */
export function unwrapWireSnapshotSentinels(value: unknown): unknown {
    if (value === null || typeof value !== 'object') {
        return value;
    }
    if (Array.isArray(value)) {
        return value.map(unwrapWireSnapshotSentinels);
    }
    const record = value as Record<string, unknown>;
    if (record.$undefined === true) {
        return undefined;
    }
    if (typeof record.$nonfinite === 'string') {
        return record.$nonfinite === '+' ? Infinity
            : record.$nonfinite === '-' ? -Infinity : NaN;
    }
    if (record.$negzero === true) {
        return -0;
    }
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(record)) {
        out[key] = unwrapWireSnapshotSentinels(inner);
    }
    return out;
}

/**
 * The inverse of {@link unwrapWireSnapshotSentinels}: re-wraps the
 * values JSON cannot carry after a binary read, so the decoded
 * snapshot is the same JSON-safe shape the sender captured and the
 * restore path (fromJsonSafe) sees one form.
 */
export function wrapWireSnapshotSentinels(value: unknown): unknown {
    if (value === undefined) {
        return { $undefined: true };
    }
    if (typeof value === 'number') {
        if (!Number.isFinite(value)) {
            return { $nonfinite: value > 0 ? '+' : value < 0 ? '-' : 'nan' };
        }
        if (Object.is(value, -0)) {
            return { $negzero: true };
        }
        return value;
    }
    if (value === null || typeof value !== 'object') {
        return value;
    }
    if (Array.isArray(value)) {
        return value.map(wrapWireSnapshotSentinels);
    }
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value)) {
        out[key] = wrapWireSnapshotSentinels(inner);
    }
    return out;
}

let codec: AvroWireCodec | undefined;

/**
 * The components whose ONLY wire codec is the snapshot policies' (not
 * serializer-registered): a pair tagged 'serializer' for one of these
 * would route restore through a serializer registration it does not
 * have. The typed codec's read tags them 'wire'; everything else reads
 * back 'serializer' (the tag the receiving world's restore consults
 * first, and the one its own policies agree with — the registry spec
 * pins the two registries identical).
 */
let wireOnlyNames: ReadonlySet<string> | undefined;

function wireOnlyComponentNames(): ReadonlySet<string> {
    if (!wireOnlyNames) {
        const world = buildRegistryWorld();
        const policies = world.resources.get(SnapshotPoliciesResource);
        const serializer = world.resources.get(SerializerResource)!;
        const names = new Set<string>();
        for (const component of policies?.wireCodecs.keys() ?? []) {
            if (!serializer.hasComponent(component)) {
                names.add(component.name);
            }
        }
        wireOnlyNames = names;
    }
    return wireOnlyNames;
}

/**
 * The typed codec for a whole wire snapshot: the derived schema's
 * binary encoding, with the sentinels unwrapped on the way in and
 * re-wrapped on the way out (see the module comment for why the binary
 * wire drops them). Memoized; the schema is derived once per process.
 *
 * The encoding tag of each pair is not schema'd (it is a property of
 * the sending world's policies, not of the data): the write drops it,
 * and the read restores the tag the receiving world's restore expects —
 * 'wire' for the wire-codec-only components (enumerated from the
 * registry world's own policies), 'serializer' for the rest.
 */
export function wireSnapshotCodec(): AvroWireCodec {
    if (!codec) {
        const binary = avroWireCodec(wireSnapshotSchema());
        const wireOnly = wireOnlyComponentNames();
        const reTag = (snapshot: unknown): unknown => {
            if (!snapshot || typeof snapshot !== 'object') {
                return snapshot;
            }
            const record = snapshot as {
                entities?: { components?: [string, unknown, string?][] }[],
                singleton?: [string, unknown, string?][],
            };
            for (const entity of record.entities ?? []) {
                for (const pair of entity.components ?? []) {
                    pair[2] = wireOnly.has(pair[0]) ? 'wire' : 'serializer';
                }
            }
            for (const pair of record.singleton ?? []) {
                pair[2] = wireOnly.has(pair[0]) ? 'wire' : 'serializer';
            }
            return snapshot;
        };
        codec = {
            ...binary,
            encode: (message: unknown) =>
                binary.encode(unwrapWireSnapshotSentinels(message)),
            decode: (bytes: Uint8Array) =>
                reTag(wrapWireSnapshotSentinels(binary.decode(bytes))),
        };
    }
    return codec;
}

/** The typed wire snapshot codec's schema fingerprint. */
export function wireSnapshotFingerprint(): string {
    return wireSnapshotCodec().fingerprint;
}

// The wire snapshot TYPE comes from nova_ecs; re-exported for callers
// of this module that want the codec and the type together.
export type { WireWorldSnapshot } from 'nova_ecs/plugins/snapshot_plugin';
export { WireComponentTupleType } from './wire_component_list.js';
