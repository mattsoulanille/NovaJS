import { produce } from 'immer';
import * as t from 'io-ts';
import { OutfitData, OutfitPhysics } from 'novadatainterface/outfit_data';
import { ShipPhysics } from 'novadatainterface/ship_data';
import { Component } from 'nova_ecs/component';
import { map } from 'nova_ecs/datatypes/map';
import { Plugin } from 'nova_ecs/plugin';
import { DeltaResource } from 'nova_ecs/plugins/delta_plugin';
import { MovementPhysics, MovementType } from 'nova_ecs/plugins/movement_plugin';
import { ProvideFromCache } from '../core/index.js';
import { registerEntityDeriver } from '../core/index.js';
import { SimulationGameDataInterface } from '../../client/gamedata/simulation_game_data.js';
import { DefaultMap } from '../../common/default_map.js';
import { SimulationGameDataResource } from '../core/index.js';
import { Stat } from '../core/index.js';
import { WeaponsStateComponent, WeaponState } from './weapons_state.js';
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

/**
 * The tonnage ONE unit of `outfit` takes up aboard a hull of `shipMass`
 * tons: its oütf Mass as written, unless flag 0x0400 says the mass is
 * proportional to the ship's — "ship class Mass field is multiplied by
 * this item's Mass field and then divided by 100. Only works for
 * positive-mass items" (EVN Bible ~:1977).
 *
 * ROUNDING RULING: rounded UP to a whole ton. The Bible's formula is
 * fractional for small hulls (Carbon Fiber, Mass 1, on a mass-25 Heavy
 * Shuttle is 0.25), and the original-hardware capture
 * ui_screenshots/original_macos_screenshots/outfitter/
 * earth_outfitter_carbon_fiber_cant_hold_any_more.png settles it: that
 * pilot is in a mass-25 hull ("Item Price: 6,250 cr" = 250 x 25), the pane
 * reads "Item Mass: 1 ton" beside "Available: 0 tons", and the caption is
 * "Can't hold any more!" — so the installed mass is a full ton, not 0.25
 * and not the 0 that floor or nearest rounding would give (a zero-mass
 * item would fit in zero tons and draw no such caption).
 *
 * This is THE ONE mass rule: the sim's physics derivation
 * (applyOutfitPhysics below), the outfitter's free-mass arithmetic and
 * its "Item Mass:" line all read it, so what the shop quotes is what the
 * ship flies with.
 */
export function installedOutfitMass(outfit: OutfitData,
    shipMass: number): number {
    const mass = outfit.physics.freeMass;
    if (outfit.massScalesWithShipMass && mass > 0) {
        return Math.ceil(shipMass * mass / 100);
    }
    return mass;
}

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

function deriveWeaponsState(outfits: OutfitsState,
    gameData: SimulationGameDataInterface) {
        const weaponsState = new DefaultMap<string, WeaponState>(() => ({
            count: 0,
            firing: false,
        }));

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
                    const weaponState = weaponsState.get(weaponId);
                    weaponState.count += count * state.count;
                    weaponState.fireGroup = weapon.fireGroup;
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
