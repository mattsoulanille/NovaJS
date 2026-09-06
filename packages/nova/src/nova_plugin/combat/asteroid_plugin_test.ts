import 'jasmine';
import { getDefaultAsteroidData } from 'novadatainterface/asteroid_data';
import { getDefaultOutfitData } from 'novadatainterface/outfit_data';
import { getDefaultProjectileWeaponData } from 'novadatainterface/weapon_data';
import { Angle } from 'nova_ecs/datatypes/angle';
import { Position } from 'nova_ecs/datatypes/position';
import { Vector } from 'nova_ecs/datatypes/vector';
import { Entity } from 'nova_ecs/entity';
import { MovementStateComponent } from 'nova_ecs/plugins/movement_plugin';
import { Random, RandomResource } from 'nova_ecs/plugins/random_plugin';
import { TimePlugin, useFixedTimestep } from 'nova_ecs/plugins/time_plugin';
import { World } from 'nova_ecs/world';
import {
    ASTEROID_FIELD_HALF_SIZE,
    AsteroidComponent,
    AsteroidDataComponent,
    AsteroidFieldComponent,
    AsteroidPlugin,
    DebrisComponent,
    MAX_ASTEROID_SPEED,
    spawnAsteroids,
} from './asteroid_plugin.js';
import { TumbleAnimationComponent } from '../core/animation_plugin.js';
import { CargoComponent } from '../ship/cargo_plugin.js';
import { BlastDamageComponent } from '../ship/blast_data.js';
import { CollisionEvent } from '../core/collision_interaction.js';
import { DamagedEvent } from '../ship/death_plugin.js';
import { SimulationGameDataResource } from '../core/game_data_resource.js';
import { IdFactory, IdFactoryResource } from '../core/id_factory.js';
import { OutfitsStateComponent } from '../ship/outfit_plugin.js';
import { ProjectileDataComponent } from '../core/projectile_data.js';
import { getDefaultShipData } from 'novadatainterface/ship_data';
import { ShipPhysicsComponent } from '../ship/ship_plugin.js';

function stubGettable<T>(items: Record<string, T>) {
    return {
        get: async (id: string): Promise<T> => {
            if (!(id in items)) {
                throw new Error(`missing ${id}`);
            }
            return items[id];
        },
        getCached: (id: string): T | undefined => items[id],
    };
}

const BIG_ROID = {
    ...getDefaultAsteroidData(),
    id: 'test:big',
    name: 'Big Test Rock',
    strength: 100,
    yieldType: 'cargo:4',
    yieldQuantity: 8,
    debrisAnimation: getDefaultAsteroidData().animation,
    fragments: ['test:small'],
    fragmentCount: 2,
    mass: 300,
};

const SMALL_ROID = {
    ...getDefaultAsteroidData(),
    id: 'test:small',
    name: 'Small Test Rock',
    strength: 40,
    yieldType: null,
    yieldQuantity: 0,
    fragments: [],
    fragmentCount: 0,
    mass: 100,
};

function stubGameData(outfits: Record<
    string, ReturnType<typeof getDefaultOutfitData>> = {}) {
    return {
        data: {
            Asteroid: stubGettable({
                'test:big': BIG_ROID,
                'test:small': SMALL_ROID,
            }),
            SpriteSheet: stubGettable({}),
            Outfit: stubGettable(outfits),
        },
        // Only the pieces the asteroid systems touch.
    } as never;
}

async function makeAsteroidWorld(seed: number, outfits: Record<
    string, ReturnType<typeof getDefaultOutfitData>> = {}) {
    const world = new World('asteroid-test');
    await world.addPlugin(TimePlugin);
    useFixedTimestep(world, 1000 / 60);
    world.resources.set(RandomResource, new Random(seed));
    world.resources.set(IdFactoryResource, new IdFactory());
    world.resources.set(SimulationGameDataResource, stubGameData(outfits));
    await world.addPlugin(AsteroidPlugin);
    return world;
}

function asteroidEntities(world: World) {
    return [...world.entities]
        .filter(([, entity]) => entity.components.has(AsteroidComponent));
}

function debrisEntities(world: World) {
    return [...world.entities]
        .filter(([, entity]) => entity.components.has(DebrisComponent));
}

/** [uuid, röid id, x, y] for every asteroid, for field comparison. */
function fieldFingerprint(world: World) {
    return asteroidEntities(world).map(([uuid, entity]) => {
        const asteroid = entity.components.get(AsteroidComponent)!;
        const movement = entity.components.get(MovementStateComponent)!;
        const tumble = entity.components.get(TumbleAnimationComponent);
        return [uuid, asteroid.id, movement.position.x, movement.position.y,
            movement.velocity.x, movement.velocity.y,
            tumble?.frameRate, tumble?.phase];
    });
}

