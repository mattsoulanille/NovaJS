import { current, isDraft } from 'immer';
import * as t from 'io-ts';
import { UnknownComponent } from "nova_ecs/component";
import { EncodedComponentList, EncodedEntity, Serializer } from "nova_ecs/plugins/serializer_plugin";
import { cloneEncoded, SnapshotPoliciesResource } from "nova_ecs/plugins/snapshot_plugin";
import { Time } from "nova_ecs/plugins/time_plugin";
import { World } from "nova_ecs/world";
import { EncodedSimulationBridgeEvent, EncodedSimulationBridgeEventType } from "./simulation_bridge_events.js";
import { RoomSpeed, RoomSpeedType } from "./rollback_protocol.js";
import { WireTick } from "./simulation_input.js";

/**
 * The simulation → display frame: the wire shape the bridge host
 * produces each snapshot and the display applies
 * (apply_simulation_frame.ts), plus the delta encoder that produces it.
 */

export interface EntityDelta {
    /** Present only when the entity's name changed. */
    name?: string;
    /** Components whose encoded form changed since the last snapshot. */
    changed: [string, unknown][];
    /** Names of components removed since the last snapshot. */
    removed: string[];
}

/**
 * How the sim's clock should track the room's. Present only once a
 * tickSync has arrived (i.e. in a live multiplayer room).
 */
export interface SimulationPacing {
    /**
     * Multiply real elapsed time by this before accumulating
     * simulation steps: the room's clock multiplier (1 or 2) times a
     * smooth slew toward the room's clock.
     */
    rate: number;
    /**
     * Raw drift: how far the sim trails its target tick (negative
     * when ahead). Small values are corrected by `rate`; the pump
     * snaps only when this is beyond slewing (e.g. a hidden tab).
     */
    behindTicks: number;
    /**
     * The room clock's base speed multiplier at the local tick (1 or 2).
     * Optional for older/synthetic frames (defaults to 1).
     */
    speed?: RoomSpeed;
}

/**
 * Room speed vote status reported from the simulation worker to the
 * display for the status bar indicator (#371). Display-only metadata;
 * never part of simulation state.
 */
export interface RoomSpeedStatus {
    /** Active clock speed at the local tick (1 or 2). */
    speed: RoomSpeed;
    /** Scheduled clock speed from `atTick` onward (1 or 2). */
    targetSpeed: RoomSpeed;
    /** Tick boundary of the latest speed transition. */
    atTick: number;
    /** In-space voters currently voting for 2x. */
    fastVotes: number;
    /** Total in-space voters in the room (landed players excluded). */
    totalVoters: number;
    /** This peer's own Caps Lock vote. */
    wantFast: boolean;
    /** Whether this peer is currently in space (eligible to vote). */
    inSpace: boolean;
}

/**
 * A delta frame. Entities absent from `added`, `changed`, and `removed`
 * are unchanged since the previous snapshot from the same host.
 */
export interface SimulationFrame {
    added: [string, EncodedEntity][];
    changed: [string, EntityDelta][];
    removed: string[];
    time?: Time;
    events: EncodedSimulationBridgeEvent[];
    pacing?: SimulationPacing;
    roomSpeed?: RoomSpeedStatus;
    /**
     * Set on exactly one frame: the first after the host's desync
     * recovery ran out of attempts (#333), or its identity recovery after
     * a reconnect did (#354, the same terminal path). The host is frozen
     * from then on and every later frame is empty; the client saves,
     * freezes the universe and offers a reload (client/resync_failure.ts).
     */
    resyncFailed?: boolean;
}

/** The entity part of a frame: everything but time, events and pacing. */
export type EntityFrame = Pick<SimulationFrame, 'added' | 'changed' | 'removed'>;

/**
 * Codecs for the frame shapes above. The frame crosses the worker
 * bridge by structuredClone today and is never validated; these exist
 * so its wire schema can be derived (wire_schemas.ts) and so a frame
 * arriving as bytes can be gated like every other boundary.
 */
export const TimeType: t.Type<Time> = t.type({
    time: t.number,
    delta_s: t.number,
    delta_ms: t.number,
    frame: t.number,
});

export const EntityDeltaType: t.Type<EntityDelta> = t.intersection([
    t.type({
        changed: EncodedComponentList,
        removed: t.array(t.string),
    }),
    t.partial({ name: t.string }),
]);

export const SimulationPacingType: t.Type<SimulationPacing> = t.intersection([
    t.type({
        rate: t.number,
        behindTicks: t.number,
    }),
    t.partial({
        speed: RoomSpeedType,
    }),
]);

