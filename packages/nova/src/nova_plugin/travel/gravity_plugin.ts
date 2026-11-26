import { Optional } from 'nova_ecs/optional';
import { Plugin } from 'nova_ecs/plugin';
import { wrapNearestDelta } from 'nova_ecs/datatypes/position';
import { Vector } from 'nova_ecs/datatypes/vector';
import {
    MovementPhysicsComponent, MovementStateComponent, MovementSystem,
    MovementType,
} from 'nova_ecs/plugins/movement_plugin';
import { Query } from 'nova_ecs/query';
import { TimeResource, TimeSystem } from 'nova_ecs/plugins/time_plugin';
import { System } from 'nova_ecs/system';
import { ShipPhysicsComponent } from '../ship/index.js';
import { EffectiveMovementPhysicsSystem } from './afterburner_plugin.js';
import { JumpComponent } from './jump_state.js';
import { PlanetDataComponent } from './planet_plugin.js';
import { ControlShipSystem } from './ship_controller_plugin.js';

/**
 * spöb Gravity (EVN Bible ~:2901): "0 for none, positive for stellars that
 * pull, negative for stellars that push" (tracker #306, #353 section 5).
 *
 * MEASURED (reference "spöb Gravity (U7), wave 40"):
 * 1. Gravity ACCELERATES an inertial ship toward the stellar, roughly in
 *    proportion to the field: Gravity 1 about 1 px a frame per second
 *    (about 30 px/s²), Gravity 10 about 15 px a frame per second.
 * 2. The speed it gives is capped at the ship's own top speed (Probes A /
 *    B / C at their own 4.4 / 8.6 / 2.7 px a frame). From Gravity 100 up
 *    the cap is reached in a frame or two, so the ship comes in at top
 *    speed and the same pull turns it round within a frame on the far
 *    side: it sits ON the well with a few pixels of jitter. Weak wells
 *    let it swing through and back, damped.
 * 3. No falloff with distance (300 to 2,000 px alike at Gravity 100 /
 *    1000).
 * 4. A negative Gravity pushes the ship away the same way.
 * 5. An inertialess hull is not moved at all.
 *
 * So each tick an inertial ship's velocity gains GRAVITY_ACCELERATION x
 * Gravity px/s² times the tick toward each well (away from a negative
 * one), and MovementSystem's ordinary top-speed clamp is the cap (and,
 * the section's GUESS, the only brake). The constant is the proposal's
 * GUESS of 30 px/s² per unit (Gravity 1 measured; Gravity 10 came out
 * nearer 45 a unit), linear in the field.
 *
 * Not moved: inertialess ships (measured), ships whose hull sets shïp
 * Flags3 0x0010 "Ship ignores gravity" or that carry a "gravity
 * resistance" outfit (oütf ModType 41) (ShipPhysics.ignoresGravity; the
 * Bible's flags, not measured), and ships in a hyperspace jump sequence
 * (GUESS: the jump owns the ship's motion). NPCs are pulled like the
 * player (GUESS: only the player was measured; the Bible's warning that
 * gravity "severely confuses the AI" says the AI feels it). Several wells
 * in one system add up (GUESS, not measured).
 *
 * Deterministic: arithmetic and a square root on synced state (the
 * stellar's MovementState position, its cached PlanetData, the ship's
 * MovementState and physics, the tick's delta) — no trig, no PRNG, and
 * the velocity is replaced, never mutated in place.
 */
export const GRAVITY_ACCELERATION = 30;

/** Planets with a gravity field: their position and strength. */
const GravityWellQuery = new Query(
    [PlanetDataComponent, MovementStateComponent] as const);

/**
 * The velocity change, in px/s, that wells of the given `gravity` at the
 * given offsets (stellar minus ship, px) give a ship over `delta_s`. A
 * ship exactly on a well's centre feels nothing from it (no direction).
 */
export function gravityDeltaV(
    wells: Iterable<{ dx: number, dy: number, gravity: number }>,
    delta_s: number): Vector {
    let x = 0;
    let y = 0;
    for (const { dx, dy, gravity } of wells) {
        const distance = Math.sqrt(dx * dx + dy * dy);
        if (gravity === 0 || !(distance > 0)) {
            continue;
        }
        const dv = GRAVITY_ACCELERATION * gravity * delta_s / distance;
        x += dx * dv;
        y += dy * dv;
    }
    return new Vector(x, y);
}

export const GravitySystem = new System({
    name: 'GravitySystem',
    args: [MovementStateComponent, MovementPhysicsComponent,
        ShipPhysicsComponent, Optional(JumpComponent), TimeResource,
        GravityWellQuery] as const,
    step(movement, movementPhysics, shipPhysics, jump, time, wells) {
        if (jump || shipPhysics.ignoresGravity
            || movementPhysics.movementType !== MovementType.INERTIAL) {
            return;
        }
        const offsets = [];
        for (const [planetData, planetMovement] of wells) {
            if (!planetData.gravity) {
                continue;
            }
            offsets.push({
                dx: wrapNearestDelta(
                    planetMovement.position.x - movement.position.x),
                dy: wrapNearestDelta(
                    planetMovement.position.y - movement.position.y),
                gravity: planetData.gravity,
            });
        }
        if (offsets.length === 0) {
            return;
        }
        // Replace, never mutate in place; MovementSystem clamps the
        // result to the ship's top speed.
        movement.velocity = movement.velocity.add(
            gravityDeltaV(offsets, time.delta_s));
    },
    // Reads this tick's delta (determinism rule 4) and the movement type
    // EffectiveMovementPhysicsSystem wrote; adds to the velocity after the
    // controls and before the ship moves (and is clamped).
    after: [TimeSystem, ControlShipSystem, EffectiveMovementPhysicsSystem],
    before: [MovementSystem],
});

export const GravityPlugin: Plugin = {
    name: 'GravityPlugin',
    build(world) {
        world.addSystem(GravitySystem);
    },
    remove(world) {
        world.removeSystem(GravitySystem);
    },
};
