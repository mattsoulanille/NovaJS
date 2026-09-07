import { System } from "nova_ecs/system";
import { SingletonComponent } from "nova_ecs/world";
import { CargoComponent } from "../nova_plugin/ship/cargo_plugin.js";
import { SimulationGameDataResource } from "../nova_plugin/core/game_data_resource.js";
import { ArmorComponent, FuelComponent, ShieldComponent } from "../nova_plugin/ship/health_plugin.js";
import { OutfitsStateComponent } from "../nova_plugin/ship/outfit_plugin.js";
import { CreditsComponent } from "../nova_plugin/player/player_state_plugin.js";
import { ShipComponent } from "../nova_plugin/ship/ship_plugin.js";
import { sumFleetCargo } from "../spaceport/fleet_cargo.js";
import { DockedShipResource } from "./docked_ship.js";
import { cargoCapacityOf, cargoDisplayOf, DrawStatusBarCargo, fleetCargoMembers } from "./status_bar_cargo.js";
import { StatusBarResource } from "./status_bar_resource.js";

/**
 * The docked counterpart of the stats + cargo + credits readouts. While the
 * player is docked the ship is out of the display world (held by the spaceport
 * menu), so PlayerShipSelector matches nothing and the per-entity draw systems
 * (status_bar_gauges.ts, status_bar_cargo.ts) go quiet. This runs once per
 * step from the DockedShipResource instead, reading the held entity's
 * components — or, while a venue is open, that venue's live working state
 * (credits/cargo/fuel before it commits) — so the bar keeps tracking trades,
 * outfit buys, refuels, and bar gambling live.
 */
export const DrawDockedStatus = new System({
    name: 'DrawDockedStatus',
    args: [StatusBarResource, DockedShipResource, SimulationGameDataResource,
        SingletonComponent] as const,
    step(statusBar, dockedHolder, gameData) {
        const docked = dockedHolder.current;
        if (!docked) {
            return;
        }
        const entity = docked.entity;
        const live = docked.liveStatus?.() ?? {};

        // Shield/armor/fuel bars off the held entity; a venue may override fuel.
        const shield = entity.components.get(ShieldComponent);
        const armor = entity.components.get(ArmorComponent);
        if (shield && armor) {
            const fuel = live.fuel ?? entity.components.get(FuelComponent);
            statusBar.gauges.drawStats(shield, armor, fuel ?? undefined);
        }

        // Credits + cargo: the open venue's working values win over the
        // (not-yet-committed) entity components.
        const credits = live.credits
            ?? entity.components.get(CreditsComponent)?.credits ?? 0;
        const ship = entity.components.get(ShipComponent);
        if (!ship) {
            return;
        }
        const capacity = live.cargoCapacity ?? cargoCapacityOf(
            ship.id, entity.components.get(OutfitsStateComponent), gameData);
        if (capacity === undefined) {
            return; // Ship/outfit data not cached yet.
        }
        // Docked, the fleet's escorts are on the client's landed roster
        // rather than in any world. A venue that publishes working cargo
        // (only the trade center) has ALREADY summed its holds into it —
        // it has to, because those holds are uncommitted — so the roster
        // is folded in only for the venues that don't.
        const fleet = live.cargo !== undefined
            ? { cargo: live.cargo, capacity }
            : sumFleetCargo([
                { cargo: entity.components.get(CargoComponent), capacity },
                ...fleetCargoMembers(
                    (docked.landedEscorts?.() ?? [])
                        .filter(({ player }) => docked.playerUuid === undefined
                            || player === docked.playerUuid)
                        .map(({ entity: escort }) => escort),
                    gameData),
            ]);
        const { free, lines, special } =
            cargoDisplayOf(fleet.cargo, fleet.capacity, gameData);
        statusBar.cargo.drawCargo(free, credits, lines, special);
    },
    // #156 pin (shared: *): StatusBarPlugin's registration order.
    after: [DrawStatusBarCargo],
});
