import 'jasmine';
import { DEFAULT_IONIZE_COLOR, WeaponDamage } from 'novadatainterface/weapon_data';
import { Angle } from 'nova_ecs/datatypes/angle';
import { Position } from 'nova_ecs/datatypes/position';
import { Vector } from 'nova_ecs/datatypes/vector';
import { Entity } from 'nova_ecs/entity';
import {
    INERTIALESS_SHED_PER_ACCELERATION, MovementPhysicsComponent,
    MovementStateComponent, MovementType,
} from 'nova_ecs/plugins/movement_plugin';
import { World } from 'nova_ecs/world';
import { SYNTHETIC } from 'novaparse/synthetic/universe';
import { getSyntheticGameData } from '../../communication/simulation_test_fixture.js';
import { makeSystem } from '../make_system.js';
import { completeEntity } from '../spawn/index.js';
import {
    BEAM_KNOCKBACK_TOP_SPEED_FRACTION,
    DamagedEvent, DisabledComponent, DISABLED_COAST_TIME_CONSTANT_S,
    DISABLED_REST_SPEED, KNOCKBACK_PER_IMPACT, knockedVelocity, makeShip,
    ShipDataComponent,
    pulledVelocity, ShipPhysicsComponent, SourceComponent,
    TRACTOR_BRAKE_PER_IMPACT, TRACTOR_PULL_PER_IMPACT, TRACTOR_PULL_RANGE,
    tractoredVelocity, TractorShotComponent,
} from './index.js';

describe('knockedVelocity', () => {
    it('adds an impulse in full below the top speed', () => {
        const v = knockedVelocity(new Vector(10, 0), new Vector(0, 20), 90);
        expect(v.x).toBe(10);
        expect(v.y).toBe(20);
    });

    it('never pushes a ship past its top speed', () => {
        const v = knockedVelocity(new Vector(80, 0), new Vector(500, 0), 90);
        expect(v.length).toBeCloseTo(90, 9);
        expect(v.y).toBe(0);
    });

    it('can turn a ship at its cap without speeding it up', () => {
        const v = knockedVelocity(new Vector(90, 0), new Vector(0, 90), 90);
        expect(v.length).toBeCloseTo(90, 9);
        // Turned 45 degrees toward the push.
        expect(v.x).toBeCloseTo(v.y, 9);
    });

    it('never adds to a speed already above the cap (an afterburner '
        + 'overspeed bleeds at its own rate), but can slow it', () => {
        const faster = knockedVelocity(new Vector(200, 0),
            new Vector(50, 0), 90);
        expect(faster.length).toBeCloseTo(200, 9);
        const slower = knockedVelocity(new Vector(200, 0),
            new Vector(-50, 0), 90);
        expect(slower.x).toBe(150);
    });
});

/**
 * The measured law, hull by hull (reference "Knockback (the hub's
 * KNOCKBACK), wave 46"): an immobile shooter's bolts on a still hull of
 * known Mass and top speed.
 */
