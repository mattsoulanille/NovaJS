import { Emit } from 'nova_ecs/arg_types';
import { Angle } from 'nova_ecs/datatypes/angle';
import { Optional } from 'nova_ecs/optional';
import { Plugin } from 'nova_ecs/plugin';
import { KeyboardPlugin } from 'nova_ecs/plugins/keyboard_plugin';
import { MovementPhysicsComponent, MovementStateComponent, MovementSystem, MovementType } from 'nova_ecs/plugins/movement_plugin';
import { passthroughType, SerializerResource } from 'nova_ecs/plugins/serializer_plugin';
import { Resource } from 'nova_ecs/resource';
import { System } from 'nova_ecs/system';
import { SingletonComponent } from 'nova_ecs/world';
import { EcsControlEvent } from '../core/index.js';
import { AnalogControlComponent, ControlledByComponent, ControlledByType, SetControlledShipSystem, ShipControlStateComponent } from '../player/index.js';
import { PlatformResource } from '../core/index.js';
import { PlayerShipPlugin, PlayerShipSelector } from '../player/index.js';
import { PlanetTargetComponent } from './planet_plugin.js';
import { TargetComponent } from '../ship/index.js';


// Applies a ship's held-control state to its movement. Runs for every
// controlled ship, local or remote: per-peer input application updates
// each ship's ShipControlStateComponent from that peer's input records.
// Exported so the jump sequence can order itself after this and
// override the player's movement inputs while a jump is in progress.
export const ControlShipSystem = new System({
    name: 'ControlPlayerShip',
    args: [ShipControlStateComponent, MovementStateComponent,
        MovementPhysicsComponent, TargetComponent,
        Optional(PlanetTargetComponent),
        Optional(AnalogControlComponent)] as const,
    step(controlState, movementState, movementPhysics, { target },
        planetTarget, analog) {
        movementState.accelerating = controlState.get('accelerate') ? 1 : 0;
        movementState.turning =
            (controlState.get('turnLeft') ? -1 : 0) +
            (controlState.get('turnRight') ? 1 : 0);

        movementState.turnTo = null;
        if (controlState.get('pointTo')) {
            // Point at the targeted ship if there is one; otherwise fall back
            // to the selected stellar body. Both are entity UUIDs the
            // MovementSystem resolves to a position (PlanetTargetComponent's
            // `planet <id>` entity always carries a MovementState). Reads only
            // synced state and the control is input-recorded, so it stays
            // deterministic.
            const steerTarget = target ?? planetTarget?.target;
            if (steerTarget) {
                movementState.turnTo = steerTarget;
            }
        }

        if (movementPhysics.movementType === MovementType.INERTIAL) {
            movementState.turnBack = Boolean(controlState.get('reverse'));
        } else if (movementPhysics.movementType === MovementType.INERTIALESS) {
            movementState.turnBack = false;
            if (controlState.get('reverse')) {
                movementState.accelerating += -1;
            }
        }

        // Analog steering (virtual joystick / autopilot) overrides the
        // digital controls per axis while active. The movement engine
        // already supports both halves: turnTo accepts an absolute
        // Angle, and accelerating is a scalar throttle (negative
        // values brake inertialess ships; inertial ships ignore them).
        if (analog) {
            if (analog.throttle !== null) {
                movementState.accelerating = movementPhysics.movementType
                    === MovementType.INERTIAL
                    ? Math.max(0, analog.throttle)
                    : analog.throttle;
            }
            if (analog.heading !== null) {
                // Reuse the held Angle when unchanged: a fresh (but
                // equal) instance every tick would defeat ===-based
                // change detection downstream.
                const turnTo: unknown = movementState.turnTo;
                if (!(turnTo instanceof Angle)
                    || turnTo.angle !== analog.heading) {
                    movementState.turnTo = new Angle(analog.heading);
                }
                movementState.turnBack = false;
            }
        }
    },
    before: [MovementSystem]
});

export const ShipController: Plugin = {
    name: 'ShipController',
    async build(world) {
        // Every simulation runs the same control systems regardless of
        // platform: a server world stepping a ship must apply control
        // state exactly like a client's worker does, or the
        // simulations diverge. Only keyboard capture is browser-only.
        const platform = world.resources.get(PlatformResource);
        if (platform === 'browser') {
            await world.addPlugin(KeyboardPlugin);
        }
        await world.addPlugin(PlayerShipPlugin);
        world.resources.get(SerializerResource)?.addComponent(
            ControlledByComponent, ControlledByType);
        world.addSystem(ControlShipSystem);
        world.addSystem(SetControlledShipSystem);
    }
};
