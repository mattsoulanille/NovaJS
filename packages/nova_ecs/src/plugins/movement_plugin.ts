import * as t from 'io-ts';
import { Entities, GetWorld, UUID } from '../arg_types.js';
import { EntityMap } from '../entity_map.js';
import { Component } from '../component.js';
import { Angle, AngleType } from '../datatypes/angle.js';
import { Position, PositionType } from '../datatypes/position.js';
import { Vector, VectorLike, VectorType } from '../datatypes/vector.js';
import { Plugin } from '../plugin.js';
import { Resource } from '../resource.js';
import { System } from '../system.js';
import { applyObjectDelta } from './delta.js';
import { DeltaPlugin, DeltaResource } from './delta_plugin.js';
import { Time, TimeResource, TimeSystem } from './time_plugin.js';


export enum MovementType {
    INERTIAL = 0,
    INERTIALESS = 1,
    STATIONARY = 2,
}

export const MovementPhysics = t.type({
    maxVelocity: t.number,
    turnRate: t.number,
    acceleration: t.number,
    movementType: t.union([
        t.literal(MovementType.INERTIAL),
        t.literal(MovementType.INERTIALESS),
        t.literal(MovementType.STATIONARY)]),
});
export type MovementPhysics = t.TypeOf<typeof MovementPhysics>;

export const MovementPhysicsComponent = new Component<MovementPhysics>('MovementPhysics');

export const MovementState = t.intersection([t.type({
    position: PositionType,
    velocity: VectorType,
    rotation: AngleType,
    turning: t.number,
    turnBack: t.boolean,
    accelerating: t.number,
}), t.partial({
    turnTo: t.union([AngleType, t.string /* target UUID */, t.null]),
    targetSpeed: t.number,
    // Incremented on discontinuous moves (respawn, teleport) so they get
    // sent to peers, which otherwise only hear about input changes.
    teleportCount: t.number,
})]);
export type MovementState = t.TypeOf<typeof MovementState>;

/**
 * Move an entity discontinuously. Position normally evolves predictably
 * from inputs, so multiplayer only sends MovementState when an input
 * changes. A teleport is unpredictable, so it bumps `teleportCount` to
 * force the full state (including position) to be sent.
 */
export function teleport(state: MovementState, position: Position, velocity?: Vector) {
    state.position = position;
    if (velocity) {
        state.velocity = velocity;
    }
    state.teleportCount = (state.teleportCount ?? 0) + 1;
}

// Don't split this into separate position and velocity components
// because we don't want to send predictable deltas, such as when
// an entity is moving in a straight line. When an unpredictable event happens,
// such as when a player accelerates, we send the full state.
export const MovementStateComponent = new Component<MovementState>('MovementState');

/**
 * When set on a world, bounds how far a single MovementSystem step may
 * integrate. Meant for DISPLAY worlds running on the wall clock (see
 * nova's MovementExtrapolationPlugin): a stall — system suspend, a
 * debugger pause, an occluded window before the heartbeat notices —
 * makes one wall-clock delta huge, and integrating it would teleport
 * every entity until the next authoritative snapshot yanks them back.
 * `enabled: false` skips movement integration entirely (a paused
 * simulation sends no correcting snapshots, so prediction must halt
 * with it). Simulation worlds must NEVER set this resource: it is read
 * through the world (like FixedTimestepResource), and when absent the behavior is exactly
 * the unclamped original, keeping determinism untouched.
 */
export interface MovementTimeLimit {
    enabled: boolean;
    maxDeltaMs: number;
    /**
     * Entities whose MovementState an AUTHORITATIVE SNAPSHOT has overwritten
     * since this world was last stepped. They are skipped: a frame renders
     * freshly-synced state exactly as the simulation computed it, and
     * prediction only ever shows on a frame the simulation did not reach.
     *
     * Extrapolating a just-synced entity draws it one frame PAST where the
     * simulation put it, which is invisible on a ship (everything on screen
     * leads by the same frame) but obvious on anything born at another
     * entity's position: a projectile appeared already a frame's flight
     * clear of the muzzle it left, every shot, because its very first
     * rendered position was spawn + v*dt while the firing ship — moving
     * much slower — had barely left its own. Matthew: "apply the
     * interpolation after rendering the frame (so it applies to the next
     * frame if it doesn't get overwritten by a sync from the engine)".
     * Skipping the synced entities is that ordering, expressed per entity
     * rather than per phase, and it needs no second world step.
     *
     * The smoothing this plugin exists for is untouched: it covers the
     * frames that get NO fresh snapshot (a steps=0 pump, a worker reply
     * that missed the frame — one rAF in ten on the Linux playtest trace),
     * and on those frames nothing is in this set.
     *
     * Absent (or undefined) means "skip nobody", the pre-existing
     * behaviour. Simulation worlds never set the resource at all.
     */
    skipUuids?: ReadonlySet<string>;
    /**
     * How far (in this world's scaled time, ms) to advance the entities in
     * `skipUuids` instead of leaving them where the snapshot put them: the
     * snapshot's STALENESS. A snapshot normally lands the frame after the
     * pump that requested it and represents that frame (0 here: the rule
     * above, untouched). One that lands late — the worker round trip took
     * several frames, or the pump stepped fewer ticks than the frame was
     * worth (the 1-of-3 step split at 2x) — represents an EARLIER instant
     * than the display has already shown, and drawing it as-is moved every
     * synced entity backward. Absent or 0 keeps the plain skip.
     */
    syncedLeadMs?: number;
}
export const MovementTimeLimitResource =
    new Resource<MovementTimeLimit>('MovementTimeLimit');