describe('knockback law (reference KB, wave 46)', () => {
    const TARGET = 'target';
    const SHOOTER = 'shooter';

    function bolt(impact: number): WeaponDamage {
        return {
            shield: 0, armor: 0, ionization: 0,
            ionizationColor: DEFAULT_IONIZE_COLOR, passThroughShield: 0,
            knockback: impact, disableOnly: false,
        };
    }

    /** A still hull at the origin, a shooter 250 px off along -y firing
     * along +y. */
    async function stillHull(mass: number, speed: number,
        inertialess = false, acceleration = 45) {
        const gameData = await getSyntheticGameData();
        const world = await makeSystem(SYNTHETIC.systems.thessaly, gameData,
            'worker', { npcs: false });
        const shipData = (await gameData.data.Ship.get(
            SYNTHETIC.ships.skiff))!;
        const ship = makeShip(shipData);
        await completeEntity(world, ship);
        ship.components.set(ShipDataComponent, {
            ...ship.components.get(ShipDataComponent)!,
            physics: {
                ...shipData.physics, mass, speed, acceleration, inertialess,
            },
        });
        ship.components.delete(ShipPhysicsComponent);
        world.entities.set(TARGET, ship);
        const shooter = new Entity(SHOOTER);
        shooter.components.set(MovementStateComponent, {
            position: new Position(0, -250), velocity: new Vector(0, 0),
            rotation: new Angle(Math.PI), turning: 0, turnBack: false,
            accelerating: 0,
        });
        world.entities.set(SHOOTER, shooter);
        const movement = ship.components.get(MovementStateComponent)!;
        movement.position = new Position(0, 0);
        movement.velocity = new Vector(0, 0);
        // Nose across the line of fire, as the pad's player sat.
        movement.rotation = new Angle(Math.PI / 2);
        movement.accelerating = 0;
        world.step();
        expect(movement.velocity.length).toBe(0);
        expect(ship.components.get(MovementPhysicsComponent)!.maxVelocity)
            .toBe(speed);
        return { world, ship, movement };
    }

    function hit(world: World, impact: number, scale?: number) {
        world.emit(DamagedEvent, {
            damage: bolt(impact), damager: SHOOTER,
            ...(scale === undefined ? {} : { scale }),
        }, [TARGET]);
        world.step();
    }

    it('is 30 x Impact / Mass px/s a bolt hit', () => {
        expect(KNOCKBACK_PER_IMPACT).toEqual(30);
    });

    // [mass, top speed, impact, the measured steps]
    const RUNS: [number, number, number, number[]][] = [
        // kb20_b: Probe A, +11.8, +11.2, +12.3, +12.3, +12.6.
        [50, 131, 20, [12, 24, 36, 48, 60]],
        // kb100_a: Probe A, 0 -> 58.3 -> 116.7.
        [50, 131, 100, [60, 120]],
        // kb100h_a: Mass Hull 300, six steps of about +10 to 69.6.
        [300, 175, 100, [10, 20, 30, 40, 50, 60]],
    ];
    for (const [mass, speed, impact, steps] of RUNS) {
        it(`adds ${30 * impact / mass} px/s a hit of Impact ${impact} on `
            + `a ${mass} t hull, in full under its top speed`, async () => {
                const { world, movement } = await stillHull(mass, speed);
                for (const expected of steps) {
                    hit(world, impact);
                    expect(movement.velocity.length).toBeCloseTo(expected, 6);
                    // Along the shot (+y).
                    expect(movement.velocity.x).toBeCloseTo(0, 6);
                    // Coasts between hits: an inertial hull keeps it.
                    for (let i = 0; i < 30; i++) {
                        world.step();
                    }
                    expect(movement.velocity.length).toBeCloseTo(expected, 6);
                }
            }, 60_000);
    }

    it('caps the push at the top speed (kb100d_a: 134 px/s, not 150, on '
        + 'the 20 t disc, held through the next hit)', async () => {
            const { world, movement } = await stillHull(20, 131);
            hit(world, 100);
            expect(movement.velocity.length).toBeCloseTo(131, 6);
            hit(world, 100);
            expect(movement.velocity.length).toBeCloseTo(131, 6);
        }, 60_000);

    it('pushes a beam per Count unit (kbbeamh_a: +59 px/s a Count-30 '
        + 'Impact-20 shot on the 300 t hull)', async () => {
            const { world, movement } = await stillHull(300, 175);
            // BeamDamageSystem shares the Count units over the shot's
            // ticks as `scale`: 30 units over 32 ticks here.
            for (let i = 0; i < 32; i++) {
                hit(world, 20, 30 / 32);
            }
            expect(movement.velocity.length).toBeCloseTo(60, 6);
        }, 60_000);

    /** Steps until `movement` is at rest (at most `max`), and how far it
     * went. */
    function untilRest(world: World, movement: { velocity: Vector,
        position: Position }, max = 120) {
        const start = movement.position;
        let steps = 0;
        let travelled = 0;
        let last = start;
        while (movement.velocity.length > 0 && steps < max) {
            world.step();
            steps++;
            travelled += Vector.fromVectorLike(
                movement.position.subtract(last)).length;
            last = movement.position;
        }
        return { seconds: steps / 60, travelled };
    }

    it('lets an inertialess hull at rest shed a push in 0.3 s over about '
        + '9 px (kb20l_a, the Hyperioid, Impact 20)', async () => {
            const { world, movement } = await stillHull(10, 87.5, true, 45);
            hit(world, 20);
            const { seconds, travelled } = untilRest(world, movement);
            expect(seconds).toBeGreaterThan(0.25);
            expect(seconds).toBeLessThanOrEqual(0.35);
            expect(travelled).toBeGreaterThan(7);
            expect(travelled).toBeLessThan(11);
        }, 60_000);

    it('lets it shed a capped Impact-100 push in under 0.5 s over about 20 '
        + 'px (kb100l_a: 21-22 px)', async () => {
            const { world, movement } = await stillHull(10, 87.5, true, 45);
            hit(world, 100);
            const { seconds, travelled } = untilRest(world, movement);
            expect(seconds).toBeGreaterThan(0.35);
            expect(seconds).toBeLessThanOrEqual(0.5);
            expect(travelled).toBeGreaterThan(17);
            expect(travelled).toBeLessThan(23);
        }, 60_000);

    it('keeps nothing of 14 hits on an inertialess hull at rest',
        async () => {
            const { world, movement } = await stillHull(10, 87.5, true, 45);
            const start = movement.position;
            let farthest = 0;
            for (let i = 0; i < 14; i++) {
                hit(world, 20);
                // A shot every 7-8 s; at rest again well before the next.
                for (let s = 0; s < 60; s++) {
                    world.step();
                    farthest = Math.max(farthest, Vector.fromVectorLike(
                        movement.position.subtract(start)).length);
                }
                expect(movement.velocity.length).toBe(0);
                expect(movement.targetSpeed).toBe(0);
            }
            // Each hit's ~9 px adds up along the line of fire, but no
            // speed carries from one hit to the next.
            expect(farthest).toBeLessThan(14 * 11);
        }, 60_000);

    it('sheds at INERTIALESS_SHED_PER_ACCELERATION x the acceleration '
        + '(180-200 px/s² on the Hyperioid, from its two readings)', () => {
            expect(45 * INERTIALESS_SHED_PER_ACCELERATION)
                .toBeGreaterThanOrEqual(170);
            expect(45 * INERTIALESS_SHED_PER_ACCELERATION)
                .toBeLessThanOrEqual(210);
        });
});

/**
 * Reference "A beam on a fast light hull (the KB leftover), wave 48": a
 * beam's push stops at 0.72 x the victim's top speed.
 */
