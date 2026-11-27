import { Optional } from 'nova_ecs/optional';
import { Plugin } from 'nova_ecs/plugin';
import { MovementPhysicsComponent, MovementStateComponent, MovementSystem } from 'nova_ecs/plugins/movement_plugin';
import { TimeResource, TimeSystem } from 'nova_ecs/plugins/time_plugin';
import { System } from 'nova_ecs/system';
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
 * How much an engaged afterburner multiplies a ship's top speed. The EVN
 * Bible documents only the afterburner's fuel burn (oütf ModType 15,
 * units of fuel per second).
 *
 * MEASURED with a ruler of moon decorations (reference "The afterburner
 * with a ruler (U4), wave 43"): a FLAT x 1.8 on five hulls (1.79-1.82,
 * Speed 100 to 1,000, Accel 150 to 600), no dependence on Speed or
 * Accel. The earlier star-field readings (x 1.5 / 1.75 / 1.53 / 1.73-1.77,
 * waves 39-42) were biased toward 1 (wave 42). Was max(1.5, 1.25 + Speed
 * / 1200), and 1.25 + Speed / 1200, a constant 1.5 and 2 before that.
 */
export const AFTERBURNER_FACTOR = 1.8;

/**
 * The afterburner's own thrust, px/s²: an engaged burner accelerates the
 * ship at this rate (or the hull's own acceleration, if that is more),
 * NOT at the hull's acceleration times AFTERBURNER_FACTOR.
 *
 * MEASURED (reference "The afterburner with a ruler (U4), wave 43"): the
 * boost comes up in about 0.4-0.5 s on Kit Probe A (131 -> 237 px/s,
 * about 250 px/s², five times its own 54 px/s²) and about 1.5 s on Kit
 * Probe E (437 -> 790, about 230-250 px/s²). GUESS: one thrust for every
 * hull (both hulls have Accel 300, so "accel x 5" fits too; a third
 * hull's ramp would tell). Ionization cuts it like the hull's own
 * acceleration (not measured).
 */
export const AFTERBURNER_THRUST = 250;

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
 * MEASURED with a ruler (reference "The afterburner with a ruler (U4),
 * wave 43"): with Up held after the burner's release the ship comes back
 * to its top speed at about 0.6-0.8 of the hull's own acceleration (Kit
 * Probe A 44, D 30-35, E 37 px/s² against 54 for Accel 300; B about 19
 * against 27 for Accel 150). GUESS 0.7. Was 0.5 (waves 39-40's "about
 * half", read off the biased star field), and 1 before that.
 */
export const OVERSPEED_DECAY_FACTOR = 0.7;

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
        const boost = afterburning ? AFTERBURNER_FACTOR : 1;
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
        // The burner's own thrust, not the hull's times the factor
        // (reference U4 wave 43: about 0.5 s to the boosted speed).
        movementPhysics.acceleration = ion.acceleration * (afterburning
            ? Math.max(base.acceleration, AFTERBURNER_THRUST)
            : base.acceleration);
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
