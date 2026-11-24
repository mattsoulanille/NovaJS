import { BaseData, getDefaultBaseData } from "./base_data.js";

/**
 * A jünk: a specialized tradeable commodity bought and sold at a few
 * specific stellar objects (EVN Bible p. 31). Cargo of this type uses
 * the "junk:<globalID>" key scheme in CargoComponent (see
 * cargo_plugin.ts and the röid parser).
 *
 * Price semantics follow the standard commodity tiers: at a stellar
 * where the jünk is *sold* (SoldAt) the player buys it at the low
 * tier (80% of BasePrice); at a stellar where it is *bought*
 * (BoughtAt) the player sells it at the high tier (125%).
 */
export interface JunkData extends BaseData {
    /** Global spöb ids where the player can buy this commodity. */
    soldAt: string[];
    /** Global spöb ids where the player can sell this commodity. */
    boughtAt: string[];
    /** Average price of the commodity. */
    basePrice: number;
    /** Tribbles flag: multiplies in the cargo hold. */
    multiplies: boolean;
    /** Perishable: gradually decays in the cargo hold. */
    decays: boolean;
    /**
     * jünk ScanMask (EVN Bible ~:1168): "If any of the 1 bits in a ship's
     * government's ScanMask field match any of the 1 bits in a jünk type's
     * ScanMask field, that government will consider that junk cargo type
     * illegal. Set to zero if unused." Compare with GovtData.scanMask.
     * Carried as data for contraband scanning, which does not exist yet
     * (docs/npc_behavior_gaps.md); 21 of the 23 stock jünks set bits.
     */
    scanMask: number;
    /** Lower-case display name, e.g. "machine parts". */
    lcName: string;
    /** Status bar abbreviation, e.g. "Parts". */
    abbrev: string;
    /** NCB test expression; buyable only when true (empty = always). */
    buyOn: string;
    /** NCB test expression; sellable only when true (empty = always). */
    sellOn: string;
}

export function getDefaultJunkData(): JunkData {
    return {
        ...getDefaultBaseData(),
        soldAt: [],
        boughtAt: [],
        basePrice: 0,
        multiplies: false,
        decays: false,
        scanMask: 0,
        lcName: "",
        abbrev: "",
        buyOn: "",
        sellOn: "",
    };
}
