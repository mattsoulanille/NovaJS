import { GetEntity, UUID } from "nova_ecs/arg_types";
import { Component } from "nova_ecs/component";
import { wrapNearestDelta } from "nova_ecs/datatypes/position";
import { Optional } from "nova_ecs/optional";
import { MovementStateComponent } from "nova_ecs/plugins/movement_plugin";
import { TimeResource } from "nova_ecs/plugins/time_plugin";
import { Query } from "nova_ecs/query";
import { System } from "nova_ecs/system";
import { CloakActiveComponent, CloakActiveState, CloakCapability, CloakComponent, deriveCloakScanner } from "../nova_plugin/cloak_plugin.js";
import { DisabledComponent } from "../nova_plugin/disabled_component.js";
import { SimulationGameDataResource } from "../nova_plugin/game_data_resource.js";
import { GovtComponent } from "../nova_plugin/govt_component.js";
import { deriveIff, planetBlipColor, planetDisposition, shipBlipColor, shipDisposition } from "../nova_plugin/iff_plugin.js";
import { landable } from "../nova_plugin/landable.js";
import { ActiveRanksComponent } from "../nova_plugin/ncb_plugin.js";
import { isPacifiedToward, NpcComponent } from "../nova_plugin/npc_ai_plugin.js";
import { OutfitsStateComponent, sumOutfitField } from "../nova_plugin/outfit_plugin.js";
import { PlanetComponent, PlanetDataComponent, stellarClearanceFor, StellarBribesComponent } from "../nova_plugin/planet_plugin.js";
import { PlayerShipSelector } from "../nova_plugin/player_ship_plugin.js";
import { MissionsComponent } from "../nova_plugin/player_state_plugin.js";
import { LegalRecordsComponent } from "../nova_plugin/reputation_plugin.js";
import { ShipDataComponent } from "../nova_plugin/ship_plugin.js";
import { TargetComponent } from "../nova_plugin/target_component.js";
import { SimulationTimeResource } from "./simulation_time.js";
import { StatusBarResource } from "./status_bar_resource.js";


/** Full on+off period of the blinking system-center radar arrow, in ms. */
const CENTER_ARROW_BLINK_MS = 700;
/**
 * The selected target's radar blip flashes white: on for the first half of
 * each period. Same wall-clock cadence family as the centre arrow and the
 * running lights (display-only; never sim time). Tunables — the original's
 * exact rate isn't recorded in the reference notes.
 */
export const TARGET_FLASH_MS = 800;
export const TARGET_FLASH_COLOR = 0xffffff;
export const TARGET_FLASH_SIZE = 2;

/** Whether the target blip is in the ON half of its flash at `time`. */
export function targetFlashOn(time: number): boolean {
    return (time % TARGET_FLASH_MS) < TARGET_FLASH_MS / 2;
}

const RadarTime = new Component<{ lastTime: number }>('RadarTime');

/**
 * Whether a ship's cloak takes it off the radar: actively cloaked with a
 * device whose 0x0002 "Visible on radar" bit is CLEAR (EVN Bible, oütf
 * ModType 17; CloakData.hidesFromRadar is that bit inverted). Five of
 * the six stock cloaks set the bit — Fed nova:211, Rebel nova:234/347,
 * Wraith nova:266, Cloaking Organ v1.0 nova:268 — so those ships stay
 * blips; only Cloaking Organ v1.1 nova:269 hides.
 *
 * `cloak` is the ship's CloakComponent, which the display derives from
 * its synced outfits (cloak_display_plugin.ts); the sim never sends it,
 * and before that plugin existed it was always undefined here, so the
 * conservative default hid EVERY cloaked ship. The default stays: a
 * cloak whose data has not cached yet hides until it has.
 */
export function radarHidesShip(cloakActive: CloakActiveState | undefined,
    cloak: CloakCapability | undefined): boolean {
    return cloakActive?.active === true && (cloak?.hidesFromRadar ?? true);
}