export const MovementSystem = new System({
    name: 'movement',
    args: [MovementStateComponent, MovementPhysicsComponent,
        TimeResource, Entities, GetWorld, UUID] as const,
    step(state, physics, time, entities, world, uuid) {
        const limit = world.resources.get(MovementTimeLimitResource);
        if (limit) {
            if (!limit.enabled) {
                return;
            }
            if (limit.skipUuids?.has(uuid)) {
                // Synced this frame: render it where the simulation put
                // it, advanced only by how stale that snapshot is.
                const lead = limit.syncedLeadMs ?? 0;
                if (!(lead > 0)) {
                    return;
                }
                time = { ...time, delta_ms: lead, delta_s: lead / 1000 };
            }
            if (time.delta_ms > limit.maxDeltaMs) {
                time = {
                    ...time,
                    delta_ms: limit.maxDeltaMs,
                    delta_s: limit.maxDeltaMs / 1000,
                };
            }
        }
        if (physics.movementType === MovementType.INERTIAL) {
            inertialControls(state, physics, time, entities);
        } else if (physics.movementType === MovementType.INERTIALESS) {
            inertialessControls(state, physics, time, entities);
        }
    },
    after: [TimeSystem],
});

function inertialControls(state: MovementState, physics: MovementPhysics,
    time: Time, entities: EntityMap) {
    handleTurning(state, physics, time, entities);

    // Acceleration
    if (state.accelerating > 0) {
        state.velocity = state.velocity.add(
            state.rotation.getUnitVector()
                .normalize(state.accelerating * physics.acceleration * time.delta_s));
    }
    state.velocity = state.velocity.shortenToLength(physics.maxVelocity);

    // Velocity
    updatePosition(state, time);
}

function inertialessControls(state: MovementState, physics: MovementPhysics,
    time: Time, entities: EntityMap) {
    handleTurning(state, physics, time, entities);

    if (state.targetSpeed === undefined) {
        state.targetSpeed = state.velocity.length;
    }

    state.targetSpeed += state.accelerating * physics.acceleration * time.delta_s;
    state.targetSpeed = Math.min(state.targetSpeed, physics.maxVelocity);
    state.targetSpeed = Math.max(state.targetSpeed, 0);

    const targetVelocity = state.rotation.getUnitVector().scale(state.targetSpeed);
    state.velocity = approachVec(targetVelocity, state.velocity,
        physics.acceleration * time.delta_s
        * INERTIALESS_REALIGN_PER_ACCELERATION);
    // Speed ABOVE the throttle's (a knockback push) goes faster still:
    // INERTIALESS_SHED_PER_ACCELERATION in all, the realign's share
    // included.
    const excess = state.velocity.length - state.targetSpeed;
    if (excess > 0) {
        state.velocity = state.velocity.shortenToLength(Math.max(
            state.targetSpeed, state.velocity.length
            - physics.acceleration * time.delta_s
            * (INERTIALESS_SHED_PER_ACCELERATION
                - INERTIALESS_REALIGN_PER_ACCELERATION)));
    }
    updatePosition(state, time);
}

/**
 * How fast an INERTIALESS hull's velocity is pulled back onto its heading
 * x targetSpeed (inertialessControls) — after a turn, a nudge, a push —
 * as a multiple of its (effective) acceleration, in px/s². Unmeasured
 * (TUNABLE): the AI steering (inertialess_steering.ts, npc_formation.ts)
 * and a bay fighter's run home are built around it; at a faster realign
 * a fighter flying home at full thrust from inside its turning circle
 * circles its carrier for good instead of sliding in to dock.
 */
export const INERTIALESS_REALIGN_PER_ACCELERATION = 2;

