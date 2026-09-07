import { Emit, Entities, GetEntity, UUID } from 'nova_ecs/arg_types';
import { Optional } from 'nova_ecs/optional';
import { Plugin } from 'nova_ecs/plugin';
import { MovementStateComponent } from 'nova_ecs/plugins/movement_plugin';
import { Resource } from 'nova_ecs/resource';
import { System } from 'nova_ecs/system';
import { World } from 'nova_ecs/world';
import { Subscription } from 'rxjs';
import { ControlsSubject } from '../nova_plugin/core/controls_plugin.js';
import { DisabledComponent } from '../nova_plugin/ship/disabled_component.js';
import { SimulationGameDataResource } from '../nova_plugin/core/game_data_resource.js';
import { FuelComponent, FUEL_PER_JUMP } from '../nova_plugin/ship/health_plugin.js';
import { selectNearestHostile, styleForTarget } from '../nova_plugin/combat/hostility.js';
import { JumpComponent, JumpRouteComponent, JUMP_DISTANCE } from '../nova_plugin/travel/jump_plugin.js';
import { jumpBlocker, jumpRadiusFor } from '../nova_plugin/travel/jump_readiness.js';
import { PlanetTargetComponent } from '../nova_plugin/travel/planet_plugin.js';
import { PlayerShipSelector } from '../nova_plugin/player/player_ship_plugin.js';
import { ShipComponent, ShipPhysicsComponent } from '../nova_plugin/ship/ship_plugin.js';
import { TargetComponent } from '../nova_plugin/ship/target_component.js';
import { WeaponsStateComponent } from '../nova_plugin/ship/weapons_state.js';
import { MenuControls } from '../spaceport/menu_controls.js';
import { defaultSimulationTime, SimulationTimeResource } from './simulation_time.js';
import {
    BEEP_CANT_DO, BEEP_DISABLED, BEEP_JUMP_READY, BEEP_TARGET_PLANET,
    BEEP_TARGET_SHIP, playUiSound, SOUND_FIRST_HOSTILE, UiSoundEvent,
} from './ui_sound.js';
import {
    firstHostileEdge, initialJumpReadyState, JumpReadyState, jumpReadyEdge,
    risingEdge, targetChangedEdge,
} from './ui_sound_logic.js';

/**
 * Per-local-player edge-trigger state for the display-detected UI/space
 * sounds. All of these fire off state that already crosses to the display
 * world; nothing here touches the simulation. The display world is rebuilt
 * on every system transit, so this resets to a clean baseline at each jump —
 * exactly the re-arm the jump-ready and first-hostile cues want.
 */
interface UiSoundTriggerState {
    prevShipTarget: string | undefined;
    prevPlanetTarget: string | undefined;
    disabled: boolean;
    jumpReady: JumpReadyState;
    anyHostile: boolean;
}
const UiSoundTriggerStateResource =
    new Resource<UiSoundTriggerState>('UiSoundTriggerState');

// A ship was targeted by any means (tab, click, escort cycle, hail
// auto-target all write TargetComponent). Runs only for the local player's
// ship (PlayerShipSelector); a change to a new, non-empty target beeps.
export const TargetShipBeepSystem = new System({
    name: 'TargetShipBeep',
    args: [TargetComponent, UiSoundTriggerStateResource, Emit,
        PlayerShipSelector] as const,
    step({ target }, state, emit) {
        const { beep, next } = targetChangedEdge(state.prevShipTarget, target);
        if (beep) {
            emit(UiSoundEvent, { id: BEEP_TARGET_SHIP });
        }
        state.prevShipTarget = next;
    },
});

