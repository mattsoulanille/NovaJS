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
    shouldExtrapolate, STALE_SNAPSHOT_MS,
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

    /**
     * ========================================================================
     * A FRAME THE SIMULATION REACHED IS RENDERED AS THE SIMULATION LEFT IT
     * ========================================================================
     *
     * Matthew: "projectiles appear a frame farther away from the firing ship
     * than they should. Perhaps we should apply the interpolation AFTER
     * rendering the frame (so it applies to the next frame if it doesn't get
     * overwritten by a sync from the engine) rather than before."
     *
     * The display stepped, extrapolated and THEN rendered, so an entity whose
     * position had just arrived in a snapshot was drawn at synced + v*dt. On
     * a ship that is invisible — everything on screen leads by the same one
     * frame. On a projectile it is not: it is born at the muzzle of a ship
     * moving a fraction of its speed, so its very first rendered position was
     * already a frame of ITS flight clear of a ship that had barely moved.
     *
     * Expressed per entity (skipUuids) rather than per phase: an entity a
     * snapshot placed since the last step is left exactly there, and one the
     * snapshot did not reach still advances — which is the missed-pump
     * smoothing this plugin exists for, untouched.
     */
    describe('freshly-synced entities', () => {
        /** A mover at the origin doing 60 units/s along +x. */
        function mover(uuid: string) {
            const entity = new Entity(uuid)
                .addComponent(MovementStateComponent, makeMovementState({
                    velocity: new Vector(60, 0),
                }))
                .addComponent(MovementPhysicsComponent, {
                    maxVelocity: 300,
                    turnRate: 1,
                    acceleration: 100,
                    movementType: MovementType.INERTIAL,
                });
            world.entities.set(uuid, entity);
            return entity;
        }

        function skip(...uuids: string[]) {
            world.resources.get(MovementTimeLimitResource)!.skipUuids =
                new Set(uuids);
        }

        function positionOf(entity: Entity) {
            return entity.components.get(MovementStateComponent)!.position.x;
        }

        it('renders an entity synced THIS frame at its synced position',
            () => {
                // The projectile arrived in this frame's snapshot, at the
                // muzzle. It must be drawn there, not a frame downrange.
                const shot = mover('shot');
                skip('shot');
                world.step();
                expect(positionOf(shot)).toBe(0);
            });

        it('still advances an entity the snapshot did NOT reach — the '
            + 'missed-pump smoothing', () => {
                const synced = mover('synced');
                const missed = mover('missed');
                skip('synced');
                world.step();

                expect(positionOf(synced)).toBe(0);
                expect(positionOf(missed))
                    .toBeCloseTo(60 * (STEP_MS / 1000), 5);
            });

        it('advances a previously-synced entity on the NEXT frame, once the '
            + 'snapshot no longer covers it', () => {
                // browser.ts clears the set right after each step, so the
                // skip lasts exactly one frame — "it applies to the next
                // frame if it doesn't get overwritten by a sync".
                const shot = mover('shot');
                skip('shot');
                world.step();
                skip(); // No snapshot reached it this time.
                world.step();
                expect(positionOf(shot))
                    .toBeCloseTo(60 * (STEP_MS / 1000), 5);
            });

        it('skips nobody when the set is absent (the pre-existing rule)',
            () => {
                const ship = mover('ship');
                world.step();
                expect(positionOf(ship))
                    .toBeCloseTo(60 * (STEP_MS / 1000), 5);
            });
    });

    /**
     * ========================================================================
     * PREDICTION STOPS WHEN THERE IS NOTHING BEHIND IT
     * ========================================================================
     *
     * A multiplayer RESYNC holds the whole frame stream: `step()` refuses to
     * step a world being rebuilt from the input log, and `snapshot()` returns
     * an EMPTY frame on purpose, for up to twenty seconds per attempt. The
     * per-frame clamp bounds one step and says nothing about a run of them,
     * so every ship coasted on its last known velocity for the entire hold —
     * a turning one pirouetting — and then teleported when the first real
     * snapshot landed.
     */
    describe('shouldExtrapolate', () => {
        it('predicts across the ordinary gaps this plugin exists for', () => {
            expect(shouldExtrapolate({
                paused: false, now: 1_000, lastMovementSyncMs: 1_000,
            })).toBeTrue();
            // A steps=0 pump, or a worker reply a frame late: tens of ms.
            expect(shouldExtrapolate({
                paused: false, now: 1_050, lastMovementSyncMs: 1_000,
            })).toBeTrue();
        });

        it('stops once no authoritative movement has arrived for '
            + 'STALE_SNAPSHOT_MS — the resync hold', () => {
                expect(shouldExtrapolate({
                    paused: false, now: 1_000 + STALE_SNAPSHOT_MS,
                    lastMovementSyncMs: 1_000,
                })).toBeFalse();
                expect(shouldExtrapolate({
                    paused: false, now: 21_000, lastMovementSyncMs: 1_000,
                })).toBeFalse();
            });

        it('never predicts while the simulation is paused', () => {
            expect(shouldExtrapolate({
                paused: true, now: 1_000, lastMovementSyncMs: 1_000,
            })).toBeFalse();
        });

        it('never predicts before the first snapshot has landed', () => {
            expect(shouldExtrapolate({
                paused: false, now: 1_000, lastMovementSyncMs: undefined,
            })).toBeFalse();
        });
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
