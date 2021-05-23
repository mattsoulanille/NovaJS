import * as t from 'io-ts';
import { Entities, GetEntity, UUID } from 'nova_ecs/arg_types';
import { Component } from 'nova_ecs/component';
import { map } from 'nova_ecs/datatypes/map';
import { Plugin } from 'nova_ecs/plugin';
import { DeltaResource } from 'nova_ecs/plugins/delta_plugin';
import { System } from 'nova_ecs/system';
import { DefaultMap } from 'nova_ecs/utils';
import { Without } from 'nova_ecs/without';
import { GameDataResource } from './game_data_resource';
import { WeaponsStateComponent, WeaponState } from './weapon_plugin';


const OutfitState = t.type({
    count: t.number,
});
export type OutfitState = t.TypeOf<typeof OutfitState>;

const OutfitsState = map(t.string /* Outfit id */, OutfitState);
export type OutfitsState = t.TypeOf<typeof OutfitsState>;

export const OutfitsStateComponent = new Component<OutfitsState>('OutfitsStateComponent');
const AppliedOutfitsComponent = new Component<{}>('AppliedOutfitsComponent');

export const ApplyOutfitsSystem = new System({
    name: "ApplyOutfitsSystem",
    args: [OutfitsStateComponent, GameDataResource, GetEntity, UUID, Entities,
        Without(AppliedOutfitsComponent)] as const,
    step: async (outfits, gameData, entity, uuid, entities) => {
        const weaponsState = new DefaultMap<string, WeaponState>(() => ({
            count: 0,
            firing: false,
        }));

        for (const [id, state] of outfits) {
            const outfit = await gameData.data.Outfit.get(id);
            if (entities.get(uuid)?.components.get(OutfitsStateComponent) !== outfits) {
                // This handles the case where the OutfitStateComponent is reassinged before
                // this function finishes.
                // TODO: Fix AsyncSystem creating a call stack overflow when used here.
                return;
            }
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
        entity.components.set(AppliedOutfitsComponent, {});
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
        world.addSystem(ApplyOutfitsSystem);

        deltaMaker.addComponent(OutfitsStateComponent, {
            componentType: OutfitsState,
        });
        deltaMaker.addComponent(AppliedOutfitsComponent, {
            componentType: t.type({}),
        });
    }
};

