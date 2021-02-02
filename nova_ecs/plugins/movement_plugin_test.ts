import 'jasmine';
import { v4 } from 'uuid';
import { Angle } from '../datatypes/angle';
import { Position } from '../datatypes/position';
import { Vector, VectorLike } from '../datatypes/vector';
import { EntityBuilder } from '../entity';
import { System } from '../system';
import { World } from '../world';
import { MovementPhysicsComponent, MovementPlugin, MovementStateComponent, MovementSystem, MovementType } from './movement_plugin';
import { TimePlugin } from './time_plugin';

describe('Movement Plugin', () => {
    let world: World;
    let clock: jasmine.Clock;
    beforeEach(() => {
        clock = jasmine.clock();
        clock.install();
        clock.mockDate(new Date(100));

        world = new World();
        world.addPlugin(TimePlugin);
        world.addPlugin(MovementPlugin);
    });

    afterEach(() => {
        clock.uninstall();
    });

    it('updates position', () => {
        const velocity = new Vector(10, -7);

        world.entities.set(v4(), new EntityBuilder()
            .addComponent(MovementStateComponent, {
                position: new Position(0, 0),
                accelerating: 0,
                rotation: new Angle(0),
                turnBack: false,
                turning: 0,
                velocity,
            })
            .addComponent(MovementPhysicsComponent, {
                acceleration: 100,
                maxVelocity: 500,
                turnRate: 50,
                movementType: MovementType.INERTIAL,
            }));


        const positions: Position[] = [];
        const reportSystem = new System({
            name: 'ReportSystem',
            args: [MovementStateComponent],
            step: (state) => {
                // Copy the position since it's a draft
                // TODO: Why doe TypeScript think it's a vector and not a position?
                positions.push(state.position.scale(1) as Position);
            },
            after: [MovementSystem],
        });
        world.addSystem(reportSystem);

        world.step();
        clock.tick(1000);
        world.step();

        expect(positions).toEqual([
            Position.fromVectorLike(velocity.scale(0)),
            Position.fromVectorLike(velocity.scale(1)),
        ]);
    });

    it('updates velocity', () => {
        const rotation = new Angle(Math.PI / 4);
        world.entities.set(v4(), new EntityBuilder()
            .addComponent(MovementStateComponent, {
                position: new Position(0, 0),
                accelerating: 1,
                rotation: rotation,
                turnBack: false,
                turning: 0,
                velocity: new Vector(0, 0),
            })
            .addComponent(MovementPhysicsComponent, {
                acceleration: 100,
                maxVelocity: 500,
                turnRate: 50,
                movementType: MovementType.INERTIAL,
            }));


        const velocities: Vector[] = [];
        const reportSystem = new System({
            name: 'ReportSystem',
            args: [MovementStateComponent],
            step: (state) => {
                // Copy the position since it's a draft
                velocities.push(state.velocity.scale(1));
            },
            after: [MovementSystem],
        });
        world.addSystem(reportSystem);

        world.step();
        clock.tick(1000);
        world.step();

        // Inverted clock angles. See ../dataTypes/angle.ts.
        expect(velocities).toEqual([
            new Vector(0, 0),
            new Vector(100 * Math.sin(rotation.angle), -100 * Math.cos(rotation.angle))
        ]);
    });

    it('updates rotation', () => {
        world.entities.set(v4(), new EntityBuilder()
            .addComponent(MovementStateComponent, {
                position: new Position(0, 0),
                accelerating: 1,
                rotation: new Angle(0),
                turnBack: false,
                turning: 1,
                velocity: new Vector(0, 0),
            })
            .addComponent(MovementPhysicsComponent, {
                acceleration: 100,
                maxVelocity: 500,
                turnRate: 50,
                movementType: MovementType.INERTIAL,
            }));


        const rotations: number[] = [];
        const reportSystem = new System({
            name: 'ReportSystem',
            args: [MovementStateComponent],
            step: (state) => {
                // Copy the position since it's a draft
                rotations.push(state.rotation.angle);
            },
            after: [MovementSystem],
        });
        world.addSystem(reportSystem);

        world.step();
        clock.tick(1000);
        world.step();

        expect(rotations).toEqual([
            0,
            new Angle(50).angle,
        ]);
    });
});
