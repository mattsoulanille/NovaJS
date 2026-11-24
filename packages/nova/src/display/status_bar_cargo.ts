import { StatusBarData } from "novadatainterface/status_bar_data";
import { Entities, GetEntity, UUID } from "nova_ecs/arg_types";
import { Component } from "nova_ecs/component";
import { Entity } from "nova_ecs/entity";
import { Optional } from "nova_ecs/optional";
import { TimeResource } from "nova_ecs/plugins/time_plugin";
import { System } from "nova_ecs/system";
import * as PIXI from "pixi.js";
import { SimulationGameDataInterface } from "../client/gamedata/simulation_game_data.js";
import {
    CargoComponent, OutfitsState, OutfitsStateComponent, sumOutfitField, ShipComponent,
} from '../nova_plugin/ship/index.js';
import { SimulationGameDataResource } from "../nova_plugin/core/index.js";
import {
    missionCargoAbbrev, STANDARD_CARGO_NAMES,
} from "../nova_plugin/missions/index.js";
import {
    PlayerEscortComponent, PlayerShipSelector, CreditsComponent,
    MissionsComponent,
} from '../nova_plugin/player/index.js';
import {
    entityCarriesFleetCargo, FleetMemberCargo, sumFleetCargo,
} from "../spaceport/fleet_cargo.js";
import {
    abbreviateCargoName, CargoLine, formatCredits, specialCargoSummary,
    standardCargoIndex,
} from "./status_bar_content.js";
import {
    CARGO_CREDITS_LABEL_Y, CARGO_CREDITS_VALUE_Y, CARGO_FREE_VALUE_X,
    CARGO_FREE_Y, CARGO_LABEL_X, CARGO_LINE_PITCH, CARGO_LINE_Y, CARGO_NAME_X,
    CARGO_QUANTITY_X, CARGO_SPECIAL_LABEL_Y, CARGO_SPECIAL_VALUE_Y,
    CARGO_VALUE_X, StatusBarFonts,
} from "./status_bar_layout.js";
import { StatusBarResource } from "./status_bar_resource.js";
import { DrawStatusBarNavigation } from "./status_bar_navigation.js";

/**
 * The cargo panel: a manifest in the left column and the
 * Free / Special / Credits readouts in the right one, all at FIXED
 * positions (see the CARGO_* constants). Every readout is a dim label
 * plus a bright value, so each is two text objects — the original's
 * "Free:390" is a grey "Free:" with a white "390" butted against it, and
 * a manifest line's quantity sits in its own column so the numbers line
 * up under one another however wide the commodity abbreviations are.
 */
export class CargoPane {
    private static readonly MAX_CARGO_LINES = 6;
    /**
     * Reused text objects for the regular-cargo manifest (left column): the
     * dim commodity name and the bright quantity are separate so the
     * quantities share one column (CARGO_QUANTITY_X) regardless of how wide
     * the name is, the way the original stacks "Food: 9 / Ind: 9 / LuxG: 9".
     */
    private nameTexts: PIXI.Text[] = [];
    private quantityTexts: PIXI.Text[] = [];
    /** Per-build; undefined between an ïntf reload's teardown and rebuild. */
    private texts?: {
        freeLabel: PIXI.Text, free: PIXI.Text, specialLabel: PIXI.Text,
        special: PIXI.Text, creditsLabel: PIXI.Text, credits: PIXI.Text,
    };
    private lastCargo?: string;
    /**
     * The scenario's STR# 4000 / 4002 cargo tables, for the "Special:"
     * readout. Loaded once by StatusBarPlugin; empty falls back to the
     * stock names. Not per-build, so an ïntf reload keeps it.
     */
    cargoTables: { names: string[], abbrevs: string[] } =
        { names: [], abbrevs: [] };

