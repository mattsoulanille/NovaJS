import { RunQuery, UUID } from "nova_ecs/arg_types";
import { Optional } from "nova_ecs/optional";
import { Query } from "nova_ecs/query";
import { System } from "nova_ecs/system";
import { DisabledComponent } from "../nova_plugin/disabled_component.js";
import { displayName, govtTargetName } from "../nova_plugin/display_name.js";
import { SimulationGameDataResource } from "../nova_plugin/game_data_resource.js";
import { GovtComponent } from "../nova_plugin/govt_component.js";
import { ArmorComponent, ShieldComponent } from "../nova_plugin/health_plugin.js";
import { MissionShipComponent } from "../nova_plugin/mission_ship_plugin.js";
import { PersComponent } from "../nova_plugin/pers_plugin.js";
import { PlayerEscortComponent } from "../nova_plugin/player_escort.js";
import { PlayerShipSelector } from "../nova_plugin/player_ship_plugin.js";
import { ShipDataComponent } from "../nova_plugin/ship_plugin.js";
import { TargetComponent } from "../nova_plugin/target_component.js";
import { AnimationGraphicComponent } from "./animation_graphic_plugin.js";
import { targetGovtLabel } from "./status_bar_content.js";
import { StatusBarResource } from "./status_bar_resource.js";
import { targetIdentity } from "./target_identity.js";

const TargetQuery = new Query([ShipDataComponent, Optional(ShieldComponent),
    Optional(ArmorComponent), Optional(AnimationGraphicComponent),
    Optional(PersComponent), Optional(DisabledComponent),
    Optional(GovtComponent), Optional(PlayerEscortComponent),
    Optional(MissionShipComponent)] as const);
export const DrawStatusBarTarget = new System({
    name: 'DrawStatusBarTarget',
    args: [StatusBarResource, TargetComponent, RunQuery,
        SimulationGameDataResource, UUID, PlayerShipSelector] as const,
    step(statusBar, { target }, runQuery, gameData, playerUuid) {
        if (!target) {
            statusBar.clearTarget();
            return;
        }
        const result = runQuery(TargetQuery, target)[0];
        if (result) {
            const [shipData, shield, armor, shipGraphic, pers, disabled, govt,
                playerEscort, missionShip] = result;
            // The government shown lower-right of the target pane. The original
            // shows the gövt's short Target Code (gövt TMPL offset 68) — "Pyro"
            // for "Pyrogenesis Skymining", " Fed." for "Federation" — rather
            // than the overflow-prone full name. displayName trims the code's
            // leading padding and strips any "; note" author suffix; a govt
            // with no target code falls back to its (also cleaned) full name.
            // Cached lookup: undefined until the govt data loads, then appears.
            const govtData = govt
                ? gameData.data.Govt.getCached(govt.id) : undefined;
            // ...except for the local player's OWN escorts, which read
            // "Escort" instead of their government. Per-player and
            // display-only: `playerUuid` is this client's ship, so a peer
            // targeting the same ship still sees its real government
            // (targetGovtLabel).
            const government = targetGovtLabel(
                govtData ? govtTargetName(govtData) : "",
                playerEscort?.player, playerUuid);
            // Përs name/subtitle, then a mission special ship's, then the
            // ship class's own — see target_identity.ts for the Bible
            // citations behind that order.
            const identity = targetIdentity({
                persName: pers?.name,
                persSubtitle: pers?.subtitle,
                missionName: missionShip?.name,
                missionSubtitle: missionShip?.subtitle,
                shipClass: shipData.name,
                shipSubtitle: shipData.subtitle,
            });
            // Hide the "; developer note" suffix authors append to ship
            // (and përs) names — the original never shows it in the target box.
            statusBar.drawTarget(displayName(identity.name),
                shield?.percent, armor?.percent, shipGraphic,
                disabled !== undefined, identity.subtitle, government);
        } else {
            // The target exists but the query missed — e.g. a just-replicated
            // ship whose ShipDataComponent isn't in the display world yet. Clear
            // the panel so it doesn't keep showing the previous target's data.
            statusBar.clearTarget();
        }
    }
})
