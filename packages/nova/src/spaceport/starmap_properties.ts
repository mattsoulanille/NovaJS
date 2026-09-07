// The starmap's properties panel: the right-hand column (Current /
// Destination System, Government, Legal Status, Goods Traded, Services)
// and the Ports / Navigation Hazards readouts under the map pane. The
// CONTENT is a pure function of the system, the player's knowledge of it
// and their legal records (systemProperties); the layout constants and the
// text rendering live beside it so the column's measured geometry is in
// one place.
import { SystemData } from "novadatainterface/system_data";
import * as PIXI from 'pixi.js';
import { DiscoveryLevel, knownSystemProperties } from "../nova_plugin/player/index.js";
import { displayName, isPort } from '../nova_plugin/core/index.js';
import { STANDARD_CARGO_NAMES } from "../nova_plugin/missions/index.js";
import { legalStatusInSystem } from "../nova_plugin/reputation/index.js";
import { MissionUniverse } from "./mission_universe.js";
import { hazardDescription } from "./route.js";

// Right-column/properties fonts. Field captions are the light grey the
// original uses — every caption pixel in the reference panel is exactly
// #c0c0c0 (probe_colors on map/borders_off.png at 1144,297), not the
// blue-grey they used to be drawn in; values are white.
export const PROP_LABEL_FONT: Partial<PIXI.ITextStyle> = {
    fontFamily: 'Geneva', fontSize: 10, fill: 0xc0c0c0,
    align: 'left', wordWrap: false,
};
export const PROP_VALUE_FONT: Partial<PIXI.ITextStyle> = {
    fontFamily: 'Geneva', fontSize: 10, fill: 0xffffff,
    align: 'left', wordWrap: false,
};
export const DATE_FONT: Partial<PIXI.ITextStyle> = {
    fontFamily: 'Geneva', fontSize: 10, fill: 0x888888,
    align: 'right', wordWrap: false,
};

// Layout (container-centered like every menu): the properties column sits
// to the right of the 456x419 map pane and the Ports/Hazards readouts
// below it, matching map_open_over_spaceport.png.
const PROP_X = 177;
/**
 * The properties column's five groups sit at FIXED rows, not stacked one
 * under the other: measured on map/borders_off.png, map_single_jump_route.png
 * and map_zoomed_out_showing_far_away_mission.png, whose captions land on the
 * same screen rows (297 / 360 / 404 / 440 / 535) even though their Goods
 * Traded lists are six entries long, one entry long and six again. Rows are
 * container-relative (the dialog is centred on a 1080-tall screen, and text
 * ink starts ~2px below a PIXI text box).
 */
const PROP_TOP = 297 - 540 - 2;
const PROP_GROUP_Y = [0, 62, 108, 144, 236];
/** Which of those slots a properties group occupies. */
export enum PropSlot {
    System = 0, Government = 1, LegalStatus = 2, Goods = 3, Services = 4,
}
/** A group's first value sits 13px under its caption, the rest 12px apart. */
const PROP_LINE = 12;
const PROP_FIRST_VALUE = 14;
/** Values are indented 5px from their caption. */
const PROP_VALUE_INDENT = 5;
/**
 * The Ports / Navigation Hazards readouts under the map pane. Measured on
 * map/borders_off.png: the two captions' ink starts at x=678 (container -282)
 * on rows 725 and 749, their values at x=713 and x=778, and the grey date
 * shares the hazards row.
 */
export const PORTS_LABEL_X = -282;
export const PORTS_VALUE_X = -247;
export const HAZARDS_VALUE_X = -182;
export const PORTS_Y = 184;
export const HAZARDS_Y = 208;
export const DATE_RIGHT_X = 288;

/** One captioned group of the properties column. */
export interface PropertyLine {
    slot: PropSlot;
    label: string;
    values: string[];
}

/** Everything the properties panel shows for one system. */
export interface SystemProperties {
    /** The right-hand column's groups, in draw order. */
    lines: PropertyLine[];
    /** The "Ports:" readout. */
    ports: string;
    /** The "Navigation Hazards:" readout. */
    hazards: string;
}

/**
 * The properties panel's content for a system: the right-hand column
 * (Current/Destination System, Government, Legal Status, Goods Traded,
 * Services) and the Ports / Navigation Hazards readouts.
 *
 * Gated on discovery (discovery.ts) in two steps: an UNDISCOVERED system
 * reads "<Unknown>" throughout, including its name; a system that has
 * been entered but never LANDED IN fills in everything a fly-through
 * teaches (name, government, legal status, ports, hazards) and leaves
 * Goods Traded / Services "<Unknown>".
 *
 * `legalRecords` are the player's, already resolved by the caller (a
 * landed caller's win over the plugin's lookup, see Starmap).
 */
