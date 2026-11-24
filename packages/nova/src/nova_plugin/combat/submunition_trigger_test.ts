import 'jasmine';
import { getDefaultAnimation, getDefaultAnimationImage } from 'novadatainterface/animation';
import { MockGameData } from 'novadatainterface/mock_game_data';
import { getDefaultShipData, getDefaultShipPhysics, ShipData } from 'novadatainterface/ship_data';
import { ConvexHull, getDefaultSpriteSheetData } from 'novadatainterface/sprite_sheet_data';
import {
    BeamWeaponData, getDefaultBeamWeaponData, getDefaultProjectileWeaponData,
    ProjectileWeaponData, SubmunitionType, WeaponData,
} from 'novadatainterface/weapon_data';
import { UUID } from 'nova_ecs/arg_types';
import { Angle } from 'nova_ecs/datatypes/angle';
import { Position } from 'nova_ecs/datatypes/position';
import { Vector } from 'nova_ecs/datatypes/vector';
import { Entity } from 'nova_ecs/entity';
import { MovementStateComponent } from 'nova_ecs/plugins/movement_plugin';
import { System } from 'nova_ecs/system';
import { World } from 'nova_ecs/world';
import SAT from 'sat';
import { CompositeHull, hullRadius, MultiFrameHull, ProjectileComponent } from '../core/index.js';
import { makeSystem } from '../make_system.js';
import { DamagedEvent, makeShip, TargetComponent } from '../ship/index.js';
import { completeEntity, loadWeaponsGameData } from '../spawn/index.js';
import { BeamDataComponent } from './beam_plugin.js';
import { WeaponEntries } from './fire_weapon_plugin.js';
import {
    PROX_FUSE_TARGET_RADIUS_FACTOR_FITTED, ProjectileCollisionEvent,
    proximityFuseReach,
} from './projectile_plugin.js';
import { submunitionFires } from './submunition_rule.js';

/**
 * When a shot fires its submunitions, against the original
 * (docs/reference_experiments.md, "Submunitions wave 10"): on expiry
 * (unless wëap Flags2 0x0020) or when the proximity fuse fires before the
 * body is touched; ProxSafety disarms every collision. A direct hit subs
 * only when the wëap's ProxRadius is above zero, a deliberate NovaJS
 * departure (Matthew's ruling; the original never subs on a direct hit).
 * The rig mirrors the reference one: an immobile disc of radius 12 (the
 * 24 px disc) and a 16 px shot fired straight at it. Beams (a NovaJS
 * extension) sub at the end of the ray whatever it hit.
 */

const TARGET_SHIP = 'test:disc-ship';
const TARGET = 'target';
const PARENT = 'test:parent';
const SUB = 'test:star';
const BEAM = 'test:beam';
const DISC_SPRITE = 'test:disc';
const SHOT_SPRITE = 'test:shot';

/** A regular 16-gon of the given radius: the disc's sprite mask. */
function disc(radius: number): ConvexHull {
    const points: ConvexHull = [];
    for (let i = 0; i < 16; i++) {
        const a = i * Math.PI / 8;
        points.push([radius * Math.cos(a), radius * Math.sin(a)]);
    }
    return points;
}

/** A square of half-size `half`: the 16 px shot. */
function box(half: number): ConvexHull {
    return [[-half, -half], [half, -half], [half, half], [-half, half]];
}

function star(subIfExpire = true): SubmunitionType {
    return { id: SUB, count: 4, theta: -90, limit: -1, fireAtNearest: false,
        subIfExpire };
}

function parent(overrides: Partial<ProjectileWeaponData> = {}): ProjectileWeaponData {
    const base = getDefaultProjectileWeaponData();
    return {
        ...base,
        id: PARENT,
        reload: 1000,
        shotDuration: 5000,
        guidance: 'unguided',
        exitType: 'center',
        proxRadius: 0,
        vulnerableTo: [],
        physics: { ...base.physics, speed: 120 }, // 2 px a tick.
        animation: {
            ...getDefaultAnimation(),
            images: { baseImage: { ...getDefaultAnimationImage(), id: SHOT_SPRITE } },
        },
        damage: { ...base.damage, shield: 1, armor: 1 },
        submunitions: [star()],
        ...overrides,
    };
}

