import 'jasmine';
import { BOUNDARY, Position } from 'nova_ecs/datatypes/position';
import { Vector } from 'nova_ecs/datatypes/vector';
import {
    MovementPhysicsComponent, MovementStateComponent, MovementType,
} from 'nova_ecs/plugins/movement_plugin';
import { World } from 'nova_ecs/world';
import { SYNTHETIC } from 'novaparse/synthetic/universe';
import { Autopilot, stoppableSpeed } from './autopilot.js';
import { getSyntheticGameData } from './communication/simulation_test_fixture.js';
import { makeSystem } from './nova_plugin/make_system.js';
import {
    applyAnalogControl, applyControlEvents, ControlledByComponent,
    PlayerShipSelector,
} from './nova_plugin/player/index.js';
import { makeShip, ShipPhysicsComponent, unchargedTurnRate } from './nova_plugin/ship/index.js';
import { completeEntity } from './nova_plugin/spawn/index.js';
import {
    LandEvent, LandingBlockedEvent, LandingClearedEvent, landingDistance,
    PlanetDataComponent, PlanetTargetComponent, STELLAR_CLEARANCE_RANGE,
    stellarApproachRange, stellarLandingRange,
} from './nova_plugin/travel/index.js';
import { getDefaultPlanetData } from 'novadatainterface/planet_data';

/**
 * The client autopilot flown in a real simulation world: its analog and
 * 'land' outputs go through the same applyAnalogControl / applyControlEvents
 * the bridge uses, and the real AttemptLandingSystem decides the landing on
 * the SQUARE zone (planet_plugin.ts's inLandingZone). Port Amberline stands
 * in for every stellar, its sprite frame swapped for the size under test.
 */
const PEER = 'autopilot peer';
const SHIP_UUID = 'autopilot ship';
const PORT = `planet ${SYNTHETIC.planets.port}`;

async function harness(frame: [number, number], shipId: string) {
    const gameData = await getSyntheticGameData();
    const world = await makeSystem(SYNTHETIC.systems.thessaly, gameData,
        undefined, { npcs: false });
    const ship = makeShip(await gameData.data.Ship.get(shipId));
    ship.components.set(PlayerShipSelector, undefined);
    ship.components.set(ControlledByComponent, { peerId: PEER });
    await completeEntity(world, ship);
    world.entities.set(SHIP_UUID, ship);
    world.step();

    const planet = world.entities.get(PORT)!;
    planet.components.set(PlanetDataComponent, {
        ...planet.components.get(PlanetDataComponent)!,
        spriteFrameSize: frame,
    });
    ship.components.get(PlanetTargetComponent)!.target = PORT;
    return { world, ship, planet };
}

function fly(world: World, autopilot: Autopilot, maxTicks: number) {
    const lands: string[] = [];
    const blocked: string[] = [];
    world.events.get(LandEvent).subscribe(({ data }) => lands.push(data.uuid));
    world.events.get(LandingBlockedEvent).subscribe(({ data }) =>
        blocked.push(data.reason));
    let ticks = 0;
    for (; ticks < maxTicks && lands.length === 0; ticks++) {
        autopilot.step(world, PEER);
        world.step();
    }
    return { lands, blocked, ticks };
}

