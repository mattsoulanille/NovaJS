import * as t from 'io-ts';
import { PlanetData } from "novadatainterface/PlanetData";
import { Emit, UUID } from 'nova_ecs/arg_types';
import { Component } from 'nova_ecs/component';
import { EcsEvent } from 'nova_ecs/events';
import { Plugin } from 'nova_ecs/plugin';
import { DeltaResource } from 'nova_ecs/plugins/delta_plugin';
import { MovementStateComponent } from 'nova_ecs/plugins/movement_plugin';
import { Provide, ProvideAsync } from 'nova_ecs/provider';
import { Query } from 'nova_ecs/query';
import { System } from 'nova_ecs/system';
import { GameDataResource } from './game_data_resource';
import { PlayerShipSelector } from './player_ship_plugin';
import { ControlStateEvent } from './ship_controller_plugin';
import { Target } from './target_component';

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

export const PlanetTargetComponent = new Component<Target>('PlanetTargetComponent');

const PlanetTargetProvider = Provide({
    provided: PlanetTargetComponent,
    args: [] as const,
    factory: () => ({ target: undefined }),
});

export const LandEvent = new EcsEvent<{ id: string }>('LandEvent');

const AttemptLandingSystem = new System({
    name: 'AttemptLandingSystem',
    events: [ControlStateEvent] as const,
    args: [new Query([UUID, MovementStateComponent, PlanetComponent] as const),
        MovementStateComponent, PlanetTargetProvider,
        ControlStateEvent, Emit, PlayerShipSelector] as const,
    step(planets, { position, velocity }, planetTarget, controls, emit) {
        if (controls.get('land') === 'start') {
            let minSquared = Infinity;
            let closestUuid: string | undefined = undefined;
            let planetId: string | undefined = undefined;
            for (const [uuid, { position: planetPosition }, { id }] of planets) {
                const distance = planetPosition.subtract(position).lengthSquared;
                if (distance < minSquared) {
                    closestUuid = uuid;
                    minSquared = distance;
                    planetId = id;
                }
            }

            if (planetTarget.target === closestUuid) {
                // Try to land
                if (minSquared < 10_000 && velocity.lengthSquared < 3000
                    && planetId) {
                    emit(LandEvent, { id: planetId });
                }
            }

            planetTarget.target = closestUuid;
        }
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
            componentType: PlanetType,
        });
        deltaMaker.addComponent(PlanetTargetComponent, {
            componentType: Target,
        });
        world.addSystem(AttemptLandingSystem);
    }
};
