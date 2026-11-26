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
    FormationCell, FormationComponent, FORMATION_SLOT_DEADBAND, formationSpacing,
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
