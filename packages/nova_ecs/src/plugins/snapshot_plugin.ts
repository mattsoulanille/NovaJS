import { isLeft } from 'fp-ts/lib/Either.js';
import { AsyncSystemResource } from '../async_system.js';
import { Component, UnknownComponent } from '../component.js';
import { Entity } from '../entity.js';
import { AsyncProviderResource } from '../provide_async.js';
import { Resource } from '../resource.js';
import { World } from '../world.js';
import { SerializerResource } from './serializer_plugin.js';
import { TimeResource } from './time_plugin.js';

/**
 * How a component's data is captured in a snapshot:
 * - codec: io-ts roundtrip through the serializer (correct for class
 *   data like Position; the default for serializer-registered
 *   components).
 * - share: store the reference itself. Only for immutable data (static
 *   game data, derived immutable structures).
 * - clone: custom deep copy, for mutable unregistered data.
 * - skip: not simulation state, or re-derived after restore.
 */
export type ComponentSnapshotPolicy<Data = unknown> =
    | { policy: 'codec' }
    | { policy: 'share' }
    | { policy: 'clone', clone: (data: Data) => Data }
    | { policy: 'skip' };

export interface ResourceSnapshotPolicy {
    name: string;
    /** Must return JSON-safe data for wire snapshots. */
    save: () => unknown;
    restore: (saved: unknown) => void;
}

/**
 * How a component crosses the wire in a wire snapshot (see
 * wireSnapshotWorld). Both directions must be exact: a restored world
 * must continue in lockstep with worlds that never left memory.
 */
export interface WireComponentCodec<Data = unknown> {
    /** Must return JSON-safe data. */
    encode: (data: Data) => unknown;
    decode: (encoded: unknown) => Data;
}

export class SnapshotPolicies {
    readonly components = new Map<UnknownComponent, ComponentSnapshotPolicy>();
    readonly resources: ResourceSnapshotPolicy[] = [];
    /** Component names that were skipped without an explicit policy. */
    readonly unhandled = new Set<string>();

    /** Wire codecs for components the serializer does not cover. */
    readonly wireCodecs = new Map<UnknownComponent, WireComponentCodec>();
    /**
     * Components omitted from wire snapshots because the restoring
     * world rebuilds them itself (derived data, per-step scratch
     * recomputed before use, local machinery references).
     */
    readonly wireDerived = new Set<UnknownComponent>();
    /** Component names wire-skipped without an explicit decision. */
    readonly unhandledWire = new Set<string>();

    set<Data>(component: Component<Data>, policy: ComponentSnapshotPolicy<Data>) {
        this.components.set(component as UnknownComponent,
            policy as ComponentSnapshotPolicy);
    }

    setWire<Data>(component: Component<Data>, codec: WireComponentCodec<Data>) {
        this.wireCodecs.set(component as UnknownComponent,
            codec as WireComponentCodec);
    }

    setWireDerived(component: Component<unknown>) {
        this.wireDerived.add(component as UnknownComponent);
    }

    addResource(policy: ResourceSnapshotPolicy) {
        this.resources.push(policy);
    }
}

export const SnapshotPoliciesResource =
    new Resource<SnapshotPolicies>('SnapshotPolicies');

type StoredComponent = [UnknownComponent, unknown, 'value' | 'encoded'];

const objectProto = Object.prototype;

/**
 * Deep-copies serializer-encoded component data with structuredClone's
 * result shape, but without structuredClone's per-call serialization
 * round trip, which dominated the per-tick rollback snapshot (every
 * component of every entity, every tick).
 *
 * Encoded data is JSON-like: primitives, arrays and objects. Objects
 * become plain objects holding their own enumerable string-keyed
 * properties — exactly what structuredClone produces for ordinary
 * objects, including class instances such as Position that identity
 * codecs pass through (their symbol-keyed immerable marker is dropped
 * either way; decode rebuilds the class). Anything structuredClone
 * treats specially (Map, Set, Date, RegExp, ArrayBuffer views, boxed
 * primitives, errors) and anything it rejects (functions) is handed
 * to structuredClone itself, so the result — or the thrown
 * DataCloneError — is the same as before.
 */
