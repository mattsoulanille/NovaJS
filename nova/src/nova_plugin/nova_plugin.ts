import { Component } from "nova_ecs/component";
import { Plugin } from "nova_ecs/plugin";
import { Resource } from "nova_ecs/resource";
import { System } from "nova_ecs/system";
import { World } from "nova_ecs/world";
import { MultiRoom } from "../communication/multi_room_communicator";


export const SystemComponent = new Component<World>('SystemComponent');

const StepSystemSystem = new System({
    name: "StepSystemSystem",
    args: [SystemComponent] as const,
    step(system) {
        system.step();
    }
});

export const MultiRoomResource = new Resource<MultiRoom>('MultiRoomResource');

export const NovaPlugin: Plugin = {
    name: 'NovaPlugin',
    async build(world) {
        world.addSystem(StepSystemSystem);
    }
}

