import { Emit, GetEntity, UUID } from 'nova_ecs/arg_types';
import { Vector } from 'nova_ecs/datatypes/vector';
import { Optional } from 'nova_ecs/optional';
import { Plugin } from 'nova_ecs/plugin';
import { MovementStateComponent, MovementSystem } from 'nova_ecs/plugins/movement_plugin';
import { RandomResource } from 'nova_ecs/plugins/random_plugin';
import { SerializerResource } from 'nova_ecs/plugins/serializer_plugin';
import { TimeResource, TimeSystem } from 'nova_ecs/plugins/time_plugin';
import { System } from 'nova_ecs/system';
import { EffectiveMovementPhysicsSystem } from './afterburner_plugin.js';
import { ReturnAI } from './bay_plugin.js';
import { CloakActiveComponent, CLOAK_OFF_SOUND } from './cloak_plugin.js';
import { ZeroArmorEvent } from './death_plugin.js';
import { EscortCommandBehaviorSystem } from './escort_command_plugin.js';
import { EscortLandingSystem } from './player_escort_plugin.js';
import { FollowAI } from './npc_plugin.js';
import { deriveRepair, DisabledComponent, DisabledState, DISABLED_DECELERATION, isBelowDisableThreshold, repairedArmor, RepairComponent, rollRepairTime } from './disabled_component.js';
import { registerEntityDeriver } from './entity_factory.js';
import { SimulationGameDataResource } from './game_data_resource.js';
import { ArmorComponent, ShieldComponent } from './health_plugin.js';
import { FormationSystem, NpcSteeringSystem } from './npc_ai_plugin.js';
import { OutfitsStateComponent } from './outfit_plugin.js';
import { ProvideFromCache } from './provide_from_cache.js';
import { ControlledByComponent, ShipControlEvent, ShipControlStateComponent } from './ship_control.js';
import { ControlShipSystem } from './ship_controller_plugin.js';
import { ShipDataComponent, ShipPhysicsComponent } from './ship_plugin.js';
import {
    JumpComponent, JumpRouteComponent, JumpSequenceSystem, warpUpSound,
} from './jump_plugin.js';
import { PlayerSoundEvent } from './sound_plugin.js';

/**
 * Ship disabling — see disabled_component.ts for the overview, the
 * component, the tuning constants, and the pure transition helpers. This
 * module owns the systems:
 *
 *  - RepairProvider/RepairDeriver: the ModType 49 repair-system
 *    capability, derived from outfits like CloakComponent.
 *  - ShipDisableSystem: the enter/leave transitions (threshold entry,
 *    forced decloak, repair-time roll; self-repair and outside-repair
 *    exit).
 *  - JumpDisableCancelSystem: the disabled-cancels-jump rule — a ship
 *    disabled at any stage of a hyperspace jump stops dead and loses the
 *    jump, for every ship in the game.
 *  - DisabledMovementSystem: erases all steering/thrust the control, AI,
 *    formation, jump, and afterburner systems wrote this tick and slows
 *    the hulk to rest.
 *  - SelfDestructSystem: the player's escape hatch — destroys the ship
 *    through the normal zero-armor death path whether or not disabled.
 *
 * What is deliberately NOT gated here: escort commands (a disabled ship
 * can still direct its escorts, per the Bible) and target cycling.
 * The other suspended capabilities live with their owners: weapon fire
 * (weapon_plugin), cloak toggling (cloak_plugin), shield/armor/fuel
 * recharge (health_plugin), hyperspace jump initiation (jump_plugin),
 * NPC target validity (npc_ai_plugin), running lights and target corners
 * (display).
 */

const RepairProvider = ProvideFromCache({
    name: 'RepairProvider',
    provided: RepairComponent,
    update: [OutfitsStateComponent],
    args: [OutfitsStateComponent, SimulationGameDataResource] as const,
    factory: deriveRepair,
});

/**
 * Enter/leave transitions for the disabled state.
 *
 * Entry (armor at or below the ship's disable threshold): attaches
 * DisabledComponent with the rolled self-repair time and force-decloaks
 * through the same state+sound transition the existing decloak paths use
 * (CloakDrainSystem / CloakDecloakOnHitSystem), exactly once.
 *
 * Exit: self-repair at the rolled time (armor restored to slightly above
 * the threshold — repairedArmor), or any outside cause that lifts armor
 * back above the threshold. Removing the component resumes every gated
 * system at once. A player death/respawn (armor restored to max) exits
 * the same way.
 */