export const DrawRadar = new System({
    name: 'DrawRadar',
    args: [Optional(RadarTime), TimeResource, SimulationTimeResource,
        StatusBarResource, MovementStateComponent,
    new Query([UUID, MovementStateComponent, ShipDataComponent,
        Optional(CloakActiveComponent), Optional(CloakComponent),
        Optional(GovtComponent), Optional(DisabledComponent),
        Optional(NpcComponent)] as const),
    new Query([UUID, MovementStateComponent, PlanetDataComponent,
        PlanetComponent] as const),
        SimulationGameDataResource, GetEntity, UUID,
        PlayerShipSelector] as const,
    step(radarTime, { time }, simTime, statusBar, { position }, ships, planets,
        gameData, entity, playerUuid) {
        if (!radarTime) {
            radarTime = { lastTime: 0 };
            entity.components.set(RadarTime, radarTime);
        }
        if (time - radarTime.lastTime > statusBar.radarPeriod) {
            // Hide ships that are actively cloaked with a radar-hiding
            // cloak (bit 0x0002 "visible on radar" clear), unless the
            // player has a cloak scanner that reveals cloaked ships on
            // radar (ModVal 0x0001). Builds on the merged interference/
            // static radar. The player's own ship is drawn separately
            // from `source`, so it always shows.
            // Like IFF below, the scanner capability is derived here from
            // the player's delta-synced outfits: CloakScannerComponent is a
            // sim-side provider output that never crosses the bridge, so
            // reading it off the mirrored entity always came back empty.
            const scannerOutfits =
                entity.components.get(OutfitsStateComponent);
            const revealsCloaked = scannerOutfits
                ? deriveCloakScanner(scannerOutfits, gameData)
                    ?.revealsOnRadar === true
                : false;
            const visibleShips = revealsCloaked ? ships : ships.filter(
                ([, , , cloakActive, cloak]) =>
                    !radarHidesShip(cloakActive, cloak));

            // IFF (ModType 14): when the player owns an IFF outfit, colour
            // each ship's blip by its disposition toward the player. Without
            // IFF, or before govt data caches, blips stay the flat dim colour.
            // The capability is derived here from the player's (delta-synced)
            // outfits rather than read off a component: the radar runs in the
            // display world, and IffComponent lives only in the sim worker.
            //
            // DISABLED ships (DisabledComponent — real, serializer-registered
            // sim state, so it is here in the display world) are GREY with or
            // without IFF, ahead of hostile red: dead in space is a fact about
            // the ship, not about the pilot, exactly as the gray corner set
            // reads it (hostility.ts's styleForTarget).
            const playerOutfits = entity.components.get(OutfitsStateComponent);
            const hasIff = playerOutfits
                ? deriveIff(playerOutfits, gameData)?.hasIff === true : false;
            const playerGovtId = hasIff
                ? entity.components.get(GovtComponent)?.id : undefined;
            const playerGovt = playerGovtId
                ? gameData.data.Govt.getCached(playerGovtId) : undefined;
            // The player's legal records (delta-synced): a govt the
            // player is criminal with shows hostile blips.
            const playerRecords = hasIff
                ? entity.components.get(LegalRecordsComponent) : undefined;
            const shipColors = new Map<string, number>();
            for (const [uuid, , , , , shipGovt, disabled, npc]
                of visibleShips) {
                const govt = (hasIff && shipGovt)
                    ? gameData.data.Govt.getCached(shipGovt.id) : undefined;
                // A ship this player has BOUGHT OFF (beg for mercy) reads
                // neutral until the reprieve lapses, the same tier the
                // target corners and the point defense prey filter honour
                // (hostility.ts's styleForTarget) — Matthew: "its IFF should
                // become neutral again". A pirate's politics never soften,
                // so without this the blip stayed red for a truce the player
                // had already paid for. Judged on the MIRRORED SIM CLOCK,
                // which is what stamped pacifiedUntil; this world's
                // TimeResource is wall-clock epoch ms and would call every
                // reprieve expired.
                const color = shipBlipColor(
                    hasIff && !isPacifiedToward(npc, playerUuid, simTime.time)
                        ? shipDisposition(govt, playerGovt, playerRecords)
                        : 'neutral',
                    hasIff, disabled !== undefined);
                if (color !== undefined) {
                    shipColors.set(uuid, color);
                }
            }
            // Stellars are coloured by LANDING CLEARANCE: neutral (you may
            // land) yellow, forbidden orange, hostile red — one reading of
            // the ONE clearance predicate the landing gate and the comm
            // dialog use (stellar_clearance.ts), so a blip can never promise
            // a landing the gate refuses — under the same IFF gate as ships
            // (without IFF every landable stellar stays the flat yellow).
            // UNLANDABLE stellars (Jupiter, scenery worlds, dead gates —
            // landable.ts) are GREY with or without IFF: that is a fact
            // about the stellar, not about the pilot.
            const planetRecords = entity.components.get(LegalRecordsComponent);
            const bribes = entity.components.get(StellarBribesComponent);
            const shipData = entity.components.get(ShipDataComponent);
            const planetRanks = entity.components.get(ActiveRanksComponent);
            const planetMissions = entity.components.get(MissionsComponent);
            const planetColors = new Map<string, number>();
            for (const [uuid, , planetData, planet] of planets) {
                const isLandable = landable(planetData);
                const clearance = (hasIff && isLandable)
                    ? stellarClearanceFor({
                        planetData, gameData, records: planetRecords,
                        shipData, outfits: playerOutfits, bribes,
                        ranks: planetRanks, missions: planetMissions,
                        // Bribe expiries are SIM-clock stamps (0-based
                        // logical time); this world's TimeResource is the
                        // wall clock, ~50 years past every expiry.
                        planetId: planet.id, now: simTime.time,
                    })
                    : { cleared: true } as const;
                planetColors.set(uuid, planetBlipColor(
                    planetDisposition(clearance, isLandable), hasIff));
            }
            // System-center arrow: when no stellar object falls within the
            // radar's range, the original blinks a white arrow at the radar's
            // edge pointing back toward the system centre (0, 0). Chosen gate:
            // "no stellar within the radar's range" (radarScale/2 on each
            // axis) — i.e. nothing stellar is on the radar. Blinks on a
            // wall-clock cadence, like the running lights.
            const range = statusBar.radarRange;
            let stellarOnRadar = false;
            for (const [, { position: planetPos }] of planets) {
                if (Math.abs(wrapNearestDelta(planetPos.x - position.x)) <= range.x
                    && Math.abs(wrapNearestDelta(planetPos.y - position.y)) <= range.y) {
                    stellarOnRadar = true;
                    break;
                }
            }
            const blinkOn = (time % CENTER_ARROW_BLINK_MS)
                < CENTER_ARROW_BLINK_MS / 2;
            const centerArrow = (!stellarOnRadar && blinkOn)
                ? {
                    x: wrapNearestDelta(0 - position.x),
                    y: wrapNearestDelta(0 - position.y),
                }
                : null;
            // The selected target flashes white on the radar.
            const targetUuid = entity.components.get(TargetComponent)?.target;
            statusBar.drawRadar(position, visibleShips, planets, shipColors,
                centerArrow,
                targetUuid && targetFlashOn(time) ? targetUuid : null,
                planetColors);
            radarTime.lastTime = time;
        }
    }
});

/**
 * Feeds the interference-mod outfits (oütf ModType 24) into the radar: sums
 * the player ship's owned outfits' interferenceReduction and writes it to the
 * status bar. The Bible: "Subtracts the value in ModVal from the current star
 * system's Interference value when calculating how fuzzy to make the radar."
 * Display-only (interference never affects the simulation), so this reads the
 * player's outfits directly. A stock Sensor Boost (nova:203) clears 20
 * interference; several stack. Runs every step so buying/selling updates it.
 */
export const DrawStatusBarInterference = new System({
    name: 'DrawStatusBarInterference',
    args: [StatusBarResource, OutfitsStateComponent,
        SimulationGameDataResource, PlayerShipSelector] as const,
    step(statusBar, outfits, gameData) {
        const reduction = sumOutfitField(
            outfits, gameData, o => o.interferenceReduction);
        if (reduction !== undefined) {
            statusBar.interferenceReduction = reduction;
        }
    },
});