const TEST_SYSTEM = {
    asteroids: 2,
    asteroidTypes: ['test:big', 'test:small'],
};

describe('spawnAsteroids', () => {
    it('spawns the same field for the same seed', async () => {
        const worldA = await makeAsteroidWorld(1234);
        const worldB = await makeAsteroidWorld(1234);
        await spawnAsteroids(worldA, TEST_SYSTEM);
        await spawnAsteroids(worldB, TEST_SYSTEM);

        const fieldA = fieldFingerprint(worldA);
        expect(fieldA.length).toBeGreaterThan(0);
        expect(fieldA).toEqual(fieldFingerprint(worldB));
        // And stays identical as both worlds step.
        for (let i = 0; i < 60; i++) {
            worldA.step();
            worldB.step();
        }
        expect(fieldFingerprint(worldA)).toEqual(fieldFingerprint(worldB));
    });

    it('spawns a different field for a different seed', async () => {
        const worldA = await makeAsteroidWorld(1234);
        const worldB = await makeAsteroidWorld(4321);
        await spawnAsteroids(worldA, TEST_SYSTEM);
        await spawnAsteroids(worldB, TEST_SYSTEM);
        expect(fieldFingerprint(worldA))
            .not.toEqual(fieldFingerprint(worldB));
    });

    it('spawns nothing when the system has no asteroids', async () => {
        const world = await makeAsteroidWorld(1);
        await spawnAsteroids(world, { asteroids: 0, asteroidTypes: [] });
        expect(asteroidEntities(world).length).toBe(0);
        expect(world.entities.has('asteroid field')).toBeFalse();
    });

    it('spawns only the system\'s configured types, inside the field', async () => {
        const world = await makeAsteroidWorld(7);
        await spawnAsteroids(world, TEST_SYSTEM);
        for (const [, entity] of asteroidEntities(world)) {
            const asteroid = entity.components.get(AsteroidComponent)!;
            expect(['test:big', 'test:small']).toContain(asteroid.id);
            const { position } = entity.components.get(MovementStateComponent)!;
            expect(Math.abs(position.x))
                .toBeLessThanOrEqual(ASTEROID_FIELD_HALF_SIZE);
            expect(Math.abs(position.y))
                .toBeLessThanOrEqual(ASTEROID_FIELD_HALF_SIZE);
        }
        const field = world.entities.get('asteroid field')!
            .components.get(AsteroidFieldComponent)!;
        expect(field.targetCount).toBe(asteroidEntities(world).length);
    });
});

