import { BaseData, getDefaultBaseData } from "./base_data.js";


/**
 * One NPC spawn entry from the sÿst DudeTypes table: a global dude or
 * fleet id with a percent-probability weight. Weights are normalized at
 * selection time (the Bible allows them to sum to less than 100).
 */
export interface SystemSpawnChance {
    /** Global düde or flët id. */
    id: string;
    /** Percent probability weight (sÿst "% Prob", 1-99). */
    weight: number;
}

/**
 * One entry from the sÿst Person fields: a global përs id and the
 * percent chance that this person is the one an AI-person spawn creates.
 *
 * Unlike the DudeTypes weights (which sum to 100 in essentially all stock
 * systems and are a normalized distribution), the Person chances are
 * absolute per-person percentages that sum to anything from 10 to 600 in
 * stock data — see npc_spawn_plugin's maybeSpawnPers for how they compose
 * with the Bible's 5% AI-person roll.
 */
export interface SystemPersonChance {
    /** Global përs id. */
    id: string;
    /** Percent chance for this person (sÿst Person "% Prob"). */
    chance: number;
}

/**
 * A system's reinforcement fleet (sÿst ReinfFleet / ReinfTime /
 * ReinfIntrval, EVN Bible, the sÿst resource; TMPL offsets 406-410): "If
 * ships allied with the reinforcement fleet's government are under attack
 * and the combat odds against them exceed the MaxOdds field of the
 * reinforcement fleet's government, the reinforcement fleet will be called
 * in." (The oütf ModType 44 "reinforcement inhibitor" —
 * OutfitData.reinforcementInhibitorClass — suppresses it.)
 *
 * PARSED ONLY: nothing in the game calls in reinforcements yet (see the
 * feature request referenced from tracker issue #306).
 */
export interface SystemReinforcements {
    /** Global flët id of the reinforcement fleet (ReinfFleet 128+). */
    fleet: string;
    /**
     * ReinfTime: "The delay between the time the reinforcement call goes
     * out and the time the fleet appears", in frames ("A value of 30 = one
     * second").
     */
    delayFrames: number;
    /**
     * ReinfIntrval: "The interval, in days, that it takes for the
     * reinforcement fleet to be regenerated. If you set this to 0, a
     * reinforcement fleet will be available every day." Passed through as
     * stored (0 = every day, N = every N days).
     */
    regenerationDays: number;
}

export interface SystemData extends BaseData {
    position: [number, number],
    /**
     * The systems one hyperspace jump away, in BOTH directions.
     *
     * A hyperspace link is undirected: "Each system can be linked to up
     * to 16 other systems, and the player can make hyperspace jumps back
     * and forth between them" (EVN Bible, the sÿst resource). Only one
     * end of an edge has to declare it, so this list is the union of
     * this system's own Con1-Con16 (in resource order) and every other
     * system that names this one (appended in id order). The parser
     * closes it; consumers can treat it as plain adjacency.
     */
    links: Array<string>,
    planets: Array<string>,
    /**
     * How many asteroids to keep near the player at once (0-16). The
     * original engine treats this as a per-screen density: that many
     * asteroids always drift within the visible area, wrapping around
     * its edges.
     */
    asteroids: number,
    /** Global ids of the asteroid types that appear in this system. */
    asteroidTypes: Array<string>,

    /**
     * How murky (hazy) the system is, from 0 to 100. Zero renders normally;
     * higher values fog the view. A value below zero is equivalent to zero
     * murk but also hides the starfield. See the EVN Bible's sÿst docs.
     */
    murk: number,

    /**
     * How thick the sensor static in the system is, from 0 to 100. Zero is a
     * clear radar; 100 is a complete sensor blackout.
     */
    interference: number,

    /**
     * The system's background colour as 0x00RRGGBB. Zero is pure black.
     */
    backgroundColor: number,

    /**
     * NCB test expression controlling whether the system exists for the
     * player. Blank means always visible. Nova swaps between alternate
     * copies of a system (stacked at the same map position) by giving each
     * a different visibility expression.
     */
    visibility: string,

    /**
     * The dude classes AI ships spawned in this system are drawn from
     * (sÿst DudeTypes with positive ids), with percent weights.
     */
    dudes: Array<SystemSpawnChance>,

    /**
     * The fleets spawned through this system's DudeTypes table
     * (DudeTypes entries -128 to -383 reference flët -id), with percent
     * weights. Distinct from fleets that roam in via their own LinkSyst
     * ranges (see FleetData.linkSyst).
     */
    fleets: Array<SystemSpawnChance>,

    /**
     * The AI-people (përs) that can appear in this system, from the sÿst
     * Person fields at the end of the resource, with their percent
     * chances. The Bible: "Want to make a 'pers' type ship always appear?
     * Put its ID into one of the Person fields that appear at the end of
     * the syst resource." This list — not a scan of every përs whose
     * LinkSyst happens to admit the system — is what the system's
     * AI-person spawns are drawn from.
     */
    persons: Array<SystemPersonChance>,

    /**
     * The average number of AI ships in the system (sÿst AvgShips,
     * +/- 50% per the Bible). Zero means an empty system.
     */
    avgShips: number,

    /** Global id of the owning government, or null for independent. */
    govt: string | null,

    /**
     * The system's reinforcement fleet, or null when it has none: ReinfFleet
     * "Set to 0 or -1 if unused" (any id below 128 reads the same way), or a
     * flët that does not resolve. PARSED ONLY: no gameplay reads it yet, so
     * it changes neither the simulation nor the wire.
     */
    reinforcements: SystemReinforcements | null,
}

export function getDefaultSystemData(): SystemData {
    return {
        ...getDefaultBaseData(),
        position: [0, 0],
        links: [],
        planets: [],
        asteroids: 0,
        asteroidTypes: [],
        murk: 0,
        interference: 0,
        backgroundColor: 0,
        visibility: '',
        dudes: [],
        fleets: [],
        persons: [],
        avgShips: 0,
        govt: null,
        reinforcements: null,
    };
}
