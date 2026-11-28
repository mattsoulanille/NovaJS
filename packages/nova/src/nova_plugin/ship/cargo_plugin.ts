import * as t from 'io-ts';
import { Component } from 'nova_ecs/component';
import { map } from 'nova_ecs/datatypes/map';
import { Plugin } from 'nova_ecs/plugin';
import { DeltaResource } from 'nova_ecs/plugins/delta_plugin';
import { SerializerResource } from 'nova_ecs/plugins/serializer_plugin';
import { Provide } from 'nova_ecs/provide';
import { CargoJettisonedEvent, CargoJettisonedEventType } from './jettison_cargo.js';
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

/**
 * Base prices of the six standard commodities ("cargo:0" .. "cargo:5",
 * STR# 4004): Food, Industrial, Medical, Luxury, Metal, Equipment. The
 * trade center prices off them (economy/trade_logic.ts, which re-exports
 * this), and a pirate plundering a disabled player takes the costliest
 * first (npc/npc_plunder.ts).
 */
export const STANDARD_COMMODITY_BASE_PRICES: readonly number[] =
    [75, 350, 750, 900, 200, 550];

/** Total tons used in a cargo hold. */
export function cargoUsed(cargo: Cargo): number {
    let used = 0;
    for (const count of cargo.values()) {
        used += count;
    }
    return used;
}

/**
 * What of `pooled` goes aboard a `capacity` hold when two hulls exchange
 * holds: every ton of mission cargo, then commodities until the hold is
 * full, the highest key given up first (so the result does not depend on
 * Map order). Not the trade-in's proportional cut (spaceport/
 * shipyard_rules' cargoForNewShip, R11): on an exchange nothing is
 * destroyed, so the receiving hull is filled to the brim and the rest stays
 * on the other one. The hangar's swaps' (spaceport/ship_storage.ts). (The
 * capture's "Use As My Ship" exchanges nothing: both holds are lost there,
 * encounters/boarding_plugin.ts tradePlacesWithCaptain.)
 */
export function fillHold(pooled: Cargo, capacity: number): Cargo {
    const result = new Map(pooled);
    const droppable = [...result.keys()]
        .filter(key => !key.startsWith('mission:'))
        .sort()
        .reverse();
    for (const key of droppable) {
        const over = cargoUsed(result) - capacity;
        if (over <= 0) {
            break;
        }
        const held = result.get(key) ?? 0;
        if (held <= over) {
            result.delete(key);
        } else {
            result.set(key, held - over);
        }
    }
    return result;
}

/**
 * THE HOLD EXCHANGE of two hulls (a hangar swap): the pilot's hold and
 * the incoming hull's are pooled, the incoming hull takes what
 * {@link fillHold} gives it, and the rest stays aboard the hull being left.
 */
export function exchangeHolds(pilot: Cargo, incoming: Iterable<[string, number]>,
    capacity: number): { aboard: Cargo, leftBehind: Cargo } {
    const pooled = new Map(pilot);
    for (const [key, tons] of incoming) {
        pooled.set(key, (pooled.get(key) ?? 0) + tons);
    }
    const aboard = fillHold(pooled, capacity);
    const leftBehind: Cargo = new Map();
    for (const [key, tons] of pooled) {
        const left = tons - (aboard.get(key) ?? 0);
        if (left > 0) {
            leftBehind.set(key, left);
        }
    }
    return { aboard, leftBehind };
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
        world.resources.get(SerializerResource)?.addEvent(
            CargoJettisonedEvent, CargoJettisonedEventType);
        world.addSystem(ShipCargoProvider);
    }
};
