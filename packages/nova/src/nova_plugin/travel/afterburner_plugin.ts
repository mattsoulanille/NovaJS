import { Optional } from 'nova_ecs/optional';
import { Plugin } from 'nova_ecs/plugin';
import { MovementPhysicsComponent, MovementStateComponent, MovementSystem } from 'nova_ecs/plugins/movement_plugin';
import { TimeResource, TimeSystem } from 'nova_ecs/plugins/time_plugin';
import { System } from 'nova_ecs/system';
import { ShipSpeedConversionFactor } from 'novaparse/parsers/constants';
import { DisabledComponent } from '../ship/index.js';
import { FuelComponent } from '../ship/index.js';
import {
    IonizationComponent, IonizationRechargeSystem, ionSlowdown,
} from '../ship/index.js';
import { JumpComponent, JumpSequenceSystem, JUMP_BASE_SPEED, jumpBurnMs } from './jump_plugin.js';
import { ShipControlStateComponent, StrictPlayComponent } from '../player/index.js';
import { ControlShipSystem } from './ship_controller_plugin.js';
import { getShipMovementPhysics, ShipPhysicsComponent } from '../ship/index.js';

/**
 * How much an engaged afterburner multiplies a ship's top speed and
 * acceleration, from the ship's top speed (`speed`, NovaJS units: the
 * shïp Speed field x ShipSpeedConversionFactor, outfits included). The
 * EVN Bible documents only the afterburner's fuel burn (oütf ModType 15,
 * units of fuel per second).
 *
 * MEASURED on two hulls: x 1.5 on Kit Probe A (Speed 300, Accel 300: 4.05
 * -> 6.1 px a frame, reference "The player's afterburner (U4), wave 39")
 * and x 1.75 on Kit Probe B (Speed 600, Accel 150: 7.2 -> 12.6, "The
 * afterburner on a second hull (U4 leftover), wave 40"), and x 1.53 on
 * Kit Probe C (Speed 200, Accel 600: 2.95 -> 4.55, "The afterburner on a
 * third hull (U4, the hub's question), wave 41"). No Accel rule fits (A
 * and C, at Accel 300 and 600, both about 1.5). GUESS, the section's fit
 * through all three: max(1.5, 1.25 + Speed / 1200), x 1.5 at least and
 * more for a fast hull (a Speed-100 hull would test the floor). The
 * acceleration is boosted by the same factor (not measured). Was 1.25 +
 * Speed / 1200 alone (C: 1.42), a constant 1.5 and 2 before that.
 */
export function afterburnerFactor(speed: number): number {
    return Math.max(AFTERBURNER_FACTOR_FLOOR, AFTERBURNER_FACTOR_BASE
        + speed / ShipSpeedConversionFactor / AFTERBURNER_SPEED_PER_FACTOR);
}
/** afterburnerFactor's floor: no hull boosts by less. */
export const AFTERBURNER_FACTOR_FLOOR = 1.5;
/** afterburnerFactor's intercept (a Speed-0 hull). */
export const AFTERBURNER_FACTOR_BASE = 1.25;
/** afterburnerFactor's slope: Speed field units per whole factor. */
export const AFTERBURNER_SPEED_PER_FACTOR = 1200;

/**
 * What strict play multiplies the player's top speed by. Measured on the
 * original (docs/reference_experiments.md, "#316 wave 10"): one probe
 * hull, regular vs strict pilot, 130 vs 88 px/s (0.68; the window
 * summaries spread 0.64-0.71). Two thirds is the round figure the
 * measurement brackets; acceleration and turn rate are NOT cut (both
 * matched within the measurement). See StrictPlayComponent.
 */
export const STRICT_PLAY_SPEED_FACTOR = 2 / 3;

/**
 * How fast a ship sheds speed its cap no longer covers, as a multiple of
 * the ship's own (unboosted, un-ionized) acceleration.
 *
 * Releasing the afterburner used to halve a ship's speed inside a single
 * tick, because the cap dropped to normal at once and MovementSystem
 * truncates velocity to the cap ("too aggressive" — Matthew's playtest).
 * The original coasts down instead. There is no drag term anywhere in the
 * movement integration to coast on, and the Bible documents only the
 * afterburner's fuel burn (oütf ModType 15), never its physics, so the
 * decay is scaled by the ship's own acceleration, the one number in the
 * data that says how quickly these engines change this hull's speed.
 *
 * MEASURED (reference "The player's afterburner (U4), wave 39"): the
 * coast back down from the boosted 6.1 px a frame to the 4.0 top speed
 * took about 2.5 s, about 25 px/s², roughly HALF the hull's own
 * acceleration (its ramp from rest about 54 px/s²). Wave 40's Kit Probe B
 * (Accel 150) took about 10 s from 12.6 back to 7.2, again about half its
 * acceleration ("The afterburner on a second hull (U4 leftover), wave
 * 40"): half the acceleration on every hull. Was 1.
 */
export const OVERSPEED_DECAY_FACTOR = 0.5;

/**
 * The speed cap to enforce this tick for a ship whose real cap is
 * `ceiling` but which is currently travelling at `speed`.
 *
 * Speed the cap covers is capped outright, exactly as before. Speed
 * ABOVE it — an afterburner just released, an ionization slowdown just
 * landed — bleeds off at `decay` units per second instead of vanishing,
 * so the ship decelerates across ticks rather than snapping.
 *
 * A ship thrusting at its top speed still settles at exactly that speed:
 * it is not over the cap, so nothing decays, and the cap is its own
 * ceiling.
 */