export const ShipDisableSystem = new System({
    name: 'ShipDisableSystem',
    args: [ArmorComponent, ShipDataComponent, RepairComponent, TimeResource,
        RandomResource, Optional(ControlledByComponent),
        Optional(CloakActiveComponent), GetEntity, UUID, Emit] as const,
    step(armor, shipData, repair, time, random, controlledBy, cloakActive,
        entity, uuid, emit) {
        const disabled = entity.components.get(DisabledComponent);
        const fraction = shipData.disableArmorFraction;

        if (!disabled) {
            if (!isBelowDisableThreshold(armor, fraction)) {
                return;
            }
            entity.components.set(DisabledComponent, {
                repairAt: rollRepairTime(time.time, repair.hasRepairSystem,
                    controlledBy !== undefined, () => random.next()),
            });
            // Disabling drops the cloak through the existing decloak
            // transition (state flip + one cloak-off sound).
            if (cloakActive?.active) {
                cloakActive.active = false;
                emit(PlayerSoundEvent, { id: CLOAK_OFF_SOUND }, [uuid]);
            }
            return;
        }

        // A spawn-disabled hulk keeps full armor yet stays disabled: only
        // an external repair that DELETES the component (boarding) brings
        // it back online, so the threshold rules below don't apply. Any
        // future repair path that should revive hulks (e.g. NPC roadside
        // assistance) must delete DisabledComponent itself — writing
        // armor can never lift a hulk (review note L3).
        if (disabled.hulk) {
            return;
        }

        // Outside repair (boarding, death-respawn refill, plug effects):
        // armor back above the threshold re-enables the ship.
        if (!isBelowDisableThreshold(armor, fraction)) {
            entity.components.delete(DisabledComponent);
            return;
        }

        // Self-repair (ModType 49 outfit, or the player's inherent
        // repair droid): at the rolled time, restore armor to slightly
        // above the threshold and bring all systems back online.
        if (disabled.repairAt !== null && time.time >= disabled.repairAt) {
            armor.current = repairedArmor(armor.max, fraction);
            entity.components.delete(DisabledComponent);
        }
    },
    after: [TimeSystem],
});

/**
 * DISABLED CANCELS THE JUMP. Matthew's ruling, which is the original
 * game's behavior and applies to EVERY ship: "if a ship is disabled during
 * any part of its jump, including accelerating out of the system, it
 * immediately stops (zero velocity) and the jump is cancelled."
 *
 * So: one rule, stated once, for players, escorts, and NPCs alike, at
 * every stage of the sequence.
 *
 *  - THE JUMP IS GONE, not paused. There is no resume: a repaired ship
 *    decides again from scratch — a player presses jump (PlayerJumpControl
 *    polls the held key every tick, so even holding it through the repair
 *    works), an NPC re-enters through its normal AI (npc_ai_plugin's
 *    depart/flee modes call departByJump again), an escort re-enters only
 *    if its player is still mid-jump when it comes back online.
 *  - IT STOPS DEAD. Zero velocity, on the spot — not the gradual coast
 *    DisabledMovementSystem gives an ordinary hulk. The original stops the
 *    ship, and a hyperdrive burn is exactly the case where the difference
 *    shows: a ship two seconds into its departure acceleration is moving
 *    far faster than any sane deceleration would bleed off before it left
 *    the screen. DisabledMovementSystem still runs afterwards and keeps it
 *    at rest.
 *  - THE ROUTE IS PUT BACK, unless the hop was already FLOWN. beginJump
 *    SHIFTS the destination off JumpRouteComponent when it starts, so a
 *    cancelled jump has to unshift it or the repaired ship's next jump
 *    would silently skip a hop and fly somewhere the pilot never chose. The
 *    exception is stage 'arriving', which runs in the destination system:
 *    see the unshift below. Fuel needs no such care: it is only charged at
 *    departure, which never happened.
 *
 * ORDERING is the substance of the rule. `after: [ShipDisableSystem]` sees
 * a ship disabled on THIS tick, and `before: [JumpSequenceSystem]` means
 * the sequence never gets to advance — so a ship disabled on the very tick
 * its departure burn would have ended cannot still warp out. The two edges
 * together are what make "at every stage, including accelerating out"
 * true rather than nearly true.
 *
 * WHY HERE. It needs both ends of that ordering, and this module already
 * owns the disabled state's ordering against every gameplay system it
 * switches off (see DisabledMovementSystem's `after` list, and the
 * JumpSequenceSystem import it already carries). jump_plugin cannot hold
 * it: importing ShipDisableSystem from there would cycle. Its own module
 * would need its own plugin registration for one small system.
 *
 * FOLLOWERS cost nothing here. A ship following this one's jump watches
 * the leader's JumpComponent (JumpSequenceSystem, which runs after this),
 * so cancelling a player's jump cancels their whole flock's on the same
 * tick — "if the parent ship is disabled mid-jump, escorts should not
 * jump" — with no escort knowledge in this module at all.
 */