export function cloneEncoded<T>(value: T,
    /**
     * Objects already copied in this clone, so a reference shared between
     * two places in the input is shared between the same two places in
     * the copy (and a cycle terminates) — exactly structuredClone's graph
     * semantics, which the fast path must not weaken (review r12 M-1).
     */
    seen: Map<object, unknown> = new Map()): T {
    if (typeof value !== 'object' || value === null) {
        if (typeof value === 'function' || typeof value === 'symbol') {
            return structuredClone(value);
        }
        return value;
    }
    const already = seen.get(value);
    if (already !== undefined) {
        return already as T;
    }
    if (Array.isArray(value)) {
        const length = value.length;
        // Only dense arrays with no extra properties take the fast path.
        if (Object.keys(value).length !== length) {
            return structuredClone(value);
        }
        const copy = new Array(length);
        seen.set(value, copy);
        for (let i = 0; i < length; i++) {
            copy[i] = cloneEncoded(value[i], seen);
        }
        return copy as T;
    }
    const proto = Object.getPrototypeOf(value);
    if (proto !== objectProto && proto !== null && !isOrdinaryClassInstance(value)) {
        return structuredClone(value);
    }
    const copy: Record<string, unknown> = {};
    seen.set(value, copy);
    for (const key in value) {
        if (Object.prototype.hasOwnProperty.call(value, key)) {
            copy[key] = cloneEncoded((value as Record<string, unknown>)[key], seen);
        }
    }
    return copy as T;
}

const objectToString = Object.prototype.toString;

/**
 * True for instances of user-defined classes, which structured clone
 * serializes as ordinary objects. Everything with its own class tag
 * (Map, Set, Date, RegExp, errors, buffers and views, boxed primitives,
 * platform objects, anything with a Symbol.toStringTag) is left to
 * structuredClone.
 */
function isOrdinaryClassInstance(value: object): boolean {
    return objectToString.call(value) === '[object Object]';
}

interface SnapshotEntity {
    uuid: string;
    name?: string;
    components: StoredComponent[];
}

export interface WorldSnapshot {
    entities: SnapshotEntity[];
    singleton: StoredComponent[];
    resources: unknown[];
}

const CODEC_POLICY: ComponentSnapshotPolicy = { policy: 'codec' };
const SKIP_POLICY: ComponentSnapshotPolicy = { policy: 'skip' };

function snapshotComponents(world: World, entity: Entity,
    policies: SnapshotPolicies): StoredComponent[] {
    const serializer = world.resources.get(SerializerResource);
    const stored: StoredComponent[] = [];
    for (const [component, data] of entity.components) {
        let policy = policies.components.get(component);
        if (!policy) {
            policy = serializer?.hasComponent(component)
                ? CODEC_POLICY : SKIP_POLICY;
        }
        switch (policy.policy) {
            case 'share':
                stored.push([component, data, 'value']);
                break;
            case 'clone':
                stored.push([component, policy.clone(data), 'value']);
                break;
            case 'codec':
                // io-ts optimizes all-identity codecs (e.g. VectorLike,
                // passthrough types) to return the live object, and even
                // non-identity codecs can share mutable inner objects.
                // Deep-copy so the snapshot cannot be mutated by
                // continued simulation; decode reconstructs class
                // instances from the plain data.
                stored.push([component, cloneEncoded(
                    serializer!.encodeComponent(component, data)), 'encoded']);
                break;
            case 'skip':
                if (!policies.components.has(component)) {
                    policies.unhandled.add(component.name);
                }
                break;
        }
    }
    return stored;
}

