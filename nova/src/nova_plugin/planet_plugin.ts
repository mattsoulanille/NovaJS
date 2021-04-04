import * as t from 'io-ts';
import { PlanetData } from "novadatainterface/PlanetData";
import { Component } from 'nova_ecs/component';
import { Plugin } from 'nova_ecs/plugin';
import { DeltaResource } from 'nova_ecs/plugins/delta_plugin';
import { ProvideAsync } from 'nova_ecs/provider';
import { GameDataResource } from './game_data_resource';

export const PlanetType = t.type({
    id: t.string // Not a UUID. A nova id.
});
export type PlanetType = t.TypeOf<typeof PlanetType>;

export const PlanetComponent = new Component<PlanetType>('Planet');

export const PlanetDataComponent = new Component<PlanetData>('PlanetData');

export const PlanetDataProvider = ProvideAsync({
    provided: PlanetDataComponent,
    args: [GameDataResource, PlanetComponent] as const,
    factory: async (gameData, planet) => {
        return await gameData.data.Planet.get(planet.id);
    }
});

export const PlanetPlugin: Plugin = {
    name: 'PlanetPlugin',
    build(world) {
        const deltaMaker = world.resources.get(DeltaResource);
        if (!deltaMaker) {
            throw new Error('Expected delta maker resource to exist');
        }

        world.addComponent(PlanetComponent);
        world.addComponent(PlanetDataComponent);
        deltaMaker.addComponent(PlanetComponent, {
            componentType: PlanetType
        });
    }
};
