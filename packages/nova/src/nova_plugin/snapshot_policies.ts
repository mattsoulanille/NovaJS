import { Comms } from "nova_ecs/plugins/multiplayer_plugin";
import { RandomResource } from "nova_ecs/plugins/random_plugin";
import { SnapshotPolicies, SnapshotPoliciesResource } from "nova_ecs/plugins/snapshot_plugin";
import { TimeResource } from "nova_ecs/plugins/time_plugin";
import { DefaultMap } from "nova_ecs/utils";
import { World } from "nova_ecs/world";
import { AnimationComponent, ExplosionDataComponent } from "./animation_plugin.js";
import { AsteroidDataComponent } from "./asteroid_plugin.js";
import { BlastDamageComponent, BlastIgnoreComponent } from "./blast_data.js";
import { BlastDoneComponent } from "./blast_plugin.js";
import { CloakComponent, CloakScannerComponent } from "./cloak_plugin.js";
import { RepairComponent } from "./disabled_component.js";
import { IffComponent } from "./iff_plugin.js";
import { CollisionHitterComponent, CollisionVulnerabilityComponent } from "./collision_interaction.js";
import { decodeHull, encodeHull, HitboxHullComponent, HurtboxHullComponent } from "./collisions_plugin.js";
import { CreateTime } from "./create_time.js";
import { AnalogControlComponent, ShipControlStateComponent } from "./ship_control.js";
import { ControlState } from "./control_state_event.js";
import { defaultWeaponLocalState, SubCounts, WeaponsComponent } from "./fire_weapon_plugin.js";
import { SourceComponent } from "./weapon_components.js";
import { IdFactoryResource } from "./id_factory.js";
import { PlanetDataComponent } from "./planet_plugin.js";
import { ProjectileBlastHull, ProjectileDataComponent } from "./projectile_data.js";
import { ShipDataComponent } from "./ship_plugin.js";
import { ShipExplosionComponent } from "./ship_explosion.js";
import { BayFighterComponent, ReturnWhenTargetRemovedComponent } from "./bay_plugin.js";
import { ExplodingComponent } from "./death_plugin.js";
import { ChooseRandomTargetComponent, DeathAIComponent, FollowComponent, ShootAllWeaponsComponent } from "./npc_plugin.js";
import { ReturnToQueueComponent } from "./return_to_queue_plugin.js";
import { GuidanceComponent } from "./guidance.js";
import { DecoyTargetComponent, JamSteerComponent } from "./jamming_plugin.js";
import { TargetIndexComponent } from "./target_plugin.js";
import { ShipPhysicsComponent } from "./ship_plugin.js";
import { SingletonComponent } from "nova_ecs/world";

/**
 * A wire codec for data that is already JSON-safe. (The snapshot layer
 * clones around encode and decode, so sharing is fine here.)
 */
function passthroughWire<Data = unknown>() {
    return {
        encode: (data: Data) => data as unknown,
        decode: (encoded: unknown) => encoded as Data,
    };
}

/**
 * Clones a DefaultMap, preserving its default factory.
 */
function cloneDefaultMap<K, V>(map: DefaultMap<K, V>, cloneValue: (v: V) => V) {
    const factory = (map as unknown as { factory: (key: K) => V }).factory;
    const copy = new DefaultMap<K, V>(factory);
    for (const [key, value] of map) {
        copy.set(key, cloneValue(value));
    }
    return copy;
}

/**
 * Registers how each kind of simulation state is captured in rollback
 * snapshots. Serializer-registered components default to a codec
 * roundtrip and are not listed here; this configures the exceptions:
 * - share: immutable static game data and derived structures that are
 *   recomputed every step before use (hulls).
 * - clone: mutable simulation state that is not serializer-registered.
 * - skip: multiplayer machinery, which is not simulation state.
 */