function restoreComponents(world: World, entity: Entity,
    stored: StoredComponent[], policies: SnapshotPolicies) {
    const serializer = world.resources.get(SerializerResource);
    for (const [component, data, kind] of stored) {
        if (kind === 'encoded') {
            // Clone before decoding: identity codecs return their
            // input, so without this the entity would hold (and
            // mutate) the snapshot's stored data, corrupting it for a
            // second restore of the same snapshot.
            const decoded = serializer!.decodeComponent(
                component.name, cloneEncoded(data));
            if (!decoded || isLeft(decoded)) {
                throw new Error(`Failed to restore component ${component.name}`);
            }
            entity.components.set(component, decoded.right[1]);
            continue;
        }
        const policy = policies.components.get(component);
        if (policy?.policy === 'clone') {
            // Clone again on restore so the snapshot's copy stays
            // pristine for later restores.
            entity.components.set(component, policy.clone(data));
        } else {
            entity.components.set(component, data);
        }
    }
}

/** Worlds already warned about a snapshot taken with queued events. */
const warnedQueuedEventWorlds = new WeakSet<World>();

/**
 * Dev check for the invariant snapshots (and restores) rely on:
 * snapshots are taken between steps, when the event queue is empty.
 * Queued events are NOT captured, and restore discards whatever the
 * restore itself queued (see restoreWorld) — so a snapshot taken with
 * events pending silently loses them across a restore.
 *
 * The one accepted exception is the genesis snapshot of a world that
 * has never stepped (frame 0): entity insertion at world-build time
 * queues AddEvents that the first step will flush. Warning there would
 * fire on every world build and train readers to ignore the check, so
 * the never-stepped case is exempt. Everything else warns, once per
 * world.
 */
function checkEventQueueEmpty(world: World) {
    if (world.queuedEventCount === 0 || warnedQueuedEventWorlds.has(world)) {
        return;
    }
    const frame = world.resources.get(TimeResource)?.frame ?? 0;
    if (frame === 0) {
        return;
    }
    warnedQueuedEventWorlds.add(world);
    console.warn(`Snapshot of ${world} taken with `
        + `${world.queuedEventCount} queued event(s); snapshots should be `
        + `taken between steps (queued events are not captured, and a `
        + `restore discards them)`);
}

/**
 * Captures the simulation state of a world: every entity's components
 * (per the registered policies), the singleton's components, and the
 * registered resources. Entities are recorded in insertion order,
 * which iteration order (and therefore determinism) depends on.
 */
export function snapshotWorld(world: World): WorldSnapshot {
    const policies = world.resources.get(SnapshotPoliciesResource);
    if (!policies) {
        throw new Error('Expected SnapshotPoliciesResource to exist');
    }
    checkEventQueueEmpty(world);

    const entities: SnapshotEntity[] = [];
    let singleton: StoredComponent[] = [];
    for (const [uuid, entity] of world.entities) {
        if (uuid === 'singleton') {
            singleton = snapshotComponents(world, entity, policies);
            continue;
        }
        entities.push({
            uuid,
            name: entity.name,
            components: snapshotComponents(world, entity, policies),
        });
    }

    return {
        entities,
        singleton,
        resources: policies.resources.map(resource => resource.save()),
    };
}

/**
 * Resources are restored positionally against the policies order, so a
 * length mismatch means the snapshot came from a differently configured
 * world and restoring it would silently write wrong data into wrong
 * resources. Fail loudly instead: a mismatched snapshot is unusable.
 */
function checkResourceCount(snapshotCount: number, policyCount: number) {
    if (snapshotCount !== policyCount) {
        throw new Error(`Snapshot has ${snapshotCount} resources but the `
            + `world has ${policyCount} resource snapshot policies; `
            + `refusing to restore a mismatched snapshot`);
    }
}

/**
 * Discards the async machinery's in-flight state on restore. AsyncSystem
 * patches, promises and `running` flags — and ProvideAsync's running
 * markers — describe work started on the timeline being abandoned, and
 * none of it is covered by snapshots: left in place, a completion landing
 * after the restore would apply patches computed against the abandoned
 * base onto the restored one, at a tick a forward execution of the
 * restored state would never produce. Clearing the maps orphans the
 * entries the in-flight completion callbacks captured, so when those
 * promises settle they write into unreachable objects and the restored
 * world never sees them; async systems then restart from scratch,
 * exactly as a fresh execution of the restored state would.
 *
 * (Deterministic simulation worlds have no async systems today — the
 * base AsyncSystemPlugin's resource is empty there, making this a no-op
 * on the rollback hot path — but a world that does use one is now safe
 * to snapshot and restore by construction.)
 */
