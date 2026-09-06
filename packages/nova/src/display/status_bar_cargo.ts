import { Entities, GetEntity, UUID } from "nova_ecs/arg_types";
import { Component } from "nova_ecs/component";
import { Entity } from "nova_ecs/entity";
import { Optional } from "nova_ecs/optional";
import { TimeResource } from "nova_ecs/plugins/time_plugin";
import { System } from "nova_ecs/system";
import { SimulationGameDataInterface } from "../client/gamedata/simulation_game_data.js";
import { CargoComponent } from "../nova_plugin/cargo_plugin.js";
import { SimulationGameDataResource } from "../nova_plugin/game_data_resource.js";
import { STANDARD_CARGO_NAMES } from "../nova_plugin/mission_logic.js";
import { OutfitsState, OutfitsStateComponent, sumOutfitField } from "../nova_plugin/outfit_plugin.js";
import { PlayerEscortComponent } from "../nova_plugin/player_escort.js";
import { PlayerShipSelector } from "../nova_plugin/player_ship_plugin.js";
import { CreditsComponent } from "../nova_plugin/player_state_plugin.js";
import { ShipComponent } from "../nova_plugin/ship_plugin.js";
import {
    entityCarriesFleetCargo, FleetMemberCargo, sumFleetCargo,
} from "../spaceport/fleet_cargo.js";
import {
    abbreviateCargoName, CargoLine, specialCargoSummary, standardCargoIndex,
} from "./status_bar_content.js";
import { StatusBarResource } from "./status_bar_resource.js";

/**
 * Total cargo capacity in tons for a ship + its owned outfits, or undefined
 * if the ship or an outfit's data hasn't cached yet (getCached kicks off the
 * load). Shared by the in-flight and docked cargo readouts.
 */
export function cargoCapacityOf(shipId: string, outfits: OutfitsState | undefined,
    gameData: SimulationGameDataInterface): number | undefined {
    const shipData = gameData.data.Ship.getCached(shipId);
    if (!shipData) {
        return undefined;
    }
    let capacity = shipData.physics.freeCargo;
    if (outfits) {
        const outfitCargo = sumOutfitField(
            outfits, gameData, o => o.physics.freeCargo ?? 0);
        if (outfitCargo === undefined) {
            return undefined; // An outfit's data isn't cached yet.
        }
        capacity += outfitCargo;
    }
    return capacity;
}

/**
 * The cargo panel's readout values (free space, manifest lines, and the
 * mission-cargo "Special:" summary) for a cargo hold and capacity. Undefined
 * if a jünk name isn't cached yet. Shared by the in-flight and docked paths.
 */
export function cargoDisplayOf(cargo: ReadonlyMap<string, number> | undefined,
    capacity: number, gameData: SimulationGameDataInterface):
    { free: number, lines: CargoLine[], special: string | null } {
    const lines: CargoLine[] = [];
    const specialNames: string[] = [];
    if (cargo) {
        for (const [key, quantity] of cargo) {
            if (quantity <= 0) {
                continue;
            }
            const stdIndex = standardCargoIndex(key);
            if (stdIndex !== null) {
                lines.push({
                    name: abbreviateCargoName(
                        STANDARD_CARGO_NAMES[stdIndex] ?? `Cargo ${stdIndex}`),
                    quantity,
                });
            } else if (key.startsWith('junk:')) {
                const junk = gameData.data.Junk.getCached(key.slice(5));
                lines.push({
                    name: abbreviateCargoName(junk?.abbrev || 'Cargo'),
                    quantity,
                });
            } else if (key.startsWith('mission:')) {
                specialNames.push('Cargo');
            }
        }
    }
    let used = 0;
    if (cargo) {
        for (const quantity of cargo.values()) {
            used += quantity;
        }
    }
    const free = Math.max(0, capacity - used);
    return { free, lines, special: specialCargoSummary(specialNames) };
}

/**
 * The player's cargo-carrying escorts among a set of candidate entities,
 * as {@link FleetMemberCargo} contributions to the bar's fleet readout.
 *
 * Anything whose ship or outfit data has not cached yet is SKIPPED rather
 * than counted at zero, so the readout never briefly under-reports a
 * loaded freighter's capacity as free space it does not have; the
 * getCached calls warm the data, and the next frame includes it.
 *
 * Display-only, and it reads only serializer-registered components
 * (ShipComponent, OutfitsStateComponent, CargoComponent, and the markers
 * entityCarriesFleetCargo tests), so it sees exactly what every peer's
 * display world sees.
 */