describe('AsteroidDamageSystem', () => {
    /** A world with a single big asteroid and a damager projectile. */
    async function makeBreakupWorld(seed: number, asteroidMiner = false) {
        const world = await makeAsteroidWorld(seed);
        const gameData = world.resources
            .get(SimulationGameDataResource)! as never as
            { data: { Asteroid: { get(id: string): Promise<unknown> } } };
        await gameData.data.Asteroid.get('test:big');
        await gameData.data.Asteroid.get('test:small');

        const asteroid = new Entity('rock')
            .addComponent(AsteroidComponent,
                { id: 'test:big', health: BIG_ROID.strength })
            .addComponent(AsteroidDataComponent, BIG_ROID)
            .addComponent(MovementStateComponent, {
                position: new Position(10, 20),
                velocity: new Vector(0, 0),
                rotation: new Angle(0),
                accelerating: 0, turning: 0, turnBack: false,
            });
        world.entities.set('rock', asteroid);

        const projectile = new Entity('shot')
            .addComponent(ProjectileDataComponent, {
                ...getDefaultProjectileWeaponData(),
                asteroidMiner,
            })
            .addComponent(MovementStateComponent, {
                position: new Position(0, 0),
                velocity: new Vector(0, 0),
                rotation: new Angle(0),
                accelerating: 0, turning: 0, turnBack: false,
            });
        world.entities.set('shot', projectile);
        return world;
    }

    function hit(world: World, armor: number, shield = 0) {
        world.emit(DamagedEvent, {
            damage: {
                armor, shield, ionization: 0, ionizationColor: 0,
                passThroughShield: 0, knockback: 0,
            },
            damager: 'shot',
        }, ['rock']);
        world.step();
    }

    /**
     * Fires a knockback-only DamagedEvent at the rock. Non-blast
     * knockback pushes along the damager's rotation, so `direction`
     * aims the shove.
     */
    function knock(world: World, knockback: number, direction = new Angle(1)) {
        const shot = world.entities.get('shot')!
            .components.get(MovementStateComponent)!;
        shot.rotation = direction;
        world.emit(DamagedEvent, {
            damage: {
                armor: 0, shield: 0, ionization: 0, ionizationColor: 0,
                passThroughShield: 0, knockback,
            },
            damager: 'shot',
        }, ['rock']);
        world.step();
    }

    /**
     * Fires a knockback-only DamagedEvent at the rock from a *blast*
     * entity placed at `position`. Blast knockback is radial — along
     * the rock's position minus the blast's — so `position` aims the
     * shove and `rotation` is deliberately misleading: it must not
     * affect the result.
     */
    function boom(world: World, knockback: number, position: Position,
        rotation = new Angle(Math.PI / 2)) {
        const damage = {
            armor: 0, shield: 0, ionization: 0, ionizationColor: 0,
            passThroughShield: 0, knockback,
        };
        world.entities.set('blast', new Entity('blast')
            .addComponent(BlastDamageComponent, damage)
            .addComponent(MovementStateComponent, {
                position, velocity: new Vector(0, 0), rotation,
                accelerating: 0, turning: 0, turnBack: false,
            }));
        world.emit(DamagedEvent, { damage, damager: 'blast' }, ['rock']);
        world.step();
    }

    function rockVelocity(world: World) {
        return Vector.fromVectorLike(world.entities.get('rock')!
            .components.get(MovementStateComponent)!.velocity);
    }

    it('applies mass (armor) damage against the röid strength', async () => {
        const world = await makeBreakupWorld(5);
        hit(world, 30);
        const asteroid = world.entities.get('rock')!
            .components.get(AsteroidComponent)!;
        expect(asteroid.health).toBe(70);
        // Shield damage does not hurt asteroids.
        hit(world, 0, 500);
        expect(asteroid.health).toBe(70);
        expect(world.entities.has('rock')).toBeTrue();
    });

    it('applies 10x damage for asteroid-miner weapons', async () => {
        const world = await makeBreakupWorld(5, true);
        hit(world, 5);
        const asteroid = world.entities.get('rock')!
            .components.get(AsteroidComponent)!;
        expect(asteroid.health).toBe(50); // 5 * 10
    });

    it('breaks into fragments and debris with Bible-range yields', async () => {
        const world = await makeBreakupWorld(5);
        hit(world, BIG_ROID.strength);
        expect(world.entities.has('rock')).toBeFalse();

        // Sub-asteroids: fragmentCount 2, +/-50% -> 1 to 3, all small.
        const fragments = asteroidEntities(world);
        expect(fragments.length).toBeGreaterThanOrEqual(1);
        expect(fragments.length).toBeLessThanOrEqual(3);
        for (const [, entity] of fragments) {
            const asteroid = entity.components.get(AsteroidComponent)!;
            expect(asteroid.id).toBe('test:small');
            expect(asteroid.health).toBe(SMALL_ROID.strength);
        }

        // Resource-boxes: yieldQuantity 8, +/-50% -> 4 to 12, all
        // carrying the röid's yield commodity.
        const debris = debrisEntities(world);
        expect(debris.length).toBeGreaterThanOrEqual(4);
        expect(debris.length).toBeLessThanOrEqual(12);
        for (const [, entity] of debris) {
            expect(entity.components.get(DebrisComponent)!.commodity)
                .toBe('cargo:4');
        }
    });

    it('produces identical breakup for identical seeds', async () => {
        const outcome = async () => {
            const world = await makeBreakupWorld(99);
            hit(world, BIG_ROID.strength);
            return {
                fragments: fieldFingerprint(world),
                debris: debrisEntities(world).map(([uuid, entity]) => [
                    uuid,
                    entity.components.get(DebrisComponent)!.commodity,
                    entity.components.get(MovementStateComponent)!.position.x,
                    entity.components.get(MovementStateComponent)!.position.y,
                ]),
            };
        };
        expect(await outcome()).toEqual(await outcome());
    });

    it('debris expires after its lifetime', async () => {
        const world = await makeBreakupWorld(5);
        hit(world, BIG_ROID.strength);
        expect(debrisEntities(world).length).toBeGreaterThan(0);
        // 15s lifetime at 60Hz.
        for (let i = 0; i < 15 * 60 + 2; i++) {
            world.step();
        }
        expect(debrisEntities(world).length).toBe(0);
    });

    it('caps a huge knockback impulse, preserving its direction', async () => {
        const world = await makeBreakupWorld(5);
        const direction = new Angle(1);
        // impact 1e6 on a mass-300 röid: 1e6 * 5 / 300 ~ 16667 px/s.
        knock(world, 1e6, direction);

        const velocity = rockVelocity(world);
        expect(velocity.length).toBeCloseTo(MAX_ASTEROID_SPEED, 9);
        const expected = direction.getUnitVector().scale(MAX_ASTEROID_SPEED);
        expect(velocity.x).toBeCloseTo(expected.x, 9);
        expect(velocity.y).toBeCloseTo(expected.y, 9);
    });

    it('stays at the cap however many impulses land', async () => {
        const world = await makeBreakupWorld(5);
        for (let i = 0; i < 200; i++) {
            // Shoved from slightly different angles, as a real fight
            // would; nothing bleeds the accumulated speed off between
            // hits, which is what made asteroids run away.
            knock(world, 20_000, new Angle(1 + (i % 3) * 0.1));
            expect(rockVelocity(world).length)
                .toBeLessThanOrEqual(MAX_ASTEROID_SPEED + 1e-9);
        }
        expect(rockVelocity(world).length).toBeCloseTo(MAX_ASTEROID_SPEED, 9);
    });

    it('leaves ordinary knockback alone', async () => {
        const world = await makeBreakupWorld(5);
        // A Hellhound Missile's impact (100) against the Big Test Rock
        // (mass 300) is 100 * 5 / 300 px/s, nowhere near the cap.
        knock(world, 100);
        expect(rockVelocity(world).length).toBeCloseTo(100 * 5 / 300, 9);
    });

    it('shoves the rock radially away from a blast', async () => {
        const world = await makeBreakupWorld(5);
        // The rock is at (10, 20). Put the blast 100 px due north of it
        // (screen coords: north is -y) and point it *east*, so a shove
        // along the blast's facing would be plainly visible. Radially
        // outward from the blast is due south.
        boom(world, 100, new Position(10, -80), new Angle(Math.PI / 2));

        const velocity = rockVelocity(world);
        const speed = 100 * 5 / 300; // impact 100 on a mass-300 röid.
        expect(velocity.x).toBeCloseTo(0, 9);
        expect(velocity.y).toBeCloseTo(speed, 9);
    });

    it('ignores the blast entity\'s rotation entirely', async () => {
        // The same blast, aimed four different ways, must shove the
        // rock identically.
        const shove = async (rotation: Angle) => {
            const world = await makeBreakupWorld(5);
            boom(world, 100, new Position(10, -80), rotation);
            return rockVelocity(world);
        };
        const expected = await shove(new Angle(0));
        for (const angle of [1, 2, 3]) {
            const velocity = await shove(new Angle(angle));
            expect(velocity.x).toBeCloseTo(expected.x, 12);
            expect(velocity.y).toBeCloseTo(expected.y, 12);
        }
    });

    it('still caps a huge blast impulse', async () => {
        const world = await makeBreakupWorld(5);
        boom(world, 1e6, new Position(10, -80));
        const velocity = rockVelocity(world);
        expect(velocity.length).toBeCloseTo(MAX_ASTEROID_SPEED, 9);
        expect(velocity.x).toBeCloseTo(0, 9);
        expect(velocity.y).toBeCloseTo(MAX_ASTEROID_SPEED, 9);
    });

    it('pushes along the damager\'s facing for a non-blast hit', async () => {
        const world = await makeBreakupWorld(5);
        // The shot is at the origin and the rock at (10, 20), so a
        // radial shove would head down and to the right; a projectile
        // instead pushes along its own facing, here due east.
        knock(world, 100, new Angle(Math.PI / 2));

        const velocity = rockVelocity(world);
        const speed = 100 * 5 / 300;
        expect(velocity.x).toBeCloseTo(speed, 9);
        expect(velocity.y).toBeCloseTo(0, 9);
    });

    it('gives no impulse for a blast exactly on the rock', async () => {
        const world = await makeBreakupWorld(5);
        // Zero distance has no direction to normalize; the rock must
        // come out untouched rather than with a NaN velocity.
        boom(world, 100, new Position(10, 20));

        const velocity = rockVelocity(world);
        expect(Number.isNaN(velocity.x)).toBeFalse();
        expect(Number.isNaN(velocity.y)).toBeFalse();
        expect(velocity.x).toBe(0);
        expect(velocity.y).toBe(0);
    });

    it('caps fragments that inherit a fast parent velocity', async () => {
        const world = await makeBreakupWorld(5);
        const movement = world.entities.get('rock')!
            .components.get(MovementStateComponent)!;
        // A parent already at the cap; fragments add an ejection speed
        // on top of the inherited velocity.
        movement.velocity = new Angle(1).getUnitVector()
            .scale(MAX_ASTEROID_SPEED);
        hit(world, BIG_ROID.strength);

        const fragments = asteroidEntities(world);
        expect(fragments.length).toBeGreaterThan(0);
        for (const [, entity] of fragments) {
            const velocity = Vector.fromVectorLike(entity.components
                .get(MovementStateComponent)!.velocity);
            expect(velocity.length)
                .toBeLessThanOrEqual(MAX_ASTEROID_SPEED + 1e-9);
        }
    });
});