describe('a beam\'s push cap (reference KB, wave 48)', () => {
    const TARGET = 'target';
    const SHOOTER = 'shooter';

    async function probe(speed: number) {
        const gameData = await getSyntheticGameData();
        const world = await makeSystem(SYNTHETIC.systems.thessaly, gameData,
            'worker', { npcs: false });
        const shipData = (await gameData.data.Ship.get(
            SYNTHETIC.ships.skiff))!;
        const ship = makeShip(shipData);
        await completeEntity(world, ship);
        ship.components.set(ShipDataComponent, {
            ...ship.components.get(ShipDataComponent)!,
            physics: {
                ...shipData.physics, mass: 50, speed, acceleration: 45,
                inertialess: false,
            },
        });
        ship.components.delete(ShipPhysicsComponent);
        world.entities.set(TARGET, ship);
        const shooter = new Entity(SHOOTER);
        shooter.components.set(MovementStateComponent, {
            position: new Position(0, -250), velocity: new Vector(0, 0),
            rotation: new Angle(Math.PI), turning: 0, turnBack: false,
            accelerating: 0,
        });
        world.entities.set(SHOOTER, shooter);
        const movement = ship.components.get(MovementStateComponent)!;
        movement.position = new Position(0, 0);
        movement.velocity = new Vector(0, 0);
        movement.rotation = new Angle(Math.PI / 2);
        movement.accelerating = 0;
        world.step();
        return { world, movement };
    }

    /** One Count-30 Impact-20 shot (360 px/s by the law on 50 t), its
     * units shared over 32 ticks as BeamDamageSystem's `scale` does. */
    function shot(world: World, beam: boolean) {
        for (let i = 0; i < 32; i++) {
            world.emit(DamagedEvent, {
                damage: {
                    shield: 0, armor: 0, ionization: 0,
                    ionizationColor: DEFAULT_IONIZE_COLOR,
                    passThroughShield: 0, knockback: 20,
                    disableOnly: false,
                },
                damager: SHOOTER, scale: 30 / 32,
                ...(beam ? { beam } : {}),
            }, [TARGET]);
            world.step();
        }
    }

    it('is 0.72', () => {
        expect(BEAM_KNOCKBACK_TOP_SPEED_FRACTION).toBe(0.72);
    });

    it('throws Kit Probe A (131 px/s) to 94.6 and later beams add '
        + 'nothing', async () => {
            const { world, movement } = await probe(131);
            shot(world, true);
            expect(movement.velocity.length).toBeCloseTo(0.72 * 131, 6);
            expect(Math.abs(movement.velocity.length - 94.6))
                .toBeLessThan(0.5);
            expect(movement.velocity.x).toBeCloseTo(0, 6);
            for (let i = 0; i < 2; i++) {
                for (let s = 0; s < 420; s++) {
                    world.step();
                }
                shot(world, true);
                expect(movement.velocity.length)
                    .toBeCloseTo(0.72 * 131, 6);
            }
        }, 60_000);

    it('throws Kit Probe B (262 px/s) to 189.4', async () => {
        const { world, movement } = await probe(262);
        shot(world, true);
        expect(movement.velocity.length).toBeCloseTo(0.72 * 262, 6);
        expect(Math.abs(movement.velocity.length - 189.4))
            .toBeLessThan(1);
    }, 60_000);

    it('leaves the same push from bolts capped at the FULL top speed '
        + '(wave 46)', async () => {
            const { world, movement } = await probe(131);
            shot(world, false);
            expect(movement.velocity.length).toBeCloseTo(131, 6);
        }, 60_000);
});

/**
 * Reference "A tractor beam (the KB leftover), wave 48": a negative
 * Impact brakes the target toward its firer's velocity, never past it.
 */