export function fleetCargoMembers(escorts: Iterable<Entity>,
    gameData: SimulationGameDataInterface): FleetMemberCargo[] {
    const members: FleetMemberCargo[] = [];
    for (const entity of escorts) {
        const ship = entity.components.get(ShipComponent);
        if (!ship) {
            continue;
        }
        const shipData = gameData.data.Ship.getCached(ship.id);
        if (!entityCarriesFleetCargo(entity, shipData)) {
            continue;
        }
        const capacity = cargoCapacityOf(ship.id,
            entity.components.get(OutfitsStateComponent), gameData);
        if (capacity === undefined) {
            continue;
        }
        members.push(
            { cargo: entity.components.get(CargoComponent), capacity });
    }
    return members;
}

/**
 * The player's escorts that are PRESENT IN THIS WORLD, in uuid order.
 *
 * Presence is the whole filter: an escort left behind in another system,
 * or one still sitting on a planet the player took off from, is not in
 * this world's entity map and so contributes nothing — which is the
 * behavior we want, since its hold is not with the fleet. Fighters in the
 * player's own bays and mission ships are dropped later, by
 * fleetCargoMembers.
 *
 * PlayerEscortComponent.player is the durable ownership marker (it
 * survives landings and jumps), so a carrier escort's own wing is
 * included too — it belongs to the player just as directly.
 */
export function playerEscortEntities(entities: ReadonlyMap<string, Entity>,
    playerUuid: string): Entity[] {
    const found: [string, Entity][] = [];
    for (const [uuid, entity] of entities) {
        if (entity.components.get(PlayerEscortComponent)?.player
            === playerUuid) {
            found.push([uuid, entity]);
        }
    }
    found.sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
    return found.map(([, entity]) => entity);
}

/**
 * How often the in-flight cargo readout is recomputed, in display ms.
 * The computation walks every entity for escorts, sorts them, and sums
 * the fleet's holds — all to feed a readout that changes about once a
 * minute — so, like the radar (radarPeriod), it runs a few times a
 * second rather than every frame. drawCargo's own memo still skips the
 * PIXI text writes when nothing changed.
 */
export const CARGO_READOUT_PERIOD_MS = 200;

const CargoReadoutTime = new Component<{ lastTime: number }>('CargoReadoutTime');

export const DrawStatusBarCargo = new System({
    name: 'DrawStatusBarCargo',
    args: [StatusBarResource, Optional(CargoComponent), Optional(CreditsComponent),
        ShipComponent, Optional(OutfitsStateComponent),
        SimulationGameDataResource, Entities, UUID,
        Optional(CargoReadoutTime), TimeResource, GetEntity,
        PlayerShipSelector] as const,
    step(statusBar, cargo, credits, ship, outfits, gameData, entities, uuid,
        readoutTime, { time }, entity) {
        // First draw immediately (a fresh player entity has no stamp),
        // then at most once per period.
        if (readoutTime
            && time - readoutTime.lastTime < CARGO_READOUT_PERIOD_MS) {
            return;
        }
        const capacity = cargoCapacityOf(ship.id, outfits, gameData);
        if (capacity === undefined) {
            return; // Ship/outfit data not cached yet.
        }
        // The FLEET's cargo, not just this hull's (Matthew's ruling; see
        // spaceport/fleet_cargo.ts's sumFleetCargo).
        const fleet = sumFleetCargo([
            { cargo, capacity },
            ...fleetCargoMembers(
                playerEscortEntities(entities, uuid), gameData),
        ]);
        const { free, lines, special } =
            cargoDisplayOf(fleet.cargo, fleet.capacity, gameData);
        statusBar.drawCargo(free, credits?.credits ?? 0, lines, special);
        // Stamped only after a real draw, so a frame that bailed on
        // uncached data retries next frame instead of waiting a period.
        if (readoutTime) {
            readoutTime.lastTime = time;
        } else {
            entity.components.set(CargoReadoutTime, { lastTime: time });
        }
    }
});
