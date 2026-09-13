import { Serializer, SerializerResource } from 'nova_ecs/plugins/serializer_plugin';
import { Random, RandomResource } from 'nova_ecs/plugins/random_plugin';
import { TimeResource } from 'nova_ecs/plugins/time_plugin';
import { World } from 'nova_ecs/world';
import { MultiplayerData, MultiplayerDataType } from 'nova_ecs/plugins/multiplayer_plugin';
import { MissileGuidanceResource } from '../nova_plugin/combat/index.js';
import { ControlledByComponent, ControlledByType } from '../nova_plugin/player/index.js';
import {
    IdFactory, IdFactoryResource, SimulationGameDataResource, SystemIdResource,
} from '../nova_plugin/core/index.js';
import { SystemPlugin } from '../nova_plugin/system_plugin.js';

/**
 * ============================================================================
 * The world-independent component registry for the wire schema
 * ============================================================================
 *
 * The socket schema (wire_schemas.ts) is derived before any world
 * exists, and the component lists inside it — a catchUp baseline's or
 * a desync dump's wire snapshot, an addEntity record's entity — need a
 * serializer to be typed by: without one every component's data rode
 * the binary wire as an opaque self-describing blob (io_ts_to_avro's
 * dynamic encoding), name string and all, behind the toJsonSafe
 * sentinels of the JSON-safe capture form.
 *
 * This module is that world-independence. `buildRegistryWorld` builds
 * a bare world — stub game data, no entities, nothing stepped — and
 * runs the full simulation plugin set on it, which registers every
 * component codec the simulation ever registers, with ZERO duplication
 * of the codecs themselves: the registry IS the real registrations. Two
 * registrations happen outside the plugin set's synchronous build
 * (ControlledBy, in ship_controller_plugin after its internal await;
 * MultiplayerData, in makeSystem after the plugin set), so they are
 * repeated here explicitly.
 *
 * A spec pins the registry against a real stepped world, so a future
 * registration cannot be missed.
 */

/**
 * A bare world that has run the whole simulation plugin set, for its
 * serializer registrations alone. Nothing is stepped and no entity is
 * inserted; the stub resources satisfy the plugin builds' resource
 * checks (addSystem validates that every queried resource exists).
 *
 * Built SYNCHRONOUSLY: SystemPlugin adds the domain plugins without
 * awaiting them, and each build body runs to its first await inside
 * `addPlugin` — the registrations all happen in that synchronous
 * prefix, except the two repeated below.
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
    void world.addPlugin(SystemPlugin);
    const serializer = world.resources.get(SerializerResource)!;
    // Registered by ship_controller_plugin AFTER its internal await, so
    // the synchronous prefix does not carry it.
    serializer.addComponent(ControlledByComponent, ControlledByType);
    // Registered by makeSystem after the plugin set (every simulation
    // world carries it).
    serializer.addComponent(MultiplayerData, MultiplayerDataType);
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
        for (const [, component] of source.componentsByName) {
            const type = source.componentTypes.get(component);
            if (type) {
                serializer.addComponent(component, type);
            }
        }
        registrySerializer = serializer;
    }
    return registrySerializer;
}