// A planet/stellar was selected (number keys, click, nav all write
// PlanetTargetComponent).
const TargetPlanetBeepSystem = new System({
    name: 'TargetPlanetBeep',
    args: [PlanetTargetComponent, UiSoundTriggerStateResource, Emit,
        PlayerShipSelector] as const,
    step({ target }, state, emit) {
        const { beep, next } = targetChangedEdge(state.prevPlanetTarget, target);
        if (beep) {
            emit(UiSoundEvent, { id: BEEP_TARGET_PLANET });
        }
        state.prevPlanetTarget = next;
    },
    // #156 pin (shared: ShipControl, Emit, UiSoundTriggerState):
    // UiSoundTriggersPlugin's registration order.
    after: [TargetShipBeepSystem],
});

// Your own ship became disabled (DisabledComponent appears). Optional so the
// system still runs to keep the edge state fresh while not disabled.
const DisabledBeepSystem = new System({
    name: 'DisabledBeep',
    args: [Optional(DisabledComponent), UiSoundTriggerStateResource, Emit,
        PlayerShipSelector] as const,
    step(disabled, state, emit) {
        const { beep, next } = risingEdge(state.disabled, disabled !== undefined);
        if (beep) {
            emit(UiSoundEvent, { id: BEEP_DISABLED });
        }
        state.disabled = next;
    },
    // #156 pin (shared: ShipControl, Emit, UiSoundTriggerState).
    after: [TargetPlanetBeepSystem],
});

// The moment a jump becomes possible (route selected + outside the no-jump
// zone + enough fuel + not disabled + not already jumping). The conditions
// are NOT copied from PlayerJumpControl — both quote the shared readiness
// predicate (nova_plugin/travel/jump_readiness.ts) — so the cue cannot drift from
// the gate. Edge-triggered and re-armed on route change / after jumping.
const JumpReadyBeepSystem = new System({
    name: 'JumpReadyBeep',
    args: [JumpRouteComponent, MovementStateComponent, ShipPhysicsComponent,
        FuelComponent, Optional(DisabledComponent), Optional(JumpComponent),
        UiSoundTriggerStateResource, Emit, PlayerShipSelector] as const,
    step(jumpRoute, movement, shipPhysics, fuel, disabled, jump, state, emit) {
        const { beep, next } = jumpReadyEdge(state.jumpReady, {
            hasRoute: jumpRoute.route.length > 0,
            distance: movement.position.length,
            jumpRadius: jumpRadiusFor(JUMP_DISTANCE,
                shipPhysics.jumpDistanceMod),
            fuel: fuel.current,
            fuelPerJump: FUEL_PER_JUMP,
            disabled: disabled !== undefined,
            jumping: jump !== undefined,
            routeHead: jumpRoute.route[0],
        });
        if (beep) {
            emit(UiSoundEvent, { id: BEEP_JUMP_READY });
        }
        state.jumpReady = next;
    },
    // #156 pin (shared: Disabled, ShipControl, Emit, UiSoundTriggerState).
    after: [DisabledBeepSystem],
});

// A ship turned hostile to you while none was hostile before. Reuses the
// exact hostility rule the target corners use (styleForTarget), evaluated
// over every ship in the system, so the cue flips hostile exactly when the
// corners would.
export const FirstHostileBeepSystem = new System({
    name: 'FirstHostileBeep',
    args: [Entities, SimulationGameDataResource, SimulationTimeResource,
        UiSoundTriggerStateResource, UUID, GetEntity, Emit,
        PlayerShipSelector] as const,
    step(entities, gameData, simulationTime, state, playerUuid, playerEntity,
        emit) {
        let anyHostile = false;
        for (const [uuid, entity] of entities) {
            if (uuid === playerUuid || !entity.components.has(ShipComponent)) {
                continue;
            }
            if (styleForTarget(uuid, entity, playerUuid, playerEntity,
                gameData, u => entities.get(u),
                simulationTime.time) === 'hostile') {
                anyHostile = true;
                break;
            }
        }
        const { beep, next } = firstHostileEdge(state.anyHostile, anyHostile);
        if (beep) {
            emit(UiSoundEvent, { id: SOUND_FIRST_HOSTILE });
        }
        state.anyHostile = next;
    },
    // #156 pin (shared: *).
    after: [JumpReadyBeepSystem],
});

