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
import { AnimationComponent } from './animation_plugin';
import { ControlStateEvent } from './control_state_event';
import { GameDataResource } from './game_data_resource';
import { PlayerShipSelector } from './player_ship_plugin';
import { ShipComponent } from './ship_plugin';
import { Target } from './target_component';

export const PlanetType = t.type({
    id: t.string // Not a UUID. A nova id.
});
export type PlanetType = t.TypeOf<typeof PlanetType>;

export const PlanetComponent = new Component<PlanetType>('Planet');

export const PlanetDataComponent = new Component<PlanetData>('PlanetData');

export const PlanetDataProvider = ProvideAsync({
    name: "PlanetDataProvider",
    provided: PlanetDataComponent,
    args: [GameDataResource, PlanetComponent] as const,
    factory: async (gameData, planet) => {
        return await gameData.data.Planet.get(planet.id);
    }
});

export const PlanetTargetComponent = new Component<Target>('PlanetTargetComponent');

const PlanetTargetProvider = Provide({
    name: "PlanetTargetProvider",
    provided: PlanetTargetComponent,
    args: [ShipComponent] as const,
    factory: () => ({ target: undefined }),
});

export const LandEvent = new EcsEvent<{ id: string, uuid: string }>('LandEvent');

const AttemptLandingSystem = new System({
    name: 'AttemptLandingSystem',
    events: [ControlStateEvent] as const,
    args: [new Query([UUID, MovementStateComponent, PlanetComponent] as const),
        MovementStateComponent, PlanetTargetComponent,
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
                    && planetId && closestUuid) {
                    emit(LandEvent, { id: planetId, uuid: closestUuid });
                }
            }

            planetTarget.target = closestUuid;
        }
    }
});

const PlanetAnimationProvider = Provide({
    name: "PlanetAnimationProvider",
    provided: AnimationComponent,
    update: [PlanetDataComponent],
    args: [PlanetDataComponent],
    factory: planetData => planetData.animation,
});

// TODO: Make planets multiplayer aware
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
        world.addSystem(PlanetTargetProvider);
        world.addSystem(PlanetAnimationProvider);
        world.addSystem(PlanetDataProvider);
        world.addSystem(AttemptLandingSystem);
    }
};