function resetAsyncState(world: World) {
    const asyncSystems = world.resources.get(AsyncSystemResource);
    if (asyncSystems) {
        asyncSystems.systems.clear();
        asyncSystems.done = Promise.resolve();
    }
    world.resources.get(AsyncProviderResource)?.clear();
}

/**
 * Restores a world to a snapshot's state. `complete` runs on each
 * restored entity before it is inserted, so derived components can be
 * reattached synchronously (no first-step gap during resimulation).
 */
export function restoreWorld(world: World, snapshot: WorldSnapshot,
    complete?: (world: World, entity: Entity) => void) {
    const policies = world.resources.get(SnapshotPoliciesResource);
    if (!policies) {
        throw new Error('Expected SnapshotPoliciesResource to exist');
    }
    checkResourceCount(snapshot.resources.length, policies.resources.length);

    for (const uuid of [...world.entities.keys()]) {
        if (uuid !== 'singleton') {
            world.entities.delete(uuid);
        }
    }

    for (const snap of snapshot.entities) {
        const entity = new Entity(snap.name);
        restoreComponents(world, entity, snap.components, policies);
        complete?.(world, entity);
        world.entities.set(snap.uuid, entity);
    }

    const singleton = world.entities.get('singleton');
    if (singleton) {
        restoreComponents(world, singleton, snapshot.singleton, policies);
    }

    policies.resources.forEach((resource, i) => {
        resource.restore(snapshot.resources[i]);
    });

    // Entity removal/re-insertion above queued Add/Delete events that
    // did not happen in the restored timeline. Snapshots are taken
    // between steps (empty queue), so restore that invariant.
    world.clearEventQueue();
    resetAsyncState(world);
}

/**
 * JSON cannot represent Infinity, NaN, or undefined — but encoded game
 * state legitimately contains them (inertialess ships have infinite
 * max velocity; marker components encode to undefined). Sentinel-wrap
 * them on capture and unwrap on restore, so a JSON roundtrip of a wire
 * snapshot is exact. The walk also detaches the data from live state.
 */
function toJsonSafe(value: unknown): unknown {
    if (value === undefined) {
        return { $undefined: true };
    }
    if (typeof value === 'number' && !Number.isFinite(value)) {
        return { $nonfinite: value > 0 ? '+' : value < 0 ? '-' : 'nan' };
    }
    if (Array.isArray(value)) {
        return value.map(toJsonSafe);
    }
    if (value && typeof value === 'object') {
        const safe: Record<string, unknown> = {};
        for (const [key, inner] of Object.entries(value)) {
            safe[key] = toJsonSafe(inner);
        }
        return safe;
    }
    return value;
}

function fromJsonSafe(value: unknown): unknown {
    if (value && typeof value === 'object') {
        if ('$undefined' in value) {
            return undefined;
        }
        if ('$nonfinite' in value) {
            const kind = (value as { $nonfinite: string }).$nonfinite;
            return kind === '+' ? Infinity : kind === '-' ? -Infinity : NaN;
        }
        if (Array.isArray(value)) {
            return value.map(fromJsonSafe);
        }
        const restored: Record<string, unknown> = {};
        for (const [key, inner] of Object.entries(value)) {
            restored[key] = fromJsonSafe(inner);
        }
        return restored;
    }
    return value;
}

/** [componentName, data, how the data was encoded] */
type WireComponent = [string, unknown, 'serializer' | 'wire'];

export interface WireEntity {
    uuid: string;
    name?: string;
    components: WireComponent[];
}