export function decayedSpeedCap(ceiling: number, speed: number,
    decay: number, delta_s: number): number {
    const overspeed = speed - ceiling;
    if (overspeed <= 0) {
        return ceiling;
    }
    return ceiling + Math.max(0, overspeed - decay * delta_s);
}

/**
 * The single per-tick writer of a ship's effective movement physics:
 * recomputes it from ShipPhysicsComponent and applies the transient
 * modifiers (ionization's cut to acceleration and turning, afterburner boost, hyperspace jump
 * burn, strict play's top-speed cut). Modifiers that hold while a
 * condition lasts belong here, so they compose instead of clobbering each
 * other's writes.
 *
 * While the afterburner control is held (and the ship has an
 * afterburner outfit), the ship thrusts forward, burning
 * ShipPhysics.afterburner units of fuel per second; it cuts out when
 * the fuel runs dry. The afterburner is unavailable during a jump
 * sequence — control of the ship is taken away.
 *
 * During the jump's departure burn the speed cap and acceleration are
 * replaced outright (not multiplied) so the ship reaches its full jump
 * speed exactly at departure. Ionization still slows turning, but the
 * hyperdrive burn itself is not ion-slowed.
 */
export const EffectiveMovementPhysicsSystem = new System({
    name: 'EffectiveMovementPhysics',
    args: [ShipPhysicsComponent, MovementPhysicsComponent,
        MovementStateComponent, TimeResource,
        Optional(ShipControlStateComponent), Optional(FuelComponent),
        Optional(IonizationComponent),
        Optional(JumpComponent),
        Optional(DisabledComponent), Optional(StrictPlayComponent)] as const,
    step(shipPhysics, movementPhysics, movementState, time,
        controlState, fuel, ionization, jump, disabled,
        strictPlay) {
        let afterburning = false;
        // A disabled ship cannot burn: DisabledMovementSystem erases the
        // thrust afterwards, but the fuel was already spent here (Matthew's
        // playtest — holding afterburner while disabled drained the tank).
        if (!jump && !disabled && controlState?.get('afterburner')
            && shipPhysics.afterburner > 0
            && fuel && fuel.current > 0) {
            afterburning = true;
            fuel.current = Math.max(fuel.min,
                fuel.current - shipPhysics.afterburner * time.delta_s);
            // The afterburner thrusts the ship forward while engaged.
            movementState.accelerating = 1;
        }

        const base = getShipMovementPhysics(shipPhysics);
        const ion = ionSlowdown(ionization);
        const boost = afterburning ? afterburnerFactor(base.maxVelocity) : 1;
        // A strict pilot's top speed only: not its acceleration, not its
        // turn rate (reference #316 wave 10).
        const strict = strictPlay ? STRICT_PLAY_SPEED_FACTOR : 1;
        // While the burner is on this IS the boosted cap: a ship at or
        // below it has no overspeed to bleed. Once it is released the cap
        // drops, and the leftover speed comes off over the following
        // ticks rather than all at once. Same for the burner cutting out
        // on a dry tank. (Ionization does not cut the top speed: reference
        // "Ionization (E6), wave 39".)
        movementPhysics.maxVelocity = decayedSpeedCap(
            base.maxVelocity * strict * ion.maxVelocity * boost,
            movementState.velocity.length,
            base.acceleration * OVERSPEED_DECAY_FACTOR, time.delta_s);
        movementPhysics.acceleration =
            base.acceleration * ion.acceleration * boost;
        movementPhysics.turnRate = base.turnRate * ion.turnRate;
        movementPhysics.movementType = base.movementType;

        // Hyperspace physics. JumpSequenceSystem (which runs first this
        // tick) owns the stage machine; this system owns the physics it
        // implies. Only the departure burn boosts physics: arriving
        // ships jump in already at their regular top speed.
        if (jump?.stage === 'accelerating') {
            const jumpSpeed = JUMP_BASE_SPEED * shipPhysics.jumpSpeedMult;
            movementPhysics.maxVelocity = jumpSpeed;
            movementPhysics.acceleration =
                jumpSpeed / (jumpBurnMs(jump) / 1000);
        }
    },
    // Overrides the acceleration ControlShipSystem chose (and the jump
    // sequence's stage transitions must land first), and must take
    // effect before the ship moves. TimeSystem is listed explicitly
    // (determinism rule 4): this system reads time.delta_s to drain
    // afterburner fuel, and neither ControlShipSystem nor JumpSequenceSystem's
    // ordering alone pins it after TimeSystem across a restore. It reads
    // the ion charge (ionSlowdown), so it runs after this tick's
    // deionization too.
    after: [TimeSystem, ControlShipSystem, JumpSequenceSystem,
        IonizationRechargeSystem],
    before: [MovementSystem],
});

export const AfterburnerPlugin: Plugin = {
    name: 'AfterburnerPlugin',
    build(world) {
        world.addSystem(EffectiveMovementPhysicsSystem);
    },
    remove(world) {
        world.removeSystem(EffectiveMovementPhysicsSystem);
    },
}
