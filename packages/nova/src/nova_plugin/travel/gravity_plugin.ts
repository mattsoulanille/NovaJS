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
 *    let it swing through and back, NOT damped (reference "Gravity
 *    damping and strength (U7, the hub's questions), wave 41": the peak
 *    speed held 75 s at Gravity 5 and 10; what read as damping was the
 *    swing turning from one axis into the other).
 * 3. The pull FALLS with distance (reference "A Gravity-5 ramp from far
 *    out, and the swing's cap (U7 leftover ...), wave 42": from rest a
 *    Gravity-5 well pulled about 15 px/s² 2,000-1,450 px out, 45 from
 *    1,000 px, 195 from 300 px, roughly 1 / d^1.5). Waves 40-41's "no
 *    falloff" came from Gravity 100 / 1000, which reach the top-speed cap
 *    within a frame at any range and so could not show one. Inside 300 px
 *    it is CONSTANT (reference "Gravity inside 300 px (U7 leftover), wave
 *    43": about 140 px/s² at Gravity 5 from 300, 150 and 85 px, read off
 *    moon decorations, not the star field). The whole law, read off moons
 *    (reference "Gravity's law with moons (U7 leftovers), wave 44"):
 *    Gravity x min(30, 8.6e6 / d²) px/s², an inverse square beyond about
 *    535 px and constant inside, both in proportion to Gravity.
 * 4. A negative Gravity pushes the ship away the same way.
 * 5. An inertialess hull is not moved at all.
 *
 * So each tick an inertial ship's velocity gains gravityAcceleration(
 * Gravity) x gravityFalloff(distance) px/s² times the tick toward each
 * well (away from a negative one), and MovementSystem's ordinary
 * top-speed clamp is the cap (and the only brake: no damping, wave 41;
 * the cap itself MEASURED in wave 42: the far fall-in levelled off at
 * Probe A's own top speed).
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
 * Deterministic: arithmetic and square roots on synced state (the
 * stellar's MovementState position, its cached PlanetData, the ship's
 * MovementState and physics, the tick's delta) — no trig, no PRNG, and
 * the velocity is replaced, never mutated in place.
 */
export const GRAVITY_NEAR_PER_UNIT = 30;
export const GRAVITY_FAR_PER_UNIT = 8.6e6;

/**
 * A well's pull, in px/s², from its spöb Gravity (signed: negative
 * pushes), at GRAVITY_REFERENCE_DISTANCE or closer; farther out it is
 * scaled by gravityFalloff.
 *
 * MEASURED off moon decorations (reference "Gravity's law with moons (U7
 * leftovers), wave 44"): a constant 150 px/s² at Gravity 5 and 300 at
 * Gravity 10 (one law fitted to four falls of each well, 2-4 px rms), so
 * GRAVITY_NEAR_PER_UNIT 30 px/s² a unit, linear in Gravity. GUESS: the
 * same for a negative Gravity (wave 40 saw it push; its strength was
 * never measured) and for strong wells (Gravity 100+ then reaches the
 * top speed in a few frames, as wave 40 saw). Was 16.5 x G + 2.3 x G x
 * |G| (a quadratic through wave 41's biased star readings, 395 at Gravity
 * 10), and linear, 30 a unit, before that. Arithmetic only.
 */
export function gravityAcceleration(gravity: number): number {
    return GRAVITY_NEAR_PER_UNIT * gravity;
}

/**
 * The square of the distance, px², where the constant core meets the
 * inverse square (the two pieces of Gravity x min(GRAVITY_NEAR_PER_UNIT,
 * GRAVITY_FAR_PER_UNIT / d²) are equal there): about 535 px. Kept
 * squared so the falloff needs no square root or pow.
 */
const GRAVITY_REFERENCE_DISTANCE_SQUARED =
    GRAVITY_FAR_PER_UNIT / GRAVITY_NEAR_PER_UNIT;

/**
 * The distance, px, at or inside which gravityAcceleration is the whole
 * pull (about 535 px; MEASURED, wave 44: the same for Gravity 5 and 10).
 */
export const GRAVITY_REFERENCE_DISTANCE =
    Math.sqrt(GRAVITY_REFERENCE_DISTANCE_SQUARED);

/**
 * The fraction of a well's gravityAcceleration felt `distance` px from
 * it: 1 inside GRAVITY_REFERENCE_DISTANCE, (that / d)² beyond, so the
 * pull is Gravity x GRAVITY_FAR_PER_UNIT / d² out there (MEASURED,
 * reference "Gravity's law with moons (U7 leftovers), wave 44": 4.3e7 /
 * d² at Gravity 5 from 2,000 px in to about 600: 11 px/s² at 2,000, 19
 * at 1,500, 43 at 1,000). Was (300 / d)^1.5 beyond 300 px (wave 42's star
 * readings). d² is exact IEEE arithmetic on every engine (determinism).
 */
export function gravityFalloff(distance: number): number {
    const squared = distance * distance;
    if (!(squared > GRAVITY_REFERENCE_DISTANCE_SQUARED)) {
        return 1;
    }
    return GRAVITY_REFERENCE_DISTANCE_SQUARED / squared;
}

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
        const dv = gravityAcceleration(gravity) * gravityFalloff(distance)
            * delta_s / distance;
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
