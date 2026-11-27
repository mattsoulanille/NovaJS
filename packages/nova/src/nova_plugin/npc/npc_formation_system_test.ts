import 'jasmine';
import { getDefaultShipData, getDefaultShipPhysics, ShipData } from 'novadatainterface/ship_data';
import { Angle } from 'nova_ecs/datatypes/angle';
import { Position } from 'nova_ecs/datatypes/position';
import { Vector } from 'nova_ecs/datatypes/vector';
import { Entity } from 'nova_ecs/entity';
import {
    MovementPhysicsComponent, MovementPlugin, MovementStateComponent,
    MovementType,
} from 'nova_ecs/plugins/movement_plugin';
import { TimePlugin, useFixedTimestep } from 'nova_ecs/plugins/time_plugin';
import { World } from 'nova_ecs/world';
import { SIMULATION_STEP_MS } from '../make_system.js';
import { BayFighterComponent, ShipDataComponent, ShipPhysicsComponent } from '../ship/index.js';
import {
    FormationCell, FormationComponent, FORMATION_SLOT_DEADBAND,
    formationSlotPosition, formationSpacing,
} from './npc_formation.js';
import { FormationSystem } from './npc_formation_system.js';

/**
 * ============================================================================
 * The formation step is the GROUP's: the largest sprite frame among the
 * leader and every escort in its formation (reference F1b)
 * ============================================================================
 *
 * On the original, a 24 px leader with escorts of 96/24/96/24 px frames
 * puts all four escorts at the 96 px spacing. FormationSystem reads each
 * member's ShipData.spriteFrameWidth and recomputes the step from the live
 * group, so an escort joining or leaving re-spaces everyone.
 */

const LEADER = 'leader';

function hull(spriteFrameWidth: number): ShipData {
    return {
        ...getDefaultShipData(),
        spriteFrameWidth,
        // Nimble enough to settle well inside the run.
        physics: {
            ...getDefaultShipPhysics(), speed: 300, acceleration: 300,
            turnRate: Math.PI,
        },
    };
}

function ship(data: ShipData, position: Position): Entity {
    const entity = new Entity();
    entity.components.set(ShipDataComponent, data);
    entity.components.set(ShipPhysicsComponent, data.physics);
    entity.components.set(MovementPhysicsComponent, {
        acceleration: data.physics.acceleration,
        maxVelocity: data.physics.speed,
        movementType: MovementType.INERTIAL,
        turnRate: data.physics.turnRate,
    });
    entity.components.set(MovementStateComponent, {
        accelerating: 0, position, rotation: new Angle(0), turnBack: false,
        turning: 0, velocity: new Vector(0, 0),
    });
    return entity;
}

async function formationWorld(leaderWidth: number, escortWidths: number[]) {
    const world = new World('formation group spacing test');
    await world.addPlugin(TimePlugin);
    useFixedTimestep(world, SIMULATION_STEP_MS);
    await world.addPlugin(MovementPlugin);
    world.addComponent(FormationComponent);
    world.addComponent(ShipDataComponent);
    world.addComponent(ShipPhysicsComponent);
    world.addComponent(BayFighterComponent);
    world.addSystem(FormationSystem);
    // The leader at rest at the origin facing "up" (angle 0).
    world.entities.set(LEADER, ship(hull(leaderWidth), new Position(0, 0)));
    escortWidths.forEach((width, slot) => {
        const escort = ship(hull(width), new Position(30 * slot - 45, 80));
        escort.components.set(FormationComponent, { leader: LEADER, slot });
        world.entities.set(`escort-${slot}`, escort);
    });
    return world;
}

/** Where escort `slot` sets off (formationWorld). */
function startOf(slot: number): [number, number] {
    return [30 * slot - 45, 80];
}

function positionOf(world: World, uuid: string): [number, number] {
    const { position } = world.entities.get(uuid)!
        .components.get(MovementStateComponent)!;
    return [position.x, position.y];
}

/**
 * Expects `uuid` parked for the station at [astern, left of the heading]
 * (the leader at the origin facing up): inside the slot dead band,
 * on the straight line from `from` (where it set off) to the station
 * (reference "F1c re-flow offsets, wave 36": each escort stops 7.7-11.5 px
 * short on the line from its old slot). The layouts' stations are 23.5 px
 * or more apart, so a wrong one fails the band or the line.
 */
