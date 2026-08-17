import { Optional } from 'nova_ecs/optional';
import { Plugin } from 'nova_ecs/plugin';
import { MovementPhysicsComponent, MovementStateComponent, MovementSystem } from 'nova_ecs/plugins/movement_plugin';
import { TimeResource, TimeSystem } from 'nova_ecs/plugins/time_plugin';
import { System } from 'nova_ecs/system';
import { DisabledComponent } from './disabled_component.js';
import { FuelComponent } from './health_plugin.js';
import { ION_FACTOR, IsIonizedComponent } from './ionization_plugin.js';
import { JumpComponent, JumpSequenceSystem, JUMP_BASE_SPEED, JUMP_DEPART_DELAY_MS } from './jump_plugin.js';
import { ShipControlStateComponent } from './ship_control.js';
import { ControlShipSystem } from './ship_controller_plugin.js';
import { getShipMovementPhysics, ShipPhysicsComponent } from './ship_plugin.js';

/**
 * How much an engaged afterburner multiplies a ship's top speed and
 * acceleration. The EVN Bible documents only the afterburner's fuel
 * burn (oütf ModType 15, units of fuel per second); the boost itself is
 * undocumented, so this matches the Nova engine's observed
 * roughly-double boost.
 */
export const AFTERBURNER_FACTOR = 2;

/**
 * How fast a ship sheds speed its cap no longer covers, as a multiple of
 * the ship's own (unboosted, un-ion-slowed) acceleration.
 *
 * Releasing the afterburner used to halve a ship's speed inside a single
 * tick, because the cap dropped to normal at once and MovementSystem
 * truncates velocity to the cap ("too aggressive" — Matthew's playtest).
 * The original coasts down instead. There is no drag term anywhere in the
 * movement integration to coast on, and the Bible documents only the
 * afterburner's fuel burn (oütf ModType 15), never its physics, so the
 * decay rate is a choice: the ship's own acceleration, the one number in
 * the data that says how quickly these engines change this hull's speed.
 *
 * At 1.0 the coast-down takes twice as long as the spin-up did, since the
 * burn accelerated at AFTERBURNER_FACTOR times acceleration — fast in,
 * slower out, which is how the slingshot reads in the original.
 */
export const OVERSPEED_DECAY_FACTOR = 1;

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
 * modifiers (ionization slowness, afterburner boost, hyperspace jump
 * burn). Modifiers that hold while a condition lasts belong here, so
 * they compose instead of clobbering each other's writes.
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
        Optional(IsIonizedComponent), Optional(JumpComponent),
        Optional(DisabledComponent)] as const,
    step(shipPhysics, movementPhysics, movementState, time,
        controlState, fuel, isIonized, jump, disabled) {
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
        const slowness = isIonized ? ION_FACTOR : 1;
        const boost = afterburning ? AFTERBURNER_FACTOR : 1;
        // While the burner is on this IS the boosted cap: a ship at or
        // below it has no overspeed to bleed. Once it is released the cap
        // drops, and the leftover speed comes off over the following
        // ticks rather than all at once. Same for the ionization
        // slowdown, and for the burner cutting out on a dry tank.
        movementPhysics.maxVelocity = decayedSpeedCap(
            base.maxVelocity * slowness * boost,
            movementState.velocity.length,
            base.acceleration * OVERSPEED_DECAY_FACTOR, time.delta_s);
        movementPhysics.acceleration = base.acceleration * slowness * boost;
        movementPhysics.turnRate = base.turnRate * slowness;
        movementPhysics.movementType = base.movementType;

        // Hyperspace physics. JumpSequenceSystem (which runs first this
        // tick) owns the stage machine; this system owns the physics it
        // implies. Only the departure burn boosts physics: arriving
        // ships jump in already at their regular top speed.
        if (jump?.stage === 'accelerating') {
            const jumpSpeed = JUMP_BASE_SPEED * shipPhysics.jumpSpeedMult;
            movementPhysics.maxVelocity = jumpSpeed;
            movementPhysics.acceleration =
                jumpSpeed / (JUMP_DEPART_DELAY_MS / 1000);
        }
    },
    // Overrides the acceleration ControlShipSystem chose (and the jump
    // sequence's stage transitions must land first), and must take
    // effect before the ship moves. TimeSystem is listed explicitly
    // (determinism rule 4): this system reads time.delta_s to drain
    // afterburner fuel, and neither ControlShipSystem nor JumpSequenceSystem's
    // ordering alone pins it after TimeSystem across a restore.
    after: [TimeSystem, ControlShipSystem, JumpSequenceSystem],
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
