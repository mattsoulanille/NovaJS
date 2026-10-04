import { System } from "nova_ecs/system";
import { SingletonComponent } from "nova_ecs/world";
import {
    CargoComponent, ArmorComponent, FuelComponent, ShieldComponent, OutfitsStateComponent,
    ShipComponent,
} from '../nova_plugin/ship/index.js';
import { SimulationGameDataResource } from "../nova_plugin/core/index.js";
import { CreditsComponent } from "../nova_plugin/player/index.js";
import { sumFleetCargo } from "../spaceport/fleet_cargo.js";
import { DockedShipResource } from "./docked_ship.js";
import { cargoCapacityOf, cargoDisplayOf, DrawStatusBarCargo, fleetCargoMembers } from "./status_bar_cargo.js";
import { StatusBarResource } from "./status_bar_resource.js";

/**
 * The docked counterpart of the stats + cargo + credits readouts. While the
 * player is docked the ship is out of the display world (held by the spaceport
 * menu), so PlayerShipSelector matches nothing and the per-entity draw systems
 * (status_bar_gauges.ts, status_bar_cargo.ts) go quiet. This runs once per
 * step from the DockedShipResource instead, reading the docked player's
 * data as it stands right now (DockedShip.component: the landing's
 * working copy, not the held hull, which is only written when a venue
 * closes — so a BBS accept's payout or cargo shows at once, #246) — and,
 * while a venue publishes one, that venue's live status on top (the trade
 * center's working FLEET cargo) — so the bar keeps tracking trades,
 * outfit buys, refuels, bar gambling and mission accepts live.
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
        const live = docked.liveStatus?.() ?? {};

        // Shield/armor/fuel bars off the held hull; a venue may override fuel.
        const shield = docked.component(ShieldComponent);
        const armor = docked.component(ArmorComponent);
        if (shield && armor) {
            const fuel = live.fuel ?? docked.component(FuelComponent);
            statusBar.gauges.drawStats(shield, armor, fuel ?? undefined);
        }

        // Credits + cargo: the landing's working copy (DockedShip.component),
        // with the open venue's live values on top.
        const credits = live.credits
            ?? docked.component(CreditsComponent)?.credits ?? 0;
        const ship = docked.component(ShipComponent);
        if (!ship) {
            return;
        }
        const capacity = live.cargoCapacity ?? cargoCapacityOf(
            ship.id, docked.component(OutfitsStateComponent), gameData);
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
                { cargo: docked.component(CargoComponent), capacity },
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