function expectParked(world: World, uuid: string, from: [number, number],
    [back, left]: [number, number], context = uuid) {
    const [x, y] = positionOf(world, uuid);
    const station = [-left, back];
    const rest = [station[0] - x, station[1] - y];
    const line = [station[0] - from[0], station[1] - from[1]];
    const lineLength = Math.hypot(line[0], line[1]);
    expect(Math.hypot(rest[0], rest[1])).withContext(context)
        .toBeLessThanOrEqual(FORMATION_SLOT_DEADBAND);
    // Within 2 px of that line (a hull that sets off at rest facing away
    // curves a little as it turns; a long run in may overshoot and settle
    // back from the far side, still on the line).
    expect(Math.abs(rest[0] * line[1] - rest[1] * line[0]) / lineLength)
        .withContext(context).toBeLessThan(2);
}

function stepSeconds(world: World, seconds: number) {
    for (let i = 0; i < seconds * 1000 / SIMULATION_STEP_MS; i++) {
        world.step();
    }
}

describe('FormationSystem group spacing (reference F1b)', () => {
    it('spaces every escort by the LARGEST frame in the formation: a 24 px '
        + 'leader with 96/24/96/24 px escorts flies at the 96 px step',
        async () => {
            const world = await formationWorld(24, [96, 24, 96, 24]);
            stepSeconds(world, 30);
            const a = formationSpacing(96);
            expect(a).toBeCloseTo(56.6, 1);
            const expected: Array<[number, number]> =
                [[a, a], [a, -a], [2 * a, 2 * a], [2 * a, -2 * a]];
            expected.forEach((station, slot) => expectParked(world,
                `escort-${slot}`, startOf(slot), station));
        });

    it('counts the leader\'s frame too', async () => {
        const world = await formationWorld(200, [24, 24]);
        stepSeconds(world, 30);
        expect(formationSpacing(200)).toBeCloseTo(59.5, 1);
        expectParked(world, 'escort-0', startOf(0), [59.5, 59.5]);
        expectParked(world, 'escort-1', startOf(1), [59.5, -59.5]);
    });

    it('re-spaces the formation when its largest escort leaves', async () => {
        const world = await formationWorld(24, [24, 96]);
        stepSeconds(world, 30);
        expectParked(world, 'escort-0', startOf(0), [56.6, 56.6]);
        const parked = positionOf(world, 'escort-0');
        world.entities.delete('escort-1');
        stepSeconds(world, 30);
        expectParked(world, 'escort-0', parked, [23.5, 23.5]);
    });
});

/** Where a follower's station is for `cell` at step `a`, in
 * expectParked's [astern, left] frame (a cell's steps are to the RIGHT). */
function expected(cell: FormationCell, a: number): [number, number] {
    return [Math.round(cell[0] * a * 10) / 10,
        Math.round(-cell[1] * a * 10) / 10 + 0];
}