describe('a tractor beam (reference KB, wave 48)', () => {
    const TARGET = 'target';
    const BEAMER = 'beamer';
    const BEAM = 'beam';

    async function hull(inertialess = false) {
        const gameData = await getSyntheticGameData();
        const world = await makeSystem(SYNTHETIC.systems.thessaly, gameData,
            'worker', { npcs: false });
        const shipData = (await gameData.data.Ship.get(
            SYNTHETIC.ships.skiff))!;
        const ship = makeShip(shipData);
        await completeEntity(world, ship);
        ship.components.set(ShipDataComponent, {
            ...ship.components.get(ShipDataComponent)!,
            physics: {
                ...shipData.physics, mass: 50, speed: 131,
                acceleration: 45, inertialess,
            },
        });
        ship.components.delete(ShipPhysicsComponent);
        world.entities.set(TARGET, ship);
        // The beamer 250 px west; its beam entity holds no velocity of
        // its own and names the beamer as its Source, as a fired beam
        // does.
        const beamer = new Entity(BEAMER);
        beamer.components.set(MovementStateComponent, {
            position: new Position(-250, 0), velocity: new Vector(0, 0),
            rotation: new Angle(Math.PI / 2), turning: 0, turnBack: false,
            accelerating: 0,
        });
        world.entities.set(BEAMER, beamer);
        const beam = new Entity(BEAM);
        beam.components.set(MovementStateComponent, {
            position: new Position(-250, 0), velocity: new Vector(0, 0),
            rotation: new Angle(Math.PI / 2), turning: 0, turnBack: false,
            accelerating: 0,
        });
        beam.components.set(SourceComponent, BEAMER);
        world.entities.set(BEAM, beam);
        const movement = ship.components.get(MovementStateComponent)!;
        movement.position = new Position(0, 0);
        movement.velocity = new Vector(0, 0);
        movement.rotation = new Angle(Math.PI / 2);
        movement.accelerating = 0;
        world.step();
        return { world, beamer, movement };
    }

    function tractor(world: World, impact: number, scale = 1) {
        world.emit(DamagedEvent, {
            damage: {
                shield: 0, armor: 0, ionization: 0,
                ionizationColor: DEFAULT_IONIZE_COLOR, passThroughShield: 0,
                knockback: impact, disableOnly: false,
            },
            damager: BEAM, scale, beam: true,
        }, [TARGET]);
        world.step();
    }

    it('never moves a hull at rest (kta_a: four shots, 0 px)',
        async () => {
            const { world, movement } = await hull();
            const start = movement.position;
            for (let shot = 0; shot < 4; shot++) {
                for (let i = 0; i < 32; i++) {
                    tractor(world, -20, 30 / 32);
                }
                for (let s = 0; s < 420; s++) {
                    world.step();
                }
            }
            expect(movement.velocity.length).toBe(0);
            expect(movement.position.x).toBe(start.x);
            expect(movement.position.y).toBe(start.y);
        }, 60_000);

    /** One Count-30 tractor shot, its units shared over 32 ticks as
     * BeamDamageSystem shares them. */
    function tractorShot(world: World, impact: number) {
        for (let i = 0; i < 32; i++) {
            tractor(world, impact, 30 / 32);
        }
    }

    it('brakes about 19 px/s a Count-30 Impact -20 shot on 50 t '
        + '(GUESS fit, TRACTOR_BRAKE_PER_IMPACT 1.6)', () => {
            expect(TRACTOR_BRAKE_PER_IMPACT).toBe(1.6);
            expect(30 * 20 * TRACTOR_BRAKE_PER_IMPACT / 50)
                .toBeCloseTo(19.2, 9);
        });

    it('brakes a hull flying TOWARD the beamer by about 19 px/s, stops it '
        + 'with the next shot and holds it still (ktm_a: 30 -> 10.9 -> 0), '
        + 'never reversing it', async () => {
            const { world, movement } = await hull();
            movement.velocity = new Vector(-30, 0);
            tractorShot(world, -20);
            // ktm_a read 10.9 after the first shot.
            expect(movement.velocity.x).toBeCloseTo(-10.8, 6);
            expect(movement.velocity.y).toBeCloseTo(0, 9);
            expect(Math.abs(movement.velocity.x - -10.9)).toBeLessThan(0.5);
            tractorShot(world, -20);
            expect(movement.velocity.length).toBe(0);
            // Not pulled on toward the beamer: it stays put.
            const at = movement.position;
            for (let i = 0; i < 2; i++) {
                tractorShot(world, -20);
                for (let s = 0; s < 420; s++) {
                    world.step();
                }
            }
            expect(movement.position.x).toBe(at.x);
            expect(movement.position.y).toBe(at.y);
            expect(movement.velocity.length).toBe(0);
        }, 60_000);

    it('brakes toward the BEAMER\'s velocity, not to a stop', async () => {
        const { world, beamer, movement } = await hull();
        beamer.components.get(MovementStateComponent)!.velocity =
            new Vector(0, 20);
        movement.velocity = new Vector(30, 20);
        tractorShot(world, -20);
        expect(movement.velocity.x).toBeCloseTo(10.8, 6);
        expect(movement.velocity.y).toBeCloseTo(20, 9);
        tractorShot(world, -20);
        // Latched to the beamer's motion, no overshoot.
        expect(movement.velocity.x).toBe(0);
        expect(movement.velocity.y).toBe(20);
        tractorShot(world, -20);
        expect(movement.velocity.x).toBe(0);
        expect(movement.velocity.y).toBe(20);
    }, 60_000);

    it('leaves an inertialess hull alone (the Bible; ktg_a)', async () => {
        const { world, movement } = await hull(true);
        // Cruising east along its heading at 30 px/s.
        movement.velocity = new Vector(30, 0);
        movement.targetSpeed = 30;
        for (let i = 0; i < 5; i++) {
            tractor(world, -20);
        }
        expect(movement.velocity.x).toBeCloseTo(30, 9);
        expect(movement.velocity.y).toBeCloseTo(0, 9);
    }, 60_000);

    it('tractoredVelocity never passes the firer\'s velocity', () => {
        const toward = new Vector(5, 5);
        expect(tractoredVelocity(new Vector(6, 5), toward, 100))
            .toBe(toward);
        const v = tractoredVelocity(new Vector(15, 5), toward, 4);
        expect(v.x).toBeCloseTo(11, 12);
        expect(v.y).toBeCloseTo(5, 12);
    });
});

/**
 * Reference "A tractor beam's rate with Mass and distance (the KB
 * leftover), wave 50": beyond TRACTOR_PULL_RANGE (495 px since wave 52)
 * a tractor shot PULLS a hull lighter than the beamer toward it, each
 * velocity axis held at the hull's top speed; a shot that starts within
 * it brakes (wave 48, above), and either holds for the whole shot (wave
 * 52); heavier and inertialess hulls never move. Wave 48's Kit Tractor Beamer 20: the
 * stock Terrapin's 175 t, immobile, a Count-30 Impact -20 beam.
 */