function subWeapon(): ProjectileWeaponData {
    const base = getDefaultProjectileWeaponData();
    return {
        ...base,
        id: SUB,
        reload: 1000,
        shotDuration: 2000,
        guidance: 'unguided',
        exitType: 'center',
        proxRadius: 0,
        vulnerableTo: [],
        damage: { ...base.damage, shield: 0, armor: 0 },
        animation: {
            ...getDefaultAnimation(),
            images: { baseImage: { ...getDefaultAnimationImage(), id: SHOT_SPRITE } },
        },
    };
}

async function makeWorld(weapons: WeaponData[], targetRadius = 12) {
    const gameData = new MockGameData();
    for (const data of [subWeapon(), ...weapons]) {
        gameData.data.Weapon.map.set(data.id, data);
    }
    gameData.data.SpriteSheet.map.set(DISC_SPRITE, {
        ...getDefaultSpriteSheetData(), id: DISC_SPRITE,
        hulls: [[disc(targetRadius)]],
    });
    gameData.data.SpriteSheet.map.set(SHOT_SPRITE, {
        ...getDefaultSpriteSheetData(), id: SHOT_SPRITE, hulls: [[box(8)]],
    });
    const shipData: ShipData = {
        ...getDefaultShipData(),
        id: TARGET_SHIP,
        physics: { ...getDefaultShipPhysics(), shield: 30000, armor: 30000 },
        animation: {
            ...getDefaultAnimation(),
            images: { baseImage: { ...getDefaultAnimationImage(), id: DISC_SPRITE } },
        },
    };
    gameData.data.Ship.map.set(TARGET_SHIP, shipData);

    const world = await makeSystem('test:system', gameData);
    const target = makeShip(shipData);
    await completeEntity(world, target);
    world.entities.set(TARGET, target);
    pin(target);
    await loadWeaponsGameData(world, [SUB, ...weapons.map(w => w.id)]);

    const damaged: string[] = [];
    world.addSystem(new System({
        name: 'DamageRecorder',
        events: [DamagedEvent],
        args: [DamagedEvent, UUID] as const,
        step(_event, uuid) {
            damaged.push(uuid);
        },
    }));
    const detonations: { position: Position, otherUuid: string }[] = [];
    world.events.get(ProjectileCollisionEvent).subscribe(({ data }) => {
        if (data.projectileData.id === PARENT) {
            detonations.push({ position: data.position,
                otherUuid: data.otherUuid });
        }
    });
    step(world, 3); // Providers attach the hitbox.
    return { world, damaged, detonations };
}

function pin(ship: Entity) {
    ship.components.set(MovementStateComponent, {
        position: new Position(0, 0),
        velocity: new Vector(0, 0),
        rotation: new Angle(0),
        accelerating: 0,
        turning: 0,
        turnBack: false,
    });
}

function step(world: World, ticks: number) {
    for (let i = 0; i < ticks; i++) {
        world.step();
    }
}

/** Fires the parent from 150 px south of the target, flying north at it. */
function fireAtTarget(world: World, id = PARENT, distance = 150) {
    const entry = world.resources.get(WeaponEntries)!.getCached(id)!;
    const shot = entry.fire(new Position(0, distance), new Angle(0),
        'shooter', TARGET, 'shooter');
    expect(shot).toBeDefined();
    return shot!;
}

/** Steps until the parent is gone, then counts every sub ever spawned. */
function runToEnd(world: World, maxTicks = 400) {
    const subs = new Set<string>();
    for (let i = 0; i < maxTicks; i++) {
        step(world, 1);
        let parentAlive = false;
        for (const [uuid, entity] of world.entities) {
            const id = entity.components.get(ProjectileComponent)?.id;
            if (id === SUB) {
                subs.add(uuid);
            } else if (id === PARENT) {
                parentAlive = true;
            }
        }
        if (!parentAlive && i > 0) {
            step(world, 1);
            for (const [uuid, entity] of world.entities) {
                if (entity.components.get(ProjectileComponent)?.id === SUB) {
                    subs.add(uuid);
                }
            }
            return subs.size;
        }
    }
    throw new Error('the parent never ended');
}

