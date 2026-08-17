import { SystResource } from "../resource_parsers/syst_resource.js";
import { SystemData, SystemPersonChance, SystemSpawnChance } from "novadatainterface/system_data";
import { BaseParse } from "./base_parse.js";
import { BaseData } from "novadatainterface/base_data";


/**
 * Which systems name each system in their own Con1-Con16, by global id.
 * See SystemLinkMap in nova_parse.ts for how it is built and why.
 */
export type SystemBacklinkMap = Promise<{ [index: string]: string[] }>;

export function SystemParseClosure(backlinks: SystemBacklinkMap) {
    return (syst: SystResource, notFoundFunction: (m: string) => void) =>
        SystemParse(syst, notFoundFunction, backlinks);
}

// TODO: Refactor redundant code
export async function SystemParse(syst: SystResource,
    notFoundFunction: (m: string) => void,
    backlinks?: SystemBacklinkMap): Promise<SystemData> {
    var base: BaseData = await BaseParse(syst, notFoundFunction);

    var links: Array<string> = [];
    for (let i in [...syst.links]) {
        let linkLocal = [...syst.links][i];

        let systLinkedTo = syst.idSpace.sÿst[linkLocal];
        if (systLinkedTo) {
            links.push(systLinkedTo.globalID);
        }
        else {
            notFoundFunction("No corresponding system " + linkLocal + " for link from " + base.id);
        }
    }

    // A hyperspace link is undirected — "the player can make hyperspace
    // jumps back and forth between them" (EVN Bible, the sÿst resource) —
    // so a system another one links TO is one jump away whether or not it
    // says so itself. Plug-ins lean on this: the Singularity plug-in
    // reaches AP Fringe IX by declaring the link only from AP Fringe IX's
    // end, and stock Nova's swapped duplicate systems (the Glimmers, the
    // Procyons) are entered the same way. Closing the edge here rather
    // than in each consumer is what makes the destination routable,
    // stageable and jumpable, not merely drawn on the map.
    //
    // Appended in id order after the system's own declarations, so the
    // list is byte-identical on every peer.
    const declared = new Set(links);
    for (const other of (await backlinks)?.[base.id] ?? []) {
        if (!declared.has(other)) {
            declared.add(other);
            links.push(other);
        }
    }

    var planets: Array<string> = [];

    for (let i in syst.spobs) {
        let planetLocal = syst.spobs[i];

        let planetGlobal = syst.idSpace.spöb[planetLocal];
        if (planetGlobal) {
            planets.push(planetGlobal.globalID);
        }
        else {
            notFoundFunction("Missing spöb id " + planetLocal + " for sÿst " + base.id);
        }
    }


    // Resolve the asteroid-type bitmask (bit 0 = röid 128) to global
    // röid ids. Only meaningful when the system has asteroids.
    const asteroidTypes: Array<string> = [];
    if (syst.asteroids > 0) {
        for (let bit = 0; bit < 16; bit++) {
            if (!(syst.asteroidTypes & (1 << bit))) {
                continue;
            }
            const roid = syst.idSpace.röid[128 + bit];
            if (roid) {
                asteroidTypes.push(roid.globalID);
            } else {
                notFoundFunction("Missing röid " + (128 + bit)
                    + " for sÿst " + base.id);
            }
        }
    }

    // Resolve the NPC spawn table: DudeTypes entries reference düde
    // resources (positive) or flët resources (negative, parsed into
    // syst.fleets). These are soft references — plug-ins routinely
    // point at resources they don't ship — so drop the entry with a
    // warning rather than calling notFoundFunction (which throws in
    // strict mode and would take the whole system down with it).
    const dudes: Array<SystemSpawnChance> = [];
    for (const { id, chance } of syst.dudes) {
        const dude = syst.idSpace.düde[id];
        if (dude) {
            dudes.push({ id: dude.globalID, weight: chance });
        } else {
            console.warn("Missing düde id " + id + " for sÿst " + base.id);
        }
    }
    const fleets: Array<SystemSpawnChance> = [];
    for (const { id, chance } of syst.fleets) {
        const fleet = syst.idSpace.flët[id];
        if (fleet) {
            fleets.push({ id: fleet.globalID, weight: chance });
        } else {
            console.warn("Missing flët id " + id + " for sÿst " + base.id);
        }
    }

    // The sÿst Person fields: the AI-people that can appear here, with
    // their percent chances. Soft references like the dude table (a
    // plug-in may list përs it doesn't ship), and order-preserving so
    // every peer builds the same spawn table.
    const persons: Array<SystemPersonChance> = [];
    for (const { id, chance } of syst.persons) {
        const pers = syst.idSpace.përs[id];
        if (pers) {
            persons.push({ id: pers.globalID, chance });
        } else {
            console.warn("Missing përs id " + id + " for sÿst " + base.id);
        }
    }

    // Also a soft reference: an unresolvable owning govt degrades to
    // independent.
    let govt: string | null = null;
    if (syst.govt >= 128) {
        const govtResource = syst.idSpace.gövt[syst.govt];
        if (govtResource) {
            govt = govtResource.globalID;
        } else {
            console.warn("Missing gövt id " + syst.govt
                + " for sÿst " + base.id);
        }
    }

    return {
        ...base,
        links,
        position: [syst.position[0], syst.position[1]],
        planets,
        asteroids: syst.asteroids,
        asteroidTypes,
        murk: syst.murk,
        interference: syst.interference,
        backgroundColor: syst.backgroundColor,
        visibility: syst.visibility,
        dudes,
        fleets,
        persons,
        avgShips: syst.avgShips,
        govt,
    }

}
