import 'jasmine';
import { Entity } from 'nova_ecs/entity';
import { Angle } from 'nova_ecs/datatypes/angle';
import { Position } from 'nova_ecs/datatypes/position';
import { Vector } from 'nova_ecs/datatypes/vector';
import {
    MovementPhysicsComponent, MovementState, MovementStateComponent,
    MovementType,
} from 'nova_ecs/plugins/movement_plugin';
import {
    FixedTimestepResource, TimePlugin,
} from 'nova_ecs/plugins/time_plugin';
import { MovementTimeLimitResource } from 'nova_ecs/plugins/movement_plugin';
import { World } from 'nova_ecs/world';
import {
    MAX_EXTRAPOLATION_DELTA_MS, MovementExtrapolationPlugin,
} from './movement_extrapolation_plugin.js';

const STEP_MS = 1000 / 60;

function makeMovementState(overrides: Partial<MovementState> = {}): MovementState {
    return {
        position: new Position(0, 0),
        velocity: new Vector(0, 0),
        rotation: new Angle(0),
        turning: 0,
        turnBack: false,
        accelerating: 0,
        ...overrides,
    };
}

// The display world only ever showed the last simulation snapshot that
// happened to arrive: a rAF with no fresh snapshot (a steps=0 pump, or a
// worker round trip landing a frame late — roughly one frame in ten in
// the 2026-08-31 Linux playtest trace) rendered a pixel-identical
// duplicate and the next frame double-stepped. These specs pin the fix:
// the display world itself integrates motion between snapshots.
describe('MovementExtrapolationPlugin', () => {
    let world: World;

    beforeEach(async () => {
        world = new World('display test');
        await world.addPlugin(TimePlugin);
        // The real display world runs on the wall clock; the test pins
        // the delta instead so the expected displacement is exact.
        world.resources.set(FixedTimestepResource, { delta_ms: STEP_MS });
        await world.addPlugin(MovementExtrapolationPlugin);
    });

    it('advances a mover between simulation snapshots', () => {
        const ship = new Entity('ship')
            .addComponent(MovementStateComponent, makeMovementState({
                velocity: new Vector(60, 0),
            }))
            .addComponent(MovementPhysicsComponent, {
                maxVelocity: 300,
                turnRate: 1,
                acceleration: 100,
                movementType: MovementType.INERTIAL,
            });
        world.entities.set('ship', ship);

        // Two display frames with no new simulation frame: the ship
        // must keep moving at its velocity (the missed-pump case).
        world.step();
        world.step();

        const state = ship.components.get(MovementStateComponent)!;
        expect(state.position.x)
            .toBeCloseTo(2 * 60 * (STEP_MS / 1000), 5);
        expect(state.position.y).toBeCloseTo(0, 5);
    });

    it('extrapolates from a fresh authoritative snapshot after an overwrite', () => {
        const ship = new Entity('ship')
            .addComponent(MovementStateComponent, makeMovementState({
                velocity: new Vector(60, 0),
            }))
            .addComponent(MovementPhysicsComponent, {
                maxVelocity: 300,
                turnRate: 1,
                acceleration: 100,
                movementType: MovementType.INERTIAL,
            });
        world.entities.set('ship', ship);
        world.step();

        // A simulation frame arrives: applySimulationFrame overwrites
        // MovementState wholesale. Local extrapolation must continue
        // from the authoritative state, not fight it.
        ship.components.set(MovementStateComponent, makeMovementState({
            position: new Position(100, 50),
            velocity: new Vector(0, -60),
        }));
        world.step();

        const state = ship.components.get(MovementStateComponent)!;
        expect(state.position.x).toBeCloseTo(100, 5);
        expect(state.position.y)
            .toBeCloseTo(50 - 60 * (STEP_MS / 1000), 5);
    });

    it('bounds a stalled wall clock to MAX_EXTRAPOLATION_DELTA_MS', () => {
        // A system suspend or debugger pause makes one wall-clock delta
        // huge; integrating it would teleport everything until the next
        // snapshot yanked it back.
        const ship = new Entity('ship')
            .addComponent(MovementStateComponent, makeMovementState({
                velocity: new Vector(60, 0),
            }))
            .addComponent(MovementPhysicsComponent, {
                maxVelocity: 300,
                turnRate: 1,
                acceleration: 100,
                movementType: MovementType.INERTIAL,
            });
        world.entities.set('ship', ship);

        world.resources.set(FixedTimestepResource, { delta_ms: 10_000 });
        world.step();

        const state = ship.components.get(MovementStateComponent)!;
        expect(state.position.x)
            .toBeCloseTo(60 * (MAX_EXTRAPOLATION_DELTA_MS / 1000), 5);
        expect(state.position.y).toBeCloseTo(0, 5);
    });

    it('freezes prediction while the limit is disabled (paused sim)', () => {
        // browser.ts flips `enabled` off while novaSim is paused: a
        // paused simulation sends no correcting snapshots, so
        // wall-clock prediction must halt with it.
        const ship = new Entity('ship')
            .addComponent(MovementStateComponent, makeMovementState({
                velocity: new Vector(60, 0),
                turning: 1,
            }))
            .addComponent(MovementPhysicsComponent, {
                maxVelocity: 300,
                turnRate: 1,
                acceleration: 100,
                movementType: MovementType.INERTIAL,
            });
        world.entities.set('ship', ship);

        const limit = world.resources.get(MovementTimeLimitResource)!;
        expect(limit).toBeDefined();
        limit.enabled = false;
        world.step();

        let state = ship.components.get(MovementStateComponent)!;
        expect(state.position.x).toBe(0);
        expect(state.rotation.angle).toBe(0);

        // Resuming picks prediction back up.
        limit.enabled = true;
        world.step();
        state = ship.components.get(MovementStateComponent)!;
        expect(state.position.x)
            .toBeCloseTo(60 * (STEP_MS / 1000), 5);
    });

    it('leaves display-only entities without MovementPhysics alone', () => {
        // Explosions and debris sparks carry MovementState (a position
        // for the draw systems) but no physics; extrapolating them
        // would fight their own display systems.
        const explosion = new Entity('explosion')
            .addComponent(MovementStateComponent, makeMovementState({
                position: new Position(10, 20),
                velocity: new Vector(60, 60),
            }));
        world.entities.set('explosion', explosion);

        world.step();

        const state = explosion.components.get(MovementStateComponent)!;
        expect(state.position.x).toBe(10);
        expect(state.position.y).toBe(20);
    });
});
