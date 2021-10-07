import * as t from 'io-ts';
import { GameDataInterface } from 'novadatainterface/GameDataInterface';
import { Component } from 'nova_ecs/component';
import { map } from 'nova_ecs/datatypes/map';
import { Plugin } from 'nova_ecs/plugin';
import { DeltaResource } from 'nova_ecs/plugins/delta_plugin';
import { MovementPhysics, MovementType } from 'nova_ecs/plugins/movement_plugin';
import { ProvideAsync } from 'nova_ecs/provider';
import { DefaultMap } from '../common/DefaultMap';
import { GameDataResource } from './game_data_resource';
import { WeaponsStateComponent, WeaponState } from './weapon_plugin';


const OutfitState = t.type({
    count: t.number,
});
export type OutfitState = t.TypeOf<typeof OutfitState>;

const OutfitsState = map(t.string /* Outfit id */, OutfitState);
export type OutfitsState = t.TypeOf<typeof OutfitsState>;

export const OutfitsStateComponent = new Component<OutfitsState>('OutfitsStateComponent');
export const AppliedOutfitsComponent = new Component<{}>('AppliedOutfitsComponent');

export async function applyOutfitPhysics(gameData: GameDataInterface,
    movementPhysics: MovementPhysics, outfits: OutfitsState) {

    for (const [id, state] of outfits) {
        const outfit = await gameData.data.Outfit.get(id);
        if (!outfit) {
            continue;
        }
        if (outfit.physics) {
            movementPhysics.acceleration +=
                state.count * (outfit.physics.acceleration ?? 0);
            movementPhysics.maxVelocity +=
                state.count * (outfit.physics.speed ?? 0);
            movementPhysics.turnRate +=
                state.count * (outfit.physics.turnRate ?? 0);

            if (outfit.physics.inertialess) {
                movementPhysics.movementType = MovementType.INERTIALESS;
            }
            // TODO: Afterburner
        }
    }
    return movementPhysics;
}

// export const ApplyOutfitsSystem = new System({
//     name: "ApplyOutfitsSystem",
//     args: [OutfitsStateComponent, GameDataResource, GetEntity, UUID, Entities,
//         MovementPhysicsComponent, Optional(ShieldComponent),
//         Optional(ArmorComponent), Optional(IonizationComponent),
//         Without(AppliedOutfitsComponent)] as const,
//     step: async (outfits, gameData, entity, uuid, entities, movementPhysics,
//         shield, armor, ionization) => {
//         const weaponsState = new DefaultMap<string, WeaponState>(() => ({
//             count: 0,
//             firing: false,
//         }));

//         for (const [id, state] of outfits) {
//             const outfit = await gameData.data.Outfit.get(id);
//             if (entities.get(uuid)?.components.get(OutfitsStateComponent) !== outfits) {
//                 // This handles the case where the OutfitStateComponent is reassinged before
//                 // this function finishes.
//                 // TODO: Fix AsyncSystem creating a call stack overflow when used here.
//                 return;
//             }
//             if (!outfit) {
//                 continue;
//             }

//             if (outfit.weapons) {
//                 for (const [weaponId, count] of Object.entries(outfit.weapons)) {
//                     weaponsState.get(weaponId).count += count * state.count;
//                 }
//             }

//             if (outfit.physics) {
//                 movementPhysics.acceleration +=
//                     state.count * (outfit.physics.acceleration ?? 0);
//                 movementPhysics.maxVelocity +=
//                     state.count * (outfit.physics.speed ?? 0);
//                 movementPhysics.turnRate +=
//                     state.count * (outfit.physics.turnRate ?? 0);

//                 if (outfit.physics.inertialess) {
//                     movementPhysics.movementType = MovementType.INERTIALESS;
//                 }
//                 // TODO: Afterburner

//                 if (shield) {
//                     shield.max += state.count * (outfit.physics.shield ?? 0);
//                     shield.recharge +=
//                         state.count * (outfit.physics.shieldRecharge ?? 0);
//                 }

//                 if (armor) {
//                     armor.max += state.count * (outfit.physics.armor ?? 0);
//                     armor.recharge +=
//                         state.count * (outfit.physics.armorRecharge ?? 0);
//                 }

//                 if (ionization) {
//                     ionization.max += state.count * (outfit.physics.ionization ?? 0);
//                     ionization.recharge +=
//                         state.count * (outfit.physics.deionize ?? 0);
//                 }
//             }
//         }

//         entity.components.set(WeaponsStateComponent, new Map(weaponsState));
//         entity.components.set(AppliedOutfitsComponent, {});
//     }
// });


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

