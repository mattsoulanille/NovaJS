import * as t from 'io-ts';
import { ShipData } from "novadatainterface/ShipData";
import { Component } from 'nova_ecs/component';
import { Plugin } from 'nova_ecs/plugin';
import { DeltaResource } from 'nova_ecs/plugins/delta_plugin';
import { ProvideAsync } from 'nova_ecs/provider';
import { GameDataResource } from './game_data_resource';

export const ShipType = t.type({
    id: t.string // Not a UUID. A nova id.
});
export type ShipType = t.TypeOf<typeof ShipType>;

export const ShipComponent = new Component<ShipType>('Ship');

export const ShipDataComponent = new Component<ShipData>('ShipData');

export const ShipDataProvider = ProvideAsync({
    provided: ShipDataComponent,
    args: [GameDataResource, ShipComponent] as const,
    factory: async (gameData, ship) => {
        return await gameData.data.Ship.get(ship.id);
    }
});

export const ShipPlugin: Plugin = {
    name: "ShipPlugin",
    build(world) {
        const deltaMaker = world.resources.get(DeltaResource);
        if (!deltaMaker) {
            throw new Error('Expected delta maker resource to exist');
        }

        world.addComponent(ShipComponent);
        world.addComponent(ShipDataComponent);
        deltaMaker.addComponent(ShipComponent, {
            componentType: ShipType
        });
    }
}