export const RoomSpeedStatusType: t.Type<RoomSpeedStatus> = t.type({
    speed: RoomSpeedType,
    targetSpeed: RoomSpeedType,
    atTick: WireTick,
    fastVotes: WireTick,
    totalVoters: WireTick,
    wantFast: t.boolean,
    inSpace: t.boolean,
});

export const SimulationFrameType: t.Type<SimulationFrame> = t.intersection([
    t.type({
        added: t.array(t.tuple([t.string, EncodedEntity])),
        changed: t.array(t.tuple([t.string, EntityDeltaType])),
        removed: t.array(t.string),
        events: t.array(EncodedSimulationBridgeEventType),
    }),
    t.partial({
        time: TimeType,
        pacing: SimulationPacingType,
        roomSpeed: RoomSpeedStatusType,
        resyncFailed: t.boolean,
    }),
]);

interface SentComponentEntry {
    /** Per-entity component epoch when last seen (avoids Map/Set churn). */
    epoch: number;
    /** Codec object used on the last encode (guards against codec re-registration). */
    codec: unknown;
    /**
     * When true, `raw` holds an immutable live value (primitive or
     * 'share'-policy component). If the live value is Object.is-identical
     * under the same codec on the next encode, the encoded output is
     * guaranteed unchanged without calling encodeComponent or diffing.
     */
    hasImmutableRaw: boolean;
    raw: unknown;
    /** Detached copy of the last sent encoded value for structural diffing. */
    encoded: unknown;
    /** Fallback JSON string for values with toJSON() or exotic object types. */
    jsonFallback?: string;
}

interface SentEntityRecord {
    /** Encoder epoch when this entity was last seen. */
    epoch: number;
    /** Incremented per visit to detect removed components without allocations. */
    componentEpoch: number;
    name: string | undefined;
    components: Map<UnknownComponent, SentComponentEntry>;
}

const objectProto = Object.prototype;
const hasOwn = Object.prototype.hasOwnProperty;
const objectToString = Object.prototype.toString;
/**
 * Prototypes already confirmed to be ordinary user classes with no custom
 * toJSON or Symbol.toStringTag (e.g. Position, Vector, Angle). Avoids slow
 * Object.prototype.toString calls on hot value objects every frame.
 */
const ordinaryPlainProtos = new WeakSet<object>();

function isPlainObjectOrClass(value: object): boolean {
    const proto = Object.getPrototypeOf(value);
    if (proto === objectProto || proto === null) {
        return typeof (value as { toJSON?: unknown }).toJSON !== 'function';
    }
    if (ordinaryPlainProtos.has(proto)) {
        return !hasOwn.call(value, 'toJSON')
            && !hasOwn.call(value, Symbol.toStringTag);
    }
    if (typeof (value as { toJSON?: unknown }).toJSON === 'function') {
        return false;
    }
    if (objectToString.call(value) !== '[object Object]') {
        return false;
    }
    if (!(Symbol.toStringTag in proto) && !('toJSON' in proto)) {
        ordinaryPlainProtos.add(proto);
    }
    return true;
}

function isImmutableRaw(data: unknown, policy: string | undefined): boolean {
    return typeof data !== 'object' || data === null || policy === 'share';
}

function snapshotSentValue(encoded: unknown, isImmutable: boolean): {
    encoded: unknown, jsonFallback?: string,
} {
    if (typeof encoded !== 'object' || encoded === null) {
        return { encoded };
    }
    if (!Array.isArray(encoded) && !isPlainObjectOrClass(encoded)) {
        return { encoded: undefined, jsonFallback: JSON.stringify(encoded) ?? 'undefined' };
    }
    return { encoded: isImmutable ? encoded : cloneEncoded(encoded) };
}

/**
 * Updates a private detached plain-object copy `dst` in place to match `src`
 * (avoiding per-frame allocations for hot mutable records such as
 * MovementState). Returns false if `dst`/`src` cannot be updated in place
 * (e.g. non-plain objects, arrays, deep nesting/cycles, or toJSON objects).
 */
function tryCopyPlainInPlace(dst: unknown, src: unknown, depth: number): boolean {
    if (depth > 4) {
        return false;
    }
    if (typeof dst !== 'object' || dst === null || Array.isArray(dst)
        || typeof src !== 'object' || src === null || Array.isArray(src)) {
        return false;
    }
    if (!isPlainObjectOrClass(src)) {
        return false;
    }
    const dstObj = dst as Record<string, unknown>;
    const srcObj = src as Record<string, unknown>;
    for (const key in dstObj) {
        if (hasOwn.call(dstObj, key) && !hasOwn.call(srcObj, key)) {
            delete dstObj[key];
        }
    }
    for (const key in srcObj) {
        if (!hasOwn.call(srcObj, key)) {
            continue;
        }
        const val = srcObj[key];
        if (typeof val !== 'object' || val === null) {
            dstObj[key] = val;
        } else if (!tryCopyPlainInPlace(dstObj[key], val, depth + 1)) {
            const stored = snapshotSentValue(val, false);
            if (stored.jsonFallback !== undefined) {
                return false;
            }
            dstObj[key] = stored.encoded;
        }
    }
    return true;
}

