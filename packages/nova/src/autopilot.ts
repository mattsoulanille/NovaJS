import { MovementPhysicsComponent, MovementStateComponent, MovementType } from 'nova_ecs/plugins/movement_plugin';
import { World } from 'nova_ecs/world';
import { ControlEvent } from './nova_plugin/core/index.js';
import { AnalogControlState, ControlledByComponent } from './nova_plugin/player/index.js';
import {
    landingDistance, LAND_SPEED_SQUARED, PlanetDataComponent,
    stellarApproachRange,
} from './nova_plugin/travel/index.js';

/**
 * Client-side autopilot: flies the player's ship to a tapped planet
 * and lands. It reads the display world (a mirror of the simulation)
 * and steers by sending ordinary inputs — analog heading/throttle plus
 * 'land' taps — so the simulation needs no autopilot concept and every
 * peer sees the flight as plain user input. Movement input from the
 * user cancels it.
 */

export interface ControlSinks {
    controlEvents(events: ControlEvent[]): void;
    analogControl(control: AnalogControlState): void;
}

/**
 * Landing wants the ship cleared and inside the stellar's landing window:
 * a SQUARE around its centre measured as max(|dx|, |dy|)
 * (landingDistance) of half-width stellarApproachRange (the smaller of
 * the 249 px clearance zone, where the first tap clears, and the art's
 * trunc(1.75 W) window, where the next one lands), and slower than 20 px/s
 * (LAND_SPEED_SQUARED); aim inside both: 90% of the half-width on the
 * same square, half the speed² (about 14 px/s). The approach itself flies
 * at the centre, so it enters the square on any heading.
 */
const ARRIVE_RANGE_FRACTION = 0.9;
const ARRIVE_SPEED_SQUARED = LAND_SPEED_SQUARED / 2;
/** Stop aiming closer than this (px), or 60% of a small stellar's range. */
const STOP_MARGIN = 60;
const STOP_MARGIN_RANGE_FRACTION = 0.6;
/** An inertial ship coasts once its velocity is this close (px/s) to the
 * wanted one; finer than the landing gate, so it settles below it. */
const COAST_TOLERANCE = 4;
/** Below a full burn's worth of correction the inertial throttle is
 * proportional: a needed change of `acceleration * this` px/s (a fifth of
 * a second's thrust) burns at full throttle, smaller ones less, so braking
 * to the 20 px/s gate does not overshoot it. */
const PROPORTIONAL_BURN_SECONDS = 0.2;
/** Thrust only when facing within this many radians of the burn. */
const BURN_FACING_TOLERANCE = 0.5;
/** Pump frames between 'land' taps, and held frames per tap. The gap
 * keeps press and release in different simulation ticks (same-tick
 * edges collapse to a no-op). */
const LAND_TAP_INTERVAL = 30;
const LAND_TAP_HOLD = 5;

function angleDifference(a: number, b: number) {
    let difference = (a - b) % (2 * Math.PI);
    if (difference < -Math.PI) {
        difference += 2 * Math.PI;
    } else if (difference >= Math.PI) {
        difference -= 2 * Math.PI;
    }
    return difference;
}

/**
 * The fastest approach speed (px/s) from which a ship can still stop
 * within `distance` px: it first coasts for `turnSeconds` while it turns
 * its nose retrograde, then brakes at `acceleration`, so
 * v·turnSeconds + v²/(2a) = distance, solved for v.
 *
 * The turn is what an inertial hull needs and the plain bang-bang
 * v = sqrt(2·a·d) left out. A nimble hull flips in a fraction of a second
 * and barely notices; a heavy one does not. Matthew's Auroran Thunderforge
 * (turn 1.18 rad/s, so 2.7 s to turn round, at 166 px/s) coasted about
 * 440 px before it could brake at all, sailed through the 28 px window
 * of the 17 x 31 Auroran LP V and swung back and forth across it for
 * five minutes without landing (the return of "Auroran 19: Observe
 * Auroran Border", nova:676). The half-turn is the worst case (the nose
 * pointed at the planet); an inertialess ship stops when its throttle
 * does, so it passes 0.
 */
export function stoppableSpeed(acceleration: number, turnSeconds: number,
    distance: number): number {
    if (acceleration <= 0 || distance <= 0) {
        return 0;
    }
    return acceleration * (Math.sqrt(turnSeconds * turnSeconds
        + 2 * distance / acceleration) - turnSeconds);
}

export class Autopilot {
    private planetUuid?: string;
    private analogSent = false;
    private landHeldFrames = 0;
    private framesUntilLandTap = 0;

    constructor(private sinks: ControlSinks) { }

    get active(): boolean {
        return this.planetUuid !== undefined;
    }

    /** Which planet the autopilot is flying to, if any. */
    get destination(): string | undefined {
        return this.planetUuid;
    }

    navigateTo(planetUuid: string) {
        this.planetUuid = planetUuid;
        this.framesUntilLandTap = 0;
    }