export function configureSnapshotPolicies(world: World) {
    const policies = new SnapshotPolicies();
    world.resources.set(SnapshotPoliciesResource, policies);

    // Immutable static game data: share the reference. (These are
    // serializer-registered, but a codec roundtrip of e.g. full
    // ShipData per snapshot would dominate the cost.)
    policies.set(ShipDataComponent, { policy: 'share' });
    policies.set(PlanetDataComponent, { policy: 'share' });
    policies.set(AsteroidDataComponent, { policy: 'share' });
    policies.set(ProjectileDataComponent, { policy: 'share' });
    policies.set(AnimationComponent, { policy: 'share' });
    policies.set(ExplosionDataComponent, { policy: 'share' });
    policies.set(BlastDamageComponent, { policy: 'share' });
    policies.set(SourceComponent, { policy: 'share' });
    policies.set(CreateTime, { policy: 'share' });

    // Hulls carry per-step scratch state (position, frame), but it is
    // recomputed from movement every step before collisions use it.
    policies.set(HitboxHullComponent, { policy: 'share' });
    policies.set(HurtboxHullComponent, { policy: 'share' });
    policies.set(ProjectileBlastHull, { policy: 'share' });

    // Re-derived from ship data and outfits at restore.
    policies.set(ShipPhysicsComponent, { policy: 'skip' });
    // The cloak CAPABILITY is derived from owned outfits and re-derived
    // at restore by CloakDeriver (like ship physics / weapons), so it is
    // skipped from snapshots. The cloak ACTIVE toggle
    // (CloakActiveComponent) is real sim state and is serializer/delta-
    // registered, so it is handled by the default codec path.
    policies.set(CloakComponent, { policy: 'skip' });
    // The cloak-scanner capability is likewise derived from outfits.
    policies.set(CloakScannerComponent, { policy: 'skip' });
    // The IFF capability is derived from owned outfits and re-derived at
    // restore by IffDeriver, exactly like the cloak capability.
    policies.set(IffComponent, { policy: 'skip' });
    // The ModType 49 repair-system capability is likewise derived from
    // outfits (RepairDeriver). The disabled STATE (DisabledComponent) is
    // real sim state and serializer-registered, so it takes the default
    // codec path.
    policies.set(RepairComponent, { policy: 'skip' });

    // Transient per-frame jam steering: recomputed by
    // MissileJammingSystem before guidance consumes it every tick, so
    // snapshots skip it (see the JamSteerComponent doc). Without a
    // policy a snapshot taken while a missile was mid-jam tripped the
    // unhandled-component check — first seen when the përs spawn roll
    // shifted the PRNG stream under the combat resimulation test.
    policies.set(JamSteerComponent, { policy: 'skip' });
    policies.setWireDerived(JamSteerComponent);

    // Enum-valued; effectively immutable.
    policies.set(GuidanceComponent, { policy: 'share' });
    policies.set(SingletonComponent, { policy: 'share' });
    // Static decoy weight (asteroids); never mutated.
    policies.set(DecoyTargetComponent, { policy: 'share' });

    policies.set(TargetIndexComponent, {
        policy: 'clone',
        clone: data => ({ ...data }),
    });

    // Mutable unregistered simulation state: explicit clones.
    policies.set(WeaponsComponent, {
        policy: 'clone',
        clone: map => cloneDefaultMap(map, state => ({ ...state })),
    });
    policies.set(SubCounts, {
        policy: 'clone',
        clone: map => cloneDefaultMap(map, count => count),
    });
    policies.set(CollisionHitterComponent, {
        policy: 'clone',
        clone: hitter => ({ hitTypes: new Set(hitter.hitTypes) }),
    });
    policies.set(CollisionVulnerabilityComponent, {
        policy: 'clone',
        clone: vulnerability => ({ vulnerableTo: new Set(vulnerability.vulnerableTo) }),
    });
    policies.set(BlastIgnoreComponent, {
        policy: 'clone',
        clone: ignore => new Set(ignore),
    });

    // Value-typed and marker components: sharing is copying.
    policies.set(ExplodingComponent, { policy: 'share' });
    policies.set(FollowComponent, { policy: 'share' });
    policies.set(ShootAllWeaponsComponent, { policy: 'share' });
    policies.set(DeathAIComponent, { policy: 'share' });
    policies.set(ReturnWhenTargetRemovedComponent, { policy: 'share' });
    // The queue reference is shared machinery, not per-entity state.
    policies.set(ReturnToQueueComponent, { policy: 'share' });

    policies.set(ChooseRandomTargetComponent, {
        policy: 'clone',
        clone: data => ({ ...data }),
    });
    // Which bay launched this fighter. Cloned, not shared: it is an
    // object, and the snapshot must not alias the live world's copy.
    policies.set(BayFighterComponent, {
        policy: 'clone',
        clone: data => ({ ...data }),
    });
    policies.set(BlastDoneComponent, {
        policy: 'clone',
        clone: data => ({ ...data }),
    });
    // The exploding hull's mass, on the blast a ship's final explosion
    // drops (ship_explosion_plugin.ts). Cloned, not shared: it is an
    // object, so the snapshot must not alias the live world's copy.
    policies.set(ShipExplosionComponent, {
        policy: 'clone',
        clone: data => ({ ...data }),
    });
    policies.set(ShipControlStateComponent, {
        policy: 'clone',
        clone: state => new Map(state),
    });
    policies.set(AnalogControlComponent, {
        policy: 'clone',
        clone: data => ({ ...data }),
    });

    // Multiplayer machinery is not simulation state.
    policies.set(Comms, { policy: 'skip' });

    // --- Wire snapshots (server archive, late join, desync resync) ---
    // Serializer-registered components cross the wire through their
    // codecs automatically. The rest either get an explicit JSON-safe
    // wire codec here, or are marked wire-derived: the restoring world
    // rebuilds them (per-step scratch recomputed before use, local
    // machinery, or completeEntity-derived data).
    // Hulls cross the wire as resting geometry (see encodeHull).
    const hullWire = {
        encode: encodeHull,
        decode: (encoded: unknown) =>
            decodeHull(encoded as Parameters<typeof decodeHull>[0]),
    };
    policies.setWire(HitboxHullComponent, hullWire);
    policies.setWire(HurtboxHullComponent, hullWire);
    policies.setWire(ProjectileBlastHull, hullWire);
    // The queue is this world's own pool machinery.
    policies.setWireDerived(ReturnToQueueComponent);
    // Static shared röid data; the restoring world re-derives it from
    // AsteroidComponent (see AsteroidDataDeriver).
    policies.setWireDerived(AsteroidDataComponent);
    // The restoring world's singleton already carries its marker.
    policies.setWireDerived(SingletonComponent);

    // Plain JSON-safe values.
    policies.setWire(CreateTime, passthroughWire<number>());
    policies.setWire(SourceComponent, passthroughWire<string>());
    policies.setWire(BlastDamageComponent, passthroughWire());
    policies.setWire(GuidanceComponent, passthroughWire());
    policies.setWire(DecoyTargetComponent, passthroughWire());
    policies.setWire(ExplodingComponent, passthroughWire<number>());
    policies.setWire(TargetIndexComponent, passthroughWire());
    policies.setWire(BlastDoneComponent, passthroughWire());
    // {mass: number} — already JSON.
    policies.setWire(ShipExplosionComponent, passthroughWire());
    // {bayWeaponId: string} — already JSON.
    policies.setWire(BayFighterComponent, passthroughWire());
    policies.setWire(ReturnWhenTargetRemovedComponent, {
        encode: () => null,
        decode: () => undefined,
    });

    policies.setWire(CollisionHitterComponent, {
        encode: hitter => [...hitter.hitTypes],
        decode: encoded => ({ hitTypes: new Set(encoded as unknown[]) }),
    });
    policies.setWire(CollisionVulnerabilityComponent, {
        encode: vulnerability => [...vulnerability.vulnerableTo],
        decode: encoded => ({ vulnerableTo: new Set(encoded as unknown[]) }),
    });
    policies.setWire(BlastIgnoreComponent, {
        encode: ignore => [...ignore],
        decode: encoded => new Set(encoded as string[]),
    });

    policies.setWire(WeaponsComponent, {
        encode: map => [...map],
        decode: encoded => {
            const map = new DefaultMap<string,
                ReturnType<typeof defaultWeaponLocalState>>(
                    defaultWeaponLocalState);
            for (const [id, state] of encoded as [
                string, ReturnType<typeof defaultWeaponLocalState>][]) {
                map.set(id, state);
            }
            return map;
        },
    });
    policies.setWire(SubCounts, {
        encode: map => [...map],
        decode: encoded => {
            const map = new DefaultMap<string, number>(() => 0);
            for (const [id, count] of encoded as [string, number][]) {
                map.set(id, count);
            }
            return map;
        },
    });
    policies.setWire(ShipControlStateComponent, {
        encode: state => [...state],
        decode: encoded => new Map(encoded as never) as ControlState,
    });
    policies.setWire(AnalogControlComponent, passthroughWire());

    // Simulation-state resources.
    const time = world.resources.get(TimeResource);
    if (time) {
        policies.addResource({
            name: 'time',
            save: () => ({ ...time }),
            restore: saved => Object.assign(time, saved),
        });
    }
    const random = world.resources.get(RandomResource);
    if (random) {
        policies.addResource({
            name: 'random',
            save: () => random.getState(),
            restore: saved => random.setState(saved as ReturnType<typeof random.getState>),
        });
    }
    const idFactory = world.resources.get(IdFactoryResource);
    if (idFactory) {
        policies.addResource({
            name: 'idFactory',
            save: () => idFactory.getState(),
            restore: saved => idFactory.setState(saved as number),
        });
    }
}