describe('a tractor beam\'s pull (reference KB, wave 50)', () => {
    const TARGET = 'target';
    const BEAMER = 'beamer';
    const BEAM = 'beam';
    const BEAMER_MASS = 175;

    async function rig(options: {
        mass: number, speed: number, inertialess?: boolean,
        beamerAt: Position, velocity?: Vector,
    }) {
        const gameData = await getSyntheticGameData();
        const world = await makeSystem(SYNTHETIC.systems.thessaly, gameData,
            'worker', { npcs: false });
        const shipData = (await gameData.data.Ship.get(
            SYNTHETIC.ships.skiff))!;
        const ship = makeShip(shipData);
        await completeEntity(world, ship);
        ship.components.set(ShipDataComponent, {
            ...ship.components.get(ShipDataComponent)!,
            physics: {
                ...shipData.physics, mass: options.mass,
                speed: options.speed, acceleration: 45,
                inertialess: options.inertialess ?? false,
            },
        });
        ship.components.delete(ShipPhysicsComponent);
        world.entities.set(TARGET, ship);
        // The immobile beamer, with a hull's Mass; its beam entity names
        // it as Source and holds nothing of its own that counts.
        const beamer = new Entity(BEAMER);
        beamer.components.set(MovementStateComponent, {
            position: options.beamerAt, velocity: new Vector(0, 0),
            rotation: new Angle(0), turning: 0, turnBack: false,
            accelerating: 0,
        });
        beamer.components.set(ShipPhysicsComponent, {
            ...shipData.physics, mass: BEAMER_MASS,
        });
        world.entities.set(BEAMER, beamer);
        const beam = new Entity(BEAM);
        beam.components.set(MovementStateComponent, {
            position: options.beamerAt, velocity: new Vector(0, 0),
            rotation: new Angle(0), turning: 0, turnBack: false,
            accelerating: 0,
        });
        beam.components.set(SourceComponent, BEAMER);
        world.entities.set(BEAM, beam);
        const movement = ship.components.get(MovementStateComponent)!;
        movement.position = new Position(0, 0);
        movement.velocity = options.velocity ?? new Vector(0, 0);
        movement.rotation = new Angle(Math.PI / 2);
        movement.accelerating = 0;
        if (options.inertialess) {
            movement.targetSpeed = movement.velocity.length;
        }
        world.step();
        return { world, movement };
    }

    /** One Count-30 tractor unit's share (of 32 ticks, as
     * BeamDamageSystem shares them). */
    function unit(world: World, impact = -20) {
        world.emit(DamagedEvent, {
            damage: {
                shield: 0, armor: 0, ionization: 0,
                ionizationColor: DEFAULT_IONIZE_COLOR,
                passThroughShield: 0, knockback: impact,
                disableOnly: false,
            },
            damager: BEAM, scale: 30 / 32, beam: true,
        }, [TARGET]);
        world.step();
    }

    /** One Count-30 shot (Impact -20 unless given), its units shared
     * over 32 ticks as BeamDamageSystem shares them. A new shot: the
     * rig's one beam entity forgets the last shot's pull / brake. */
    function shot(world: World, impact = -20) {
        world.entities.get(BEAM)!.components.delete(TractorShotComponent);
        for (let i = 0; i < 32; i++) {
            unit(world, impact);
        }
    }

    // tra_a / tra_b: the beamer on the first moon, 500 px up-left.
    const DIAGONAL_500 = new Position(-400, -300);

    it('pulls at the push law\'s own 30 x |Impact| / Mass a unit beyond '
        + '495 px (wave 51: about 11.5 px/s a unit on 50 t at Impact 20; '
        + 'wave 52: the edge in (490, 500])',
        () => {
            expect(TRACTOR_PULL_RANGE).toBeGreaterThan(490);
            expect(TRACTOR_PULL_RANGE).toBeLessThanOrEqual(500);
            expect(TRACTOR_PULL_RANGE).toBe(495);
            expect(TRACTOR_PULL_PER_IMPACT).toBe(30);
            // 12 px/s a unit; 360 a Count-30 shot (read 345 uncapped).
            expect(TRACTOR_PULL_PER_IMPACT * 20 / 50).toBe(12);
            expect(Math.abs(TRACTOR_PULL_PER_IMPACT * 20 / 50 - 11.5))
                .toBeLessThan(0.6);
        });

    it('pulls a still 50 t Kit Probe A 500 px out toward the beamer to '
        + 'its top speed on EACH axis in one shot (tra_a / tra_b: 181-185 '
        + 'px/s, about -135 deg, 1.4 x its 131 px/s)', async () => {
            const { world, movement } = await rig({
                mass: 50, speed: 131, beamerAt: DIAGONAL_500,
            });
            shot(world);
            const { x, y } = movement.velocity;
            // Toward the beamer (up-left), both axes at the cap, less
            // whatever the overspeed bled meanwhile.
            expect(x).toBeLessThan(-120);
            expect(y).toBeLessThan(-120);
            expect(x).toBeGreaterThanOrEqual(-131);
            expect(y).toBeGreaterThanOrEqual(-131);
            expect(movement.velocity.length).toBeGreaterThan(170);
            expect(movement.velocity.length).toBeLessThan(186);
            expect(Math.abs(Math.abs(x) - Math.abs(y))).toBeLessThan(10);
        }, 60_000);

    it('pulls a still 150 t Star Liner its x axis to the 87.5 cap in one '
        + 'shot (trs_a: x 85-90, about 100 px/s in all; this law 113)',
        async () => {
            const { world, movement } = await rig({
                mass: 150, speed: 87.5, beamerAt: DIAGONAL_500,
            });
            shot(world);
            const { x, y } = movement.velocity;
            // 120 px/s of pull along (-0.8, -0.6): x 96 cut to its cap
            // (read 85-90), y 72 (not read on its own; the read total,
            // about 100, implies about 50), less the overspeed bleed.
            expect(x).toBeGreaterThanOrEqual(-87.5);
            expect(x).toBeLessThan(-85);
            expect(Math.abs(y + 72)).toBeLessThan(5);
            expect(movement.velocity.length).toBeGreaterThan(100);
            expect(movement.velocity.length).toBeLessThan(115);
        }, 60_000);

    it('never moves a hull heavier than the beamer, at rest or coasting '
        + '(tre_a 255 t, trm_a / trm_b 300 t)', async () => {
            const still = await rig({
                mass: 255, speed: 100, beamerAt: DIAGONAL_500,
            });
            shot(still.world);
            shot(still.world);
            expect(still.movement.velocity.length).toBe(0);
            const coasting = await rig({
                mass: 300, speed: 100, beamerAt: DIAGONAL_500,
                velocity: new Vector(40.8, 0),
            });
            shot(coasting.world);
            shot(coasting.world);
            expect(coasting.movement.velocity.x).toBeCloseTo(40.8, 9);
            expect(coasting.movement.velocity.y).toBeCloseTo(0, 9);
        }, 60_000);

    it('does not brake a heavier hull inside the range either (wave 51 '
        + 'finding 4: wave 50\'s trm_b, 300 t coasting 40.8 px/s 357-360 px '
        + 'from the 175 t beamer, kept all of it through a shot)',
        async () => {
            const { world, movement } = await rig({
                mass: 300, speed: 100, beamerAt: new Position(-100, 0),
                velocity: new Vector(-30, 0),
            });
            shot(world);
            expect(movement.velocity.x).toBeCloseTo(-30, 9);
            const trm = await rig({
                mass: 300, speed: 100, beamerAt: new Position(-357, 0),
                velocity: new Vector(0, 40.8),
            });
            shot(trm.world);
            expect(trm.movement.velocity.x).toBeCloseTo(0, 9);
            expect(trm.movement.velocity.y).toBeCloseTo(40.8, 9);
        }, 60_000);

    it('brakes a LIGHTER hull coasting toward the beamer inside the range '
        + '(wave 51 tr350m_a / tr350m_b: 28.5 -> 9-10 px/s over a shot, 0 '
        + 'at the next)', async () => {
            const { world, movement } = await rig({
                mass: 50, speed: 131, beamerAt: new Position(-350, 0),
                velocity: new Vector(-28.5, 0),
            });
            shot(world);
            expect(-movement.velocity.x).toBeGreaterThan(8.5);
            expect(-movement.velocity.x).toBeLessThan(10.5);
            expect(movement.velocity.y).toBeCloseTo(0, 9);
            shot(world);
            expect(movement.velocity.length).toBe(0);
        }, 60_000);

    it('never moves an inertialess hull 500 px out (trg_a)', async () => {
        const { world, movement } = await rig({
            mass: 50, speed: 131, inertialess: true,
            beamerAt: DIAGONAL_500,
        });
        for (let i = 0; i < 3; i++) {
            shot(world);
        }
        expect(movement.velocity.length).toBe(0);
    }, 60_000);

    it('holds a still hull at 490, 475, 450, 425 and 350 px (wave 52 '
        + 'tr490_a / tr475_a / tr450_a, wave 50 tr425_a / tr350_a)',
        async () => {
            for (const distance of [490, 475, 450, 425, 350]) {
                const { world, movement } = await rig({
                    mass: 50, speed: 131,
                    beamerAt: new Position(-distance, 0),
                });
                shot(world);
                shot(world);
                expect(movement.velocity.length).withContext(`${distance}`)
                    .toBe(0);
            }
        }, 60_000);

    it('pulls just beyond the range edge and not just inside it',
        async () => {
            const outside = await rig({
                mass: 50, speed: 131, beamerAt: new Position(-505, 0),
            });
            shot(outside.world);
            // Pulled in across the edge during the shot, and pulled on to
            // its end (the mode is the shot's): x at its 131 cap, less
            // the overspeed bleed.
            expect(outside.movement.velocity.x).toBeLessThan(-120);
            expect(outside.movement.velocity.y).toBeCloseTo(0, 9);
            const inside = await rig({
                mass: 50, speed: 131, beamerAt: new Position(-485, 0),
            });
            shot(inside.world);
            expect(inside.movement.velocity.length).toBe(0);
        }, 60_000);

    /**
     * Reference "A tractor shot that starts outside the pull range and
     * crosses inside it (the hub's extra, KB), wave 52": wave 51's trb_c
     * hull passed 425 and 400 px during the shot and kept speeding toward
     * the beamer to its end, never braked: pull or brake is the SHOT's.
     */
    it('keeps pulling for the whole shot once it starts pulling, however '
        + 'far inside the range the hull comes; the next shot starts afresh',
        async () => {
            // 500 px out on the axis, a 262 px/s cap: one shot pulls it
            // about 90 px in, to about 410 px.
            const { world, movement } = await rig({
                mass: 50, speed: 262, beamerAt: new Position(-500, 0),
            });
            const speeds: number[] = [];
            for (let i = 0; i < 32; i++) {
                unit(world);
                speeds.push(-movement.velocity.x);
            }
            expect(world.entities.get(BEAM)!.components
                .get(TractorShotComponent)).toBe('pull');
            // Well inside the range by the shot's end.
            expect(movement.position.x + 500)
                .toBeLessThan(TRACTOR_PULL_RANGE - 50);
            // Every unit added the same pull until the axis met its cap,
            // and none braked, the last ones inside the range too.
            for (let i = 1; i < 32; i++) {
                if (speeds[i - 1] + 11.25 <= 262) {
                    expect(speeds[i] - speeds[i - 1]).withContext(`${i}`)
                        .toBeCloseTo(11.25, 6);
                } else {
                    expect(speeds[i]).withContext(`${i}`)
                        .toBeCloseTo(262, 6);
                }
            }
            // A new shot that starts with the hull inside the range brakes
            // it toward the beamer's (zero) velocity.
            const before = movement.velocity.length;
            shot(world);
            expect(world.entities.get(BEAM)!.components
                .get(TractorShotComponent)).toBe('brake');
            expect(movement.velocity.length).toBeLessThan(before);
        }, 60_000);

    it('GUESS: keeps braking for the whole shot once it starts braking, '
        + 'though the hull coasts out of the range', async () => {
            // 480 px out and leaving at 60 px/s: past 495 within the shot.
            const { world, movement } = await rig({
                mass: 50, speed: 131, beamerAt: new Position(-480, 0),
                velocity: new Vector(60, 0),
            });
            let last = movement.velocity.x;
            for (let i = 0; i < 32; i++) {
                unit(world);
                expect(movement.velocity.x).withContext(`${i}`)
                    .toBeLessThanOrEqual(last);
                expect(movement.velocity.x).withContext(`${i}`)
                    .toBeGreaterThanOrEqual(0);
                last = movement.velocity.x;
            }
            // Out past the range by the shot's end, never pulled.
            expect(movement.position.x + 480)
                .toBeGreaterThan(TRACTOR_PULL_RANGE);
            expect(world.entities.get(BEAM)!.components
                .get(TractorShotComponent)).toBe('brake');
        }, 60_000);

    // Wave 51's Kit Probe B: 50 t, a 262 px/s axis cap (Speed 600 on the
    // reference clock), still on the -143 deg diagonal from the beamer,
    // 500 px out, where the original pulled it for the whole 1 s shot
    // (about 170 px of travel, so ending well inside TRACTOR_PULL_RANGE):
    // the shot's pull goes on inside the range (TractorShotComponent).
    const PROBE_B = { mass: 50, speed: 262, beamerAt: DIAGONAL_500 };

    it('builds the pull steadily, one push-law unit a beam unit, to 340 '
        + 'px/s a Count-30 Impact -20 shot on 50 t (trb_c / trb_a: 33-35 '
        + 'px/s every 0.1 s, 330 at the end with x at its cap)', async () => {
            const { world, movement } = await rig(PROBE_B);
            const speeds: number[] = [];
            for (let i = 0; i < 32; i++) {
                unit(world);
                speeds.push(movement.velocity.length);
            }
            // Every unit adds the same 30 x 20 / 50 x 30 / 32 = 11.25
            // px/s toward the beamer until x meets its cap.
            for (let i = 1; i < 20; i++) {
                expect(speeds[i] - speeds[i - 1]).withContext(`${i}`)
                    .toBeCloseTo(11.25, 6);
            }
            // 360 px/s of pull along (-0.8, -0.6): x 288 held at its cap
            // (read 261-263), y 216 (read 203), less the overspeed bleed
            // (OVERSPEED_DECAY_FACTOR) once past the 262 total.
            const { x, y } = movement.velocity;
            expect(x).toBeGreaterThanOrEqual(-262);
            expect(x).toBeLessThan(-255);
            expect(Math.abs(y + 216)).toBeLessThan(10);
            expect(Math.abs(movement.velocity.length - 330)).toBeLessThan(15);
        }, 60_000);

    it('pulls in proportion to Impact: Impact -40 twice as hard, until both '
        + 'axes hold at the cap (trb40_c / trb40_d: 1.97 x, 372 px/s at '
        + '-135 deg)', async () => {
            const at20 = await rig(PROBE_B);
            const at40 = await rig(PROBE_B);
            for (let i = 0; i < 8; i++) {
                unit(at20.world, -20);
                unit(at40.world, -40);
            }
            expect(at40.movement.velocity.length
                / at20.movement.velocity.length).toBeCloseTo(2, 9);
            for (let i = 8; i < 32; i++) {
                unit(at40.world, -40);
            }
            // Both axes at the cap, less the overspeed bleed.
            const { x, y } = at40.movement.velocity;
            for (const axis of [x, y]) {
                expect(axis).toBeGreaterThanOrEqual(-262);
                expect(axis).toBeLessThan(-255);
            }
            expect(Math.abs(at40.movement.velocity.length - 372))
                .toBeLessThan(10);
        }, 60_000);

    it('pulledVelocity holds each axis at the top speed, never cutting '
        + 'an axis already over it', () => {
        const v = pulledVelocity(new Vector(0, 0), new Vector(-248, -186),
            131);
        expect(v.x).toBe(-131);
        expect(v.y).toBe(-131);
        const under = pulledVelocity(new Vector(10, 0), new Vector(-50, 20),
            131);
        expect(under.x).toBeCloseTo(-40, 12);
        expect(under.y).toBeCloseTo(20, 12);
        // An axis already at 200 keeps it; the pull may slow it.
        const over = pulledVelocity(new Vector(200, 0), new Vector(10, -5),
            131);
        expect(over.x).toBe(200);
        expect(over.y).toBe(-5);
        expect(pulledVelocity(new Vector(200, 0), new Vector(-30, 0), 131).x)
            .toBe(170);
    });
});