function distanceFromCentre(position: Position) {
    return Math.hypot(position.x, position.y);
}

describe('submunitionFires (the one sub rule)', () => {
    const fused = { type: 'ProjectileWeaponData', proxRadius: 10 } as const;
    const unfused = { type: 'ProjectileWeaponData', proxRadius: 0 } as const;
    it('never subs on a direct hit without a proximity fuse (the original)', () => {
        expect(submunitionFires(unfused, { subIfExpire: true }, 'directHit')).toBeFalse();
        expect(submunitionFires(unfused, { subIfExpire: false }, 'directHit')).toBeFalse();
        // A negative ProxRadius (arpia's "Explosion", -1) is no fuse.
        expect(submunitionFires({ ...unfused, proxRadius: -1 }, { subIfExpire: true },
            'directHit')).toBeFalse();
        // Weapon data without the field (a beam's) counts as 0.
        expect(submunitionFires({ type: 'BeamWeaponData' }, { subIfExpire: true },
            'directHit')).toBeFalse();
    });
    it('subs on a direct hit with ProxRadius > 0, Flags2 0x0020 or not '
        + '(a NovaJS departure)', () => {
        expect(submunitionFires(fused, { subIfExpire: true }, 'directHit')).toBeTrue();
        expect(submunitionFires(fused, { subIfExpire: false }, 'directHit')).toBeTrue();
        expect(submunitionFires({ ...fused, proxRadius: 1 }, { subIfExpire: true },
            'directHit')).toBeTrue();
    });
    it('always subs on a proximity detonation', () => {
        for (const weapon of [fused, unfused]) {
            expect(submunitionFires(weapon, { subIfExpire: true }, 'proximity')).toBeTrue();
            expect(submunitionFires(weapon, { subIfExpire: false }, 'proximity')).toBeTrue();
        }
    });
    it('subs on expiry unless wëap Flags2 0x0020', () => {
        for (const weapon of [fused, unfused]) {
            expect(submunitionFires(weapon, { subIfExpire: true }, 'expired')).toBeTrue();
            expect(submunitionFires(weapon, { subIfExpire: false }, 'expired')).toBeFalse();
        }
    });
});

describe('proximity fuse reach', () => {
    it('is ProxRadius plus two thirds of the target radius', () => {
        expect(PROX_FUSE_TARGET_RADIUS_FACTOR_FITTED).toBeCloseTo(2 / 3, 10);
        expect(proximityFuseReach(16, 12)).toBeCloseTo(24, 10);
        expect(proximityFuseReach(30, 48)).toBeCloseTo(62, 10);
    });

    it('reads a hull\'s radius over every frame', () => {
        const small = new CompositeHull([new SAT.Polygon(new SAT.Vector(),
            [new SAT.Vector(-3, 0), new SAT.Vector(0, 4), new SAT.Vector(3, 0)])]);
        const big = new CompositeHull([new SAT.Circle(new SAT.Vector(), 10)]);
        expect(hullRadius(small)).toBeCloseTo(4, 10);
        expect(hullRadius(new MultiFrameHull([small, big]))).toBeCloseTo(10, 10);
    });
});