function encodeWithCodec(codec: { encode(a: unknown): unknown }, data: unknown): unknown {
    return codec.encode(
        typeof data === 'object' && data !== null && isDraft(data)
            ? current(data) : data);
}

/**
 * Compares a detached previously-sent value `a` against a newly encoded
 * value `b` with JSON.stringify equivalence:
 * - NaN / ±Infinity / null are equivalent (JSON emits "null").
 * - -0 and +0 are equivalent (===).
 * - Own object keys whose value is `undefined` are ignored (JSON omits them).
 * - Inside arrays, `undefined` is equivalent to `null` (JSON emits "null").
 * - Objects with toJSON() or non-plain built-ins return undefined so the
 *   caller falls back to JSON.stringify.
 */
function jsonEquivalent(a: unknown, b: unknown, inArray: boolean): boolean | undefined {
    if (inArray) {
        if (a === undefined) a = null;
        if (b === undefined) b = null;
    }
    if (a === b) {
        return true;
    }
    if (typeof a === 'number') {
        if (!Number.isFinite(a)) {
            return b === null || (typeof b === 'number' && !Number.isFinite(b));
        }
        return false;
    }
    if (a === null) {
        return typeof b === 'number' && !Number.isFinite(b);
    }
    if (typeof a !== 'object' || typeof b !== 'object' || b === null) {
        return false;
    }
    const aIsArr = Array.isArray(a);
    if (aIsArr !== Array.isArray(b)) {
        return false;
    }
    if (aIsArr) {
        const arrA = a as unknown[];
        const arrB = b as unknown[];
        const len = arrA.length;
        if (len !== arrB.length) {
            return false;
        }
        for (let i = 0; i < len; i++) {
            const eq = jsonEquivalent(arrA[i], arrB[i], true);
            if (eq !== true) {
                return eq;
            }
        }
        return true;
    }
    if (!isPlainObjectOrClass(a) || !isPlainObjectOrClass(b)) {
        return undefined;
    }
    const objA = a as Record<string, unknown>;
    const objB = b as Record<string, unknown>;
    let countA = 0;
    for (const key in objA) {
        if (!hasOwn.call(objA, key)) {
            continue;
        }
        const valA = objA[key];
        if (valA === undefined) {
            continue;
        }
        countA++;
        if (!hasOwn.call(objB, key)) {
            return false;
        }
        const valB = objB[key];
        if (valB === undefined) {
            return false;
        }
        const eq = jsonEquivalent(valA, valB, false);
        if (eq !== true) {
            return eq;
        }
    }
    let countB = 0;
    for (const key in objB) {
        if (!hasOwn.call(objB, key)) {
            continue;
        }
        if (objB[key] !== undefined) {
            countB++;
        }
    }
    return countA === countB;
}

/**
 * Encodes a world's serializer-registered state as a delta against the
 * state this encoder last sent: entities never sent arrive in full,
 * entities whose encoded components changed arrive as an EntityDelta,
 * and entities that vanished are named in `removed`.
 */
export class DeltaFrameEncoder {
    private lastSent = new Map<string, SentEntityRecord>();
    private epoch = 0;

