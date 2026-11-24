import { BaseData, getDefaultBaseData } from "./base_data.js";


/**
 * A government ("gövt"): a collection of ships and planets that react
 * collectively to the actions of the player and other ships. Ships inherit
 * their government from the düde/përs that spawns them; the government decides
 * who a ship is allied with, who it fights, how skilled it is, and how much
 * inherent missile jamming it has.
 *
 * Field layout and semantics follow the EVN Bible's gövt section (pp. ~27-30)
 * and ResForge's 192-byte gövt template. Only the fields plausibly useful to
 * combat, reputation, and fleet behaviour are plumbed through here; the
 * remaining cosmetic/UI fields (comm name, target code, news picture, etc.)
 * are carried too so consumers don't have to re-parse.
 */
export interface GovtData extends BaseData {
    /**
     * Class numbers this government belongs to (Class1-4 in the Bible), with
     * unused (-1) entries dropped. Allies/enemies are expressed in terms of
     * these class numbers, not govt ids: a ship is allied with any government
     * whose class list intersects this government's `allies`, and hostile to
     * any whose class list intersects this government's `enemies`.
     */
    classes: number[];

    /** Class numbers this government is allied with (Ally1-4). */
    allies: number[];

    /** Class numbers this government is enemies with (Enemy1-4). */
    enemies: number[];

    /**
     * Maximum combat odds this government's ships consider favourable before
     * they'll engage; 100 = a 1-to-1 fight. Higher = more willing to attack
     * when outnumbered.
     */
    maxOdds: number;

    /**
     * Global skill multiplier (percent) applied to this government's ships'
     * skill levels; 100 = stock. Higher values give the government's pilots
     * extra speed/acceleration/accuracy. The Bible notes values < 1 are
     * ignored by the engine.
     */
    skillMult: number;

    /**
     * The government's inherent jamming ability for each of the four jamming
     * types, 0-100%. Ordered [type1, type2, type3, type4] to match weapon
     * JamVulnerabilities and outfit jamming. See jamming_plugin.ts for how this
     * folds into a ship's effective jamming.
     */
    inhJam: [number, number, number, number];

    /**
     * How much the government dilutes the player's legal record before deciding
     * whether to be hostile (Crime Tolerance). Higher = more forgiving.
     */
    crimeTol: number;

    /**
     * Scan Fine behaviour when caught carrying illegal cargo: >0 is a fixed
     * credit fine, 0 is a warning only, <0 is a percentage of the player's cash.
     * Every stock gövt has 0 (EVN Bible ~:977-985).
     */
    scanFine: number;

    /**
     * 16-bit ScanMask (EVN Bible ~:1116): if any 1 bit matches one in a
     * mïsn's ScanMask (MissionData.scanMask), a jünk's (JunkData.scanMask)
     * or an oütf's (OutfitData.scanMask), this government considers that
     * mission cargo, commodity or outfit illegal. 0 = unused. Read by the
     * AI 4 contraband scan (nova's npc/contraband.ts): a govt with 0 here
     * never scans.
     */
    scanMask: number;

    /**
     * Legal-record penalties for various crimes against this government.
     * smugglePenalty is the Bible's SmugPenalty (~:987), the record lost
     * for being detected smuggling past this government's ships. The
     * contraband scan charges it for an illegal OUTFIT only (reference S1/S2
     * wave 12; nova's npc/contraband.ts).
     */
    smugglePenalty: number;
    disablePenalty: number;
    boardPenalty: number;
    killPenalty: number;
    /** Currently ignored by the game engine (kept for completeness). */
    shootPenalty: number;

    /** The player's starting legal record with this government. */
    initialRecord: number;

    /** Flags1 bits, decoded to named booleans. Drives combat/hail/bribe AI. */
    flags: GovtFlags;

    /** Flags2 bits, decoded to named booleans. Drives assist/map/travel AI. */
    flags2: GovtFlags2;

    /** Short comms name shown when a ship of this government is hailed. */
    commName: string;
    /** Short string shown in the target display for this government's ships. */
    targetCode: string;
    /** Medium-length name, e.g. "...xxx reinforcement fleet approaching." */
    mediumName: string;

    /** Theme colour as 0x00RRGGBB. */
    color: number;
    /** Ship paint colour as 0x00RRGGBB; 0 means unpainted. */
    shipColor: number;

    /**
     * 64-bit Require mask and'ed against the player's Contribute bits to land,
     * as a decimal string. Stored as a string (not a bigint) so GovtData stays
     * JSON-serializable end to end -- the server sends this over HTTP with
     * `res.send`, which would throw on a bigint. Parse with `BigInt(require)`
     * when the landing check is eventually implemented.
     */
    require: string;

    /** Voice set used by escorts of this government (see the Bible / gövt TMPL). */
    voiceType: number;

    /**
     * Global PICT id used as the background of the news window on this
     * government's stellars (gövt NewsPic), or null for the standard
     * independent news background.
     */
    newsPic: string | null;

    /**
     * Global ïntf id of the status bar shown while the player flies a ship of
     * this government (gövt Interface). EVN Bible, gövt section: "ID of an
     * ïntf resource to use when the player is flying a ship whose inherent
     * attributes govt or inherent combat govt is equal to this govt type.
     * Values less than 128 will be interpreted as 128" — which is what a null
     * here means: fall back to the default status bar.
     */
    statusBar: string | null;

