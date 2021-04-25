import * as t from 'io-ts';
import { GetEntity } from 'nova_ecs/arg_types';
import { AsyncSystem } from 'nova_ecs/async_system';
import { Component } from 'nova_ecs/component';
import { map } from 'nova_ecs/datatypes/map';
import { DefaultMap } from 'nova_ecs/utils';
import { Without } from 'nova_ecs/without';
import { GameDataResource } from './game_data_resource';
import { WeaponsStateComponent, WeaponState } from './weapon_plugin';
import { Plugin } from 'nova_ecs/plugin';


const OutfitState = t.type({
    count: t.number,
});
export type OutfitState = t.TypeOf<typeof OutfitState>;

const OutfitsState = map(t.string /* Outfit id */, OutfitState);
export type OutfitsState = t.TypeOf<typeof OutfitsState>;

export const OutfitsStateComponent = new Component<OutfitsState>('OutfitsStateComponent');
const AppliedOutfitsComponent = new Component<undefined>('AppliedOutfitsComponent');

export const ApplyOutfitsSystem = new AsyncSystem({
    name: "ApplyOutfitsSystem",
    args: [OutfitsStateComponent, GameDataResource, GetEntity,
        Without(AppliedOutfitsComponent)] as const,
    step: async (outfits, gameData, entity) => {
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

        entity.components.set(WeaponsStateComponent, new Map(weaponsState));
        entity.components.set(AppliedOutfitsComponent, undefined);
    }
});

export const OutfitPlugin: Plugin = {
    name: "OutfitPlugin",
    build(world) {
        world.addComponent(OutfitsStateComponent);
        world.addComponent(AppliedOutfitsComponent);
        world.addSystem(ApplyOutfitsSystem);
    }
};

