import { World } from '../world.js';
import { EncodedEntity, SerializerResource } from './serializer_plugin.js';

/** FNV-1a 32-bit hash. Not cryptographic; used for state comparison. */
export function fnv1a(text: string, seed = 0x811c9dc5): number {
    let hash = seed;
    for (let i = 0; i < text.length; i++) {
        hash ^= text.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193);
    }
    return hash >>> 0;
}

/**
 * JSON.stringify maps -0 to "0" and NaN/±Infinity to "null", so two
 * worlds holding different bits hashed identically and a fork stayed
 * invisible until it propagated into non-zero state (#85). Fold the
 * exact values in, matching what the wire snapshot preserves
 * (snapshot_plugin's toJsonSafe): the hash distinguishes precisely the
 * states a resync could produce a peer in.
 */
function hashReplacer(_key: string, value: unknown): unknown {
    if (typeof value === 'number') {
        if (Object.is(value, -0)) {
            return '$-0';
        }
        if (!Number.isFinite(value)) {
            return value > 0 ? '$+inf' : value < 0 ? '$-inf' : '$nan';
        }
    }
    return value;
}

export interface WorldHash {
    /** Combined hash of all entities. */
    hash: string;
    /** Per-entity hashes, for diagnosing which entity diverged. */
    entities: Map<string, string>;
}

/**
 * Hashes the serializable state of a world: every entity's
 * serializer-registered components, in a canonical order that does not
 * depend on entity or component insertion order. Two worlds that have
 * simulated the same inputs deterministically hash identically.
 *
 * Resources are not yet included; they will need to be once rollback
 * snapshots carry resources (RNG state, id counters).
 */
export function hashWorld(world: World,
    excludeComponents?: ReadonlySet<string>): WorldHash {
    const serializer = world.resources.get(SerializerResource);
    if (!serializer) {
        throw new Error('Expected a serializer resource to hash the world');
    }

    const entities = new Map<string, string>();
    const uuids = [...world.entities.keys()].sort();
    let combined = 0x811c9dc5;
    for (const uuid of uuids) {
        const entity = world.entities.get(uuid)!;
        const encoded = serializer.encode(entity) as EncodedEntity;
        const components = [...encoded.components]
            .filter(([name]) => !excludeComponents?.has(name))
            .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
        const json = JSON.stringify({ name: encoded.name, components },
            hashReplacer) ?? '';
        const entityHash = fnv1a(json).toString(16).padStart(8, '0');
        entities.set(uuid, entityHash);
        combined = fnv1a(`${uuid}=${entityHash};`, combined);
    }
    return { hash: combined.toString(16).padStart(8, '0'), entities };
}

/**
 * Describes how two world hashes differ: which entities are missing
 * from one side or have different state. Empty if they match.
 */
export function diffWorldHashes(a: WorldHash, b: WorldHash): string[] {
    const differences: string[] = [];
    for (const [uuid, hash] of a.entities) {
        const other = b.entities.get(uuid);
        if (other === undefined) {
            differences.push(`${uuid}: only in first world`);
        } else if (other !== hash) {
            differences.push(`${uuid}: state differs (${hash} vs ${other})`);
        }
    }
    for (const uuid of b.entities.keys()) {
        if (!a.entities.has(uuid)) {
            differences.push(`${uuid}: only in second world`);
        }
    }
    return differences;
}
