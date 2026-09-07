import { MovementPhysicsComponent, MovementStateComponent, MovementType } from 'nova_ecs/plugins/movement_plugin';
import { World } from 'nova_ecs/world';
import { ControlEvent } from './nova_plugin/core/index.js';
import { AnalogControlState, ControlledByComponent } from './nova_plugin/player/index.js';

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

/** Landing wants dist² < 10_000 and speed² < 3_000; aim inside both. */
const ARRIVE_DISTANCE_SQUARED = 8_100;   // 90 units
const ARRIVE_SPEED_SQUARED = 2_500;      // 50 units/s
/** Stop aiming closer than this; the landing radius is 100 units. */
const STOP_MARGIN = 60;
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

        const planetMovement = world.entities.get(this.planetUuid)
            ?.components.get(MovementStateComponent);
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

        if (distanceSquared < ARRIVE_DISTANCE_SQUARED
            && speedSquared < ARRIVE_SPEED_SQUARED) {
            this.sendAnalog({ heading: null, throttle: 0 });
            this.tapLand();
            return;
        }

        const distance = Math.sqrt(distanceSquared);
        const speed = Math.sqrt(speedSquared);
        // Bang-bang braking distance with margin: the fastest approach
        // that can still stop is v = sqrt(2·a·remaining); track a bit
        // under it so the ship settles inside the landing window.
        const desiredSpeed = Math.min(physics.maxVelocity,
            0.8 * Math.sqrt(2 * physics.acceleration
                * Math.max(0, distance - STOP_MARGIN)));

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
        if (burn < physics.acceleration * 0.05) {
            // Velocity is right; coast, nose toward the planet.
            this.sendAnalog({ heading: Math.atan2(toX, -toY), throttle: 0 });
            return;
        }
        const burnHeading = Math.atan2(burnX, -burnY);
        const facingError = Math.abs(
            angleDifference(burnHeading, movement.rotation.angle));
        this.sendAnalog({
            heading: burnHeading,
            throttle: facingError < BURN_FACING_TOLERANCE ? 1 : 0,
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
        // single 'land' press lands on it. The tap repeats until the ship is
        // inside the landing window, at which point the press takes.
        this.sinks.controlEvents([{ action: 'land', state: 'start' }]);
        this.landHeldFrames = LAND_TAP_HOLD;
        this.framesUntilLandTap = LAND_TAP_INTERVAL;
    }
}
