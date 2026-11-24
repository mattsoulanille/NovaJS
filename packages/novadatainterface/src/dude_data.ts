import { BaseData, getDefaultBaseData } from "./base_data.js";


/** One ship class a dude can spawn as, with its relative weight. */
export interface DudeShipChoice {
    /** Global ship id, e.g. "nova:128". */
    id: string;
    /**
     * Relative probability weight (the düde's Probability field, in
     * percent). Weights are normalized at selection time, so they need
     * not sum to 100.
     */
    weight: number;
}

/**
 * A düde: a container for ship classes that share an AI type, a
 * government, and boarding booty. NPC spawning picks a concrete ship
 * class from `ships` using the weights, then applies `aiType` and
 * `govt` to the spawned ship.
 *
 * Field semantics follow the EVN Bible's düde section (pp. 24-25).
 * The hail-info field (InfoTypes) is carried as `hailInfo`; the booty
 * flags (Flags 0x0001-0x0040, what a plundered ship carries) are parsed
 * by the resource parser but not plumbed here yet: a boarded NPC yields
 * the CargoComponent it has, and spawned traffic carries nothing.
 */
export interface DudeData extends BaseData {
    /**
     * AI type for ships of this dude class: 1 = wimpy trader, 2 = brave
     * trader, 3 = warship, 4 = interceptor. 0 means each ship uses its
     * own inherent AI type (ShipData.inherentAI).
     */
    aiType: number;

    /** Global govt id, or null for independent. */
    govt: string | null;

    /** Ship classes this dude can spawn, with selection weights. */
    ships: DudeShipChoice[];

    /** What a ship of this dude class tells the player when hailed. */
    hailInfo: DudeHailInfo;
}

/**
 * düde InfoTypes (EVN Bible ~:832-839): "What kind of info to display when
 * hailed". DATA ONLY: the hail dialog does not show any of it yet, and
 * where the original puts the text is still to be measured
 * (docs/npc_behavior_gaps.md, "Hail info"). In stock, 130 of the 147
 * düdes set at least one bit; none uses specific advice.
 */
export interface DudeHailInfo {
    /** 0x1000 "Good prices". 26 stock düdes. */
    goodPrices: boolean;
    /** 0x2000 "Disaster info". 24 stock düdes. */
    disasterInfo: boolean;
    /** 0x8000 "Generic govt hail messages". 119 stock düdes. */
    genericGovtHail: boolean;
    /**
     * 0x4xxx "Specific advice": "the lower 12 bits of this value are added
     * to 7500 to get the ID of the STR# resource from which to get the
     * quote". Resolved at parse time to that STR#'s lines (blank and "*"
     * entries dropped), like GovtData.commGreetings. Empty when the bit is
     * clear or the STR# is missing.
     */
    specificAdvice: string[];
}

export function getDefaultDudeHailInfo(): DudeHailInfo {
    return {
        goodPrices: false,
        disasterInfo: false,
        genericGovtHail: false,
        specificAdvice: [],
    };
}

export function getDefaultDudeData(): DudeData {
    return {
        ...getDefaultBaseData(),
        aiType: 0,
        govt: null,
        ships: [],
        hailInfo: getDefaultDudeHailInfo(),
    };
}