    /** Stops navigating and releases any inputs the autopilot holds. */
    cancel() {
        if (!this.active) {
            return;
        }
        this.planetUuid = undefined;
        if (this.landHeldFrames > 0) {
            this.landHeldFrames = 0;
            this.sinks.controlEvents([{ action: 'land', state: false }]);
        }
        if (this.analogSent) {
            this.analogSent = false;
            this.sinks.analogControl({ heading: null, throttle: null });
        }
    }

    /** Steers for one frame. Call once per render/pump frame. */
    step(world: World | undefined, myPeerId: string | undefined) {
        if (!this.planetUuid || !world) {
            return;
        }

        const planet = world.entities.get(this.planetUuid);
        const planetMovement = planet?.components.get(MovementStateComponent);
        const landingRange =
            stellarApproachRange(planet?.components.get(PlanetDataComponent));
        const arriveDistance = ARRIVE_RANGE_FRACTION * landingRange;
        const stopMargin = Math.min(STOP_MARGIN,
            STOP_MARGIN_RANGE_FRACTION * landingRange);
        let ship;
        for (const entity of world.entities.values()) {
            if (entity.components.get(ControlledByComponent)?.peerId === myPeerId) {
                ship = entity;
                break;
            }
        }
        const movement = ship?.components.get(MovementStateComponent);
        const physics = ship?.components.get(MovementPhysicsComponent);
        if (!planetMovement || !movement || !physics) {
            // The planet or the ship vanished (jump, landing, death).
            this.cancel();
            return;
        }

        const toX = planetMovement.position.x - movement.position.x;
        const toY = planetMovement.position.y - movement.position.y;
        const distanceSquared = toX * toX + toY * toY;
        const speedSquared = movement.velocity.x * movement.velocity.x
            + movement.velocity.y * movement.velocity.y;

        if (landingDistance(toX, toY) < arriveDistance
            && speedSquared < ARRIVE_SPEED_SQUARED) {
            this.sendAnalog({ heading: null, throttle: 0 });
            this.tapLand();
            return;
        }

        const distance = Math.sqrt(distanceSquared);
        const speed = Math.sqrt(speedSquared);
        const desiredSpeed = Math.min(physics.maxVelocity,
            0.8 * stoppableSpeed(physics.acceleration,
                physics.movementType === MovementType.INERTIALESS
                    ? 0 : Math.PI / Math.max(physics.turnRate, 1e-3),
                Math.max(0, distance - stopMargin)));

        if (physics.movementType === MovementType.INERTIALESS) {
            // Velocity follows the nose; point at the planet and match
            // the approach speed (negative throttle brakes).
            const throttle = Math.max(-1, Math.min(1,
                (desiredSpeed - speed) / Math.max(1, physics.acceleration * 0.5)));
            this.sendAnalog({ heading: Math.atan2(toX, -toY), throttle });
            return;
        }

        // Inertial: steer the velocity vector toward "approach the
        // planet at desiredSpeed". Near the planet desiredSpeed → 0,
        // so the correction becomes a retrograde burn.
        const desiredVelocityX = (toX / distance) * desiredSpeed;
        const desiredVelocityY = (toY / distance) * desiredSpeed;
        const burnX = desiredVelocityX - movement.velocity.x;
        const burnY = desiredVelocityY - movement.velocity.y;
        const burn = Math.hypot(burnX, burnY);
        if (burn < Math.min(physics.acceleration * 0.05, COAST_TOLERANCE)) {
            // Velocity is right; coast, nose toward the planet.
            this.sendAnalog({ heading: Math.atan2(toX, -toY), throttle: 0 });
            return;
        }
        const burnHeading = Math.atan2(burnX, -burnY);
        const facingError = Math.abs(
            angleDifference(burnHeading, movement.rotation.angle));
        this.sendAnalog({
            heading: burnHeading,
            throttle: facingError < BURN_FACING_TOLERANCE
                ? Math.min(1, burn
                    / Math.max(1, physics.acceleration * PROPORTIONAL_BURN_SECONDS))
                : 0,
        });
    }

    private sendAnalog(control: AnalogControlState) {
        this.analogSent = true;
        this.sinks.analogControl(control);
    }

    private tapLand() {
        if (this.landHeldFrames > 0) {
            this.landHeldFrames--;
            if (this.landHeldFrames === 0) {
                this.sinks.controlEvents([{ action: 'land', state: false }]);
            }
            return;
        }
        if (this.framesUntilLandTap > 0) {
            this.framesUntilLandTap--;
            return;
        }
        // navigateTo already selected this planet (setPlanetTarget), so a
        // 'land' press acts on it: the first inside the clearance zone
        // clears the ship (unless a standing request already was), the
        // next inside the landing window lands. The tap repeats until one
        // lands.
        this.sinks.controlEvents([{ action: 'land', state: 'start' }]);
        this.landHeldFrames = LAND_TAP_HOLD;
        this.framesUntilLandTap = LAND_TAP_INTERVAL;
    }
}
