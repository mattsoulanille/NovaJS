import { Plugin } from 'nova_ecs/plugin';
import {
    ShipPhysicsComponent, ShipPhysicsProvider,
} from '../nova_plugin/ship/index.js';

/**
 * Derives ShipPhysicsComponent in the DISPLAY world.
 *
 * Display entities are mirrored from the simulation world, and only
 * serializer-registered components survive that trip (see
 * source_component_bridge_test.ts for the same failure mode).
 * ShipPhysicsComponent is not one of them, deliberately: it is a derived
 * summary of the hull's stats plus every outfit's modifiers, cheap to
 * recompute and wasteful to send, which is why the rollback snapshot
 * policy skips it too and re-derives on restore.
 *
 * Nothing re-derived it here, though, so the display world simply never
 * had it — and its readers fell through their `if (!physics)` guards.
 * Two shipped features were dead in the real game as a result, while
 * their unit tests, which set the component by hand, passed:
 *
 *   - the "can't do" beep on a refused jump (ui_sound_triggers_plugin's
 *     playerJumpRefused), which needs `jumpDistanceMod` to size the
 *     no-jump zone, returned false in every state and never beeped;
 *   - the status bar's hyperspace destination (status_bar.ts
 *     DrawStatusBarNavigation) fell back to "jump is possible" and drew
 *     the destination bright whether or not the player could go;
 *   - and JumpReadyBeepSystem, which lists the component as a required
 *     argument, matched no entity at all, so nova:154 never played.
 *
 * ShipDataComponent and OutfitsStateComponent — everything
 * deriveShipPhysics needs — DO cross the bridge, and the display world
 * shares the simulation's game data, so the same provider the simulation
 * runs works here unchanged.
 */
export const ShipPhysicsDisplayPlugin: Plugin = {
    name: 'ShipPhysicsDisplay',
    build(world) {
        world.addComponent(ShipPhysicsComponent);
        world.addSystem(ShipPhysicsProvider);
    },
    remove(world) {
        world.removeSystem(ShipPhysicsProvider);
    },
};
