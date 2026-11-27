import { produce } from 'immer';
import * as t from 'io-ts';
import { installedOutfitMass, OutfitData, OutfitPhysics } from 'novadatainterface/outfit_data';
import { ShipPhysics } from 'novadatainterface/ship_data';
import { Component } from 'nova_ecs/component';
import { map } from 'nova_ecs/datatypes/map';
import { Plugin } from 'nova_ecs/plugin';
import { DeltaResource } from 'nova_ecs/plugins/delta_plugin';
import { MovementPhysics, MovementType } from 'nova_ecs/plugins/movement_plugin';
import { ProvideFromCache } from '../core/index.js';
import { registerEntityDeriver } from '../core/index.js';
import { SimulationGameDataInterface } from '../../client/gamedata/simulation_game_data.js';
import { SimulationGameDataResource } from '../core/index.js';
import { Stat } from '../core/index.js';
import { WeaponsState, WeaponsStateComponent, WeaponState } from './weapons_state.js';
import { weaponReach } from './weapon_range.js';

const OutfitState = t.type({
    count: t.number,
});
export type OutfitState = t.TypeOf<typeof OutfitState>;

const OutfitsState = map(t.string /* Outfit id */, OutfitState);
export type OutfitsState = t.TypeOf<typeof OutfitsState>;

export const OutfitsStateComponent = new Component<OutfitsState>('OutfitsStateComponent');
export const AppliedOutfitsComponent = new Component<{}>('AppliedOutfitsComponent');

/**
 * Sums a numeric field over a ship's owned outfits, weighting each by its
 * count. Returns undefined when any owned outfit's data is not yet cached
 * (so the caller can retry next step, matching the deriveWeaponsState
 * contract). Used by display-side hooks that add up a passive modifier
 * (e.g. murk / interference clearing) across the player's outfits.
 */
export function sumOutfitField(outfits: OutfitsState,
    gameData: SimulationGameDataInterface,
    field: (outfit: OutfitData) => number): number | undefined {
    let total = 0;
    for (const [id, state] of outfits) {
        if (state.count <= 0) {
            continue;
        }
        const outfit = gameData.data.Outfit.getCached(id);
        if (!outfit) {
            return undefined;
        }
        total += field(outfit) * state.count;
    }
    return total;
}

// THE ONE mass rule (the original's measured max/floor for oütf 0x0400)
// lives beside OutfitData so the ship parser can use it too: a hull's
// empty capacity (ShipData physics.freeMass) adds back its stock items at
// exactly the tonnage this rule takes off again. See its doc comment.
export { installedOutfitMass };

export function applyOutfitPhysics(basePhysics: ShipPhysics,
    outfits: Iterable<readonly [OutfitData, number /* count */]>) {
    // The HULL's mass, read before any outfit is applied: no ModType
    // touches `mass`, but the proportional-mass rule is about the ship
    // CLASS's Mass field and must not drift with anything an outfit does.
    const hullMass = basePhysics.mass;
    return produce(basePhysics, (basePhysics) => {
        for (const [outfit, count] of outfits) {
            if (count <= 0) {
                // An outfit the ship does not actually own contributes
                // nothing — including its boolean capabilities, which
                // the `||` below would otherwise grant regardless of
                // count. Same rule as every other outfit summation
                // (sumOutfitField, deriveRepair, deriveIff, deriveCloak).
                continue;
            }
            for (const [uncast, val] of Object.entries(outfit.physics)) {
                const key = uncast as keyof OutfitPhysics;
                if (basePhysics.hasOwnProperty(key)) {
                    if (typeof val === 'number') {
                        if (key === 'freeMass') {
                            // An outfit's freeMass is the space it
                            // occupies, so it consumes the ship's — at
                            // the hull-scaled tonnage for oütf 0x0400.
                            basePhysics.freeMass -=
                                installedOutfitMass(outfit, hullMass) * count;
                        } else {
                            (basePhysics[key] as number) += val * count;
                        }
                    } else if (typeof val === 'boolean') {
                        // Boolean capabilities (fast jumping, inertial
                        // dampers) are granted if any outfit has them.
                        (basePhysics[key] as boolean) =
                            (basePhysics[key] as boolean) || val;
                    }
                }
            }
        }
    });
}

/**
 * WeaponsState from an outfit loadout. Returns a PLAIN Map, never a
 * DefaultMap: the same component decoded from a rollback snapshot, a wire
 * baseline or a save is a plain Map (the io-ts `map` codec), so a live
 * DefaultMap made the object's behaviour depend on whether this world had
 * restored since the derive. A bare `.get()` for an unmounted weapon then
 * CREATED a hashed {count: 0, firing: false} entry on a never-restored
 * world (the server's archive) and returned undefined everywhere else —
 * the 2026-11-27 nova:479 desync, where opening a plunder session
 * (ammoPlunderInputs looking up the victim's ammo weapons on the
 * boarder) left the archive alone with phantom entries.
 */
function deriveWeaponsState(outfits: OutfitsState,
    gameData: SimulationGameDataInterface): WeaponsState | undefined {
        const weaponsState: WeaponsState = new Map<string, WeaponState>();

        for (const [id, state] of outfits) {
            const outfit = gameData.data.Outfit.getCached(id);
            if (!outfit) {
                // Not loaded yet; retry next step.
                return undefined;
            }

            if (outfit.weapons) {
                for (const [weaponId, count] of Object.entries(outfit.weapons)) {
                    // All-or-nothing on the weapon data too: fireGroup
                    // rides in the synced state so weapon selection
                    // never reads getCached at input-application time.
                    const weapon = gameData.data.Weapon.getCached(weaponId);
                    if (!weapon) {
                        return undefined;
                    }
                    let weaponState = weaponsState.get(weaponId);
                    if (!weaponState) {
                        weaponState = { count: 0, firing: false };
                        weaponsState.set(weaponId, weaponState);
                    }
                    weaponState.count += count * state.count;
                    weaponState.fireGroup = weapon.fireGroup;
                    const reach = weaponReach(weapon);
                    if (Number.isFinite(reach)) {
                        weaponState.reach = reach;
                    }
                    if (weapon.destroyShipWhenFiring) {
                        weaponState.suicideReach = weaponReach(weapon);
                    }
                }
            }
        }
        return weaponsState;
}

export const OutfitWeaponProvider = ProvideFromCache({
    name: "OutfitWeaponProvider",
    provided: WeaponsStateComponent,
    update: [OutfitsStateComponent],
    args: [OutfitsStateComponent, SimulationGameDataResource] as const,
    factory: deriveWeaponsState,
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

        registerEntityDeriver(world, {
            name: 'WeaponsStateDeriver',
            provided: WeaponsStateComponent,
            requires: [OutfitsStateComponent],
            derive: (entity, gameData) => deriveWeaponsState(
                entity.components.get(OutfitsStateComponent)!, gameData),
        });
        world.addSystem(OutfitWeaponProvider);
    }
};