/** The local player's ship's weapon state, or undefined while docked. */
function playerWeapons(world: World) {
    for (const entity of world.entities.values()) {
        if (entity.components.has(PlayerShipSelector)) {
            return entity.components.get(WeaponsStateComponent);
        }
    }
    return undefined;
}

/**
 * True when the player pressed hyperjump and the jump gate refuses it: the
 * NEGATION of the shared readiness predicate (nova_plugin/travel/jump_readiness.ts)
 * at the moment of the press, so this beep, the nova:154 jump-ready cue and
 * PlayerJumpControl itself are answering one question with one implementation.
 *
 * NO ROUTE IS SILENT (Matthew's ruling, 2026-08-15, restoring commit
 * f2ef16e1's original judgement): the can't-do beep answers a jump the
 * player is TRYING to make and can't — inside the no-jump zone or out of
 * fuel — and pressing jump with no destination selected is a no-op, not a
 * refusal. (An intermediate revision beeped there too; it was overruled.)
 *
 * ALREADY JUMPING is deliberately NOT a refusal (the 'jumping' blocker is
 * excluded below): the key is held through a jump sequence as a matter of
 * course — that is how a held key chain-jumps a route — and beeping at a
 * player whose jump is already underway would be nonsense.
 *
 * No player ship / missing components → no beep: there is no ship to refuse.
 */
function playerJumpRefused(world: World): boolean {
    for (const entity of world.entities.values()) {
        if (!entity.components.has(PlayerShipSelector)) {
            continue;
        }
        const route = entity.components.get(JumpRouteComponent);
        const movement = entity.components.get(MovementStateComponent);
        const physics = entity.components.get(ShipPhysicsComponent);
        const fuel = entity.components.get(FuelComponent);
        if (!route || !movement || !physics || !fuel) {
            return false;
        }
        const blocked = jumpBlocker({
            hasRoute: route.route.length > 0,
            distance: movement.position.length,
            jumpRadius: jumpRadiusFor(JUMP_DISTANCE, physics.jumpDistanceMod),
            fuel: fuel.current,
            fuelPerJump: FUEL_PER_JUMP,
            disabled: entity.components.has(DisabledComponent),
            jumping: entity.components.has(JumpComponent),
        });
        // 'noRoute' is a no-op, not a refusal (Matthew, 2026-08-15: the
        // can't-do beep is for "not enough energy / not far enough from
        // system center", and "doesn't include when you haven't selected a
        // destination"). 'jumping' is excluded for the held-key reason
        // documented above.
        return blocked !== undefined && blocked !== 'jumping'
            && blocked !== 'noRoute';
    }
    return false;
}

/**
 * True when the player pressed 'r' (nearestTarget) and there is no
 * hostile ship for it to land on.
 *
 * This is the NEGATION of the very function the simulation's
 * ChooseTargetSystem uses to retarget (selectNearestHostile), evaluated
 * over the display world's mirror of the same synced state, so the beep
 * and the retarget are answering one question with one implementation —
 * the same discipline the failed-jump beep follows with
 * jump_readiness's shared predicate. When it returns true the sim
 * provably left the target alone, so the "can't do that" cue is never
 * played over a target that actually changed.
 *
 * No player ship, or no game data yet: no beep — there is nothing to
 * refuse.
 */
function playerNearestHostileRefused(world: World): boolean {
    const gameData = world.resources.get(SimulationGameDataResource);
    if (!gameData) {
        return false;
    }
    const now = (world.resources.get(SimulationTimeResource)
        ?? defaultSimulationTime()).time;
    for (const [uuid, entity] of world.entities) {
        if (!entity.components.has(PlayerShipSelector)) {
            continue;
        }
        return selectNearestHostile({
            viewerUuid: uuid,
            viewerEntity: entity,
            entities: world.entities,
            gameData,
            now,
        }) === undefined;
    }
    return false;
}