describe('ScoopSystem', () => {
    const scoopOutfit = { ...getDefaultOutfitData(), miningScoop: true };
    const plainOutfit = { ...getDefaultOutfitData(), miningScoop: false };

    function makeScoopShip(outfitId: string, freeCargo: number,
        cargo: Map<string, number> = new Map()) {
        return new Entity('scooper')
            .addComponent(CargoComponent, cargo)
            .addComponent(OutfitsStateComponent,
                new Map([[outfitId, { count: 1 }]]))
            .addComponent(ShipPhysicsComponent, {
                ...getDefaultShipData().physics,
                freeCargo,
            });
    }

    function makeDebrisEntity(commodity: string) {
        return new Entity('box')
            .addComponent(DebrisComponent,
                { commodity, expires: 1e12 })
            .addComponent(MovementStateComponent, {
                position: new Position(0, 0),
                velocity: new Vector(0, 0),
                rotation: new Angle(0),
                accelerating: 0, turning: 0, turnBack: false,
            });
    }

    async function scoopWorld(outfits: Record<
        string, ReturnType<typeof getDefaultOutfitData>>) {
        const world = await makeAsteroidWorld(3, outfits);
        // Warm the outfit cache like loadShipGameData would.
        const gameData = world.resources
            .get(SimulationGameDataResource)! as never as
            { data: { Outfit: { get(id: string): Promise<unknown> } } };
        for (const id of Object.keys(outfits)) {
            await gameData.data.Outfit.get(id);
        }
        return world;
    }

    function collide(world: World) {
        world.emit(CollisionEvent,
            { other: 'box', initiator: false }, ['scooper']);
        world.step();
    }

    it('scoops debris into cargo with a mining scoop and space', async () => {
        const world = await scoopWorld({ scoop: scoopOutfit });
        world.entities.set('scooper', makeScoopShip('scoop', 10));
        world.entities.set('box', makeDebrisEntity('cargo:4'));
        collide(world);
        expect(world.entities.has('box')).toBeFalse();
        const cargo = world.entities.get('scooper')!
            .components.get(CargoComponent)!;
        expect(cargo.get('cargo:4')).toBe(1);
    });

    it('accumulates scooped commodities by type', async () => {
        const world = await scoopWorld({ scoop: scoopOutfit });
        world.entities.set('scooper',
            makeScoopShip('scoop', 10, new Map([['cargo:4', 3]])));
        world.entities.set('box', makeDebrisEntity('cargo:4'));
        collide(world);
        const cargo = world.entities.get('scooper')!
            .components.get(CargoComponent)!;
        expect(cargo.get('cargo:4')).toBe(4);
    });

    it('does not scoop without a mining scoop outfit', async () => {
        const world = await scoopWorld({ plain: plainOutfit });
        world.entities.set('scooper', makeScoopShip('plain', 10));
        world.entities.set('box', makeDebrisEntity('cargo:4'));
        collide(world);
        expect(world.entities.has('box')).toBeTrue();
        expect(world.entities.get('scooper')!
            .components.get(CargoComponent)!.size).toBe(0);
    });

    it('does not scoop past the ship\'s cargo capacity', async () => {
        const world = await scoopWorld({ scoop: scoopOutfit });
        world.entities.set('scooper',
            makeScoopShip('scoop', 5, new Map([['junk:x', 5]])));
        world.entities.set('box', makeDebrisEntity('cargo:4'));
        collide(world);
        expect(world.entities.has('box')).toBeTrue();
        const cargo = world.entities.get('scooper')!
            .components.get(CargoComponent)!;
        expect(cargo.get('cargo:4')).toBeUndefined();
        expect(cargo.get('junk:x')).toBe(5);
    });
});