describe('Autopilot landing on the square zone', () => {
    /**
     * Matthew's Auroran Thunderforge as flown into Auroran LP V for
     * "Auroran 19: Observe Auroran Border" (nova:676), read off the live
     * player entity: Accel 101.9 px/s², top speed 165.6 px/s, and a turn
     * of 1.18 rad/s, so turning round to brake takes about 2.7 s. The
     * braking curve ignored that turn and the ship sailed through the 28
     * px window of the 17 x 31 station for five minutes without landing.
     */
    const SLOW_TURNING_HULL = {
        acceleration: 101.88, maxVelocity: 165.6, turnRate: 1.178,
    };
    /** Stock inertialess hulls (base data): the nimble Vell-os Dart
     * (nova:173), the slow-turning Wraith Adult (nova:185) and the Raven
     * (nova:164). An inertialess hull keeps its speed until it brakes. */
    const DART = { acceleration: 225, maxVelocity: 270, turnRate: 5.236 };
    const WRAITH_ADULT = {
        acceleration: 79.2, maxVelocity: 153, turnRate: 1.5708,
    };
    const RAVEN = { acceleration: 63, maxVelocity: 101.25, turnRate: 2.0944 };
    const cases: Array<{
        name: string, frame: [number, number], offset: [number, number],
        inertialess?: boolean,
        physics?: typeof SLOW_TURNING_HULL,
        /** Engaged while flying ACROSS the line to the stellar at top
         * speed, rather than from rest. */
        flyingPast?: boolean,
    }> = [
        { name: 'a 17x31 station in a slow-turning heavy hull (Auroran LP V '
            + 'in a Thunderforge)', frame: [17, 31], offset: [-300, 150],
            physics: SLOW_TURNING_HULL },
        { name: 'a 17x31 station in a slow-turning heavy hull, from afar',
            frame: [17, 31], offset: [1400, -900],
            physics: SLOW_TURNING_HULL },
        { name: 'a tiny 15x21 station, straight on',
            frame: [15, 21], offset: [0, 900] },
        { name: 'a tiny 15x21 station, on the diagonal',
            frame: [15, 21], offset: [-700, -700] },
        { name: 'a 17x31 station, inertialess',
            frame: [17, 31], offset: [600, -300], inertialess: true },
        { name: 'a big 325 px planet, on the diagonal',
            frame: [325, 325], offset: [1200, 1200] },
        { name: 'a big 325 px planet, inertialess',
            frame: [325, 325], offset: [-1500, 200], inertialess: true },
        { name: 'a 250 px planet (window 435, clearance zone 249)',
            frame: [250, 250], offset: [1000, 0] },
        { name: 'a 17x31 station in a Vell-os Dart flying past at top speed',
            frame: [17, 31], offset: [600, -300], inertialess: true,
            physics: DART, flyingPast: true },
        { name: 'a 17x31 station in a Wraith Adult flying past at top speed',
            frame: [17, 31], offset: [-200, 150], inertialess: true,
            physics: WRAITH_ADULT, flyingPast: true },
        { name: 'a 17x31 station in a Raven, from rest',
            frame: [17, 31], offset: [900, 400], inertialess: true,
            physics: RAVEN },
    ];
    for (const { name, frame, offset, inertialess, physics, flyingPast }
        of cases) {
        it(`lands on ${name}`, async () => {
            const { world, ship, planet } = await harness(frame,
                SYNTHETIC.ships.skiff);
            // Through ShipPhysicsComponent, the per-tick source: the
            // EffectiveMovementPhysicsSystem rewrites MovementPhysics from
            // it every tick, so an override of MovementPhysics itself
            // would last one tick.
            ship.components.set(ShipPhysicsComponent, {
                ...ship.components.get(ShipPhysicsComponent)!,
                ...(physics ? {
                    acceleration: physics.acceleration,
                    speed: physics.maxVelocity,
                    turnRate: physics.turnRate,
                } : {}),
                ...(inertialess ? { inertialess: true } : {}),
            });
            world.step();
            const flown = ship.components.get(MovementPhysicsComponent)!;
            if (physics) {
                // Flown at whole degrees a frame (E6B wave 52).
                expect(flown.turnRate)
                    .toBeCloseTo(unchargedTurnRate(physics.turnRate), 9);
            }
            expect(flown.movementType).toBe(inertialess
                ? MovementType.INERTIALESS : MovementType.INERTIAL);
            const centre = planet.components.get(MovementStateComponent)!
                .position;
            const movement = ship.components.get(MovementStateComponent)!;
            movement.position = new Position(centre.x + offset[0],
                centre.y + offset[1]);
            movement.velocity = new Vector(0, 0);
            if (flyingPast) {
                // Nose (and velocity) square to the line to the stellar.
                const across = new Position(centre.x, centre.y)
                    .subtract(movement.position).angle.add(Math.PI / 2);
                movement.rotation = across;
                movement.velocity = across.getUnitVector()
                    .scale(flown.maxVelocity);
                movement.targetSpeed = flown.maxVelocity;
            }

            const autopilot = new Autopilot({
                controlEvents: events =>
                    applyControlEvents(world, PEER, events),
                analogControl: control =>
                    applyAnalogControl(world, PEER, control),
            });
            autopilot.navigateTo(PORT);
            const { lands, ticks } = fly(world, autopilot, 30 * 60);

            expect(lands).withContext(`after ${ticks} ticks`).toEqual([PORT]);
            const at = ship.components.get(MovementStateComponent)!;
            const range = stellarLandingRange(
                planet.components.get(PlanetDataComponent));
            expect(landingDistance(at.position.x - centre.x,
                at.position.y - centre.y)).toBeLessThanOrEqual(range);
        }, 60_000);
    }

    /**
     * The system is a torus (positions wrap over ±BOUNDARY). Matthew's
     * playtest: the landing autopilot "doesn't quite account for screen
     * wrapping, unlike holding `a`". It measured the planet by the plain
     * coordinate difference, so with the ship just past one edge and the
     * stellar just inside the other it set off the long way round,
     * across the whole system. It now flies the short hop over the seam,
     * as 'pointTo' (Position.subtract) does, and the sim's landing check
     * (also Position.subtract) lands it there.
     */
    const seamCases: Array<{
        name: string, planetAt: [number, number], shipAt: [number, number],
        inertialess?: boolean,
    }> = [
        { name: 'across the x seam (ship past +x, planet inside -x)',
            planetAt: [-BOUNDARY + 150, 300],
            shipAt: [BOUNDARY - 350, 300] },
        { name: 'across the x seam the other way, inertialess',
            planetAt: [BOUNDARY - 120, -200],
            shipAt: [-BOUNDARY + 380, -200], inertialess: true },
        { name: 'across the y seam on the diagonal',
            planetAt: [400, BOUNDARY - 100],
            shipAt: [100, -BOUNDARY + 250] },
        { name: 'across both seams at the corner, inertialess',
            planetAt: [-BOUNDARY + 80, -BOUNDARY + 60],
            shipAt: [BOUNDARY - 300, BOUNDARY - 240], inertialess: true },
    ];
    for (const { name, planetAt, shipAt, inertialess } of seamCases) {
        it(`lands the short way ${name}`, async () => {
            const { world, ship, planet } = await harness([72, 72],
                SYNTHETIC.ships.skiff);
            if (inertialess) {
                ship.components.set(ShipPhysicsComponent, {
                    ...ship.components.get(ShipPhysicsComponent)!,
                    inertialess: true,
                });
                world.step();
            }
            const planetMovement =
                planet.components.get(MovementStateComponent)!;
            planetMovement.position = new Position(...planetAt);
            const movement = ship.components.get(MovementStateComponent)!;
            movement.position = new Position(...shipAt);
            movement.velocity = new Vector(0, 0);
            const start = planetMovement.position
                .subtract(movement.position).length;
            // Across the seam: the plain coordinate difference is most of
            // the world, the wrapped one a few hundred px.
            expect(Math.hypot(planetAt[0] - shipAt[0],
                planetAt[1] - shipAt[1])).toBeGreaterThan(BOUNDARY);
            expect(start).toBeLessThan(600);

            const autopilot = new Autopilot({
                controlEvents: events =>
                    applyControlEvents(world, PEER, events),
                analogControl: control =>
                    applyAnalogControl(world, PEER, control),
            });
            autopilot.navigateTo(PORT);
            const lands: string[] = [];
            world.events.get(LandEvent).subscribe(({ data }) =>
                lands.push(data.uuid));
            let farthest = start;
            let ticks = 0;
            for (; ticks < 30 * 60 && lands.length === 0; ticks++) {
                autopilot.step(world, PEER);
                world.step();
                farthest = Math.max(farthest, planet.components
                    .get(MovementStateComponent)!.position.subtract(
                        ship.components.get(MovementStateComponent)!
                            .position).length);
            }
            expect(lands).withContext(`after ${ticks} ticks`)
                .toEqual([PORT]);
            // It never turned away to go round: never farther than where
            // it started (plus a little overshoot while braking).
            expect(farthest).toBeLessThan(start + 100);
            expect(ticks).toBeLessThan(30 * 30);
        }, 60_000);
    }

    it('approaches no faster than it can turn round and stop from', () => {
        // No turn to make: the plain bang-bang sqrt(2 a d).
        expect(stoppableSpeed(100, 0, 200)).toBeCloseTo(200, 9);
        // The Thunderforge's 2.7 s half-turn at 300 px out: coasting
        // 2.7 s, then braking, ends exactly at the planet.
        const turn = Math.PI / SLOW_TURNING_HULL.turnRate;
        const v = stoppableSpeed(SLOW_TURNING_HULL.acceleration, turn, 300);
        expect(v * turn + v * v / (2 * SLOW_TURNING_HULL.acceleration))
            .toBeCloseTo(300, 6);
        expect(v).toBeLessThan(Math.sqrt(2 * 101.88 * 300) / 2);
        expect(stoppableSpeed(100, 2, 0)).toBe(0);
        expect(stoppableSpeed(0, 2, 100)).toBe(0);
    });

    it('taps land at once from a corner of the square, outside the circle '
        + 'of the same half-width', async () => {
            const { world, ship, planet } = await harness([40, 40],
                SYNTHETIC.ships.skiff);
            const range = stellarLandingRange(
                planet.components.get(PlanetDataComponent));
            const centre = planet.components.get(MovementStateComponent)!
                .position;
            const movement = ship.components.get(MovementStateComponent)!;
            // 0.85 R along both axes: inside the square's 90% aim, 1.2 R
            // from the centre.
            const corner = 0.85 * range;
            movement.position = new Position(centre.x + corner,
                centre.y - corner);
            movement.velocity = new Vector(0, 0);
            const sent: string[] = [];
            const autopilot = new Autopilot({
                controlEvents: events => {
                    sent.push(...events.map(e => `${e.action}:${e.state}`));
                    applyControlEvents(world, PEER, events);
                },
                analogControl: control =>
                    applyAnalogControl(world, PEER, control),
            });
            autopilot.navigateTo(PORT);
            const cleared: string[] = [];
            world.events.get(LandingClearedEvent).subscribe(({ data }) =>
                cleared.push(data.kind));
            const { lands, ticks } = fly(world, autopilot, 60);
            // The first tap clears the ship (wave 31: only a cleared ship
            // lands), the next one lands.
            expect(sent[0]).toEqual('land:start');
            expect(cleared).toEqual(['planet']);
            expect(sent.filter(s => s === 'land:start').length).toBe(2);
            expect(lands).toEqual([PORT]);
            expect(ticks).toBeLessThan(40);
        }, 60_000);

    it('aims inside the 249 px clearance zone at a big planet whose window '
        + 'is wider, and lands from there', () => {
            const big = { ...getDefaultPlanetData(),
                spriteFrameSize: [250, 250] as [number, number] };
            expect(stellarLandingRange(big)).toBe(437);
            expect(stellarApproachRange(big)).toBe(STELLAR_CLEARANCE_RANGE);
            const small = { ...getDefaultPlanetData(),
                spriteFrameSize: [72, 72] as [number, number] };
            expect(stellarApproachRange(small)).toBe(126);
        });
});
