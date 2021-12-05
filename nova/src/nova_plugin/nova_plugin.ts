import { Component } from "nova_ecs/component";
import { EntityBuilder } from "nova_ecs/entity";
import { AddEvent, DeleteEvent } from "nova_ecs/events";
import { Plugin } from "nova_ecs/plugin";
import { DeltaResource } from "nova_ecs/plugins/delta_plugin";
import { CommunicatorResource, multiplayer, MultiplayerData, NewOwnedEntityEvent } from "nova_ecs/plugins/multiplayer_plugin";
import { Resource } from "nova_ecs/resource";
import { System } from "nova_ecs/system";
import { World } from "nova_ecs/world";
import { MultiRoom } from "../communication/multi_room_communicator";
import { GameDataResource } from "./game_data_resource";
import { WorldJumpPlugin } from "./jump_plugin";
import { makeSystem } from "./make_system";
import { SystemsResource } from "./systems_resource";


export const SystemComponent = new Component<World>('SystemComponent');
export const ActiveSystemComponent = new Component<true>('ActiveSystemComponent');

const StepSystemSystem = new System({
    name: "StepSystemSystem",
    args: [SystemComponent, ActiveSystemComponent] as const,
    step(system) {
        system.step();
    }
});

export const MultiplayerCountComponent =
    new Component<{ count: number }>('MultiplayerCountComponent');
export const MultiRoomResource = new Resource<MultiRoom>('MultiRoomResource');

export const NovaPlugin: Plugin = {
    name: 'NovaPlugin',
    async build(world) {
        const gameData = world.resources.get(GameDataResource);
        if (!gameData) {
            throw new Error('GameDataResource must exist');
        }
        const communicator = world.resources.get(CommunicatorResource);
        if (!communicator) {
            throw new Error('CommunicatorResource must exist');
        }
        const multiRoom = world.resources.get(MultiRoomResource);
        if (!multiRoom) {
            throw new Error('MultiRoomResource must exist');
        }

        world.addSystem(StepSystemSystem);

        const systems = await Promise.all(
            (await gameData.ids).System
                .map(async id => [id, makeSystem(id, gameData)] as const));

        world.resources.set(SystemsResource, new Map(systems));

        for (const [id, system] of systems) {
            await system.addPlugin(multiplayer(multiRoom.join(id),
                message => `System ${id}: ${message}`));

            const systemEntity = new EntityBuilder()
                .addComponent(SystemComponent, system)
                .addComponent(MultiplayerCountComponent, { count: 0 })
                .build();
            world.entities.set(id, systemEntity);

            // Track active systems by subscribing to the add and remove events
            // instead of using an ecs system that listens to those events because
            // the ecs system will not run if the nova system is not active.
            system.events.get(AddEvent).subscribe(([, addedEntity]) => {
                const multiplayerData = addedEntity.components.get(MultiplayerData);

                if (multiplayerData && multiplayerData.owner !== 'server') {
                    const count = ++systemEntity.components
                        .get(MultiplayerCountComponent)!.count;
                    if (count > 0) {
                        systemEntity.components.set(ActiveSystemComponent, true);
                    }
                };
            });
            system.events.get(DeleteEvent).subscribe(entities => {
                for (const [, deletedEntity] of entities) {
                    const multiplayerData = deletedEntity.components
                        .get(MultiplayerData);
                    if (multiplayerData && multiplayerData.owner !== 'server') {
                        systemEntity.components
                            .get(MultiplayerCountComponent)!.count++;
                    }
                }
                const count = systemEntity.components.get(MultiplayerCountComponent)!.count;
                if (count < 0) {
                    console.warn(`System ${id} has ${count} multiplayer objects`);
                }
                if (count <= 0) {
                    systemEntity.components.get(MultiplayerCountComponent)!.count = 0;
                    systemEntity.components.delete(ActiveSystemComponent);
                }
            });

            // Set initial active systems based on the initial system state
            // for (const entity of system.entities.values()) {
            //     if (entity.components.has(MultiplayerData)) {
            //         systemEntity.components.set(ActiveSystemComponent, true);
            //     }
            // }

            // system.events.get(NewOwnedEntityEvent).subscribe(uuid => {
            //     console.log(`New owned entity ${uuid}`);
            // });
        }
        await world.addPlugin(WorldJumpPlugin);
    }
}

