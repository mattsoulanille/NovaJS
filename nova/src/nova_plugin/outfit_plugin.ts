import produce from 'immer';
import * as t from 'io-ts';
import { GameDataInterface } from 'novadatainterface/GameDataInterface';
import { OutfitData, OutfitPhysics } from 'novadatainterface/OutiftData';
import { ShipPhysics } from 'novadatainterface/ShipData';
import { Component } from 'nova_ecs/component';
import { map } from 'nova_ecs/datatypes/map';
import { Plugin } from 'nova_ecs/plugin';
import { DeltaResource } from 'nova_ecs/plugins/delta_plugin';
import { MovementPhysics, MovementType } from 'nova_ecs/plugins/movement_plugin';
import { ProvideAsync } from 'nova_ecs/provider';
import { DefaultMap } from '../common/DefaultMap';
import { GameDataResource } from './game_data_resource';
import { Stat } from './stat';
import { WeaponsStateComponent, WeaponState } from './weapons_state';

const OutfitState = t.type({
    count: t.number,
});
export type OutfitState = t.TypeOf<typeof OutfitState>;

const OutfitsState = map(t.string /* Outfit id */, OutfitState);
export type OutfitsState = t.TypeOf<typeof OutfitsState>;

export const OutfitsStateComponent = new Component<OutfitsState>('OutfitsStateComponent');
export const AppliedOutfitsComponent = new Component<{}>('AppliedOutfitsComponent');

export function applyOutfitPhysics(basePhysics: ShipPhysics,
    outfits: Iterable<readonly [OutfitData, number /* count */]>) {
    return produce(basePhysics, (basePhysics) => {
        for (const [outfit, count] of outfits) {
            for (const [uncast, val] of Object.entries(outfit.physics)) {
                const key = uncast as keyof OutfitPhysics;
                if (basePhysics.hasOwnProperty(key)) {
                    if (typeof val === 'number') {
                        (basePhysics[key] as number) += val * count;
                    }
                }
            }
        }
    });
}

const OutfitWeaponProvider = ProvideAsync({
    name: "OutfitWeaponProvider",
    provided: WeaponsStateComponent,
    update: [OutfitsStateComponent],
    args: [OutfitsStateComponent, GameDataResource] as const,
    async factory(outfits, gameData) {
        const weaponsState = new DefaultMap<string, WeaponState>(() => ({
            count: 0,
            firing: false,
        }));

        for (const [id, state] of outfits) {
            const outfit = await gameData.data.Outfit.get(id);
            if (!outfit) {
                continue;
            }

            if (outfit.weapons) {
                for (const [weaponId, count] of Object.entries(outfit.weapons)) {
                    weaponsState.get(weaponId).count += count * state.count;
                }
            }
        }
        return weaponsState;
    }
});

export const OutfitPlugin: Plugin = {
    name: "OutfitPlugin",
    build(world) {
        const deltaMaker = world.resources.get(DeltaResource);
        if (!deltaMaker) {
            throw new Error('Expected delta maker resource to exist');
        }

        world.addComponent(OutfitsStateComponent);
        world.addComponent(AppliedOutfitsComponent);

        deltaMaker.addComponent(OutfitsStateComponent, {
            componentType: OutfitsState,
        });
        deltaMaker.addComponent(AppliedOutfitsComponent, {
            componentType: t.type({}),
        });

        world.addSystem(OutfitWeaponProvider);
    }
};