    build(parent: PIXI.Container, data: StatusBarData, fonts: StatusBarFonts) {
        const cargo = data.dataAreas.cargo;
        const container = new PIXI.Container();
        parent.addChild(container);
        container.position.set(cargo.position[0], cargo.position[1]);

        // Regular-cargo manifest lines (left column), reused across frames.
        for (let i = 0; i < CargoPane.MAX_CARGO_LINES; i++) {
            const y = CARGO_LINE_Y + i * CARGO_LINE_PITCH;
            const name = new PIXI.Text("", fonts.dim);
            name.anchor.set(0, 0);
            name.position.set(CARGO_NAME_X, y);
            name.visible = false;
            container.addChild(name);
            this.nameTexts.push(name);

            const quantity = new PIXI.Text("", fonts.bright);
            quantity.anchor.set(0, 0);
            quantity.position.set(CARGO_QUANTITY_X, y);
            quantity.visible = false;
            container.addChild(quantity);
            this.quantityTexts.push(quantity);
        }

        const freeLabel = new PIXI.Text("Free:", fonts.dim);
        freeLabel.anchor.set(0, 0);
        freeLabel.position.set(CARGO_LABEL_X, CARGO_FREE_Y);
        container.addChild(freeLabel);

        const free = new PIXI.Text("0", fonts.bright);
        free.anchor.set(0, 0);
        free.position.set(CARGO_FREE_VALUE_X, CARGO_FREE_Y);
        container.addChild(free);

        const specialLabel = new PIXI.Text("Special:", fonts.dim);
        specialLabel.anchor.set(0, 0);
        specialLabel.position.set(
            CARGO_LABEL_X, CARGO_SPECIAL_LABEL_Y);
        specialLabel.visible = false;
        container.addChild(specialLabel);

        const special = new PIXI.Text("", fonts.bright);
        special.anchor.set(0, 0);
        special.position.set(
            CARGO_VALUE_X, CARGO_SPECIAL_VALUE_Y);
        special.visible = false;
        container.addChild(special);

        const creditsLabel = new PIXI.Text("Credits:", fonts.dim);
        creditsLabel.anchor.set(0, 0);
        creditsLabel.position.set(
            CARGO_LABEL_X, CARGO_CREDITS_LABEL_Y);
        container.addChild(creditsLabel);

        const credits = new PIXI.Text("0", fonts.bright);
        credits.anchor.set(0, 0);
        credits.position.set(
            CARGO_VALUE_X, CARGO_CREDITS_VALUE_Y);
        container.addChild(credits);

        this.texts = {
            freeLabel, free, specialLabel, special, creditsLabel, credits,
        };
    }

    private get allTexts(): PIXI.Text[] {
        return [...Object.values(this.texts ?? {}),
            ...this.nameTexts, ...this.quantityTexts];
    }

    /**
     * Destroys this build's texts (each owns a canvas texture) ahead of a
     * rebuild; the container they sat in is destroyed by StatusBar.reload
     * with the rest of the outgoing tree.
     */
    reset() {
        for (const text of this.allTexts) {
            text.destroy();
        }
        this.texts = undefined;
        this.nameTexts = [];
        this.quantityTexts = [];
        this.lastCargo = undefined;
    }

    destroy() {
        for (const text of this.allTexts) {
            if (!text.destroyed) {
                text.destroy();
            }
        }
        this.texts = undefined;
        this.nameTexts = [];
        this.quantityTexts = [];
    }

    /**
     * Draws the cargo/credits panel. Everything sits at a fixed spot (the
     * CARGO_* constants): the manifest fills the left column top-down, and
     * the right column always reads Free / [Special] / Credits at the same
     * rows whether or not the hold is empty and whether or not the player
     * carries mission cargo — which is what the original does (in_space.png's
     * empty hold puts "Free:390" and "Credits:" on exactly the rows
     * board_ship.png's loaded hold does).
     */
    drawCargo(free: number, credits: number, lines: CargoLine[],
        special: string | null) {
        if (!this.texts) {
            return;
        }
        const creditsText = formatCredits(credits);
        const key = JSON.stringify([free, creditsText, lines, special]);
        if (key === this.lastCargo) {
            return;
        }
        this.lastCargo = key;

        // Regular cargo manifest, left column.
        const shown = Math.min(lines.length, CargoPane.MAX_CARGO_LINES);
        for (let i = 0; i < this.nameTexts.length; i++) {
            const name = this.nameTexts[i];
            const quantity = this.quantityTexts[i];
            if (i < shown) {
                name.text = `${lines[i].name}:`;
                quantity.text = String(lines[i].quantity);
            }
            name.visible = i < shown;
            quantity.visible = i < shown;
        }

        this.texts.free.text = String(free);
        this.texts.credits.text = creditsText;
        const hasSpecial = special !== null;
        this.texts.specialLabel.visible = hasSpecial;
        this.texts.special.visible = hasSpecial;
        if (hasSpecial) {
            this.texts.special.text = special;
        }
    }
}

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
 * What the "Special:" readout needs to name a mission's cargo: the
 * player's active missions (MissionsComponent, for each one's resolved
 * cargo type) and the scenario's STR# 4000 / 4002 tables.
 */
export interface SpecialCargoSource {
    missions?: ReadonlyMap<string, { cargoType: number }>;
    /** STR# 4000, PlayerStartData.cargoNames. */
    names?: readonly string[];
    /** STR# 4002, PlayerStartData.cargoAbbrevs. */
    abbrevs?: readonly string[];
}

/**
 * The "Special:" name of the mission cargo held under CargoComponent key
 * `key` ("mission:<mïsn id>"): the carrying mission's STR# 4002
 * abbreviation (missionCargoAbbrev). "Cargo" when the mission is not
 * among `missions` or carries no cargo type.
 */