/**
 * A light hull (a Hyperioid's numbers: 10 t, 90 px/s, 45 px/s²) taking
 * a heavy beam's worth of knockback every step, as a Thunderhead Lance
 * (impact 50, 10 units a shot) lands it, from a fixed shooter.
 */
describe('knockback on a light hull under sustained fire', () => {
    const TARGET = 'target';
    const SHOOTER = 'shooter';
    const TOP_SPEED = 90;
    const HEAVY: WeaponDamage = {
        shield: 0, armor: 0, ionization: 0,
        ionizationColor: DEFAULT_IONIZE_COLOR, passThroughShield: 0,
        knockback: 50, disableOnly: false,
    };

    async function lightHullWorld(inertialess: boolean) {
        const gameData = await getSyntheticGameData();
        const world = await makeSystem(SYNTHETIC.systems.thessaly, gameData,
            'worker', { npcs: false });
        const shipData = (await gameData.data.Ship.get(
            SYNTHETIC.ships.skiff))!;
        const ship = makeShip(shipData);
        await completeEntity(world, ship);
        ship.components.set(ShipDataComponent, {
            ...ship.components.get(ShipDataComponent)!,
            physics: {
                ...shipData.physics, mass: 10, speed: TOP_SPEED,
                acceleration: 45, inertialess,
            },
        });
        // Re-derived from the ShipData above on the next step.
        ship.components.delete(ShipPhysicsComponent);
        world.entities.set(TARGET, ship);
        const shooter = new Entity(SHOOTER);
        // Fires along +y (the clock-angle unit vector of 0 is (0, -1);
        // the direction does not matter, only that it is fixed).
        shooter.components.set(MovementStateComponent, {
            position: new Position(0, -400), velocity: new Vector(0, 0),
            rotation: new Angle(Math.PI), turning: 0, turnBack: false,
            accelerating: 0,
        });
        world.entities.set(SHOOTER, shooter);
        const movement = ship.components.get(MovementStateComponent)!;
        movement.position = new Position(0, 0);
        // Flying across the line of fire.
        movement.rotation = new Angle(Math.PI / 2);
        world.step();
        expect(ship.components.get(MovementPhysicsComponent)!)
            .toEqual(jasmine.objectContaining({
                maxVelocity: TOP_SPEED,
                movementType: inertialess
                    ? MovementType.INERTIALESS : MovementType.INERTIAL,
            }));
        return { world, ship, movement };
    }

    function hammer(world: World, steps: number, onStep: () => void) {
        for (let i = 0; i < steps; i++) {
            world.emit(DamagedEvent, { damage: HEAVY, damager: SHOOTER },
                [TARGET]);
            world.step();
            onStep();
        }
    }

    for (const inertialess of [true, false]) {
        const kind = inertialess ? 'an inertialess' : 'an inertial';
        it(`holds ${kind} hull, thrusting, at its top speed (was over `
            + '5,000 px/s in 10 s)', async () => {
            const { world, movement } = await lightHullWorld(inertialess);
            let maxSpeed = 0;
            let maxTargetSpeed = 0;
            hammer(world, 600, () => {
                movement.accelerating = 1;
                maxSpeed = Math.max(maxSpeed, movement.velocity.length);
                maxTargetSpeed = Math.max(maxTargetSpeed,
                    movement.targetSpeed ?? 0);
            });
            expect(maxSpeed).toBeLessThanOrEqual(TOP_SPEED + 1e-9);
            // The pushes did land: it is at its cap.
            expect(maxSpeed).toBeGreaterThan(TOP_SPEED * 0.9);
            // The inertialess model's targetSpeed never ratchets up
            // with an overspeed (it used to follow the raised cap).
            expect(maxTargetSpeed).toBeLessThanOrEqual(TOP_SPEED);
        }, 60_000);

        it(`keeps ${kind} hulk under fire within its top speed, and `
            + 'lets it coast to rest once the fire stops', async () => {
            const { world, ship, movement } =
                await lightHullWorld(inertialess);
            // Up to speed first, then disabled for good (a hulk: the
            // armor stays above the threshold).
            for (let i = 0; i < 180; i++) {
                movement.accelerating = 1;
                world.step();
            }
            ship.components.set(DisabledComponent,
                { repairAt: null, hulk: true });
            let maxSpeed = 0;
            hammer(world, 600, () => {
                maxSpeed = Math.max(maxSpeed, movement.velocity.length);
            });
            expect(maxSpeed).toBeLessThanOrEqual(TOP_SPEED + 1e-9);
            // The fire stops: the measured coast, from at most the top
            // speed, rests by tau x ln(top / DISABLED_REST_SPEED).
            const restSteps = Math.ceil(DISABLED_COAST_TIME_CONSTANT_S
                * Math.log(TOP_SPEED / DISABLED_REST_SPEED) * 60) + 10;
            for (let i = 0; i < restSteps; i++) {
                world.step();
            }
            expect(movement.velocity.length).toBe(0);
            expect(ship.components.has(DisabledComponent)).toBeTrue();
        }, 60_000);
    }

    it('coasts an inertialess hulk on the measured exponential, along its '
        + 'own line (it used to cruise on at its targetSpeed forever)',
        async () => {
            const { world, ship, movement } = await lightHullWorld(true);
            for (let i = 0; i < 180; i++) {
                movement.accelerating = 1;
                world.step();
            }
            const v0 = movement.velocity.length;
            expect(v0).toBeCloseTo(TOP_SPEED, 6);
            const heading = movement.velocity.normalize();
            ship.components.set(DisabledComponent,
                { repairAt: null, hulk: true });
            // One time constant later: 1/e of the speed, same direction.
            const tauSteps = Math.round(DISABLED_COAST_TIME_CONSTANT_S * 60);
            for (let i = 0; i < tauSteps; i++) {
                world.step();
            }
            const v = movement.velocity.length;
            expect(v).toBeCloseTo(v0 / Math.E, 0);
            const direction = movement.velocity.normalize();
            expect(direction.x).toBeCloseTo(heading.x, 6);
            expect(direction.y).toBeCloseTo(heading.y, 6);
            expect(movement.targetSpeed).toBeCloseTo(v, 9);
        }, 60_000);
});
