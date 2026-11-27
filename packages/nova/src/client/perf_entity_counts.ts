/**
 * What is in the display world, for the performance telemetry
 * (client/perf_telemetry.ts): ships, projectiles, beams, explosions,
 * asteroids, planets and every entity, in the system and on screen, the
 * proximity-fused missiles among the projectiles, plus
 * the GPU particles alive.
 *
 * A READ of the display world, a few times a second (not per frame): one
 * pass over its entities with component lookups, written into a reused
 * array in ENTITY_COUNT_KEYS order. Nothing is written to the world.
 */
import { MovementStateComponent } from 'nova_ecs/plugins/movement_plugin';
import type { World } from 'nova_ecs/world';
import { ENTITY_COUNT_KEYS, EntityCounts } from '../common/perf_stats.js';
import { cameraCentre } from '../display/display_plugin.js';
import { ParticleSystemResource } from '../display/particles_plugin.js';
import {
    DisplayScaleResource, WorldScreenSize,
} from '../display/screen_size_plugin.js';
import { CameraFocus } from '../display/space_resource.js';
import { StatusBarResource } from '../display/status_bar_resource.js';
import { BeamStateComponent } from '../nova_plugin/combat/beam_plugin.js';
import {
    AsteroidComponent, ExplosionDataComponent, ProjectileComponent,
    ProjectileDataComponent,
} from '../nova_plugin/core/index.js';
import { ShipComponent } from '../nova_plugin/ship/ship_plugin.js';
import { PlanetComponent } from '../nova_plugin/travel/planet_plugin.js';

/** How far past the view's edge (world units) still counts as on
 * screen: about half the biggest sprites, so a capital ship whose centre
 * has just left the view, but whose hull still shows, is counted. */
export const ON_SCREEN_MARGIN = 128;

const I = Object.fromEntries(ENTITY_COUNT_KEYS.map((key, i) => [key, i])) as
    Record<keyof EntityCounts, number>;

/** The view's extent around the camera focus, world units. */
export interface ViewBox {
    left: number;
    right: number;
    top: number;
    bottom: number;
}

/**
 * The part of the world the view shows, relative to the camera focus
 * (the player ship): the WORLD-logical screen less the status bar, laid
 * out as CenterShipSystem lays it out (display_plugin.ts cameraCentre).
 * Written into `out`. Undefined when the world has no camera yet.
 */
export function viewBox(world: World, out: ViewBox): ViewBox | undefined {
    const screen = world.resources.get(WorldScreenSize);
    if (!screen) {
        return undefined;
    }
    const scale = world.resources.get(DisplayScaleResource);
    const statusBar = world.resources.get(StatusBarResource);
    const centre = cameraCentre(screen, statusBar?.width ?? 0,
        scale?.ui ?? 1);
    out.left = -centre.x - ON_SCREEN_MARGIN;
    out.right = screen.x - centre.x + ON_SCREEN_MARGIN;
    out.top = -centre.y - ON_SCREEN_MARGIN;
    out.bottom = screen.y - centre.y + ON_SCREEN_MARGIN;
    return out;
}

/**
 * Counts the display world into `out` (ENTITY_COUNT_KEYS order) and
 * returns it. A beam is counted as a beam, not also as a projectile.
 */
export function countDisplayEntities(world: World,
    out: Float64Array, box: ViewBox): Float64Array {
    out.fill(0);
    const focus = world.resources.get(CameraFocus);
    const view = focus ? viewBox(world, box) : undefined;
    for (const entity of world.entities.values()) {
        const components = entity.components;
        let kind = -1;
        let onScreenKind = -1;
        if (components.has(ShipComponent)) {
            kind = I.ships;
            onScreenKind = I.onScreenShips;
        } else if (components.has(BeamStateComponent)) {
            kind = I.beams;
            onScreenKind = I.onScreenBeams;
        } else if (components.has(ProjectileComponent)) {
            kind = I.projectiles;
            onScreenKind = I.onScreenProjectiles;
            // Proximity-fused: what the simulation's fuse system scans
            // every collidable for, every tick.
            if ((components.get(ProjectileDataComponent)?.proxRadius ?? 0)
                > 0) {
                out[I.missiles]++;
            }
        } else if (components.has(ExplosionDataComponent)) {
            kind = I.explosions;
            onScreenKind = I.onScreenExplosions;
        } else if (components.has(AsteroidComponent)) {
            kind = I.asteroids;
            onScreenKind = I.onScreenAsteroids;
        } else if (components.has(PlanetComponent)) {
            kind = I.planets;
        }
        out[I.entities]++;
        if (kind >= 0) {
            out[kind]++;
        }
        if (!view || !focus) {
            continue;
        }
        const movement = components.get(MovementStateComponent);
        if (!movement) {
            continue;
        }
        const dx = movement.position.x - focus.x;
        const dy = movement.position.y - focus.y;
        if (dx >= view.left && dx <= view.right
            && dy >= view.top && dy <= view.bottom) {
            out[I.onScreenEntities]++;
            if (onScreenKind >= 0) {
                out[onScreenKind]++;
            }
        }
    }
    const particles = world.resources.get(ParticleSystemResource);
    if (particles) {
        out[I.particles] = particles.stats().drawnInstances;
    }
    return out;
}

/** The GPU particle system's lifetime spawn count, if the world has one
 * (the telemetry reports the difference per window). */
export function particlesSpawnedTotal(world: World): number | undefined {
    return world.resources.get(ParticleSystemResource)?.stats().totalSpawned;
}