describe('FormationSystem count layouts (reference F1c)', () => {
    const a = 23.5;

    it('flies nine 24 px escorts on the measured 9-layout', async () => {
        const world = await formationWorld(24, Array(9).fill(24));
        stepSeconds(world, 40);
        const nine: FormationCell[] = [[1, -1], [1, 1], [2, 0], [2, -2],
            [2, 2], [3, -1], [3, 1], [3, -3], [3, 3]];
        nine.forEach((cell, slot) => expectParked(world, `escort-${slot}`,
            startOf(slot), expected(cell, a)));
    });

    it('re-flows the whole group to the 8-layout when the centre escort '
        + 'leaves nine', async () => {
            const world = await formationWorld(24, Array(9).fill(24));
            stepSeconds(world, 40);
            const before = new Map([0, 1, 3, 4, 5, 6, 7, 8].map(slot =>
                [slot, positionOf(world, `escort-${slot}`)] as const));
            world.entities.delete('escort-2');
            stepSeconds(world, 40);
            // The eight left, in rank order (slot 2 gone), and the 8-layout:
            // the old rank 3 moves out to row 2's left outer cell, the
            // centre is taken by the old rank 7, the right outer of row 3
            // is empty.
            const slots = [0, 1, 3, 4, 5, 6, 7, 8];
            const eight: FormationCell[] = [[1, -1], [1, 1], [2, -2], [2, 2],
                [3, -1], [3, 1], [2, 0], [3, -3]];
            // Each re-flowed escort parks short of its new station on the
            // line from where it sat (wave 36); one whose station did not
            // move (inside its band) stays put.
            slots.forEach((slot, rank) => {
                const uuid = `escort-${slot}`;
                const station = expected(eight[rank]!, a);
                const from = before.get(slot)!;
                const moved = Math.hypot(-station[1] - from[0],
                    station[0] - from[1]) > FORMATION_SLOT_DEADBAND;
                if (moved) {
                    expectParked(world, uuid, from, station);
                } else {
                    expect(positionOf(world, uuid)).withContext(uuid)
                        .toEqual(from);
                }
            });
        });

    it('ranks hired escorts ahead of a bay fighter with a lower slot',
        async () => {
            const world = await formationWorld(24, [24, 24, 24]);
            world.entities.get('escort-0')!.components.set(BayFighterComponent,
                { bayWeaponId: 'nova:200' });
            stepSeconds(world, 30);
            // Three followers: the hired slots 1 and 2 take row 1, the
            // fighter (slot 0) the centre behind them.
            const near = (slot: number, cell: FormationCell) =>
                expectParked(world, `escort-${slot}`, startOf(slot),
                    expected(cell, a));
            near(1, [1, -1]);
            near(2, [1, 1]);
            near(0, [2, 0]);
        });
});

/**
 * ============================================================================
 * Inertialess escorts settle into their slots and hold them (Matthew's
 * playtest, 2026-11-26: they "spin around towards their desired position")
 * ============================================================================
 *
 * An inertialess hull's velocity is its heading times a throttled
 * targetSpeed (movement_plugin's inertialessControls). The inertial
 * controller never braked it and its RCS nudges were undone every tick, so
 * every stock inertialess escort looped through its slot for good, the
 * nose sweeping all the way round. These fly the real MovementPlugin
 * integrator, 60 Hz, with hulls of the stock inertialess figures (shïp
 * Speed/Accel/Turn converted): the Vell-os Dart (nimble, 32 px frame), the
 * Vell-os Javelin and the Raven (slow, 192 px frame: the 59.5 px step).
 */