/**
 * How fast an INERTIALESS hull sheds speed ABOVE its throttle's
 * targetSpeed (a knockback push; inertialessControls), as a multiple of
 * its (effective) acceleration, in px/s², the realign
 * (INERTIALESS_REALIGN_PER_ACCELERATION) included.
 *
 * MEASURED on one hull (reference "Knockback (the hub's KNOCKBACK), wave
 * 46", finding 4): the stock Hyperioid (shïp 171: Mass 10, top speed
 * about 90 px/s, acceleration 45 px/s²) at rest under fire did NOT keep
 * a push. An Impact-20 bolt (60 px/s by the knockback law) moved it about
 * 9 px over 0.3 s, then it sat still again; an Impact-100 bolt (capped at
 * its top speed) 21-22 px over about 0.5 s; nothing built up over 14
 * hits. Shedding 60 px/s in 0.3 s over 9 px is a pull of about 200
 * px/s²; the capped push (87.5 px/s) over 21.5 px, about 180. At 4 x the
 * hull's own 45 px/s² thrust (180 px/s²) the 60 Hz sim sheds the Impact-20
 * push in 0.32 s over 8.6 px and the Impact-100 one in 0.48 s over 19 px
 * (knockback_test.ts); 4.5 (202.5) fell further short of the Impact-100
 * reading (17 px). Was the realign's 2 (90 px/s²: 0.67 s and 20 px for
 * the 60 px/s push).
 *
 * GUESS: the multiple of the hull's own acceleration (the only hull-
 * relative rule one hull can fix; a Vell-os Dart's 225 px/s² sheds a push
 * at 900 px/s²), and the same for a thrusting hull as for one at rest.
 * Only the speed over targetSpeed is shed this fast: a push ACROSS the
 * heading of a cruising hull loses its excess length at this rate and
 * its sideways turn at the realign's.
 */
export const INERTIALESS_SHED_PER_ACCELERATION = 4;

function updatePosition(state: MovementState, time: Time) {
    state.position = state.position.add(state.velocity.scale(time.delta_s));
}
function handleTurning(state: MovementState, physics: MovementPhysics,
    time: Time, entities: EntityMap) {
    // Turning
    if (state.turnTo) {
        let angle: Angle | undefined;
        if (state.turnTo instanceof Angle) {
            angle = state.turnTo;
        } else {
            const otherPosition = entities.get(state.turnTo)
                ?.components.get(MovementStateComponent)?.position;
            if (otherPosition) {
                angle = otherPosition.subtract(state.position).angle;
            }
        }
        if (angle) {
            turnToAngle(state, physics, time, angle);
        }
    } else if (state.turnBack) {
        if (state.velocity.length > 0) {
            let reverseAngle = state.velocity.angle.add(Math.PI);
            turnToAngle(state, physics, time, reverseAngle);
        }
    }

    state.rotation = state.rotation
        .add(state.turning * physics.turnRate * time.delta_s);
}

export function approachVec<T extends Vector>(target: T, current: T, maxDelta: number): T {
    if (current.x === target.x && current.y === target.y) {
        return target;
    }
    const difference = target.subtract(current);
    // Math.pow, not `**`: the native exponentiation operator bypasses the
    // deterministic Math.pow patch (see deterministic_math.ts).
    if (difference.lengthSquared < Math.pow(maxDelta, 1.2)) {
        return target;
    }

    return current.add(difference.normalize().scale(maxDelta)) as T;
}

function turnToAngle(state: MovementState, physics: MovementPhysics,
    time: Time, target: Angle) {
    // Used for turning retrograde and pointing at a target
    let difference = state.rotation.distanceTo(target);

    // If we would turn past the target direction, just go to the target direction.
    if (physics.turnRate * time.delta_s > Math.abs(difference.angle)) {
        state.turning = 0;
        state.rotation = target;
    }
    else if (difference.angle > 0) {
        state.turning = 1;
    }
    else {
        state.turning = -1;
    }
}

export const MovementPlugin: Plugin = {
    name: 'MovementPlugin',
    build(world) {
        world.addPlugin(DeltaPlugin);
        const deltaMaker = world.resources.get(DeltaResource);
        if (!deltaMaker) {
            throw new Error('Expected delta maker resource to exist');
        }

        deltaMaker.addComponent(MovementStateComponent, {
            componentType: MovementState,
            deltaType: MovementState,
            getDelta(a, b) {
                // Omit position.
                // Send everything if a delta is detected.
                const same = a.turning === b.turning &&
                    a.accelerating === b.accelerating &&
                    a.turnTo === b.turnTo &&
                    a.turnBack === b.turnBack &&
                    a.teleportCount === b.teleportCount;

                if (same) {
                    return;
                }
                return b;
            },
            applyDelta: applyObjectDelta
        });

        deltaMaker.addComponent(MovementPhysicsComponent, {
            componentType: MovementPhysics
        });

        world.addComponent(MovementPhysicsComponent);
        world.addComponent(MovementStateComponent);
        world.addSystem(MovementSystem);
    }
};