export function specialCargoName(key: string,
    source: SpecialCargoSource): string {
    const active = source.missions?.get(key.slice('mission:'.length));
    if (!active || active.cargoType < 0) {
        return 'Cargo';
    }
    return missionCargoAbbrev(active.cargoType,
        source.names?.length ? source.names : undefined,
        source.abbrevs?.length ? source.abbrevs : undefined);
}

/**
 * The "Special:" name of a jünk held under CargoComponent key `key`
 * ("junk:<jünk id>"): the jünk's Abbrev field ("Status bar
 * abbreviation", the Bible's jünk resource), in full. MEASURED: 10 t of
 * the kit jünk 203 (name "Kit Contraband", Abbrev "Contraband") read
 * "Special: Contraband" in flight (docs/reference_experiments.md, "Status
 * bar "Special:" ... wave 15", `several/11-gate.png`). Falls back to the
 * jünk's name, then "Cargo" while its data is not cached yet.
 */
export function specialJunkName(key: string,
    gameData: SimulationGameDataInterface): string {
    const junk = gameData.data.Junk.getCached(key.slice('junk:'.length));
    return junk?.abbrev?.trim() || junk?.name?.trim() || 'Cargo';
}

/**
 * The cargo panel's readout values (free space, manifest lines, and the
 * "Special:" summary) for a cargo hold and capacity. Shared by the
 * in-flight and docked paths.
 *
 * MEASURED on the original (docs/reference_experiments.md, "Status bar
 * "Special:" with two missions of one cargo type, and #381 commodity
 * rows, wave 15"):
 *  - the manifest lists only the STANDARD commodities, packed from the
 *    first row with no gaps, in commodity order (Industrial, Luxury and
 *    Equipment aboard: "Ind / LuxG / Equ" on rows one to three);
 *  - jünk is never a manifest row: it is named on the "Special:" line,
 *    by its Abbrev (specialJunkName), but only when no mission cargo is
 *    aboard. With 10 t of jünk and one mission's 1 t of Food aboard the
 *    line read "Food" (`several/09-left.png`, `08-bought.png`, docked and
 *    in flight), and "Contraband" once the mission had gone
 *    (`11-gate.png`);
 *  - two missions read "Multiple", even with the same cargo type
 *    (specialCargoSummary counts per mission).
 * GUESS: two jünk types and no mission cargo read "Multiple" as two
 * missions do.
 */
export function cargoDisplayOf(cargo: ReadonlyMap<string, number> | undefined,
    capacity: number, gameData: SimulationGameDataInterface,
    special: SpecialCargoSource = {}):
    { free: number, lines: CargoLine[], special: string | null } {
    const rows: Array<{ index: number, line: CargoLine }> = [];
    const missionNames: string[] = [];
    const junkNames: string[] = [];
    let used = 0;
    if (cargo) {
        for (const [key, quantity] of cargo) {
            used += quantity;
            if (quantity <= 0) {
                continue;
            }
            const stdIndex = standardCargoIndex(key);
            if (stdIndex !== null) {
                rows.push({
                    index: stdIndex,
                    line: {
                        name: abbreviateCargoName(STANDARD_CARGO_NAMES[stdIndex]
                            ?? `Cargo ${stdIndex}`),
                        quantity,
                    },
                });
            } else if (key.startsWith('junk:')) {
                junkNames.push(specialJunkName(key, gameData));
            } else if (key.startsWith('mission:')) {
                missionNames.push(specialCargoName(key, special));
            }
        }
    }
    rows.sort((a, b) => a.index - b.index);
    const free = Math.max(0, capacity - used);
    return {
        free,
        lines: rows.map(row => row.line),
        special: specialCargoSummary(
            missionNames.length > 0 ? missionNames : junkNames),
    };
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
        Optional(MissionsComponent), PlayerShipSelector] as const,
    step(statusBar, cargo, credits, ship, outfits, gameData, entities, uuid,
        readoutTime, { time }, entity, missions) {
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
            cargoDisplayOf(fleet.cargo, fleet.capacity, gameData, {
                missions: missions ?? undefined,
                ...statusBar.cargo.cargoTables,
            });
        statusBar.cargo.drawCargo(free, credits?.credits ?? 0, lines, special);
        // Stamped only after a real draw, so a frame that bailed on
        // uncached data retries next frame instead of waiting a period.
        if (readoutTime) {
            readoutTime.lastTime = time;
        } else {
            entity.components.set(CargoReadoutTime, { lastTime: time });
        }
    },
    // #156 pin (shared: *): StatusBarPlugin's registration order.
    after: [DrawStatusBarNavigation],
});