describe('FormationSystem flying INERTIALESS escorts', () => {
    interface Hull {
        name: string, speed: number, acceleration: number, turnRate: number,
        frame: number
    }
    /** A held heading (rad): steady to well under a pixel's turn of a
     * 192 px hull. */
    const HEADING_STEADY = 1e-3;
    const HULLS: Hull[] = [
        { name: 'Dart', speed: 270, acceleration: 225, turnRate: 5.236, frame: 32 },
        { name: 'Javelin', speed: 168.75, acceleration: 90, turnRate: 2.094, frame: 88 },
        { name: 'Raven', speed: 101.25, acceleration: 63, turnRate: 2.094, frame: 192 },
    ];

    function inertialessShip(h: Hull, position: Position,
        rotation = 0): Entity {
        const data: ShipData = {
            ...getDefaultShipData(), spriteFrameWidth: h.frame,
            physics: {
                ...getDefaultShipPhysics(), speed: h.speed,
                acceleration: h.acceleration, turnRate: h.turnRate,
                inertialess: true,
            },
        };
        const entity = ship(data, position);
        entity.components.set(MovementPhysicsComponent, {
            acceleration: h.acceleration, maxVelocity: h.speed,
            movementType: MovementType.INERTIALESS, turnRate: h.turnRate,
        });
        entity.components.get(MovementStateComponent)!.rotation =
            new Angle(rotation);
        return entity;
    }

    /** Six inertialess escorts of hull `h` scattered round a leader at
     * the origin facing up, at rest (its own hull: inertial, never
     * steered). The even slots are coming back from elsewhere (a fight, a
     * jump in) at full speed on their own headings; the odd ones sit
     * still. */
    async function inertialessWorld(h: Hull) {
        const world = await formationWorld(h.frame, []);
        for (let slot = 0; slot < 6; slot++) {
            const escort = inertialessShip(h,
                new Position(70 * slot - 175, 120 + 40 * (slot % 2)),
                slot * 1.1);
            if (slot % 2 === 0) {
                const state = escort.components.get(MovementStateComponent)!;
                state.velocity = state.rotation.getUnitVector().scale(h.speed);
                state.targetSpeed = h.speed;
            }
            escort.components.set(FormationComponent, { leader: LEADER, slot });
            world.entities.set(`escort-${slot}`, escort);
        }
        return world;
    }

    function leaderState(world: World) {
        return world.entities.get(LEADER)!.components
            .get(MovementStateComponent)!;
    }

    function setLeader(world: World, velocity: Vector, rotation: Angle) {
        const leader = leaderState(world);
        leader.velocity = velocity;
        leader.rotation = rotation;
    }

    /**
     * Steps `seconds` (calling `each` before every step) and returns, per
     * escort: the largest distance from its slot, how far it moved RELATIVE
     * to the leader, how often its turn direction reversed, and its heading
     * spread.
     */
    function watch(world: World, seconds: number, each?: () => void) {
        const a = formationSpacing(world.entities.get(LEADER)!.components
            .get(ShipDataComponent)!.spriteFrameWidth!);
        const stats = new Map<string, {
            maxError: number, minError: number, drift: number,
            reversals: number, minHeading: number, maxHeading: number,
            first?: Vector, lastHeading?: number, lastTurn: number,
        }>();
        for (let i = 0; i < seconds * 1000 / SIMULATION_STEP_MS; i++) {
            each?.();
            world.step();
            const leader = leaderState(world);
            for (let slot = 0; slot < 6; slot++) {
                const uuid = `escort-${slot}`;
                const state = world.entities.get(uuid)!.components
                    .get(MovementStateComponent)!;
                const s = stats.get(uuid) ?? {
                    maxError: 0, minError: Infinity, drift: 0, reversals: 0,
                    minHeading: Infinity, maxHeading: -Infinity, lastTurn: 0,
                };
                stats.set(uuid, s);
                const station = formationSlotPosition(
                    Position.fromVectorLike(leader.position),
                    Angle.fromAngleLike(leader.rotation), slot, a, 6);
                const error = station.subtract(state.position).length;
                s.maxError = Math.max(s.maxError, error);
                s.minError = Math.min(s.minError, error);
                const offset = Position.fromVectorLike(state.position)
                    .subtract(leader.position);
                s.first ??= offset;
                s.drift = Math.max(s.drift, offset.subtract(s.first).length);
                // Unwrapped heading: the turn since the last step.
                const heading = state.rotation.angle;
                if (s.lastHeading !== undefined) {
                    const turn = new Angle(s.lastHeading)
                        .distanceTo(new Angle(heading)).angle;
                    const sign = Math.abs(turn) < 1e-9 ? 0 : Math.sign(turn);
                    if (sign !== 0 && s.lastTurn !== 0 && sign !== s.lastTurn) {
                        s.reversals++;
                    }
                    if (sign !== 0) {
                        s.lastTurn = sign;
                    }
                }
                s.lastHeading = heading;
                s.minHeading = Math.min(s.minHeading, heading);
                s.maxHeading = Math.max(s.maxHeading, heading);
            }
        }
        return stats;
    }

    for (const h of HULLS) {
        it(`${h.name}: settles in from scattered starts (some at full `
            + 'speed) within 20 s and '
            + 'then holds its slot still, facing the leader\'s heading',
            async () => {
                const world = await inertialessWorld(h);
                stepSeconds(world, 20);
                const held = watch(world, 10);
                for (const [uuid, s] of held) {
                    const context = `${h.name} ${uuid}`;
                    expect(s.maxError).withContext(context)
                        .toBeLessThanOrEqual(FORMATION_SLOT_DEADBAND);
                    expect(s.drift).withContext(context).toBeLessThan(0.5);
                    expect(s.maxHeading - s.minHeading).withContext(context)
                        .toBeLessThan(HEADING_STEADY);
                    const state = world.entities.get(uuid)!.components
                        .get(MovementStateComponent)!;
                    expect(Math.abs(state.rotation.distanceTo(new Angle(0))
                        .angle)).withContext(context).toBeLessThan(HEADING_STEADY);
                    expect(state.velocity.length).withContext(context)
                        .toBeLessThan(0.05);
                }
            });

        it(`${h.name}: follows a cruising leader, then stops with it within `
            + '10 s and holds, with no heading churn', async () => {
                const world = await inertialessWorld(h);
                stepSeconds(world, 20);
                // Cruise "up" at 60% of the escorts' top speed.
                const cruise = new Vector(0, -0.6 * h.speed);
                setLeader(world, cruise, new Angle(0));
                stepSeconds(world, 10);
                const cruising = watch(world, 10);
                // The leader stops dead.
                setLeader(world, new Vector(0, 0), new Angle(0));
                stepSeconds(world, 10);
                const stopped = watch(world, 10);
                for (const [uuid, s] of cruising) {
                    const context = `${h.name} ${uuid} cruising`;
                    expect(s.maxError).withContext(context)
                        .toBeLessThanOrEqual(FORMATION_SLOT_DEADBAND);
                    expect(s.drift).withContext(context).toBeLessThan(0.5);
                    expect(s.maxHeading - s.minHeading).withContext(context)
                        .toBeLessThan(HEADING_STEADY);
                }
                for (const [uuid, s] of stopped) {
                    const context = `${h.name} ${uuid} stopped`;
                    expect(s.maxError).withContext(context)
                        .toBeLessThanOrEqual(FORMATION_SLOT_DEADBAND);
                    expect(s.drift).withContext(context).toBeLessThan(0.5);
                    expect(s.maxHeading - s.minHeading).withContext(context)
                        .toBeLessThan(HEADING_STEADY);
                }
            });

        it(`${h.name}: follows a leader coasting slowly with its nose off `
            + 'its course without twitching', async () => {
                // An inertial leader coasting at 27 px/s, its nose 0.3 rad
                // off its course (the playtest's Shuttle after a burn).
                const world = await inertialessWorld(h);
                stepSeconds(world, 20);
                setLeader(world, new Angle(0.3).getUnitVector().scale(27),
                    new Angle(0));
                stepSeconds(world, 20);
                const coasting = watch(world, 10);
                for (const [uuid, s] of coasting) {
                    const context = `${h.name} ${uuid}`;
                    expect(s.reversals).withContext(context).toBe(0);
                    expect(s.maxHeading - s.minHeading).withContext(context)
                        .toBeLessThan(HEADING_STEADY);
                    expect(s.maxError).withContext(context)
                        .toBeLessThanOrEqual(FORMATION_SLOT_DEADBAND);
                }
            });

        it(`${h.name}: holds station round a leader turning at cruise `
            + 'without chattering its nose', async () => {
                // The Dart sat on the old dead band's edge here, its nose
                // kicked a full turn step either way every few ticks.
                const world = await inertialessWorld(h);
                stepSeconds(world, 20);
                const speed = 0.6 * h.speed;
                const rate = 0.4;
                let heading = 0;
                const turn = () => {
                    heading += rate * SIMULATION_STEP_MS / 1000;
                    const angle = new Angle(heading);
                    setLeader(world, angle.getUnitVector().scale(speed), angle);
                };
                for (let i = 0; i < 15 * 60; i++) {
                    turn();
                    world.step();
                }
                const turning = watch(world, 10, turn);
                for (const [uuid, s] of turning) {
                    const context = `${h.name} ${uuid}`;
                    // Turning steadily one way, with the leader.
                    expect(s.reversals).withContext(context).toBe(0);
                }
                // The front row holds a STEADY offset: it trails its slot
                // by a constant lag (its pull balancing the slot's swing,
                // which the leader's velocity alone does not feed forward;
                // the outer ranks of a big hull cannot keep up at all,
                // their slots outrunning its top speed).
                for (const uuid of ['escort-0', 'escort-1']) {
                    const s = turning.get(uuid)!;
                    const context = `${h.name} ${uuid}`;
                    expect(s.maxError - s.minError).withContext(context)
                        .toBeLessThan(0.5);
                    expect(s.maxError).withContext(context)
                        .toBeLessThan(3 * FORMATION_SLOT_DEADBAND);
                }
            });
    }
});
