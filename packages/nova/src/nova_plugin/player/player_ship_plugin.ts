import { Plugin } from 'nova_ecs/plugin';
import { Component } from "nova_ecs/component";
import { markerType, SerializerResource } from 'nova_ecs/plugins/serializer_plugin';


// Used to mark the single ship that's under control.
export const PlayerShipSelector = new Component<undefined>('ShipControl');

export const PlayerShipPlugin: Plugin = {
    name: 'PlayerShipPlugin',
    build(world) {
        world.resources.get(SerializerResource)?.addComponent(PlayerShipSelector, markerType);
    }
};
