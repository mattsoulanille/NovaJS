import { BaseData, getDefaultBaseData } from "./base_data.js";

/** A calendar date as EV Nova stores it. */
export interface GameDate {
    /** Day of the month, 1-31. */
    day: number;
    /** Month, 1-12. */
    month: number;
    year: number;
}

/**
 * A "character template" ("chär"): an entry point for a new pilot.
 * Selecting one sets the starting ship, credits, systems, legal
 * records, and start date.
 *
 * The intro PICT sequence is not carried (no intro sequence is
 * implemented); the intro dësc text is resolved to a string at parse
 * time like mission briefings are.
 */
export interface PlayerStartData extends BaseData {
    /** Credits the player starts with. */
    credits: number;
    /** Global id of the starting ship type (e.g. "nova:128"). */
    ship: string;
    /**
     * Global ids of the systems the player may (randomly) start in.
     * Empty means the scenario's default start system.
     */
    systems: string[];
    /** The game date at the start of a new pilot. */
    date: GameDate;
    /** String shown before the date whenever it is displayed. */
    datePrefix: string;
    /** String shown after the date whenever it is displayed. */
    dateSuffix: string;
    /** NCB set expression run when a new pilot of this type starts. */
    onStart: string;
    /** Intro text shown at game start; "" if none. */
    introText: string;
    /** Starting combat rating (kills). */
    combatRating: number;
    /** Whether this chär is the default in the new-pilot menu. */
    isDefault: boolean;
    /**
     * Starting legal statuses, keyed by global gövt id. The negative
     * of the status applies in enemy-owned systems.
     */
    govtStatuses: { govt: string, status: number }[];
    /**
     * The scenario's standard-cargo display names, resolved from STR#
     * 4000 at parse time (the six standard commodities plus any extra
     * mission cargo names). Indexed by mïsn CargoType (0-based). Carried
     * here because it's a single global table and PlayerStart is the
     * game-wide config resource; empty falls back to the built-in names.
     */
    cargoNames: string[];
    /**
     * The same table's lowercase variants, STR# 4001 (the Bible's
     * "Lowercase cargo names", 'STR ' patch range 9100-9355): what the
     * original puts into running text. The <CT> mission tag expands to
     * it (the stock "Un. Shipping Delivery" briefing reads "1 ton of
     * artwork", STR# 4000 being "Artwork"), and so does the player-info
     * cargo list ("Space probe." for STR# 4001 "*space probe"). Indexed
     * like cargoNames; empty (or a missing entry) falls back to the
     * cargoNames entry.
     */
    cargoNamesLower: string[];
}

/** The stock scenario's standard cargo names (STR# 4000), the fallback
 * when the data provides none. */
export const DEFAULT_CARGO_NAMES = ['Food', 'Industrial',
    'Medical Supplies', 'Luxury Goods', 'Metal', 'Equipment'];

/** The stock scenario's lowercase standard cargo names (STR# 4001), the
 * fallback when the data provides none. */
export const DEFAULT_CARGO_NAMES_LOWER = ['food', 'industrial goods',
    'medical supplies', 'luxury goods', 'metal', 'equipment'];

export function getDefaultGameDate(): GameDate {
    // EV Nova's stock scenario starts in October 1177 NC; a neutral
    // default for scenarios with no chär.
    return { day: 1, month: 1, year: 1177 };
}

export function getDefaultPlayerStartData(): PlayerStartData {
    return {
        ...getDefaultBaseData(),
        credits: 10000,
        ship: "default",
        systems: [],
        date: getDefaultGameDate(),
        datePrefix: "",
        dateSuffix: "",
        onStart: "",
        introText: "",
        combatRating: 0,
        isDefault: false,
        govtStatuses: [],
        cargoNames: [...DEFAULT_CARGO_NAMES],
        cargoNamesLower: [...DEFAULT_CARGO_NAMES_LOWER],
    };
}