    encode(world: World, serializer: Serializer): EntityFrame {
        const policies = world.resources.get(SnapshotPoliciesResource)?.components;
        const componentTypes = serializer.componentTypes;
        const added: [string, EncodedEntity][] = [];
        const changed: [string, EntityDelta][] = [];
        const epoch = ++this.epoch;

        for (const [uuid, entity] of world.entities) {
            if (uuid === "singleton") {
                continue;
            }
            const previous = this.lastSent.get(uuid);

            if (!previous) {
                const encodedComponents: [string, unknown][] = [];
                const components = new Map<UnknownComponent, SentComponentEntry>();
                for (const [component, data] of entity.components) {
                    const codec = componentTypes.get(component);
                    if (!codec) {
                        continue;
                    }
                    const encoded = encodeWithCodec(codec, data);
                    encodedComponents.push([component.name, encoded]);
                    const isImmutable = isImmutableRaw(data, policies?.get(component)?.policy);
                    const stored = snapshotSentValue(encoded, isImmutable);
                    components.set(component, {
                        epoch: 1,
                        codec,
                        hasImmutableRaw: isImmutable,
                        raw: isImmutable ? data : undefined,
                        encoded: stored.encoded,
                        jsonFallback: stored.jsonFallback,
                    });
                }
                this.lastSent.set(uuid, {
                    epoch,
                    componentEpoch: 1,
                    name: entity.name,
                    components,
                });
                added.push([uuid, {
                    name: entity.name,
                    components: encodedComponents,
                }]);
                continue;
            }

            previous.epoch = epoch;
            const compEpoch = ++previous.componentEpoch;
            let delta: EntityDelta | undefined;
            if (previous.name !== entity.name) {
                previous.name = entity.name;
                delta = { name: entity.name, changed: [], removed: [] };
            }

            const prevComponents = previous.components;
            let seenComponents = 0;
            for (const [component, data] of entity.components) {
                const codec = componentTypes.get(component);
                if (!codec) {
                    continue;
                }
                seenComponents++;
                const prevEntry = prevComponents.get(component);

                if (prevEntry) {
                    prevEntry.epoch = compEpoch;
                    const isImmutable = isImmutableRaw(data, policies?.get(component)?.policy);
                    if (isImmutable && prevEntry.hasImmutableRaw
                        && prevEntry.codec === codec
                        && Object.is(prevEntry.raw, data)) {
                        continue;
                    }
                    const encoded = encodeWithCodec(codec, data);
                    let equal: boolean;
                    if (prevEntry.jsonFallback !== undefined) {
                        const nextJson = JSON.stringify(encoded) ?? 'undefined';
                        equal = prevEntry.jsonFallback === nextJson;
                        if (!equal) {
                            prevEntry.jsonFallback = nextJson;
                            prevEntry.encoded = undefined;
                        }
                    } else {
                        const eq = jsonEquivalent(prevEntry.encoded, encoded, false);
                        if (eq === undefined) {
                            const prevJson = JSON.stringify(prevEntry.encoded) ?? 'undefined';
                            const nextJson = JSON.stringify(encoded) ?? 'undefined';
                            equal = prevJson === nextJson;
                            prevEntry.jsonFallback = nextJson;
                            prevEntry.encoded = undefined;
                        } else {
                            equal = eq;
                            if (!equal) {
                                if (!prevEntry.hasImmutableRaw && !isImmutable
                                    && tryCopyPlainInPlace(prevEntry.encoded, encoded, 0)) {
                                    prevEntry.jsonFallback = undefined;
                                } else {
                                    const stored = snapshotSentValue(encoded, isImmutable);
                                    prevEntry.encoded = stored.encoded;
                                    prevEntry.jsonFallback = stored.jsonFallback;
                                }
                            }
                        }
                    }
                    prevEntry.codec = codec;
                    prevEntry.hasImmutableRaw = isImmutable;
                    prevEntry.raw = isImmutable ? data : undefined;
                    if (!equal) {
                        if (!delta) {
                            delta = { changed: [], removed: [] };
                        }
                        delta.changed.push([component.name, encoded]);
                    }
                } else {
                    const isImmutable = isImmutableRaw(data, policies?.get(component)?.policy);
                    const encoded = encodeWithCodec(codec, data);
                    const stored = snapshotSentValue(encoded, isImmutable);
                    prevComponents.set(component, {
                        epoch: compEpoch,
                        codec,
                        hasImmutableRaw: isImmutable,
                        raw: isImmutable ? data : undefined,
                        encoded: stored.encoded,
                        jsonFallback: stored.jsonFallback,
                    });
                    if (!delta) {
                        delta = { changed: [], removed: [] };
                    }
                    delta.changed.push([component.name, encoded]);
                }
            }

            if (seenComponents !== prevComponents.size) {
                for (const [component, entry] of prevComponents) {
                    if (entry.epoch !== compEpoch) {
                        prevComponents.delete(component);
                        if (!delta) {
                            delta = { changed: [], removed: [] };
                        }
                        delta.removed.push(component.name);
                    }
                }
            }

            if (delta) {
                changed.push([uuid, delta]);
            }
        }

        const removed: string[] = [];
        for (const [uuid, record] of this.lastSent) {
            if (record.epoch !== epoch) {
                removed.push(uuid);
                this.lastSent.delete(uuid);
            }
        }

        return { added, changed, removed };
    }

    /**
     * Forgets all previously sent state so the next frame resends
     * every entity in full.
     */
    reset() {
        this.lastSent.clear();
    }
}
