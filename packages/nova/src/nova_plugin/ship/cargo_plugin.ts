import * as t from 'io-ts';
import { Component } from 'nova_ecs/component';
import { map } from 'nova_ecs/datatypes/map';
import { Plugin } from 'nova_ecs/plugin';
import { DeltaResource } from 'nova_ecs/plugins/delta_plugin';
import { Provide } from 'nova_ecs/provide';
import { ShipComponent } from './ship_plugin.js';

/**
 * What a ship is carrying: commodity key -> tons.
 *
 * Three key namespaces share the one map: "cargo:<0-5>" for the standard
 * commodities (STR# 4000 order), "junk:<globalID>" for jünk commodities
 * (both produced by the röid parser as well, for scooped debris), and
 * "mission:<missionId>" for mission freight (mission_logic's
 * missionCargoKey). Sources: the commodity exchange
 * (spaceport/trade_center.ts), mission load/unload, plundering
 * (boarding_plugin.ts), and scooping asteroid debris
 * (asteroid_plugin.ts).
 *
 * EVERY ship has one, including escorts: the trade center trades against
 * the player's whole FLEET, and a cargo-carrying escort's tons live in
 * its own component (spaceport/fleet_cargo.ts) — which is also how they
 * ride the escort's serialized entity into a save and are lost with it.
 *
 * Capacity is not stored here: a ship's cargo space is
 * ShipPhysicsComponent.freeCargo (base hull space plus freeCargo from
 * outfits), so it stays consistent with outfit changes.
 */
export const CargoType = map(t.string, t.number);
export type Cargo = t.TypeOf<typeof CargoType>;
export const CargoComponent = new Component<Cargo>('Cargo');

/** Total tons used in a cargo hold. */
export function cargoUsed(cargo: Cargo): number {
    let used = 0;
    for (const count of cargo.values()) {
        used += count;
    }
    return used;
}

export const ShipCargoProvider = Provide({
    name: "ShipCargoProvider",
    provided: CargoComponent,
    args: [ShipComponent] as const,
    factory: () => new Map<string, number>(),
});

export const CargoPlugin: Plugin = {
    name: 'CargoPlugin',
    build(world) {
        const deltaMaker = world.resources.get(DeltaResource);
        if (!deltaMaker) {
            throw new Error('Expected delta maker resource to exist');
        }
        // Registers with the serializer too, so cargo crosses wire
        // snapshots and rollback snapshots round-trip it.
        deltaMaker.addComponent(CargoComponent, {
            componentType: CargoType,
        });
        world.addSystem(ShipCargoProvider);
    }
};
