import { DudeData, DudeShipChoice } from "novadatainterface/dude_data";
import { BaseData } from "novadatainterface/base_data";
import { DudeResource } from "../resource_parsers/dude_resource.js";
import { BaseParse } from "./base_parse.js";


/** düde InfoTypes 0x4xxx: the advice STR# is 7500 + the low 12 bits. */
const SPECIFIC_ADVICE_STRN_BASE = 7500;

/**
 * Maps a parsed düde resource onto the DudeData shape served through
 * the data interface: local shïp and gövt ids resolve to global ids,
 * and ship entries whose class is missing from the id space are dropped
 * (with a warning) rather than served as dangling references.
 */
export async function DudeParse(dude: DudeResource,
    notFoundFunction: (m: string) => void): Promise<DudeData> {
    const base: BaseData = await BaseParse(dude, notFoundFunction);

    // Ship classes and the govt are soft references (see the same
    // note in system_parse.ts): drop/degrade with a warning instead
    // of failing the whole düde in strict mode.
    const ships: DudeShipChoice[] = [];
    for (const { id, probability } of dude.ships) {
        const ship = dude.idSpace.shïp[id];
        if (!ship) {
            console.warn("Missing shïp id " + id + " for düde " + base.id);
            continue;
        }
        ships.push({ id: ship.globalID, weight: probability });
    }

    let govt: string | null = null;
    if (dude.govt >= 128) {
        const govtResource = dude.idSpace.gövt[dude.govt];
        if (govtResource) {
            govt = govtResource.globalID;
        } else {
            console.warn("Missing gövt id " + dude.govt
                + " for düde " + base.id);
        }
    }

    // InfoTypes 0x4xxx: specific advice from STR# 7500 + the low 12 bits.
    // A soft reference like the ones above: a missing STR# warns and
    // leaves the advice empty.
    let specificAdvice: string[] = [];
    if (dude.hasSpecificAdvice) {
        const strnId = SPECIFIC_ADVICE_STRN_BASE + dude.specificAdviceStrIndex;
        const strn = dude.idSpace["STR#"][strnId];
        if (strn) {
            specificAdvice = strn.strings
                .filter(line => line.trim() !== "" && line.trim() !== "*");
        } else {
            console.warn("Missing STR# id " + strnId
                + " for the specific advice of düde " + base.id);
        }
    }

    return {
        ...base,
        aiType: dude.aiType,
        govt,
        ships,
        hailInfo: {
            goodPrices: dude.hasGoodPrices,
            disasterInfo: dude.hasDisasterInfo,
            genericGovtHail: dude.hasGenericGovtHail,
            specificAdvice,
        },
    };
}
