import { BaseData, getDefaultBaseData } from "./base_data.js";

/**
 * A list of user-visible strings (a STR# resource). Other resources index
 * into these by list position: ship names, hail and comm quotes, cargo types,
 * stellar-type descriptions, and most of the game's fixed UI text.
 */
export interface StringTableData extends BaseData {
    /** The strings in list order; index 0 is the resource's "first string". */
    strings: string[];
}

export function getDefaultStringTableData(): StringTableData {
    return {
        ...getDefaultBaseData(),
        strings: [],
    };
}

/**
 * The scenario's distress calls: stock STR# 5003 "Ship Help Messages", 20
 * lines of the "we're under attack" kind. The EVN Bible documents the
 * behaviour (ships "send distress messages" unless their gövt sets Flags2
 * 0x0008, GovtData.flags2.noDistressMessages, or the class inherits it,
 * ShipData.inheritedNoGreetings) but not the id; this is where the stock
 * data keeps the text. Fetch it through the StringTable gettable. Traders
 * under NPC attack send these (nova's npc/distress.ts, reference "P1 wave
 * 14"); the display picks the line.
 */
export const DISTRESS_MESSAGES_STRING_TABLE = "nova:5003";
