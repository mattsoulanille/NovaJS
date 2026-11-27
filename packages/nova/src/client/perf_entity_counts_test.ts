import 'jasmine';
import { Component } from 'nova_ecs/component';
import { Entity } from 'nova_ecs/entity';
import { MovementStateComponent } from 'nova_ecs/plugins/movement_plugin';
import { World } from 'nova_ecs/world';
import { ENTITY_COUNT_KEYS, EntityCounts } from '../common/perf_stats.js';
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
import {
    countDisplayEntities, ON_SCREEN_MARGIN, particlesSpawnedTotal, ViewBox,
} from './perf_entity_counts.js';

function read(out: Float64Array): EntityCounts {
    return Object.fromEntries(ENTITY_COUNT_KEYS.map((key, i) =>
        [key, out[i]])) as EntityCounts;
}

describe('countDisplayEntities', () => {
    let world: World;
    const box: ViewBox = { left: 0, right: 0, top: 0, bottom: 0 };
    const out = new Float64Array(ENTITY_COUNT_KEYS.length);

    function add(component: Component<any> | undefined, x: number, y: number,
        also?: Component<any>) {
        const entity = new Entity();
        if (component) {
            entity.components.set(component, {} as never);
        }
        if (also) {
            entity.components.set(also, {} as never);
        }
        entity.components.set(MovementStateComponent, {
            position: { x, y },
        } as never);
        world.entities.set(`e${world.entities.size}-${x}-${y}`, entity);
    }

    beforeEach(() => {
        world = new World('perf counts');
        // An 800x600 world view, no status bar: the camera centre is
        // (400, 300), so the focus sees x in [-400, 400], y in [-300, 300].
        world.resources.set(WorldScreenSize, { x: 800, y: 600 });
        world.resources.set(DisplayScaleResource,
            { ui: 1, global: 1 } as never);
        world.resources.set(CameraFocus, { x: 1000, y: 1000 });
    });

    it('classifies ships, beams, projectiles, explosions, asteroids, planets',
        () => {
            const baseline = read(countDisplayEntities(world, out, box))
                .entities;
            add(ShipComponent, 1000, 1000);
            add(ShipComponent, 1100, 1000);
            // A beam is a projectile too; it counts as a beam only.
            add(ProjectileComponent, 1000, 1000, BeamStateComponent);
            add(ProjectileComponent, 1000, 1000);
            add(ProjectileComponent, 1000, 1000);
            add(ExplosionDataComponent, 1000, 1000);
            add(AsteroidComponent, 1000, 1000);
            add(PlanetComponent, 1000, 1000);
            add(undefined, 1000, 1000);
            const counts = read(countDisplayEntities(world, out, box));
            expect(counts.ships).toBe(2);
            expect(counts.beams).toBe(1);
            expect(counts.projectiles).toBe(2);
            expect(counts.explosions).toBe(1);
            expect(counts.asteroids).toBe(1);
            expect(counts.planets).toBe(1);
            expect(counts.entities).toBe(baseline + 9);
        });

    it('counts proximity-fused projectiles as missiles too', () => {
        const fused = (proxRadius: number) => {
            const entity = new Entity();
            entity.components.set(ProjectileComponent, {} as never);
            entity.components.set(ProjectileDataComponent,
                { proxRadius } as never);
            entity.components.set(MovementStateComponent,
                { position: { x: 0, y: 0 } } as never);
            world.entities.set(`p${world.entities.size}`, entity);
        };
        fused(20);
        fused(5);
        fused(0);
        add(ProjectileComponent, 0, 0);
        const counts = read(countDisplayEntities(world, out, box));
        expect(counts.projectiles).toBe(4);
        expect(counts.missiles).toBe(2);
    });

    it('counts on screen within the view plus a margin', () => {
        add(ShipComponent, 1000 + 400 + ON_SCREEN_MARGIN - 1, 1000);
        add(ShipComponent, 1000 - 400 - ON_SCREEN_MARGIN - 1, 1000);
        add(ProjectileComponent, 1000, 1000 + 300 + ON_SCREEN_MARGIN);
        add(ProjectileComponent, 1000, 1000 - 300 - ON_SCREEN_MARGIN - 50);
        add(AsteroidComponent, 5000, 5000);
        const counts = read(countDisplayEntities(world, out, box));
        expect(counts.ships).toBe(2);
        expect(counts.onScreenShips).toBe(1);
        expect(counts.projectiles).toBe(2);
        expect(counts.onScreenProjectiles).toBe(1);
        expect(counts.asteroids).toBe(1);
        expect(counts.onScreenAsteroids).toBe(0);
        expect(counts.onScreenEntities).toBe(2);
    });

    it('shifts the view for the status bar like the camera does', () => {
        // A 200-wide status bar moves the centre to x 300: the view sees
        // x in [-300, 500] around the focus.
        world.resources.set(StatusBarResource, { width: 200 } as never);
        add(ShipComponent, 1000 + 500 + ON_SCREEN_MARGIN - 1, 1000);
        add(ShipComponent, 1000 - 300 - ON_SCREEN_MARGIN - 1, 1000);
        const counts = read(countDisplayEntities(world, out, box));
        expect(counts.onScreenShips).toBe(1);
    });

    it('counts nothing on screen without a camera', () => {
        world.resources.delete(CameraFocus);
        add(ShipComponent, 1000, 1000);
        const counts = read(countDisplayEntities(world, out, box));
        expect(counts.ships).toBe(1);
        expect(counts.onScreenEntities).toBe(0);
    });

    it('reads the GPU particles when the world has them', () => {
        expect(particlesSpawnedTotal(world)).toBeUndefined();
        world.resources.set(ParticleSystemResource, {
            stats: () => ({ drawnInstances: 512, totalSpawned: 9000 }),
        } as never);
        expect(read(countDisplayEntities(world, out, box)).particles)
            .toBe(512);
        expect(particlesSpawnedTotal(world)).toBe(9000);
    });
});