const SecondaryControlSubscription =
    new Resource<Subscription>('UiSoundSecondaryControlSubscription');

export const UiSoundTriggersPlugin: Plugin = {
    name: 'UiSoundTriggersPlugin',
    build(world) {
        // The hostility rule's aggression tier compares against SIM
        // timestamps, so seed the mirrored simulation clock in case this
        // plugin runs before the first simulation frame arrives.
        if (!world.resources.has(SimulationTimeResource)) {
            world.resources.set(SimulationTimeResource,
                defaultSimulationTime());
        }
        world.resources.set(UiSoundTriggerStateResource, {
            prevShipTarget: undefined,
            prevPlanetTarget: undefined,
            disabled: false,
            jumpReady: initialJumpReadyState(),
            anyHostile: false,
        });
        world.addSystem(TargetShipBeepSystem);
        world.addSystem(TargetPlanetBeepSystem);
        world.addSystem(DisabledBeepSystem);
        world.addSystem(JumpReadyBeepSystem);
        world.addSystem(FirstHostileBeepSystem);

        // "Can't do that" when switching secondary weapons with none
        // available. The switch itself is a sim control; here we only need
        // the local feedback, so detect it display-side off ControlsSubject
        // + the synced WeaponsStateComponent. Suppressed while a menu owns
        // the keyboard (the key does nothing docked).
        const controls = world.resources.get(ControlsSubject);
        if (controls) {
            world.resources.set(SecondaryControlSubscription,
                controls.subscribe(({ action, state }) => {
                    if (state !== 'start') {
                        return;
                    }
                    if (MenuControls.focused) {
                        return;
                    }
                    // Jump refused: hyperjump pressed while the shared
                    // readiness predicate says no — inside the no-jump
                    // zone, out of fuel, disabled, or with no route at
                    // all (per the snd-153 research: the natural
                    // negative counterpart of 154's jump-ready). Only
                    // 'start' reaches here, so a held/auto-repeating key
                    // beeps ONCE per discrete press.
                    if (action === 'hyperjump') {
                        if (playerJumpRefused(world)) {
                            playUiSound(world, { id: BEEP_CANT_DO });
                        }
                        return;
                    }
                    // 'r' with nothing hostile in the system: the sim
                    // leaves the current target (or lack of one) exactly
                    // as it was, so the key is a refusal, not a no-op,
                    // and gets the same 153 beep as a refused jump. Only
                    // 'start' reaches here, so a held key beeps ONCE per
                    // discrete press.
                    if (action === 'nearestTarget') {
                        if (playerNearestHostileRefused(world)) {
                            playUiSound(world, { id: BEEP_CANT_DO });
                        }
                        return;
                    }
                    if (action !== 'nextSecondary'
                        && action !== 'previousSecondary'
                        && action !== 'resetSecondary') {
                        return;
                    }
                    const weapons = playerWeapons(world);
                    if (!weapons) {
                        return;
                    }
                    let hasSecondary = false;
                    for (const [, w] of weapons) {
                        if (w.fireGroup === 'secondary') {
                            hasSecondary = true;
                            break;
                        }
                    }
                    if (!hasSecondary) {
                        playUiSound(world, { id: BEEP_CANT_DO });
                    }
                }));
        }
    },
    remove(world) {
        world.resources.get(SecondaryControlSubscription)?.unsubscribe();
        world.resources.delete(SecondaryControlSubscription);
        world.removeSystem(FirstHostileBeepSystem);
        world.removeSystem(JumpReadyBeepSystem);
        world.removeSystem(DisabledBeepSystem);
        world.removeSystem(TargetPlanetBeepSystem);
        world.removeSystem(TargetShipBeepSystem);
        world.resources.delete(UiSoundTriggerStateResource);
    },
};
