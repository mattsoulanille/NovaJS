import { PlayerStartData } from "novadatainterface/player_start_data";
import { BaseData } from "novadatainterface/base_data";
import { CharResource } from "../resource_parsers/char_resource.js";
import { BaseParse } from "./base_parse.js";

/**
 * Maps a parsed chär resource onto the PlayerStartData shape. Local
 * resource ids (ship, systems, govts) are resolved to global ids, and
 * the intro dësc is resolved to its text.
 */
export async function CharParse(char: CharResource,
    notFoundFunction: (m: string) => void): Promise<PlayerStartData> {
    const base: BaseData = await BaseParse(char, notFoundFunction);

    const shipResource = char.idSpace.shïp[char.startingShip];
    let ship = "default";
    if (shipResource) {
        ship = shipResource.globalID;
    } else {
        notFoundFunction("chär " + base.id + " starting shïp "
            + char.startingShip + " not found");
    }

    const systems: string[] = [];
    for (const systemId of char.startingSystems) {
        const system = char.idSpace.sÿst[systemId];
        if (system) {
            systems.push(system.globalID);
        } else {
            notFoundFunction("chär " + base.id + " starting sÿst "
                + systemId + " not found");
        }
    }

    const govtStatuses: { govt: string, status: number }[] = [];
    for (const { govt, status } of char.govtStatuses) {
        const govtResource = char.idSpace.gövt[govt];
        if (govtResource) {
            govtStatuses.push({ govt: govtResource.globalID, status });
        }
    }

    // The standard-cargo display names are STR# 4000 (the proper-case
    // list) and STR# 4001 (the lowercase list running text uses; 4002 is
    // the status-bar abbreviations, not read yet). A missing resource
    // falls back to the built-in names.
    const cargoNames = char.idSpace["STR#"][4000]?.strings ?? [];
    const cargoNamesLower = char.idSpace["STR#"][4001]?.strings ?? [];

    return {
        ...base,
        cargoNames,
        cargoNamesLower,
        credits: char.startingCredits,
        ship,
        systems,
        date: {
            day: char.startingDay,
            month: char.startingMonth,
            year: char.startingYear,
        },
        datePrefix: char.datePrefix,
        dateSuffix: char.dateSuffix,
        onStart: char.onStart,
        introText: char.introText >= 0
            ? (char.idSpace.dësc[char.introText]?.text ?? "")
            : "",
        combatRating: char.combatRating,
        isDefault: char.isDefault,
        govtStatuses,
    };
}