describe('when a shot fires its submunitions (reference: Submunitions wave 10)', () => {
    it('a direct hit (prox 0) damages the target and fires no subs', async () => {
        const { world, damaged, detonations } = await makeWorld([parent()]);
        fireAtTarget(world);
        expect(runToEnd(world)).toBe(0);
        expect(damaged).toContain(TARGET);
        expect(detonations.length).toBe(1);
        // The 16 px shot meets the radius-12 disc about 20 px out.
        expect(distanceFromCentre(detonations[0].position)).toBeLessThanOrEqual(21);
        expect(distanceFromCentre(detonations[0].position)).toBeGreaterThan(17);
    });

    it('a direct hit (prox 0) with Flags2 0x0020 fires none either', async () => {
        const { world, damaged } = await makeWorld([parent({
            submunitions: [star(false)],
        })]);
        fireAtTarget(world);
        expect(runToEnd(world)).toBe(0);
        expect(damaged).toContain(TARGET);
    });

    for (const proxRadius of [5, 8, 12]) {
        it(`a small fuse (prox ${proxRadius}) loses the race to the body, and `
            + 'the direct hit subs because ProxRadius > 0 (NovaJS departure)',
            async () => {
                const { world, damaged, detonations } =
                    await makeWorld([parent({ proxRadius })]);
                fireAtTarget(world);
                expect(runToEnd(world)).toBe(4);
                expect(damaged).toContain(TARGET);
                // It struck the body (about 20 px out), not the fuse's reach.
                expect(detonations.length).toBe(1);
                const at = distanceFromCentre(detonations[0].position);
                expect(at).toBeLessThanOrEqual(21);
                expect(at).toBeGreaterThan(17);
            });
    }

    it('a fused direct hit subs with Flags2 0x0020 too (that flag is only '
        + 'about expiry)', async () => {
        const { world, damaged } = await makeWorld([parent({
            proxRadius: 5, submunitions: [star(false)],
        })]);
        fireAtTarget(world);
        expect(runToEnd(world)).toBe(4);
        expect(damaged).toContain(TARGET);
    });

    it('an Interference-Missile-like shot (guided, prox 0, short ProxSafety) '
        + 'that hits its target fires none', async () => {
        // Extra Outfits' Interference Missile: homing, ProxRadius 0,
        // ProxSafety 1 frame, 6 Optimated IR Missiles at SubTheta 10. Its
        // description: if it hits a target before the IR missiles fire,
        // they do nothing.
        const { world, damaged } = await makeWorld([parent({
            guidance: 'guided', proxHitAll: false, proxRadius: 0,
            proxSafety: 1 / 30,
            submunitions: [{ ...star(), count: 6, theta: 10 * Math.PI / 180 }],
        })]);
        fireAtTarget(world);
        expect(runToEnd(world)).toBe(0);
        expect(damaged).toContain(TARGET);
    });

    for (const proxRadius of [16, 30, 60]) {
        it(`a wide fuse (prox ${proxRadius}) fires short of the body and subs`,
            async () => {
                const { world, damaged, detonations } =
                    await makeWorld([parent({ proxRadius })]);
                fireAtTarget(world);
                expect(runToEnd(world)).toBe(4);
                expect(damaged).toContain(TARGET);
                const reach = proximityFuseReach(proxRadius, 12);
                const at = distanceFromCentre(detonations[0].position);
                expect(at).toBeLessThanOrEqual(reach);
                expect(at).toBeGreaterThan(reach - 2.5);
            });
    }

    it('a bigger target trips the fuse farther out (two thirds of the extra radius)',
        async () => {
            const { world, detonations } =
                await makeWorld([parent({ proxRadius: 30 })], 48);
            fireAtTarget(world);
            expect(runToEnd(world)).toBe(4);
            const at = distanceFromCentre(detonations[0].position);
            expect(at).toBeLessThanOrEqual(62);
            expect(at).toBeGreaterThan(59.5);
        });

    it('on the bigger target prox 20 still loses to the body, and that '
        + 'direct hit subs (ProxRadius > 0)', async () => {
        const { world, detonations } =
            await makeWorld([parent({ proxRadius: 20 })], 48);
        fireAtTarget(world);
        expect(runToEnd(world)).toBe(4);
        // The body (radius 48 + the shot's 8) came before the fuse's 52.
        expect(distanceFromCentre(detonations[0].position))
            .toBeGreaterThan(proximityFuseReach(20, 48));
    });

    it('an expiring shot subs where it expired', async () => {
        const { world, damaged } = await makeWorld([parent({ shotDuration: 250 })]);
        fireAtTarget(world);
        expect(runToEnd(world)).toBe(4);
        expect(damaged).not.toContain(TARGET);
    });

    it('an expiring shot with Flags2 0x0020 fires none', async () => {
        const { world } = await makeWorld([parent({
            shotDuration: 250, submunitions: [star(false)],
        })]);
        fireAtTarget(world);
        expect(runToEnd(world)).toBe(0);
    });

    it('ProxSafety disarms the body too: the shot flies through, then the '
        + 'fuse fires once the safety runs out', async () => {
        // 2 px a tick from 150 px out: the shot crosses the disc at about
        // 1.25 s and is 30 px past its centre at 1.5 s.
        const { world, damaged, detonations } = await makeWorld([parent({
            proxRadius: 60, proxSafety: 1.5,
        })]);
        fireAtTarget(world);
        step(world, 85); // Through the disc, still safe.
        expect(damaged).not.toContain(TARGET);
        expect(detonations).toEqual([]);
        expect(runToEnd(world)).toBe(4);
        expect(detonations.length).toBe(1);
        // Beyond the target (north of it), inside the fuse's reach.
        expect(detonations[0].position.y).toBeLessThan(0);
    });

    it('a guided shot only fuses on its target', async () => {
        const { world, damaged } = await makeWorld([parent({
            proxRadius: 30, guidance: 'guided', proxHitAll: false,
            shotDuration: 2000, // 240 px: through the target and on.
        })]);
        const shot = fireAtTarget(world);
        shot.components.set(TargetComponent, { target: 'someone else' });
        expect(runToEnd(world)).toBe(4); // It expired.
        expect(damaged).not.toContain(TARGET);
    });

    // Beam submunitions are a NovaJS extension (the original has none);
    // Matthew's rule: a beam subs at the far end of its ray when it ends,
    // whatever it hit, unless wëap Flags2 0x0020.
    describe('beams (a NovaJS extension)', () => {
        function beam(subIfExpire = true): BeamWeaponData {
            const base = getDefaultBeamWeaponData();
            return {
                ...base, id: BEAM, guidance: 'beam', reload: 1000,
                shotDuration: 100, onScreenDuration: 100, exitType: 'center',
                beamAnimation: { ...base.beamAnimation, length: 300, width: 2 },
                submunitions: [star(subIfExpire)],
            };
        }

        function fireBeam(world: World, angle: Angle) {
            const entry = world.resources.get(WeaponEntries)!.getCached(BEAM)!;
            const shot = entry.fire(new Position(0, 150), angle, 'shooter',
                undefined, undefined);
            expect(shot).toBeDefined();
        }

        function beamAlive(world: World) {
            return [...world.entities.values()]
                .some(e => e.components.has(BeamDataComponent));
        }

        function subsAfterBeam(world: World) {
            for (let i = 0; i < 30 && beamAlive(world); i++) {
                step(world, 1);
            }
            expect(beamAlive(world)).toBeFalse();
            step(world, 1);
            return [...world.entities.values()].filter(e =>
                e.components.get(ProjectileComponent)?.id === SUB).length;
        }

        it('a beam held on its target to the end subs at its end', async () => {
            const { world, damaged } = await makeWorld([beam()]);
            fireBeam(world, new Angle(0));
            expect(subsAfterBeam(world)).toBe(4);
            expect(damaged).toContain(TARGET);
        });

        it('a beam that ends untouched subs at its end', async () => {
            const { world, damaged } = await makeWorld([beam()]);
            fireBeam(world, new Angle(Math.PI / 2));
            expect(subsAfterBeam(world)).toBe(4);
            expect(damaged).not.toContain(TARGET);
        });

        it('a beam with Flags2 0x0020 fires none, on its target or not',
            async () => {
                for (const angle of [0, Math.PI / 2]) {
                    const { world } = await makeWorld([beam(false)]);
                    fireBeam(world, new Angle(angle));
                    expect(subsAfterBeam(world)).toBe(0);
                }
            });
    });
});
