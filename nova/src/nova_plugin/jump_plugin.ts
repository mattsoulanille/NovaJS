import { System } from "nova_ecs/system";
import { EcsEvent } from "nova_ecs/events";
import { Entity } from "nova_ecs/entity";
import { Emit, Entities, GetEntity, UUID } from "nova_ecs/arg_types";
import { Plugin } from "nova_ecs/plugin";
import { SystemComponent } from "./nova_plugin";
import { ControlStateEvent } from "./ship_controller_plugin";
import { PlayerShipSelector } from "./player_ship_plugin";
import { SystemsResource } from "./systems_resource";
import { deImmerify } from "../util/deimmerify";
import { SystemIdResource } from "./make_system";
import { Optional } from "nova_ecs/optional";
import { GameDataResource } from "./game_data_resource";

export interface InitiateJump {
    to: string /* system uuid */,
}
const InitiateJumpEvent = new EcsEvent<InitiateJump>('InitiateJumpEvent');

export interface FinishJump {
    entity: Entity,
    uuid: string,
    to: string,
}
export const FinishJumpEvent = new EcsEvent<FinishJump>('FinishJumpEvent');

const JumpFromSystem = new System({
    name: 'JumpFromSystem',
    events: [InitiateJumpEvent],
    args: [GetEntity, UUID, Entities, InitiateJumpEvent, Emit] as const,
    step(entity, uuid, entities, { to }, emit) {
        entities.delete(uuid);
        // TODO: Animation etc.
        deImmerify(entity);
        emit(FinishJumpEvent, { entity, uuid, to });
    }
});

const PlayerJumpControl = new System({
    name: 'PlayerJumpControl',
    events: [ControlStateEvent],
    args: [ControlStateEvent, Emit, UUID, SystemIdResource,
        PlayerShipSelector] as const,
    step(controlState, emit, uuid, systemId) {
        if (controlState.get('hyperjump') === 'start') {
            const currentId = systemId ? Number(systemId.split(':')[1]) : 128;
            const id = (currentId + 1 - 128) % 6 + 128;
            const randomSystem = `nova:${id}`;
            emit(InitiateJumpEvent, { to: randomSystem }, [uuid]);
        }
    }
});

// For a single system to emit jump events.
export const JumpPlugin: Plugin = {
    name: 'JumpPlugin',
    build(world) {
        world.addSystem(JumpFromSystem);
        world.addSystem(PlayerJumpControl);
    }
};

// Pass jump events between systems.
// TODO: Support changing set of systems.
export const WorldJumpPlugin: Plugin = {
    name: 'WorldJumpPlugin',
    build(world) {
        const systems = world.resources.get(SystemsResource);
        if (!systems) {
            throw new Error('World must have systems resource');
        }

        for (const [, system] of systems) {
            system.events.get(FinishJumpEvent).subscribe(
                ({ entity, to, uuid }) => {
                    const destination = systems.get(to) ?? system;
                    destination.entities.set(uuid, entity);
                });
        }
    }
}