export function systemProperties(system: SystemData | undefined,
    isCurrent: boolean, discovery: DiscoveryLevel,
    universe: Pick<MissionUniverse, 'getGovt' | 'getPlanet'>,
    legalRecords: ReadonlyMap<string, number>): SystemProperties {
    const lines: PropertyLine[] = [];
    const addLine = (slot: PropSlot, label: string, values: string[]) => {
        lines.push({ slot, label, values });
    };

    const title = isCurrent ? 'Current System:' : 'Destination System:';
    const known = knownSystemProperties(discovery);
    if (!system || !known.identity) {
        addLine(PropSlot.System, title, ['<Unknown>']);
        return { lines, ports: '<Unknown>', hazards: '<Unknown>' };
    }

    addLine(PropSlot.System, title, [displayName(system.name)]);

    const govt = system.govt
        ? universe.getGovt(system.govt) : undefined;
    // Strip the "; note" author suffix ("Federation;hates Temmin
    // Shard" -> "Federation") the original never shows.
    addLine(PropSlot.Government, 'Government:',
        [govt ? displayName(govt.name) : 'Independent']);

    // The player's standing with the system's status government —
    // gövt 128's for an independent system (Bible, Appendix II) — read
    // through the same function as the 'p' dialog, InitialRec fallback
    // included, so the two screens never disagree about one record.
    // Only a status govt this universe cannot resolve leaves the slot
    // empty.
    const legalStatus = legalStatusInSystem(legalRecords,
        system.govt, id => universe.getGovt(id));
    if (legalStatus !== undefined) {
        addLine(PropSlot.LegalStatus, 'Legal Status:', [legalStatus]);
    }

    // Ports: the landable, INHABITED stellars (landable.ts isPort — the
    // same predicate that colors the dot). Goods/services aggregate over
    // them. Sol's readout in the original is "Earth, Mars, Europa": its
    // landable-but-uninhabited Wormhole is not a port.
    const planets = system.planets
        .map(id => universe.getPlanet(id))
        .filter(<T>(p: T): p is NonNullable<T> => p != null);
    const ports = planets.filter(p => isPort(p.flags));

    // WHAT A FLY-THROUGH DOES NOT TELL YOU. Flying into a system shows
    // you which of its stellars are inhabited ports, what government
    // flies there, and what the navigation hazards are — but not what
    // the ports sell or what they trade in. You learn that by LANDING,
    // which is the pilot file's own distinction between "visited" and
    // "visited and landed within" (discovery.ts). Until then both lines
    // read "<Unknown>" rather than being omitted, so the column keeps
    // its five fixed slots.
    if (!known.commerce) {
        addLine(PropSlot.Goods, 'Goods Traded:', ['<Unknown>']);
        addLine(PropSlot.Services, 'Services:', ['<Unknown>']);
    } else {
        const goods = new Set<number>();
        let trading = false, outfitting = false, shipyard = false;
        for (const port of ports) {
            port.tradeTiers.forEach((tier, i) => {
                if (tier !== null) {
                    goods.add(i);
                }
            });
            trading ||= port.flags.hasCommodityExchange;
            outfitting ||= port.flags.hasOutfitter;
            shipyard ||= port.flags.hasShipyard;
        }
        addLine(PropSlot.Goods, 'Goods Traded:', goods.size > 0
            ? [...goods].sort((a, b) => a - b)
                .map(i => STANDARD_CARGO_NAMES[i] ?? `Cargo ${i}`)
            : ['None']);
        const services = [
            ...(trading ? ['Trading'] : []),
            ...(outfitting ? ['Outfitting'] : []),
            ...(shipyard ? ['Shipyard'] : []),
        ];
        addLine(PropSlot.Services, 'Services:',
            services.length > 0 ? services : ['None']);
    }

    return {
        lines,
        ports: ports.length > 0
            ? ports.map(p => displayName(p.name)).join(', ') : 'None',
        hazards: hazardDescription(system.asteroids, system.interference),
    };
}

/**
 * Lays the column's groups out into `container` (replacing whatever it
 * held). Each group owns one of the column's five fixed slots, so a short
 * Goods Traded list leaves a gap rather than pulling the rest up — which
 * is what the original does.
 */
export function renderPropertyLines(container: PIXI.Container,
    lines: readonly PropertyLine[]) {
    container.removeChildren();
    for (const { slot, label, values } of lines) {
        const top = PROP_TOP + PROP_GROUP_Y[slot];
        const labelText = new PIXI.Text(label, PROP_LABEL_FONT);
        labelText.position.set(PROP_X, top);
        container.addChild(labelText);
        values.forEach((value, i) => {
            const valueText = new PIXI.Text(value, PROP_VALUE_FONT);
            valueText.position.set(PROP_X + PROP_VALUE_INDENT,
                top + PROP_FIRST_VALUE + i * PROP_LINE);
            container.addChild(valueText);
        });
    }
}