/**
 * A world snapshot that can cross the wire: entirely JSON-safe, unlike
 * WorldSnapshot, which holds live references (shared static data,
 * cloned Maps and Sets). Used wherever a world must be reconstructed
 * remotely from non-genesis state: the server's periodic archive for
 * late joins, desync recovery, and (someday) persistence.
 */
export interface WireWorldSnapshot {
    entities: WireEntity[];
    singleton: WireComponent[];
    resources: unknown[];
}

function wireSnapshotComponents(world: World, entity: Entity,
    policies: SnapshotPolicies): WireComponent[] {
    const serializer = world.resources.get(SerializerResource);
    const stored: WireComponent[] = [];
    for (const [component, data] of entity.components) {
        if (policies.wireDerived.has(component)) {
            continue;
        }
        // toJsonSafe also detaches the stored data: io-ts identity
        // codecs (and passthrough wire codecs) return live objects,
        // and this snapshot outlives the tick.
        const codec = policies.wireCodecs.get(component);
        if (codec) {
            stored.push([component.name,
                toJsonSafe(codec.encode(data)), 'wire']);
            continue;
        }
        if (serializer?.hasComponent(component)) {
            stored.push([component.name, toJsonSafe(
                serializer.encodeComponent(component, data)), 'serializer']);
            continue;
        }
        if (policies.components.get(component)?.policy === 'skip') {
            // Explicitly not simulation state.
            continue;
        }
        policies.unhandledWire.add(component.name);
    }
    return stored;
}

/**
 * Captures a world's simulation state in JSON-safe form. Components
 * are encoded by an explicit wire codec, by the serializer, or omitted
 * when marked wire-derived (the restoring world rebuilds them).
 * Components with none of these are skipped and recorded in
 * `unhandledWire` — assert it empty in CI: an unhandled component is
 * silently lost state, which desyncs a world restored from this.
 */
export function wireSnapshotWorld(world: World): WireWorldSnapshot {
    const policies = world.resources.get(SnapshotPoliciesResource);
    if (!policies) {
        throw new Error('Expected SnapshotPoliciesResource to exist');
    }
    checkEventQueueEmpty(world);

    const entities: WireEntity[] = [];
    let singleton: WireComponent[] = [];
    for (const [uuid, entity] of world.entities) {
        if (uuid === 'singleton') {
            singleton = wireSnapshotComponents(world, entity, policies);
            continue;
        }
        entities.push({
            uuid,
            name: entity.name,
            components: wireSnapshotComponents(world, entity, policies),
        });
    }

    return {
        entities,
        singleton,
        resources: policies.resources.map(
            resource => toJsonSafe(resource.save())),
    };
}

function wireComponentsOfStored(world: World, stored: StoredComponent[],
    policies: SnapshotPolicies): WireComponent[] {
    const serializer = world.resources.get(SerializerResource);
    const wire: WireComponent[] = [];
    for (const [component, data, kind] of stored) {
        if (policies.wireDerived.has(component)) {
            continue;
        }
        const codec = policies.wireCodecs.get(component);
        if (codec && kind === 'value') {
            wire.push([component.name,
                toJsonSafe(codec.encode(data)), 'wire']);
            continue;
        }
        if (kind === 'encoded') {
            // Stored form is already the serializer encoding — the
            // same bytes wireSnapshotWorld would produce.
            wire.push([component.name, toJsonSafe(data), 'serializer']);
            continue;
        }
        if (serializer?.hasComponent(component)) {
            wire.push([component.name, toJsonSafe(
                serializer.encodeComponent(component, data)), 'serializer']);
            continue;
        }
        policies.unhandledWire.add(component.name);
    }
    return wire;
}

/**
 * Converts a stored structural snapshot to wire form using the world's
 * policies and serializer, without touching the world's entities. Lets
 * a past state (e.g. a pinned rollback checkpoint) cross the wire
 * without restoring it first — capture stays free until someone
 * actually asks for the wire form.
 *
 * Equivalent to wireSnapshotWorld on a world restored from `snapshot`:
 * structural snapshots store serializer-registered components in their
 * encoded form already, and wire-codec'd components in live form.
 */