export const JumpDisableCancelSystem = new System({
    name: 'JumpDisableCancelSystem',
    args: [DisabledComponent, JumpComponent, MovementStateComponent,
        ShipPhysicsComponent, Optional(JumpRouteComponent), GetEntity, UUID,
        Emit] as const,
    step(_disabled, jump, movement, shipPhysics, jumpRoute, entity, uuid,
        emit) {
        entity.components.delete(JumpComponent);
        // Stopped dead, exactly as the original does.
        movement.velocity = new Vector(0, 0);
        movement.targetSpeed = 0;
        movement.accelerating = 0;
        movement.turning = 0;
        movement.turnTo = null;
        movement.turnBack = false;
        // Give the destination back to the route. A FOLLOWER never took
        // one (beginFollowJump copies the leader's heading and consumes
        // nothing), and a vanishing NPC has no route at all (and names no
        // real destination to give back — see VANISH_DESTINATION).
        //
        // NOT AT STAGE 'arriving'. That stage runs in the DESTINATION
        // system: the hop was flown, and the ship is sitting in it. Giving
        // it back points the route at the system the ship is already in,
        // and the next jump leaves and re-enters it — the pilot enters one
        // system twice along a single route (Matthew's playtest,
        // 2026-08-17). Nothing is lost by keeping it off: the hop is
        // reached, and the rest of the route is untouched.
        if (jump.follows === undefined && !jump.vanish
            && jump.stage !== 'arriving' && jumpRoute
            && jumpRoute.route[0] !== jump.to) {
            jumpRoute.route.unshift(jump.to);
        }
        // Clip the warp-up. It starts when the ship finishes aligning and
        // is only ever stopped by the arrival that now will not happen, so
        // without this it rings on over a ship that is dead in space.
        // Self-only, like every warp sound: the display plays it for the
        // local player's own ship and nobody else's.
        if (jump.stage === 'spinup' || jump.stage === 'accelerating') {
            emit(PlayerSoundEvent,
                { id: warpUpSound(shipPhysics), stop: true }, [uuid]);
        }
    },
    // No TimeSystem edge: this reads no clock. The two edges it does
    // declare are the rule (see above), and ShipDisableSystem already
    // carries the ordering against the tick's time advance.
    after: [ShipDisableSystem],
    before: [JumpSequenceSystem],
});

/**
 * A disabled ship is dead in space: no thrust, no turning. Runs after
 * every system that writes movement intent (player controls, NPC
 * steering, formation keeping, the jump sequence, the afterburner) and
 * erases whatever they wrote, then brakes the hulk toward rest at
 * DISABLED_DECELERATION ("slow to rest" — a disabled ship gradually
 * decelerates to zero velocity relative to the system).
 */
export const DisabledMovementSystem = new System({
    name: 'DisabledMovementSystem',
    args: [DisabledComponent, MovementStateComponent, TimeResource] as const,
    step(_disabled, movement, time) {
        movement.accelerating = 0;
        movement.turning = 0;
        movement.turnBack = false;
        movement.turnTo = null;

        const speed = movement.velocity.length;
        if (speed > 0) {
            const next = Math.max(0,
                speed - DISABLED_DECELERATION * time.delta_s);
            // Replace (never mutate in place) the velocity vector.
            movement.velocity = next <= 0
                ? new Vector(0, 0)
                : movement.velocity.scale(next / speed);
        }
    },
    after: [TimeSystem, ShipDisableSystem, ControlShipSystem,
        JumpSequenceSystem, EffectiveMovementPhysicsSystem,
        NpcSteeringSystem, FormationSystem, EscortCommandBehaviorSystem,
        EscortLandingSystem, ReturnAI, FollowAI],
    before: [MovementSystem],
});

/**
 * The self-destruct keybind (Alt+Shift+Minus): destroys the pilot's own
 * ship through the normal zero-armor death path (ZeroArmorEvent ->
 * exploding -> DeathEvent -> respawn for players). Works whether or not
 * the ship is disabled — it exists as the escape hatch for a disabled
 * ship with no repair coming. Deliberately not gated on
 * DisabledComponent.
 */
export const SelfDestructSystem = new System({
    name: 'SelfDestructSystem',
    events: [ShipControlEvent],
    args: [ShipControlStateComponent, ArmorComponent,
        Optional(ShieldComponent), TimeResource, UUID, Emit] as const,
    step(controlState, armor, shield, time, uuid, emit) {
        if (controlState.get('selfDestruct') !== 'start') {
            return;
        }
        if (shield) {
            shield.current = shield.min;
        }
        armor.current = 0;
        // The same event DamageSystem emits when damage zeroes armor.
        emit(ZeroArmorEvent, time, [uuid]);
    },
});

export const DisabledPlugin: Plugin = {
    name: 'DisabledPlugin',
    build(world) {
        world.addComponent(DisabledComponent);
        world.addComponent(RepairComponent);

        // Real simulation state: rollback snapshots and wire baselines
        // carry it through the default codec path (like NpcComponent).
        world.resources.get(SerializerResource)
            ?.addComponent(DisabledComponent, DisabledState);

        // The repair capability is derived from owned outfits and
        // re-derived wherever a full entity is built (staged insertion,
        // snapshot restore) — the CloakComponent model. It is skipped
        // from snapshots (snapshot_policies.ts).
        registerEntityDeriver(world, {
            name: 'RepairDeriver',
            provided: RepairComponent,
            requires: [OutfitsStateComponent],
            derive: (entity, gameData) => deriveRepair(
                entity.components.get(OutfitsStateComponent)!, gameData),
        });

        world.addSystem(RepairProvider);
        world.addSystem(ShipDisableSystem);
        world.addSystem(JumpDisableCancelSystem);
        world.addSystem(DisabledMovementSystem);
        world.addSystem(SelfDestructSystem);
    },
};
