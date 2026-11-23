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
import { ShipDataComponent, ShipPhysicsComponent } from '../ship/index.js';
import { FormationComponent, formationSpacing } from './npc_formation.js';
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

/** Escort offsets from the leader: [astern, left of the heading]. */
function offsets(world: World, count: number): Array<[number, number]> {
    const out: Array<[number, number]> = [];
    for (let slot = 0; slot < count; slot++) {
        const { position } = world.entities.get(`escort-${slot}`)!
            .components.get(MovementStateComponent)!;
        // Facing up (0, -1): astern is +y, left is -x.
        out.push([Math.round(position.y * 10) / 10,
            Math.round(-position.x * 10) / 10]);
    }
    return out;
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
            const expected = [[a, a], [a, -a], [2 * a, 2 * a], [2 * a, -2 * a]];
            offsets(world, 4).forEach(([back, left], slot) => {
                expect(back).withContext(`slot ${slot}`)
                    .toBeCloseTo(expected[slot][0], 0);
                expect(left).withContext(`slot ${slot}`)
                    .toBeCloseTo(expected[slot][1], 0);
            });
        });

    it('counts the leader\'s frame too', async () => {
        const world = await formationWorld(200, [24, 24]);
        stepSeconds(world, 30);
        expect(offsets(world, 2)).toEqual([[59.5, 59.5], [59.5, -59.5]]);
    });

    it('re-spaces the formation when its largest escort leaves', async () => {
        const world = await formationWorld(24, [24, 96]);
        stepSeconds(world, 30);
        expect(offsets(world, 1)).toEqual([[56.6, 56.6]]);
        world.entities.delete('escort-1');
        stepSeconds(world, 30);
        expect(offsets(world, 1)).toEqual([[23.5, 23.5]]);
    });
});