export function wireSnapshotOfSnapshot(world: World,
    snapshot: WorldSnapshot): WireWorldSnapshot {
    const policies = world.resources.get(SnapshotPoliciesResource);
    if (!policies) {
        throw new Error('Expected SnapshotPoliciesResource to exist');
    }
    return {
        entities: snapshot.entities.map(entity => ({
            uuid: entity.uuid,
            ...(entity.name !== undefined ? { name: entity.name } : {}),
            components: wireComponentsOfStored(
                world, entity.components, policies),
        })),
        singleton: wireComponentsOfStored(world, snapshot.singleton, policies),
        resources: snapshot.resources.map(toJsonSafe),
    };
}

function wireCodecsByName(policies: SnapshotPolicies) {
    const byName = new Map<string, [UnknownComponent, WireComponentCodec]>();
    for (const [component, codec] of policies.wireCodecs) {
        byName.set(component.name, [component, codec]);
    }
    return byName;
}

function restoreWireComponents(world: World, entity: Entity,
    stored: WireComponent[], policies: SnapshotPolicies) {
    const serializer = world.resources.get(SerializerResource);
    const byName = wireCodecsByName(policies);
    for (const [name, data, encoding] of stored) {
        // fromJsonSafe rebuilds fresh objects, so the same baseline
        // can be restored more than once (a retried join, a repeated
        // resync) even though passthrough/identity decoders hand
        // their input to the entity.
        if (encoding === 'wire') {
            const wireCodec = byName.get(name);
            if (!wireCodec) {
                throw new Error(`No wire codec registered for ${name}`);
            }
            const [component, codec] = wireCodec;
            entity.components.set(component, codec.decode(fromJsonSafe(data)));
            continue;
        }
        const decoded = serializer?.decodeComponent(name, fromJsonSafe(data));
        if (!decoded || isLeft(decoded)) {
            throw new Error(`Failed to restore wire component ${name}`);
        }
        entity.components.set(decoded.right[0], decoded.right[1]);
    }
}

/** Decodes one wire entity without inserting it into the world. */
export function decodeWireEntity(world: World, wireEntity: WireEntity): Entity {
    const policies = world.resources.get(SnapshotPoliciesResource);
    if (!policies) {
        throw new Error('Expected SnapshotPoliciesResource to exist');
    }
    const entity = new Entity(wireEntity.name);
    restoreWireComponents(world, entity, wireEntity.components, policies);
    return entity;
}

/**
 * Restores a world to a wire snapshot's state, replacing its entities.
 * The entities' game data must already be loaded (see the staging
 * helpers in the game layer): `complete` derives the omitted
 * components synchronously from warm caches.
 */
export function restoreWireWorldSnapshot(world: World,
    snapshot: WireWorldSnapshot,
    complete?: (world: World, entity: Entity) => void) {
    const policies = world.resources.get(SnapshotPoliciesResource);
    if (!policies) {
        throw new Error('Expected SnapshotPoliciesResource to exist');
    }
    checkResourceCount(snapshot.resources.length, policies.resources.length);

    for (const uuid of [...world.entities.keys()]) {
        if (uuid !== 'singleton') {
            world.entities.delete(uuid);
        }
    }

    for (const wireEntity of snapshot.entities) {
        const entity = decodeWireEntity(world, wireEntity);
        complete?.(world, entity);
        world.entities.set(wireEntity.uuid, entity);
    }

    const singleton = world.entities.get('singleton');
    if (singleton) {
        restoreWireComponents(world, singleton, snapshot.singleton, policies);
    }

    policies.resources.forEach((resource, i) => {
        resource.restore(fromJsonSafe(snapshot.resources[i]));
    });

    // Same invariant as restoreWorld: snapshots are taken between
    // steps, when the event queue is empty. And the same async reset:
    // in-flight async work belongs to the replaced timeline.
    world.clearEventQueue();
    resetAsyncState(world);
}