    /**
     * The generic comms-dialog greetings shown when a non-përs ship of this
     * government is hailed and answers with a greeting. Resolved at parse time
     * from the government's greeting STR# (id 7000 + (govtId - 128), one
     * resource of up to ten alternative lines per government; EVN Bible
     * Appendix III maps the 'STR ' patch range 10000+ onto these). Empty when
     * the government has no greeting resource (many mission-only governments
     * don't); the caller then falls back to a synthetic line. A ship picks one
     * line deterministically (a hash of stable ids) so every peer and every
     * re-hail of the same ship shows the same greeting.
     */
    commGreetings: string[];
}

/** gövt Flags1, decoded to named booleans. */
export interface GovtFlags {
    /** Warships attack everyone except allies (pirates and nasties). */
    xenophobic: boolean;
    /**
     * Flags 0x0002, the "nosy" bit (EVN Bible ~:1055): "Ships of this govt
     * will attack the player in non-allied systems if he's a criminal
     * there" -- it enforces its own laws everywhere it goes, where a govt
     * without it only cares about its home turf. Parsed, not yet read by
     * the sim (docs/npc_behavior_gaps.md, "Nosy enforcement").
     */
    attacksPlayerIfCriminal: boolean;
    alwaysAttacksPlayer: boolean;
    /** Player's shots won't hit ships of this government. */
    playerShotsPassThrough: boolean;
    /** Warships retreat when their shields drop below 25%. */
    warshipsRetreatAt25: boolean;
    /**
     * Flags 0x0020 (EVN Bible ~:1063): "Nosy ships of other non-allied
     * governments ignore ships of this govt that are under attack". Parsed,
     * not yet read by the sim (no piracy police; docs/npc_behavior_gaps.md,
     * "Nosy-ignore").
     */
    ignoredByOtherNosyGovts: boolean;
    /** Never attacks player and the player can't hit them. */
    neverAttacksPlayer: boolean;
    /** Freighters (AiTypes 1-2) get 50% of the warship InhJam value. */
    freightersHalfJamming: boolean;
    /** 'pers' ships act as if they used an escape pod (immortal). */
    persShipsImmortal: boolean;
    warshipsTakeBribes: boolean;
    cantBeHailed: boolean;
    /** Ships start out disabled (derelicts). */
    startsDisabled: boolean;
    /** Warships plunder/capture trader-type enemies before destroying them. */
    plundersBeforeDestroying: boolean;
    freightersTakeBribes: boolean;
    planetsTakeBribes: boolean;
    /** Ships demand larger bribes and planets always take bribes. */
    largerBribes: boolean;
}

/** gövt Flags2, decoded to named booleans. */
export interface GovtFlags2 {
    /** Can't request assist/mercy when hailed; non-talkative. */
    noAssistOrMercy: boolean;
    /** Considered "minor" for drawing political map boundaries. */
    minorMapBoundaries: boolean;
    /** Systems don't affect political map boundaries. */
    noMapBoundaries: boolean;
    /** Ships don't send distress messages and don't greet when hailed. */
    noDistressMessages: boolean;
    /** Roadside Assistance: always repairs/refuels the player for free. */
    roadsideAssistance: boolean;
    doesntUseHypergates: boolean;
    prefersHypergates: boolean;
    prefersWormholes: boolean;
}

export function getDefaultGovtFlags(): GovtFlags {
    return {
        xenophobic: false,
        attacksPlayerIfCriminal: false,
        alwaysAttacksPlayer: false,
        playerShotsPassThrough: false,
        warshipsRetreatAt25: false,
        ignoredByOtherNosyGovts: false,
        neverAttacksPlayer: false,
        freightersHalfJamming: false,
        persShipsImmortal: false,
        warshipsTakeBribes: false,
        cantBeHailed: false,
        startsDisabled: false,
        plundersBeforeDestroying: false,
        freightersTakeBribes: false,
        planetsTakeBribes: false,
        largerBribes: false,
    };
}

export function getDefaultGovtFlags2(): GovtFlags2 {
    return {
        noAssistOrMercy: false,
        minorMapBoundaries: false,
        noMapBoundaries: false,
        noDistressMessages: false,
        roadsideAssistance: false,
        doesntUseHypergates: false,
        prefersHypergates: false,
        prefersWormholes: false,
    };
}

export function getDefaultGovtData(): GovtData {
    return {
        ...getDefaultBaseData(),
        classes: [],
        allies: [],
        enemies: [],
        maxOdds: 0,
        skillMult: 100,
        inhJam: [0, 0, 0, 0],
        crimeTol: 0,
        scanFine: 0,
        scanMask: 0,
        smugglePenalty: 0,
        disablePenalty: 0,
        boardPenalty: 0,
        killPenalty: 0,
        shootPenalty: 0,
        initialRecord: 0,
        flags: getDefaultGovtFlags(),
        flags2: getDefaultGovtFlags2(),
        commName: "",
        targetCode: "",
        mediumName: "",
        color: 0,
        shipColor: 0,
        require: "0",
        voiceType: -1,
        newsPic: null,
        statusBar: null,
        commGreetings: [],
    };
}
