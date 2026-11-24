import { JunkData } from "novadatainterface/junk_data";
import { BaseData } from "novadatainterface/base_data";
import { JunkResource } from "../resource_parsers/junk_resource.js";
import { BaseParse } from "./base_parse.js";

/**
 * Maps a parsed jünk resource onto the JunkData shape. The local
 * SoldAt/BoughtAt spöb ids resolve to global ids (the same keys
 * PlanetData / SystemData.planets use) so the trade UI can match them
 * against the planet the player is docked at.
 */
export async function JunkParse(junk: JunkResource,
    notFoundFunction: (m: string) => void): Promise<JunkData> {
    const base: BaseData = await BaseParse(junk, notFoundFunction);

    const resolveStellars = (ids: number[]) => ids.flatMap(id => {
        const spob = junk.idSpace.spöb[id];
        if (!spob) {
            notFoundFunction(
                `No spöb ${id} for jünk ${base.id} trade location`);
            return [];
        }
        return [spob.globalID];
    });

    return {
        ...base,
        soldAt: resolveStellars(junk.soldAt),
        boughtAt: resolveStellars(junk.boughtAt),
        basePrice: junk.basePrice,
        multiplies: junk.multiplies,
        decays: junk.decays,
        scanMask: junk.scanMask,
        lcName: junk.lcName,
        abbrev: junk.abbrev,
        buyOn: junk.buyOn,
        sellOn: junk.sellOn,
    };
}
