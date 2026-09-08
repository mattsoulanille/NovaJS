/**
 * THE SYNTHETIC UNIVERSE: a small, entirely original Nova scenario that the
 * test suites can run on instead of the copyrighted game files.
 *
 * Four linked systems, five stellars (a full-service port, a landable
 * uninhabited moon, a linked pair of hypergates and a "secret" raider
 * station), three ship classes with hand-drawn sprites, a blaster, a
 * missile with its ammo, a beam, a turret, a point-defence turret, a
 * fighter bay and a cloak, two governments with legal records, dude and
 * fleet tables so NPCs spawn, a default pilot, missions (one from the
 * mission computer with a set string), ranks, and the interface, icon and
 * picture resources the display asks for.
 *
 * This module is the DESCRIPTION of the scenario, in the parsers' own
 * vocabulary (local resource ids, TMPL field values); resources.ts turns
 * it into resource bytes and data_set.ts into the checked-in .ndat. It is
 * also the oracle the novaparse synthetic specs compare the parsed data
 * against, and the id map nova's specs refer to
 * (`SYNTHETIC.ships.skiff`, ...).
 *
 * Every name, description and picture here is original. The scenario
 * loads under the base "nova" prefix (it stands in for the Nova Files),
 * so its global ids are `nova:<id>` — the same shape as the stock data's,
 * which is what lets a spec written against the stock set be re-pointed
 * at this one by changing the fixture it asks for.
 */

// ---------------------------------------------------------------------
// Local ids, grouped by resource type. Nova numbers everything from 128.
// ---------------------------------------------------------------------

export const GOVT = { meridian: 128, raiders: 129, compact: 130, wrecks: 131 } as const;
export const SYST = { thessaly: 128, kestrel: 129, ossory: 130, vael: 131 } as const;
export const SPOB = {
    port: 128, moon: 129, kestrelGate: 130, vaelGate: 131, refuge: 132,
    coldharbour: 133, giant: 134, ossoryRift: 135, vaelRift: 136, kestrelRock: 137,
} as const;
export const SHIP = { skiff: 128, corsair: 129, warden: 130, ghost: 131, hulk: 132, mote: 133 } as const;
export const WEAP = {
    blaster: 128, missile: 129, beam: 130, turret: 131, pointDefense: 132,
    skiffBay: 133, arcTurret: 134, needleBeam: 135, wideLance: 136, bowChaser: 137,
    flankTurret: 138, narrowTurret: 139, stubGun: 140, ghostBay: 141,
} as const;
export const OUTF = {
    blaster: 128, launcher: 129, missileAmmo: 130, beam: 131, turret: 132,
    pointDefense: 133, cloak: 134, shieldCapacitor: 135, cargoPod: 136,
    fuelTank: 137, skiffBay: 138, skiffFighter: 139,
    veil: 140, irBaffler: 141, radarBaffler: 142, arcTurret: 143, needleBeam: 144,
    wideLance: 145, bowChaser: 146, flankTurret: 147, narrowTurret: 148, stubGun: 149,
    ghostBay: 150, ghostFighter: 151, warrantSeal: 152, charter: 153, bondedCharter: 154,
    wardenRefit: 155, dockVoucher: 156,
} as const;
export const DUDE = { traders: 128, patrol: 129, raiders: 130, variants: 131, gatedOnly: 132 } as const;
export const FLET = { raiderWing: 128 } as const;
export const MISN = {
    courier: 128, gateSurvey: 129, bounty: 130, rescue: 131, salvage: 132,
    tradeErrand: 133, shipyardErrand: 134, outfitterErrand: 135,
} as const;
export const RANK = { warrant: 128, confidant: 129, cover: 130 } as const;
export const PERS = { lask: 128, pell: 129, vey: 130, stranded: 131, wreck: 132 } as const;
export const JUNK = { resin: 128, alloy: 129 } as const;
export const CHAR = { courier: 128 } as const;
export const BOOM = { burst: 128 } as const;
export const ROID = { shoal: 128 } as const;
export const INTF = { standard: 128 } as const;
export const RLED = {
    burst: 400, shoal: 800,
    skiff: 1000, corsair: 1001, warden: 1002, corsairGlow: 1011,
    planet: 2000, moon: 2001, gate: 2002, station: 2003,
    bolt: 3000, missile: 3001,
} as const;
export const SPIN = {
    burst: 400, shoal: 800,
    planet: 1000, moon: 1001, gate: 1002, station: 1003,
    bolt: 3000, missile: 3001,
} as const;
export const CICN = { missionMarkActive: 15000, missionMarkViewed: 15001 } as const;
export const STRN = {
    captions: 150, misc: 2002, shipComm: 3000, stellarComm: 3002,
    cargoNames: 4000, cargoPrices: 4004,
    meridianGreetings: 7000, raiderGreetings: 7001,
    /** përs comm-dialog quotes and over-the-radio hail quotes (Bible). */
    persCommQuotes: 7100, persHailQuotes: 7101,
} as const;
/** Control bits the missions set; the scenario's own numbering. */
export const BITS = {
    courierAccepted: 100, courierDone: 101, surveyAccepted: 102,
    errandAccepted: 103, errandRefused: 104, outfitterErrandOpen: 105,
    /** The Require bit the Warrant Seal outfit asks for (a Contribute bit index). */
    warrantHolder: 3,
} as const;

/** The base-data id prefix the scenario loads under. */
export const SYNTHETIC_PREFIX = "nova";
/** A global id in the scenario: `sid(SHIP.skiff)` is "nova:128". */
export function sid(localId: number): string {
    return `${SYNTHETIC_PREFIX}:${localId}`;
}

// The derived PICT / dësc ids the parsers compute from a resource's own id
// (ship_resource, outf_resource, planet_parse, misn_parse, ship_parse).
export const shipPict = (ship: number) => ship - 128 + 5000;
export const shipDesc = (ship: number) => ship - 128 + 13000;
export const pilotDesc = (ship: number) => ship - 128 + 14000;
export const outfitPict = (outfit: number) => outfit - 128 + 6000;
export const outfitDesc = (outfit: number) => outfit - 128 + 3000;
export const landscapePict = (spobType: number) => 10000 + spobType;
export const barDesc = (spob: number) => spob - 128 + 10000;
export const missionOfferDesc = (mission: number) => mission - 128 + 4000;
export const govtGreetings = (govt: number) => govt - 128 + 7000;

/** PICTs with no owner resource: the display's fixed ids. */
export const PICT = {
    statusBar: 700,
    shipInfo: 20000,
    barScene: 9100,
    /** 128x64 HUD target renders, 3000 + (shïp id - 128). */
    hudTarget: (ship: number) => ship - 128 + 3000,
    /** Button art: three normal, three pressed, three disabled slices. */
    buttons: [7500, 7501, 7502, 7503, 7504, 7505, 7506, 7507, 7508],
    /** The landed-UI dialog frames (spaceport, shipyard, bar, popups...). */
    dialogs: Array.from({ length: 34 }, (_, i) => 8500 + i),
    news: 9000,
} as const;

/**
 * The landed-UI frames at the STOCK pixel sizes (the game's own dialog
 * art, measured), so a headless layout that reads a frame's size sees
 * the geometry it was written for. A frame not listed is 64x48. The
 * button slices (7500-7508) are 13x25, with the tiling middle 2x25.
 */
export const DIALOG_PICT_SIZES: { [id: number]: [width: number, height: number] } = {
    8500: [618, 517], 8501: [765, 323], 8502: [765, 321], 8503: [263, 185],
    8504: [266, 306], 8505: [510, 201], 8506: [250, 285], 8507: [614, 537],
    8508: [387, 219], 8509: [601, 513], 8510: [426, 252], 8511: [423, 215],
    8512: [540, 295], 8513: [424, 259], 8514: [262, 107], 8515: [309, 198],
    8516: [267, 128], 8517: [471, 155], 8518: [413, 40], 8519: [413, 215],
    8520: [413, 40], 8521: [441, 9], 8522: [441, 365], 8523: [441, 40],
    8524: [441, 9], 8525: [441, 365], 8526: [441, 40], 8527: [649, 244],
    8528: [649, 244], 8529: [470, 230], 8530: [100, 100], 8531: [100, 100],
    8532: [100, 100], 8533: [100, 100],
};
export const buttonPictSize = (index: number): [number, number] =>
    index % 3 === 1 ? [2, 25] : [13, 25];

/**
 * The scenario's global ids, for specs: `SYNTHETIC.systems.thessaly` is
 * the sÿst's "nova:128". Sorted-first ids matter to several fixtures
 * (makeSimulationBridgeHarness, makeDeterminismWorld pick them): those
 * are Thessaly Reach and the Wren Skiff here.
 */
/** Every key of a local-id group mapped to its global id. */
function globalIds<T extends { [key: string]: number }>(group: T): { [K in keyof T]: string } {
    return Object.fromEntries(Object.entries(group).map(([k, v]) => [k, sid(v)])) as
        { [K in keyof T]: string };
}

export const SYNTHETIC = {
    prefix: SYNTHETIC_PREFIX,
    govts: globalIds(GOVT),
    systems: globalIds(SYST),
    planets: globalIds(SPOB),
    ships: globalIds(SHIP),
    weapons: globalIds(WEAP),
    outfits: globalIds(OUTF),
    dudes: globalIds(DUDE),
    fleets: globalIds(FLET),
    missions: globalIds(MISN),
    ranks: globalIds(RANK),
    persons: globalIds(PERS),
    junk: globalIds(JUNK),
    playerStart: sid(CHAR.courier),
    explosion: sid(BOOM.burst),
    asteroid: sid(ROID.shoal),
    statusBar: sid(INTF.standard),
    bits: BITS,
} as const;

// ---------------------------------------------------------------------
// Governments
// ---------------------------------------------------------------------

export interface GovtDef {
    id: number;
    name: string;
    flags: number;
    flags2: number;
    scanFine: number;
    crimeTol: number;
    smugPenalty: number;
    disabPenalty: number;
    boardPenalty: number;
    killPenalty: number;
    shootPenalty: number;
    initialRec: number;
    maxOdds: number;
    classes: number[];
    allies: number[];
    enemies: number[];
    skillMult: number;
    scanMask: number;
    commName: string;
    targetCode: string;
    mediumName: string;
    color: number;
    shipColor: number;
    interface: number;
    greetings: string[];
    /** InhJam: the jamming every ship of the government carries, per type. */
    inhJam: number[];
}

/** gövt Flags (EVN Bible): the bits this scenario uses. */
export const GOVT_FLAGS = {
    xenophobic: 0x0001, attacksPlayerIfCriminal: 0x0002,
    alwaysAttacksPlayer: 0x0004, warshipsTakeBribes: 0x0200,
    startsDisabled: 0x0800, plundersBeforeDestroying: 0x1000,
    freightersTakeBribes: 0x2000, planetsTakeBribes: 0x4000, largerBribes: 0x8000,
} as const;

export const GOVTS: GovtDef[] = [
    {
        id: GOVT.meridian, name: "Concord of Meridian",
        flags: GOVT_FLAGS.attacksPlayerIfCriminal, flags2: 0,
        scanFine: 500, crimeTol: 20, smugPenalty: 10, disabPenalty: 5,
        boardPenalty: 10, killPenalty: 20, shootPenalty: 2, initialRec: 0,
        maxOdds: 200, classes: [1], allies: [], enemies: [2],
        skillMult: 100, scanMask: 0x0001, commName: "Meridian",
        targetCode: "MER", mediumName: "Meridian patrol",
        color: 0x003a7bd5, shipColor: 0, interface: INTF.standard,
        greetings: [
            "Meridian control here. State your business.",
            "Keep to the marked lanes, pilot.",
            "Welcome to Concord space.",
        ],
        inhJam: [],
    },
    {
        id: GOVT.raiders, name: "Verge Raiders",
        flags: GOVT_FLAGS.xenophobic | GOVT_FLAGS.alwaysAttacksPlayer
            | GOVT_FLAGS.warshipsTakeBribes | GOVT_FLAGS.plundersBeforeDestroying,
        flags2: 0,
        scanFine: 0, crimeTol: 100, smugPenalty: 0, disabPenalty: 5,
        boardPenalty: 5, killPenalty: 15, shootPenalty: 1, initialRec: -10,
        maxOdds: 300, classes: [2], allies: [], enemies: [1],
        skillMult: 90, scanMask: 0, commName: "Raiders", targetCode: "RDR",
        mediumName: "raider wing", color: 0x00c8402a, shipColor: 0,
        interface: INTF.standard,
        greetings: [
            "Cargo or scrap. Your choice.",
            "Nobody crosses the Verge for free.",
        ],
        // A weak inherent jamming (IR 7, radar 5): the raiders' hulls are
        // a little harder for missiles to see.
        inhJam: [7, 5, 0, 0],
    },
    {
        // The Concord's ALLY (its allies list names Meridian's class 1), a
        // trading league whose worlds take bribes at the larger rate. It
        // has no ships of its own: no düde, no fleet, no inherent hulls,
        // so it only exists through Coldharbour and the reputation rules.
        id: GOVT.compact, name: "Amber Compact",
        flags: GOVT_FLAGS.planetsTakeBribes | GOVT_FLAGS.freightersTakeBribes
            | GOVT_FLAGS.largerBribes,
        flags2: 0,
        scanFine: 200, crimeTol: 15, smugPenalty: 5, disabPenalty: 3,
        boardPenalty: 6, killPenalty: 12, shootPenalty: 1, initialRec: 0,
        maxOdds: 200, classes: [3], allies: [1], enemies: [],
        skillMult: 100, scanMask: 0, commName: "Compact", targetCode: "AMB",
        mediumName: "Compact convoy", color: 0x00d5a83a, shipColor: 0,
        interface: INTF.standard,
        greetings: ["Compact traffic control. Mind the tolls."],
        // A strong inherent jamming, every type: the reference "the govt's
        // jamming dominates an outfit's" case.
        inhJam: [50, 50, 35, 20],
    },
    {
        // Derelicts: unrelated to everyone (no allies, no enemies, its own
        // class), and its ships start DISABLED (gövt Flags 0x0800).
        id: GOVT.wrecks, name: "Drift Wrecks",
        flags: GOVT_FLAGS.startsDisabled, flags2: 0,
        scanFine: 0, crimeTol: 100, smugPenalty: 0, disabPenalty: 0,
        boardPenalty: 0, killPenalty: 0, shootPenalty: 0, initialRec: 0,
        maxOdds: 100, classes: [4], allies: [], enemies: [],
        skillMult: 50, scanMask: 0, commName: "Wreck", targetCode: "WRK",
        mediumName: "drifting wreck", color: 0x00606060, shipColor: 0,
        interface: INTF.standard,
        greetings: ["...static..."],
        inhJam: [],
    },
];

// ---------------------------------------------------------------------
// Systems and stellars
// ---------------------------------------------------------------------

export interface SystDef {
    id: number;
    name: string;
    position: [number, number];
    links: number[];
    spobs: number[];
    /** DudeTypes entries: a düde id (>= 128) or -flët id, with a percent. */
    dudes: Array<{ id: number, chance: number }>;
    /** Persons entries: a përs id with its percent chance (the sÿst Person list). */
    persons: Array<{ id: number, chance: number }>;
    avgShips: number;
    govt: number;
    asteroids: number;
    asteroidTypes: number;
    interference: number;
    murk: number;
    backgroundColor: number;
}

export const SYSTS: SystDef[] = [
    {
        // The starting system. Its stellars, in resource order: the port
        // (nova:128), the moon, then the Compact's MinStatus-0 world and
        // an unlandable gas giant — appended so that "the first two
        // stellars" stay the port and the moon.
        id: SYST.thessaly, name: "Thessaly Reach", position: [0, 0],
        links: [SYST.kestrel, SYST.ossory],
        spobs: [SPOB.port, SPOB.moon, SPOB.coldharbour, SPOB.giant],
        dudes: [{ id: DUDE.traders, chance: 70 }, { id: DUDE.patrol, chance: 30 }],
        persons: [{ id: PERS.pell, chance: 30 }, { id: PERS.stranded, chance: 10 }],
        avgShips: 6, govt: GOVT.meridian, asteroids: 0, asteroidTypes: 0,
        interference: 0, murk: 0, backgroundColor: 0,
    },
    {
        id: SYST.kestrel, name: "Kestrel Drift", position: [200, 50],
        // Vael is declared from this end only: the parser closes the
        // link (system backlinks), and a spec can pin that it does.
        links: [SYST.thessaly, SYST.vael], spobs: [SPOB.kestrelGate, SPOB.kestrelRock],
        dudes: [{ id: DUDE.raiders, chance: 60 }, { id: -FLET.raiderWing, chance: 40 }],
        persons: [{ id: PERS.lask, chance: 40 }, { id: PERS.vey, chance: 20 }],
        avgShips: 3, govt: GOVT.raiders, asteroids: 0, asteroidTypes: 0,
        interference: 20, murk: 0, backgroundColor: 0,
    },
    {
        id: SYST.ossory, name: "Ossory Shoal", position: [-150, 120],
        links: [SYST.thessaly], spobs: [SPOB.refuge, SPOB.ossoryRift],
        dudes: [{ id: DUDE.raiders, chance: 50 }, { id: DUDE.traders, chance: 50 }],
        persons: [{ id: PERS.wreck, chance: 15 }],
        avgShips: 2, govt: -1, asteroids: 4, asteroidTypes: 0x0001,
        interference: 50, murk: 35, backgroundColor: 0x00101820,
    },
    {
        // No Person list at all: the system where only a përs whose
        // LinkSyst says "any" (or a govt range) can turn up.
        id: SYST.vael, name: "Vael Hollow", position: [350, -80],
        links: [], spobs: [SPOB.vaelGate, SPOB.vaelRift],
        dudes: [{ id: DUDE.patrol, chance: 100 }],
        persons: [],
        avgShips: 1, govt: GOVT.meridian, asteroids: 0, asteroidTypes: 0,
        interference: 0, murk: 0, backgroundColor: 0,
    },
];

/** spöb Flags bits (EVN Bible), as planet_parse reads them. */
export const SPOB_FLAGS = {
    canLand: 0x01, commodityExchange: 0x02, outfitter: 0x04, shipyard: 0x08,
    station: 0x10, uninhabited: 0x20, bar: 0x40,
} as const;
/** spöb Flags2: the hypergate bit. */
export const SPOB_FLAGS2 = { hypergate: 0x1000, wormhole: 0x2000 } as const;
/** The trade-tier nibbles: 1 low, 2 medium, 4 high; 0 does not trade. */
export type TradeTier = 0 | 1 | 2 | 4;
export function tradeFlags(tiers: {
    food: TradeTier, industrial: TradeTier, medical: TradeTier,
    luxury: TradeTier, metal: TradeTier, equipment: TradeTier,
}): number {
    return ((tiers.food << 28) | (tiers.industrial << 24) | (tiers.medical << 20)
        | (tiers.luxury << 16) | (tiers.metal << 12) | (tiers.equipment << 8)) >>> 0;
}

export interface SpobDef {
    id: number;
    name: string;
    system: number;
    position: [number, number];
    /** Stellar type: spïn 1000 + type names the sprite, PICT 10000 + type the landscape. */
    type: number;
    flags: number;
    flags2: number;
    techLevel: number;
    specialTech: number[];
    govt: number;
    minStatus: number;
    /** CustSndID: an emergence angle for a gate, -1 otherwise. */
    ambientSound: number;
    hyperlinks: number[];
    landingFee: number;
    landingDesc: string;
    barDesc?: string;
}

export const SPOBS: SpobDef[] = [
    {
        id: SPOB.port, name: "Port Amberline", system: SYST.thessaly,
        position: [120, -80], type: 0,
        flags: SPOB_FLAGS.canLand | SPOB_FLAGS.commodityExchange | SPOB_FLAGS.outfitter
            | SPOB_FLAGS.shipyard | SPOB_FLAGS.bar
            | tradeFlags({ food: 1, industrial: 2, medical: 4, luxury: 2, metal: 1, equipment: 4 }),
        flags2: 0, techLevel: 5, specialTech: [], govt: GOVT.meridian,
        minStatus: -32767, ambientSound: -1, hyperlinks: [], landingFee: 0,
        landingDesc: "Amberline's docks ring a shallow harbour of anchored "
            + "freighters. Cranes swing overhead, the Concord customs office "
            + "is never closed, and the shipwright on the third pier will sell "
            + "you anything with a hull.",
        barDesc: "The Ferrule is a low room under the cargo cranes where "
            + "pilots trade rumours for drinks.",
    },
    {
        id: SPOB.moon, name: "Sallow Moon", system: SYST.thessaly,
        position: [-260, 140], type: 1,
        flags: SPOB_FLAGS.canLand | SPOB_FLAGS.uninhabited,
        flags2: 0, techLevel: 0, specialTech: [], govt: -1,
        minStatus: -32767, ambientSound: -1, hyperlinks: [], landingFee: 0,
        landingDesc: "A pale moon of dust and old survey markers. Nobody lives "
            + "here; nothing stops you setting down.",
    },
    {
        id: SPOB.kestrelGate, name: "Kestrel Gate", system: SYST.kestrel,
        position: [0, 250], type: 2,
        flags: SPOB_FLAGS.canLand | SPOB_FLAGS.uninhabited,
        flags2: SPOB_FLAGS2.hypergate, techLevel: 0, specialTech: [], govt: -1,
        minStatus: -32767, ambientSound: 90, hyperlinks: [SPOB.vaelGate],
        landingFee: 0,
        landingDesc: "A ring of dark alloy hangs in the drift, humming. Ships "
            + "that enter it come out at its twin.",
    },
    {
        id: SPOB.vaelGate, name: "Vael Gate", system: SYST.vael,
        position: [-200, 0], type: 2,
        flags: SPOB_FLAGS.canLand | SPOB_FLAGS.uninhabited,
        flags2: SPOB_FLAGS2.hypergate, techLevel: 0, specialTech: [], govt: -1,
        minStatus: -32767, ambientSound: 270, hyperlinks: [SPOB.kestrelGate],
        landingFee: 0,
        landingDesc: "The far end of the Kestrel line: an identical ring, "
            + "colder and quieter.",
    },
    {
        // The "secret" port: inhabited and landable, but only for a pilot
        // the raiders rate at 20 or better, and the only outfitter that
        // stocks the tech-7 cloak (through SpecialTech).
        id: SPOB.refuge, name: "Halden Refuge", system: SYST.ossory,
        position: [60, 200], type: 3,
        flags: SPOB_FLAGS.canLand | SPOB_FLAGS.outfitter | SPOB_FLAGS.bar
            | SPOB_FLAGS.station
            | tradeFlags({ food: 0, industrial: 0, medical: 0, luxury: 0, metal: 0, equipment: 0 }),
        flags2: 0, techLevel: 3, specialTech: [7], govt: GOVT.raiders,
        minStatus: 20, ambientSound: -1, hyperlinks: [], landingFee: 250,
        landingDesc: "A hollowed rock the Verge Raiders call home. The "
            + "docking ring only opens for people they trust.",
        barDesc: "Halden's bar has no name and no windows.",
    },
    {
        // The second inhabited world of the starting system: a planet
        // (not a station) with MinStatus 0, so a pilot the Compact rates
        // below zero is refused and can try a bribe — the Compact's
        // worlds take them, at the larger rate.
        id: SPOB.coldharbour, name: "Coldharbour", system: SYST.thessaly,
        position: [-40, 320], type: 0,
        flags: SPOB_FLAGS.canLand | SPOB_FLAGS.commodityExchange | SPOB_FLAGS.bar
            | tradeFlags({ food: 4, industrial: 1, medical: 2, luxury: 0, metal: 2, equipment: 1 }),
        flags2: 0, techLevel: 2, specialTech: [], govt: GOVT.compact,
        minStatus: 0, ambientSound: -1, hyperlinks: [], landingFee: 0,
        landingDesc: "Coldharbour is a fishing world with one cold, busy "
            + "port. The Compact's harbourmaster meets every ship.",
        // A dësc with conditional blocks (gender and a control bit), for
        // the text-expansion rules.
        barDesc: "The harbourmaster nods. {G \"Welcome back, sir.\" \"Welcome "
            + "back, ma'am.\"} {b" + BITS.surveyAccepted + " \"Word is you took "
            + "the gate survey.\" \"\"}",
    },
    {
        // An unlandable gas giant sharing the starting system with the
        // ports: no can-land bit at all.
        id: SPOB.giant, name: "Ossian Giant", system: SYST.thessaly,
        position: [420, 220], type: 0,
        flags: 0, flags2: 0, techLevel: 0, specialTech: [], govt: -1,
        minStatus: -32767, ambientSound: -1, hyperlinks: [], landingFee: 0,
        landingDesc: "A banded giant with no surface to land on.",
    },
    {
        // A link-less WORMHOLE pair: each exits at a random other
        // link-less wormhole (Bible p. 61), so these two find each other.
        id: SPOB.ossoryRift, name: "Ossory Rift", system: SYST.ossory,
        position: [-320, -160], type: 2,
        flags: SPOB_FLAGS.canLand | SPOB_FLAGS.uninhabited,
        flags2: SPOB_FLAGS2.wormhole, techLevel: 0, specialTech: [], govt: -1,
        minStatus: -32767, ambientSound: -1, hyperlinks: [], landingFee: 0,
        landingDesc: "A tear in the shoal that the rocks avoid. Ships that "
            + "enter it come out somewhere else.",
    },
    {
        id: SPOB.vaelRift, name: "Vael Rift", system: SYST.vael,
        position: [240, 180], type: 2,
        flags: SPOB_FLAGS.canLand | SPOB_FLAGS.uninhabited,
        flags2: SPOB_FLAGS2.wormhole, techLevel: 0, specialTech: [], govt: -1,
        minStatus: -32767, ambientSound: -1, hyperlinks: [], landingFee: 0,
        landingDesc: "The Hollow's own tear, twin to the one in the shoal.",
    },
    {
        // An ordinary landable rock in the same system as a hypergate.
        id: SPOB.kestrelRock, name: "Kestrel Rock", system: SYST.kestrel,
        position: [-320, -220], type: 1,
        flags: SPOB_FLAGS.canLand | SPOB_FLAGS.uninhabited,
        flags2: 0, techLevel: 0, specialTech: [], govt: -1,
        minStatus: -32767, ambientSound: -1, hyperlinks: [], landingFee: 0,
        landingDesc: "A cratered rock the raiders use as a marker. Nothing "
            + "lives here.",
    },
];

// ---------------------------------------------------------------------
// Weapons and outfits
// ---------------------------------------------------------------------

export interface WeapDef {
    id: number;
    name: string;
    reload: number;
    duration: number;
    armorDamage: number;
    shieldDamage: number;
    /** Guidance: -1 unguided, 0 beam, 1 guided, 4 turret, 9 point defence, 99 bay. */
    guidance: number;
    speed: number;
    /** AmmoType: -1 unlimited, 0-255 wëap 128+n's supply, a shïp id for a bay. */
    ammoType: number;
    /** Graphic: spïn 3000 + n, -1 none. */
    graphic: number;
    accuracy: number;
    impact: number;
    /** ExplodType: bööm index (0 = bööm 128), -1 none. */
    explosion: number;
    proxRadius: number;
    blastRadius: number;
    flags: number;
    beam?: { length: number, width: number, falloff: number, color: number, coronaColor: number };
    /** Exit type: 0 gun, 1 turret, 2 guided, 3 beam, -1 centre. */
    exitType: number;
    turnRate: number;
    maxAmmo: number;
    durability: number;
}

/** wëap Flags bits this scenario uses. */
export const WEAP_FLAGS = {
    secondary: 0x0002, notVulnerableToPD: 0x0080, missesFiringShip: 0x0100,
    /** Turret blind spots (ignored on a fixed mount). */
    blindSides: 0x2000, blindRear: 0x4000,
} as const;
/** wëap Guidance values (EVN Bible). */
export const GUIDANCE = {
    unguided: -1, beam: 0, guided: 1, beamTurret: 3, turret: 4, frontQuadrant: 7,
    pointDefense: 9, bay: 99,
} as const;

export const WEAPS: WeapDef[] = [
    {
        id: WEAP.blaster, name: "Pulse Blaster", reload: 12, duration: 30,
        armorDamage: 6, shieldDamage: 8, guidance: -1, speed: 1200, ammoType: -1,
        graphic: 0, accuracy: 3, impact: 5, explosion: 0, proxRadius: 0,
        blastRadius: 0, flags: WEAP_FLAGS.missesFiringShip, exitType: 0,
        turnRate: 0, maxAmmo: -1, durability: 0,
    },
    {
        id: WEAP.missile, name: "Harrier Missile", reload: 60, duration: 240,
        armorDamage: 40, shieldDamage: 30, guidance: 1, speed: 700,
        ammoType: WEAP.missile - 128, graphic: 1, accuracy: 0, impact: 20,
        explosion: 0, proxRadius: 12, blastRadius: 30,
        flags: WEAP_FLAGS.secondary | WEAP_FLAGS.missesFiringShip, exitType: 2,
        turnRate: 30, maxAmmo: 20, durability: 2,
    },
    {
        id: WEAP.beam, name: "Lance Beam", reload: 30, duration: 10,
        armorDamage: 3, shieldDamage: 5, guidance: 0, speed: 0, ammoType: -1,
        graphic: -1, accuracy: 0, impact: 0, explosion: -1, proxRadius: 0,
        blastRadius: 0, flags: WEAP_FLAGS.missesFiringShip,
        beam: { length: 220, width: 2, falloff: 4, color: 0x0060c0ff, coronaColor: 0x00a0e0ff },
        exitType: 3, turnRate: 0, maxAmmo: -1, durability: 0,
    },
    {
        id: WEAP.turret, name: "Sentry Turret", reload: 20, duration: 35,
        armorDamage: 5, shieldDamage: 5, guidance: 4, speed: 1000, ammoType: -1,
        graphic: 0, accuracy: 2, impact: 4, explosion: 0, proxRadius: 0,
        blastRadius: 0, flags: WEAP_FLAGS.missesFiringShip, exitType: 1,
        turnRate: 0, maxAmmo: -1, durability: 0,
    },
    {
        id: WEAP.pointDefense, name: "Flak Point Defense", reload: 8, duration: 15,
        armorDamage: 2, shieldDamage: 2, guidance: 9, speed: 1400, ammoType: -1,
        graphic: 0, accuracy: 5, impact: 0, explosion: -1, proxRadius: 0,
        blastRadius: 0, flags: WEAP_FLAGS.missesFiringShip, exitType: 1,
        turnRate: 0, maxAmmo: -1, durability: 0,
    },
    {
        id: WEAP.skiffBay, name: "Skiff Bay", reload: 60, duration: 0,
        armorDamage: 0, shieldDamage: 0, guidance: 99, speed: 0,
        ammoType: SHIP.skiff, graphic: -1, accuracy: 0, impact: 0, explosion: -1,
        proxRadius: 0, blastRadius: 0, flags: WEAP_FLAGS.secondary, exitType: -1,
        turnRate: 0, maxAmmo: 4, durability: 0,
    },
    // --- The combat-rule weapons. None of these is in a düde's hull, so
    // they never fire in an NPC fight: a spec mounts them on purpose.
    {
        // A BEAM TURRET: one frame long, 240 reach, rear-blind.
        id: WEAP.arcTurret, name: "Arc Turret", reload: 15, duration: 1,
        armorDamage: 4, shieldDamage: 4, guidance: GUIDANCE.beamTurret, speed: 0,
        ammoType: -1, graphic: -1, accuracy: 0, impact: 0, explosion: -1,
        proxRadius: 0, blastRadius: 0,
        flags: WEAP_FLAGS.missesFiringShip | WEAP_FLAGS.blindRear,
        beam: { length: 240, width: 2, falloff: 4, color: 0x00ff80c0, coronaColor: 0x00ffc0e0 },
        exitType: 1, turnRate: 0, maxAmmo: -1, durability: 0,
    },
    {
        // A beam with NO reload and a one-frame life, fired with a 5
        // degree inaccuracy: thirty shots a second, each aimed once.
        id: WEAP.needleBeam, name: "Needle Beam", reload: 0, duration: 1,
        armorDamage: 1, shieldDamage: 1, guidance: GUIDANCE.beam, speed: 0,
        ammoType: -1, graphic: -1, accuracy: 5, impact: 0, explosion: -1,
        proxRadius: 0, blastRadius: 0, flags: WEAP_FLAGS.missesFiringShip,
        beam: { length: 200, width: 1, falloff: 2, color: 0x00c0ffc0, coronaColor: 0x00e0ffe0 },
        exitType: 3, turnRate: 0, maxAmmo: -1, durability: 0,
    },
    {
        // A beam alive for fifteen frames with no corona falloff.
        id: WEAP.wideLance, name: "Wide Lance", reload: 30, duration: 15,
        armorDamage: 2, shieldDamage: 3, guidance: GUIDANCE.beam, speed: 0,
        ammoType: -1, graphic: -1, accuracy: 0, impact: 0, explosion: -1,
        proxRadius: 0, blastRadius: 0, flags: WEAP_FLAGS.missesFiringShip,
        beam: { length: 200, width: 6, falloff: 0, color: 0x00ffe080, coronaColor: 0x00fff0c0 },
        exitType: 3, turnRate: 0, maxAmmo: -1, durability: 0,
    },
    {
        // A front-quadrant gun.
        id: WEAP.bowChaser, name: "Bow Chaser", reload: 18, duration: 30,
        armorDamage: 5, shieldDamage: 6, guidance: GUIDANCE.frontQuadrant, speed: 1000,
        ammoType: -1, graphic: 0, accuracy: 2, impact: 4, explosion: 0,
        proxRadius: 0, blastRadius: 0, flags: WEAP_FLAGS.missesFiringShip, exitType: 0,
        turnRate: 0, maxAmmo: -1, durability: 0,
    },
    {
        // A turret blind to its rear.
        id: WEAP.flankTurret, name: "Flank Turret", reload: 20, duration: 35,
        armorDamage: 5, shieldDamage: 5, guidance: GUIDANCE.turret, speed: 1000,
        ammoType: -1, graphic: 0, accuracy: 2, impact: 4, explosion: 0,
        proxRadius: 0, blastRadius: 0,
        flags: WEAP_FLAGS.missesFiringShip | WEAP_FLAGS.blindRear, exitType: 1,
        turnRate: 0, maxAmmo: -1, durability: 0,
    },
    {
        // A turret blind to its sides and rear.
        id: WEAP.narrowTurret, name: "Narrow Turret", reload: 20, duration: 35,
        armorDamage: 5, shieldDamage: 5, guidance: GUIDANCE.turret, speed: 1000,
        ammoType: -1, graphic: 0, accuracy: 2, impact: 4, explosion: 0,
        proxRadius: 0, blastRadius: 0,
        flags: WEAP_FLAGS.missesFiringShip | WEAP_FLAGS.blindSides | WEAP_FLAGS.blindRear,
        exitType: 1, turnRate: 0, maxAmmo: -1, durability: 0,
    },
    {
        // A FIXED gun that sets the blind-spot bits, which mean nothing
        // on a fixed mount.
        id: WEAP.stubGun, name: "Stub Gun", reload: 12, duration: 30,
        armorDamage: 6, shieldDamage: 8, guidance: GUIDANCE.unguided, speed: 1200,
        ammoType: -1, graphic: 0, accuracy: 3, impact: 5, explosion: 0,
        proxRadius: 0, blastRadius: 0,
        flags: WEAP_FLAGS.missesFiringShip | WEAP_FLAGS.blindSides | WEAP_FLAGS.blindRear,
        exitType: 0, turnRate: 0, maxAmmo: -1, durability: 0,
    },
    {
        // A second bay, whose fighter (the Shrike Ghost) is NOT
        // point-defence-vulnerable.
        id: WEAP.ghostBay, name: "Ghost Bay", reload: 60, duration: 0,
        armorDamage: 0, shieldDamage: 0, guidance: GUIDANCE.bay, speed: 0,
        ammoType: SHIP.ghost, graphic: -1, accuracy: 0, impact: 0, explosion: -1,
        proxRadius: 0, blastRadius: 0, flags: WEAP_FLAGS.secondary, exitType: -1,
        turnRate: 0, maxAmmo: 2, durability: 0,
    },
];

export interface OutfDef {
    id: number;
    name: string;
    displayWeight: number;
    mass: number;
    techLevel: number;
    /** ModType/ModVal pairs, the first being the primary function. */
    mods: Array<[modType: number, modVal: number]>;
    max: number;
    flags: number;
    cost: number;
    availableRandom: number;
    lcName: string;
    lcPlural: string;
    desc: string;
    /** Require bits (the Contribute/Require 64-bit sets); 0n unless gated. */
    require?: bigint;
    contribute?: bigint;
    /** Availability NCB test; "" for always. */
    availability?: string;
    /** OnPurchase NCB set string; "" for none. */
    onPurchase?: string;
}

/** oütf Flags bits this scenario uses. */
export const OUTF_FLAGS = {
    fixedGun: 0x0001, turret: 0x0002, persistent: 0x0004, cantSell: 0x0008,
    removeAfterPurchase: 0x0010, hideUnlessRequirementsMet: 0x0100,
} as const;
/** ModTypes (EVN Bible) this scenario uses. */
export const MOD = {
    weapon: 1, freeCargo: 2, ammunition: 3, shield: 4, energy: 12, cloak: 17,
    irJamming: 33, radarJamming: 34,
} as const;
/**
 * The cloak's ModVal bitfield (novadatainterface/cloak_data): fuel 2/s
 * (0x0020), hides from radar (0x0002 clear), drops shields (0x0004).
 */
export const CLOAK_MODVAL = 0x0020 | 0x0004;
/**
 * The Veil's ModVal: VISIBLE on radar (0x0002 set), 4 shield/s (0x0400),
 * deactivates when the ship takes damage (0x0008).
 */
export const VEIL_MODVAL = 0x0002 | 0x0008 | 0x0400;

export const OUTFS: OutfDef[] = [
    {
        id: OUTF.blaster, name: "Pulse Blaster", displayWeight: 90, mass: 5,
        techLevel: 1, mods: [[MOD.weapon, WEAP.blaster]], max: 4,
        flags: OUTF_FLAGS.fixedGun, cost: 3000, availableRandom: 100,
        lcName: "pulse blaster", lcPlural: "pulse blasters",
        desc: "A fixed forward gun. Cheap, short-ranged and everywhere.",
    },
    {
        id: OUTF.launcher, name: "Harrier Launcher", displayWeight: 80, mass: 12,
        techLevel: 3, mods: [[MOD.weapon, WEAP.missile]], max: 2, flags: 0,
        cost: 12000, availableRandom: 100,
        lcName: "harrier launcher", lcPlural: "harrier launchers",
        desc: "Fires Harrier missiles, sold separately.",
    },
    {
        id: OUTF.missileAmmo, name: "Harrier Missile", displayWeight: 79, mass: 1,
        techLevel: 3, mods: [[MOD.ammunition, WEAP.missile]], max: 20, flags: 0,
        cost: 400, availableRandom: 100,
        lcName: "harrier missile", lcPlural: "harrier missiles",
        desc: "One seeking missile for a Harrier launcher.",
    },
    {
        id: OUTF.beam, name: "Lance Beam", displayWeight: 70, mass: 14,
        techLevel: 4, mods: [[MOD.weapon, WEAP.beam]], max: 2,
        flags: OUTF_FLAGS.fixedGun, cost: 25000, availableRandom: 100,
        lcName: "lance beam", lcPlural: "lance beams",
        desc: "A fixed beam that burns whatever sits in front of it.",
    },
    {
        id: OUTF.turret, name: "Sentry Turret", displayWeight: 60, mass: 18,
        techLevel: 4, mods: [[MOD.weapon, WEAP.turret]], max: 2,
        flags: OUTF_FLAGS.turret, cost: 30000, availableRandom: 100,
        lcName: "sentry turret", lcPlural: "sentry turrets",
        desc: "A rotating mount that tracks its target.",
    },
    {
        id: OUTF.pointDefense, name: "Flak Point Defense", displayWeight: 50, mass: 10,
        techLevel: 5, mods: [[MOD.weapon, WEAP.pointDefense]], max: 1,
        flags: OUTF_FLAGS.turret, cost: 18000, availableRandom: 100,
        lcName: "flak point defense", lcPlural: "flak point defenses",
        desc: "Shoots down incoming missiles and nearby fighters.",
    },
    {
        id: OUTF.cloak, name: "Shadow Cloak", displayWeight: 40, mass: 25,
        techLevel: 7, mods: [[MOD.cloak, CLOAK_MODVAL]], max: 1, flags: 0,
        cost: 150000, availableRandom: 100,
        lcName: "shadow cloak", lcPlural: "shadow cloaks",
        desc: "Bends light and radar around the hull while it drinks fuel.",
    },
    {
        id: OUTF.shieldCapacitor, name: "Shield Capacitor", displayWeight: 30, mass: 8,
        techLevel: 2, mods: [[MOD.shield, 50]], max: 3, flags: 0,
        cost: 8000, availableRandom: 100,
        lcName: "shield capacitor", lcPlural: "shield capacitors",
        desc: "Fifty more points of shielding.",
    },
    {
        id: OUTF.cargoPod, name: "Cargo Pod", displayWeight: 20, mass: 5,
        techLevel: 1, mods: [[MOD.freeCargo, 10]], max: 5, flags: 0,
        cost: 2000, availableRandom: 100,
        lcName: "cargo pod", lcPlural: "cargo pods",
        desc: "Ten tons of hold bolted to the hull.",
    },
    {
        id: OUTF.fuelTank, name: "Fuel Tank", displayWeight: 10, mass: 6,
        techLevel: 1, mods: [[MOD.energy, 100]], max: 4, flags: 0,
        cost: 3000, availableRandom: 100,
        lcName: "fuel tank", lcPlural: "fuel tanks",
        desc: "One more jump's worth of fuel.",
    },
    {
        id: OUTF.skiffBay, name: "Skiff Bay", displayWeight: 45, mass: 40,
        techLevel: 5, mods: [[MOD.weapon, WEAP.skiffBay]], max: 1, flags: 0,
        cost: 60000, availableRandom: 100,
        lcName: "skiff bay", lcPlural: "skiff bays",
        desc: "A hangar for launching and recovering Wren skiffs.",
    },
    {
        id: OUTF.skiffFighter, name: "Wren Skiff (fighter)", displayWeight: 44, mass: 30,
        techLevel: 5, mods: [[MOD.ammunition, WEAP.skiffBay]], max: 4, flags: 0,
        cost: 15000, availableRandom: 100,
        lcName: "skiff", lcPlural: "skiffs",
        desc: "One skiff, crewed and fuelled, for a skiff bay.",
    },
    {
        // The second cloak: visible on radar, drains shields, drops when hit.
        id: OUTF.veil, name: "Shrike Veil", displayWeight: 39, mass: 20,
        techLevel: 6, mods: [[MOD.cloak, VEIL_MODVAL]], max: 1, flags: 0,
        cost: 90000, availableRandom: 100,
        lcName: "shrike veil", lcPlural: "shrike veils",
        desc: "A cheaper cloak that hides the hull but not the transponder, "
            + "burns shield charge, and drops the moment something hits it.",
    },
    {
        id: OUTF.irBaffler, name: "IR Baffler", displayWeight: 35, mass: 3,
        techLevel: 3, mods: [[MOD.irJamming, 20]], max: 1, flags: 0,
        cost: 6000, availableRandom: 100,
        lcName: "IR baffler", lcPlural: "IR bafflers",
        desc: "Twenty points of infrared jamming.",
    },
    {
        id: OUTF.radarBaffler, name: "Radar Baffler", displayWeight: 34, mass: 3,
        techLevel: 3, mods: [[MOD.radarJamming, 15]], max: 1, flags: 0,
        cost: 6000, availableRandom: 100,
        lcName: "radar baffler", lcPlural: "radar bafflers",
        desc: "Fifteen points of radar jamming.",
    },
    {
        id: OUTF.arcTurret, name: "Arc Turret", displayWeight: 59, mass: 16,
        techLevel: 5, mods: [[MOD.weapon, WEAP.arcTurret]], max: 2,
        flags: OUTF_FLAGS.turret, cost: 40000, availableRandom: 100,
        lcName: "arc turret", lcPlural: "arc turrets",
        desc: "A beam on a rotating mount. It cannot see behind itself.",
    },
    {
        id: OUTF.needleBeam, name: "Needle Beam", displayWeight: 69, mass: 8,
        techLevel: 4, mods: [[MOD.weapon, WEAP.needleBeam]], max: 2,
        flags: OUTF_FLAGS.fixedGun, cost: 20000, availableRandom: 100,
        lcName: "needle beam", lcPlural: "needle beams",
        desc: "A hair-thin beam that never stops firing and never aims twice.",
    },
    {
        id: OUTF.wideLance, name: "Wide Lance", displayWeight: 68, mass: 18,
        techLevel: 4, mods: [[MOD.weapon, WEAP.wideLance]], max: 1,
        flags: OUTF_FLAGS.fixedGun, cost: 32000, availableRandom: 100,
        lcName: "wide lance", lcPlural: "wide lances",
        desc: "A broad, slow beam that lingers for half a second.",
    },
    {
        id: OUTF.bowChaser, name: "Bow Chaser", displayWeight: 88, mass: 7,
        techLevel: 2, mods: [[MOD.weapon, WEAP.bowChaser]], max: 2,
        flags: OUTF_FLAGS.fixedGun, cost: 5000, availableRandom: 100,
        lcName: "bow chaser", lcPlural: "bow chasers",
        desc: "A gun that swings across the front quadrant.",
    },
    {
        id: OUTF.flankTurret, name: "Flank Turret", displayWeight: 58, mass: 18,
        techLevel: 4, mods: [[MOD.weapon, WEAP.flankTurret]], max: 2,
        flags: OUTF_FLAGS.turret, cost: 28000, availableRandom: 100,
        lcName: "flank turret", lcPlural: "flank turrets",
        desc: "A turret with a blind spot behind it.",
    },
    {
        id: OUTF.narrowTurret, name: "Narrow Turret", displayWeight: 57, mass: 18,
        techLevel: 4, mods: [[MOD.weapon, WEAP.narrowTurret]], max: 2,
        flags: OUTF_FLAGS.turret, cost: 26000, availableRandom: 100,
        lcName: "narrow turret", lcPlural: "narrow turrets",
        desc: "A turret that only covers the front.",
    },
    {
        id: OUTF.stubGun, name: "Stub Gun", displayWeight: 87, mass: 5,
        techLevel: 1, mods: [[MOD.weapon, WEAP.stubGun]], max: 4,
        flags: OUTF_FLAGS.fixedGun, cost: 2500, availableRandom: 100,
        lcName: "stub gun", lcPlural: "stub guns",
        desc: "A fixed gun with a nonsense blind-spot setting.",
    },
    {
        id: OUTF.ghostBay, name: "Ghost Bay", displayWeight: 43, mass: 50,
        techLevel: 6, mods: [[MOD.weapon, WEAP.ghostBay]], max: 1, flags: 0,
        cost: 80000, availableRandom: 100,
        lcName: "ghost bay", lcPlural: "ghost bays",
        desc: "A hangar for two Shrike Ghosts.",
    },
    {
        id: OUTF.ghostFighter, name: "Shrike Ghost (fighter)", displayWeight: 42, mass: 40,
        techLevel: 6, mods: [[MOD.ammunition, WEAP.ghostBay]], max: 2, flags: 0,
        cost: 60000, availableRandom: 100,
        lcName: "ghost", lcPlural: "ghosts",
        desc: "One Shrike Ghost for a ghost bay.",
    },
    {
        // Gated by a Require bit (hidden until the pilot Contributes it),
        // and Contributes one of its own.
        id: OUTF.warrantSeal, name: "Warrant Seal", displayWeight: 5, mass: 0,
        techLevel: 1, mods: [[MOD.shield, 5]], max: 1,
        flags: OUTF_FLAGS.hideUnlessRequirementsMet, cost: 1000, availableRandom: 100,
        lcName: "warrant seal", lcPlural: "warrant seals",
        desc: "A Concord seal, issued to warrant officers only.",
        require: 1n << BigInt(BITS.warrantHolder), contribute: 1n << 4n,
    },
    {
        // A persistent, unsellable, massless, free item that follows the
        // pilot from hull to hull.
        id: OUTF.charter, name: "Courier Charter", displayWeight: 4, mass: 0,
        techLevel: 1, mods: [[MOD.freeCargo, 0]], max: 1,
        flags: OUTF_FLAGS.persistent | OUTF_FLAGS.cantSell, cost: 0, availableRandom: 100,
        lcName: "courier charter", lcPlural: "courier charters",
        desc: "The licence every Amberline courier carries. It cannot be sold.",
    },
    {
        // A persistent item with a price.
        id: OUTF.bondedCharter, name: "Bonded Charter", displayWeight: 3, mass: 0,
        techLevel: 1, mods: [[MOD.freeCargo, 0]], max: 1,
        flags: OUTF_FLAGS.persistent, cost: 5000, availableRandom: 100,
        lcName: "bonded charter", lcPlural: "bonded charters",
        desc: "A bonded courier licence: it moves with you, and it costs.",
    },
    {
        // A purchase that swaps the hull (OnPurchase Hxxx) and removes
        // itself.
        id: OUTF.wardenRefit, name: "Warden Refit", displayWeight: 2, mass: 0,
        techLevel: 5, mods: [[MOD.freeCargo, 0]], max: 1,
        flags: OUTF_FLAGS.removeAfterPurchase, cost: 50000, availableRandom: 100,
        lcName: "warden refit", lcPlural: "warden refits",
        desc: "The yard takes your hull and hands you a Heron Warden.",
        onPurchase: `H${SHIP.warden}`,
    },
    {
        // Never stocked (BuyRandom 0) and self-removing.
        id: OUTF.dockVoucher, name: "Dock Voucher", displayWeight: 1, mass: 0,
        techLevel: 1, mods: [[MOD.freeCargo, 0]], max: 1,
        flags: OUTF_FLAGS.removeAfterPurchase, cost: 100, availableRandom: 0,
        lcName: "dock voucher", lcPlural: "dock vouchers",
        desc: "A voucher no outfitter ever has in stock.",
    },
];

// ---------------------------------------------------------------------
// Ships and their animations
// ---------------------------------------------------------------------

export interface ShipDef {
    id: number;
    name: string;
    shortName: string;
    commName: string;
    longName: string;
    subtitle: string;
    cargoSpace: number;
    shield: number;
    acceleration: number;
    speed: number;
    turnRate: number;
    energy: number;
    freeSpace: number;
    armor: number;
    shieldRecharge: number;
    weapons: Array<{ id: number, count: number, ammo: number }>;
    maxGuns: number;
    maxTurrets: number;
    techLevel: number;
    cost: number;
    deathDelay: number;
    armorRecharge: number;
    /** bööm index or -1. */
    initialExplosion: number;
    finalExplosion: number;
    displayOrder: number;
    mass: number;
    length: number;
    inherentAI: number;
    crew: number;
    strength: number;
    inherentGovt: number;
    flags: number;
    outfits: Array<{ id: number, count: number }>;
    energyRecharge: number;
    skillVariation: number;
    flags2: number;
    deionize: number;
    ionization: number;
    buyRandom: number;
    hireRandom: number;
    escortType: number;
    desc: string;
    pilotDesc: string;
    /** The dësc Graphic: the shipyard "more info" PICT, or -1. */
    infoPict: number;
    animation: ShanDef;
    /** AppearOn NCB test (a düde class that only spawns when true); "" always. */
    appearOn?: string;
}

export interface ShanDef {
    baseImage: number;
    glowImage: number;
    /** The sprite's square frame size in pixels. */
    size: number;
    framesPer: number;
    /** Exit points per weapon type: [x, y] pairs, up to four each. */
    gun: Array<[number, number]>;
    turret: Array<[number, number]>;
    guided: Array<[number, number]>;
    beam: Array<[number, number]>;
}

/** shïp Flags / Flags2 bits this scenario uses. */
export const SHIP_FLAGS = {
    playerFuelRegen: 0x0008,
    /** Disabled at 10% armour instead of the usual third. */
    disablesAtTenPercent: 0x0010,
    /** The hull's own turret blind spot, behind it. */
    blindRear: 0x4000,
} as const;
export const SHIP_FLAGS2 = { vulnerableToPointDefense: 0x0008 } as const;

export const SHIPS: ShipDef[] = [
    {
        id: SHIP.skiff, name: "Wren Skiff", shortName: "Skiff", commName: "Skiff",
        longName: "Wren-class skiff", subtitle: "Light courier",
        cargoSpace: 20, shield: 40, acceleration: 400, speed: 300, turnRate: 60,
        energy: 400, freeSpace: 20, armor: 25, shieldRecharge: 20,
        weapons: [{ id: WEAP.blaster, count: 1, ammo: 0 }],
        maxGuns: 2, maxTurrets: 0, techLevel: 1, cost: 20000, deathDelay: 20,
        armorRecharge: 0, initialExplosion: -1, finalExplosion: 0,
        displayOrder: 1, mass: 30, length: 20, inherentAI: 1, crew: 2,
        strength: 8, inherentGovt: -1, flags: SHIP_FLAGS.playerFuelRegen,
        outfits: [{ id: OUTF.cargoPod, count: 1 }],
        energyRecharge: 0, skillVariation: 20,
        flags2: SHIP_FLAGS2.vulnerableToPointDefense,
        deionize: 100, ionization: 100, buyRandom: 100, hireRandom: 100,
        escortType: -1,
        desc: "The Wren is the skiff every courier starts in: two seats, a "
            + "single blaster and a hold big enough for the mail.",
        pilotDesc: "A courier looking for steadier work than the mail run.",
        infoPict: PICT.shipInfo,
        animation: {
            baseImage: RLED.skiff, glowImage: -1, size: 24, framesPer: 36,
            gun: [[-4, -6], [4, -6]], turret: [[0, 0]], guided: [[0, 2]],
            beam: [[0, -8]],
        },
    },
    {
        id: SHIP.corsair, name: "Gannet Corsair", shortName: "Corsair",
        commName: "Corsair", longName: "Gannet-class corsair", subtitle: "Raider",
        cargoSpace: 15, shield: 150, acceleration: 500, speed: 360, turnRate: 80,
        energy: 500, freeSpace: 60, armor: 90, shieldRecharge: 30,
        weapons: [{ id: WEAP.blaster, count: 2, ammo: 0 },
            { id: WEAP.missile, count: 1, ammo: 8 }],
        maxGuns: 3, maxTurrets: 1, techLevel: 3, cost: 90000, deathDelay: 35,
        armorRecharge: 0, initialExplosion: -1, finalExplosion: 0,
        displayOrder: 2, mass: 90, length: 35, inherentAI: 3, crew: 6,
        strength: 40, inherentGovt: GOVT.raiders, flags: 0,
        outfits: [{ id: OUTF.shieldCapacitor, count: 1 }],
        energyRecharge: 0, skillVariation: 25,
        flags2: SHIP_FLAGS2.vulnerableToPointDefense,
        deionize: 100, ionization: 120, buyRandom: 100, hireRandom: 100,
        escortType: -1,
        desc: "A fast raider hull with twin blasters and a missile rack; "
            + "the Verge builds them out of whatever it catches.",
        pilotDesc: "A former raider who says the Verge got too crowded.",
        infoPict: -1,
        animation: {
            baseImage: RLED.corsair, glowImage: RLED.corsairGlow, size: 32,
            framesPer: 36,
            gun: [[-7, -4], [7, -4]], turret: [[0, 0]], guided: [[0, 6]],
            beam: [[0, -10]],
        },
    },
    {
        id: SHIP.warden, name: "Heron Warden", shortName: "Warden", commName: "Warden",
        longName: "Heron-class warden", subtitle: "Patrol cruiser",
        cargoSpace: 60, shield: 500, acceleration: 250, speed: 240, turnRate: 30,
        energy: 900, freeSpace: 250, armor: 300, shieldRecharge: 40,
        weapons: [{ id: WEAP.beam, count: 1, ammo: 0 },
            { id: WEAP.turret, count: 1, ammo: 0 },
            { id: WEAP.pointDefense, count: 1, ammo: 0 },
            { id: WEAP.skiffBay, count: 1, ammo: 2 }],
        maxGuns: 2, maxTurrets: 3, techLevel: 5, cost: 350000, deathDelay: 70,
        armorRecharge: 5, initialExplosion: 0, finalExplosion: 0,
        displayOrder: 3, mass: 400, length: 70, inherentAI: 3, crew: 30,
        strength: 120, inherentGovt: GOVT.meridian, flags: 0,
        outfits: [{ id: OUTF.shieldCapacitor, count: 2 }, { id: OUTF.fuelTank, count: 1 }],
        energyRecharge: 60, skillVariation: 10, flags2: 0,
        deionize: 100, ionization: 200, buyRandom: 100, hireRandom: 50,
        escortType: -1,
        desc: "The Concord's patrol cruiser: a beam, a turret, flak for "
            + "missiles and a bay for two skiffs. Slow, and built to stay.",
        pilotDesc: "A retired patrol captain with a cruiser and a pension.",
        infoPict: -1,
        animation: {
            baseImage: RLED.warden, glowImage: -1, size: 40, framesPer: 36,
            gun: [[-10, -8], [10, -8]], turret: [[0, -4], [0, 6]],
            guided: [[0, 0]], beam: [[0, -14]],
        },
    },
    // --- Hulls in no system's traffic (no düde a sÿst lists carries
    // them), so an NPC population never changes because they exist. A
    // spec spawns them itself. Their sprites are shared with the three
    // hulls above (a shän may name any rlëD).
    {
        // The cloaked, jammed raider hull: the Veil (shield-draining,
        // decloaks when hit, radar-visible) and both bafflers in its stock
        // loadout; disabled at 10% armour; NOT point-defence-vulnerable,
        // and the Ghost Bay's fighter.
        id: SHIP.ghost, name: "Shrike Ghost", shortName: "Ghost", commName: "Ghost",
        longName: "Shrike-class ghost", subtitle: "Cloaked raider",
        cargoSpace: 10, shield: 120, acceleration: 550, speed: 380, turnRate: 90,
        energy: 500, freeSpace: 40, armor: 80, shieldRecharge: 30,
        weapons: [{ id: WEAP.blaster, count: 2, ammo: 0 }],
        maxGuns: 2, maxTurrets: 0, techLevel: 6, cost: 120000, deathDelay: 30,
        armorRecharge: 0, initialExplosion: -1, finalExplosion: 0,
        displayOrder: 4, mass: 80, length: 30, inherentAI: 3, crew: 4,
        strength: 45, inherentGovt: GOVT.raiders,
        flags: SHIP_FLAGS.disablesAtTenPercent,
        outfits: [{ id: OUTF.veil, count: 1 }, { id: OUTF.irBaffler, count: 1 },
            { id: OUTF.radarBaffler, count: 1 }],
        energyRecharge: 0, skillVariation: 20, flags2: 0,
        deionize: 100, ionization: 120, buyRandom: 100, hireRandom: 60,
        escortType: -1,
        desc: "A raider hull built around a cheap cloak and a pair of "
            + "bafflers. Hard to see, easy to break.",
        pilotDesc: "A raider who claims the Ghost was a gift.",
        infoPict: -1,
        // A story variant: only spawns once the gate survey is accepted.
        appearOn: `b${BITS.surveyAccepted}`,
        animation: {
            baseImage: RLED.corsair, glowImage: -1, size: 32, framesPer: 36,
            gun: [[-7, -4], [7, -4]], turret: [[0, 0]], guided: [[0, 6]],
            beam: [[0, -10]],
        },
    },
    {
        // A ten-thousand-ton armoured hauler: the heaviest possible
        // explosion, a rear-blind hull, a brave (AI 2) freighter with a big
        // hold.
        id: SHIP.hulk, name: "Bastion Hulk", shortName: "Hulk", commName: "Hulk",
        longName: "Bastion-class hulk", subtitle: "Armoured hauler",
        cargoSpace: 250, shield: 2000, acceleration: 60, speed: 80, turnRate: 8,
        energy: 1200, freeSpace: 400, armor: 3000, shieldRecharge: 20,
        weapons: [{ id: WEAP.turret, count: 1, ammo: 0 }],
        maxGuns: 0, maxTurrets: 2, techLevel: 6, cost: 1500000, deathDelay: 150,
        armorRecharge: 0, initialExplosion: 0, finalExplosion: 0,
        displayOrder: 5, mass: 10000, length: 200, inherentAI: 2, crew: 80,
        strength: 400, inherentGovt: GOVT.compact, flags: SHIP_FLAGS.blindRear,
        outfits: [],
        energyRecharge: 100, skillVariation: 5, flags2: 0,
        deionize: 100, ionization: 400, buyRandom: 100, hireRandom: 20,
        escortType: -1,
        desc: "Ten thousand tons of plate and hold. It cannot see behind "
            + "itself and does not care.",
        pilotDesc: "A Compact hauler captain with a very slow ship.",
        infoPict: -1,
        // The other story variant: gone once the survey is accepted.
        appearOn: `!b${BITS.surveyAccepted}`,
        animation: {
            baseImage: RLED.warden, glowImage: -1, size: 40, framesPer: 36,
            gun: [[0, 0]], turret: [[0, -4], [0, 6]], guided: [[0, 0]],
            beam: [[0, -14]],
        },
    },
    {
        // A ten-ton drone: the lightest hull.
        id: SHIP.mote, name: "Mote Drone", shortName: "Mote", commName: "Mote",
        longName: "Mote-class drone", subtitle: "Survey drone",
        cargoSpace: 5, shield: 5, acceleration: 600, speed: 400, turnRate: 120,
        energy: 100, freeSpace: 5, armor: 5, shieldRecharge: 10,
        weapons: [{ id: WEAP.blaster, count: 1, ammo: 0 }],
        maxGuns: 1, maxTurrets: 0, techLevel: 1, cost: 5000, deathDelay: 10,
        armorRecharge: 0, initialExplosion: -1, finalExplosion: 0,
        displayOrder: 6, mass: 10, length: 6, inherentAI: 1, crew: 1,
        strength: 2, inherentGovt: -1, flags: 0,
        outfits: [],
        energyRecharge: 0, skillVariation: 10,
        flags2: SHIP_FLAGS2.vulnerableToPointDefense,
        deionize: 100, ionization: 40, buyRandom: 100, hireRandom: 100,
        escortType: -1,
        desc: "A survey drone with a seat bolted on.",
        pilotDesc: "A surveyor who never wanted a bigger ship.",
        infoPict: -1,
        animation: {
            baseImage: RLED.skiff, glowImage: -1, size: 24, framesPer: 36,
            gun: [[0, -6]], turret: [[0, 0]], guided: [[0, 2]], beam: [[0, -8]],
        },
    },
];

// ---------------------------------------------------------------------
// NPC tables, missions, ranks, the pilot
// ---------------------------------------------------------------------

export interface DudeDef {
    id: number;
    name: string;
    aiType: number;
    govt: number;
    flags: number;
    ships: Array<{ id: number, probability: number }>;
}

export const DUDES: DudeDef[] = [
    {
        id: DUDE.traders, name: "Meridian Traders", aiType: 1, govt: GOVT.meridian,
        flags: 0x0001 | 0x0040, ships: [{ id: SHIP.skiff, probability: 100 }],
    },
    {
        id: DUDE.patrol, name: "Meridian Patrol", aiType: 3, govt: GOVT.meridian,
        flags: 0, ships: [{ id: SHIP.warden, probability: 100 }],
    },
    {
        id: DUDE.raiders, name: "Verge Raiders", aiType: 3, govt: GOVT.raiders,
        flags: 0x0040, ships: [{ id: SHIP.corsair, probability: 100 }],
    },
    // Two tables no sÿst lists: for the AppearOn (story-variant) rules.
    {
        // Mixes an AppearOn-gated class, its complement, and an ungated one.
        id: DUDE.variants, name: "Story Variants", aiType: 1, govt: GOVT.compact,
        flags: 0, ships: [{ id: SHIP.ghost, probability: 30 },
            { id: SHIP.hulk, probability: 30 }, { id: SHIP.mote, probability: 40 }],
    },
    {
        // Every class gated: with no bits set, only the Hulk survives.
        id: DUDE.gatedOnly, name: "Gated Only", aiType: 3, govt: GOVT.raiders,
        flags: 0, ships: [{ id: SHIP.ghost, probability: 50 },
            { id: SHIP.hulk, probability: 50 }],
    },
];

export interface FletDef {
    id: number;
    name: string;
    leadShip: number;
    escorts: Array<{ id: number, min: number, max: number }>;
    govt: number;
    linkSyst: number;
}

export const FLETS: FletDef[] = [
    {
        id: FLET.raiderWing, name: "Raider Wing", leadShip: SHIP.corsair,
        escorts: [{ id: SHIP.corsair, min: 1, max: 2 }], govt: GOVT.raiders,
        linkSyst: -1,
    },
];

export interface MisnDef {
    id: number;
    name: string;
    availStel: number;
    availLoc: number;
    availRecord: number;
    availRating: number;
    availRandom: number;
    travelStel: number;
    returnStel: number;
    cargoType: number;
    cargoQty: number;
    pickupMode: number;
    dropoffMode: number;
    payVal: number;
    shipCount: number;
    shipSyst: number;
    shipDude: number;
    shipGoal: number;
    shipBehav: number;
    shipStart: number;
    compGovt: number;
    compReward: number;
    timeLimit: number;
    canAbort: number;
    flags: number;
    /** mïsn Flags2; 0 unless set. */
    flags2?: number;
    availBits: string;
    onAccept: string;
    /** OnRefuse set string; "" unless set. */
    onRefuse?: string;
    onSuccess: string;
    onFailure: string;
    onAbort: string;
    dispWeight: number;
    /** The offer text (dësc 4000 + n) and the briefing dëscs. */
    offerText: string;
    briefText: string;
    compText: string;
    quickBrief: string;
}

/** mïsn Flags / Flags2 bits this scenario uses (EVN Bible). */
export const MISN_FLAGS = {
    autoAbortOnBoard: 0x0001, takesFuelOnAutoAbort: 0x0008, invisible: 0x0400,
} as const;
export const MISN_FLAGS2 = { paysOnAutoAbort: 0x0002 } as const;
/**
 * mïsn AvailLoc values: where the offer is made (EVN Bible: 0 mission
 * computer, 1 bar, 2 from a ship, 3 main spaceport dialog, 4 the TRADING
 * dialog, 5 the shipyard, 6 the OUTFIT dialog).
 */
export const AVAIL_LOC = {
    missionComputer: 0, bar: 1, fromShip: 2, tradeCenter: 4, shipyard: 5, outfitter: 6,
} as const;

/** dësc ids for the mission briefings, from 5000 in threes. */
export const missionBriefDesc = (mission: number) => 5000 + 3 * (mission - 128);

export const MISNS: MisnDef[] = [
    {
        id: MISN.courier, name: "Amberline Courier Run",
        availStel: SPOB.port, availLoc: 0, availRecord: 0, availRating: -1,
        availRandom: 100, travelStel: SPOB.moon, returnStel: -4,
        cargoType: 0, cargoQty: 10, pickupMode: 0, dropoffMode: 0,
        payVal: 5000, shipCount: -1, shipSyst: -1, shipDude: -1, shipGoal: -1,
        shipBehav: -1, shipStart: 0, compGovt: GOVT.meridian, compReward: 2,
        timeLimit: 30, canAbort: 1, flags: 0,
        availBits: `!b${BITS.courierAccepted} & !b${BITS.courierDone}`,
        onAccept: `b${BITS.courierAccepted}`,
        onSuccess: `b${BITS.courierDone} !b${BITS.courierAccepted}`,
        onFailure: `!b${BITS.courierAccepted}`,
        onAbort: `!b${BITS.courierAccepted}`,
        dispWeight: 5,
        offerText: "Survey rations for the Sallow Moon camp. Ten tons, "
            + "thirty days, and the Concord pays on your return.",
        briefText: "Take ten tons of rations to the Sallow Moon and come "
            + "back to Port Amberline for your 5,000 credits.",
        compText: "The camp foreman signs for the rations. Amberline pays up.",
        quickBrief: "Deliver rations to the Sallow Moon, then return to Port Amberline.",
    },
    {
        id: MISN.gateSurvey, name: "Gate Survey",
        availStel: -1, availLoc: 1, availRecord: 0, availRating: -1,
        availRandom: 100, travelStel: SPOB.kestrelGate, returnStel: -4,
        cargoType: -1, cargoQty: -1, pickupMode: -1, dropoffMode: -1,
        payVal: 8000, shipCount: -1, shipSyst: -1, shipDude: -1, shipGoal: -1,
        shipBehav: -1, shipStart: 0, compGovt: -1, compReward: 0,
        timeLimit: -1, canAbort: 1, flags: 0,
        availBits: `!b${BITS.surveyAccepted}`,
        onAccept: `b${BITS.surveyAccepted}`,
        onSuccess: `!b${BITS.surveyAccepted}`,
        onFailure: `!b${BITS.surveyAccepted}`,
        onAbort: `!b${BITS.surveyAccepted}`,
        dispWeight: 3,
        offerText: "A surveyor in the bar wants readings from the Kestrel "
            + "Gate. Land on the ring, then come back.",
        briefText: "Fly to Kestrel Gate, land, and return here.",
        compText: "The surveyor pores over your readings and pays.",
        quickBrief: "Land on Kestrel Gate, then return.",
    },
    {
        id: MISN.bounty, name: "Bounty: Raider Wing",
        availStel: 10000 + (GOVT.meridian - 128), availLoc: 0, availRecord: 0,
        availRating: 0, availRandom: 100, travelStel: -1, returnStel: -4,
        cargoType: -1, cargoQty: -1, pickupMode: -1, dropoffMode: -1,
        payVal: 15000, shipCount: 2, shipSyst: SYST.kestrel, shipDude: DUDE.raiders,
        shipGoal: 0, shipBehav: 0, shipStart: 0, compGovt: GOVT.meridian,
        compReward: 5, timeLimit: -1, canAbort: 1, flags: 0,
        availBits: "", onAccept: "", onSuccess: "", onFailure: "", onAbort: "",
        dispWeight: 1,
        offerText: "The Concord will pay 15,000 credits for two Verge corsairs "
            + "destroyed in Kestrel Drift.",
        briefText: "Destroy two raider corsairs in Kestrel Drift and return.",
        compText: "The bounty clerk counts out your credits.",
        quickBrief: "Destroy two raider corsairs in Kestrel Drift.",
    },
    {
        // Offered from a SHIP (the stranded courier përs hails you): a
        // rescue goal (ShipGoal 5) whose special ship replaces the përs,
        // invisible in the mission list, auto-aborting when boarded, then
        // paying 2,000 and taking 100 fuel.
        id: MISN.rescue, name: "Stranded Courier",
        availStel: -1, availLoc: AVAIL_LOC.fromShip, availRecord: 0, availRating: -1,
        availRandom: 100, travelStel: -1, returnStel: -1,
        cargoType: -1, cargoQty: -1, pickupMode: -1, dropoffMode: -1,
        payVal: 2000, shipCount: 1, shipSyst: -6, shipDude: DUDE.traders, shipGoal: 5,
        shipBehav: -1, shipStart: 0, compGovt: -1, compReward: 0,
        timeLimit: -1, canAbort: 1,
        flags: MISN_FLAGS.autoAbortOnBoard | MISN_FLAGS.takesFuelOnAutoAbort
            | MISN_FLAGS.invisible,
        flags2: MISN_FLAGS2.paysOnAutoAbort,
        availBits: "", onAccept: "", onSuccess: "", onFailure: "", onAbort: "",
        dispWeight: 0,
        offerText: "<OSN>: My tanks are dry. Can you spare a hundred units of fuel?",
        briefText: "", compText: "", quickBrief: "Refuel the stranded skiff.",
    },
    {
        // Offered on BOARDING the drifting wreck përs: bring its log home.
        id: MISN.salvage, name: "Wreck Salvage",
        availStel: -1, availLoc: AVAIL_LOC.fromShip, availRecord: 0, availRating: -1,
        availRandom: 100, travelStel: -1, returnStel: SPOB.port,
        cargoType: -1, cargoQty: -1, pickupMode: -1, dropoffMode: -1,
        payVal: 3000, shipCount: -1, shipSyst: -1, shipDude: -1, shipGoal: -1,
        shipBehav: -1, shipStart: 0, compGovt: GOVT.compact, compReward: 1,
        timeLimit: -1, canAbort: 1, flags: 0,
        availBits: "", onAccept: "", onSuccess: "", onFailure: "", onAbort: "",
        dispWeight: 0,
        offerText: "The wreck's log is intact. The Compact would pay to read it.",
        briefText: "Take the wreck's log back to Port Amberline.",
        compText: "A Compact clerk takes the log and pays.",
        quickBrief: "Return the wreck's log to Port Amberline.",
    },
    // --- The venue jobs: offered from the trade centre, the shipyard and
    // the outfitter of Port Amberline. The first two have NO briefing
    // text (accepting shows the offer popup and nothing more); the trade
    // errand carries cargo and runs set strings on both accept and
    // refuse.
    {
        id: MISN.tradeErrand, name: "Trade Errand",
        availStel: SPOB.port, availLoc: AVAIL_LOC.tradeCenter, availRecord: 0,
        availRating: -1, availRandom: 100, travelStel: SPOB.coldharbour, returnStel: -4,
        cargoType: 5, cargoQty: 20, pickupMode: 0, dropoffMode: 0,
        payVal: 4000, shipCount: -1, shipSyst: -1, shipDude: -1, shipGoal: -1,
        shipBehav: -1, shipStart: 0, compGovt: -1, compReward: 0,
        timeLimit: -1, canAbort: 1, flags: 0,
        availBits: `!b${BITS.errandAccepted} & !b${BITS.errandRefused}`,
        onAccept: `b${BITS.errandAccepted}`, onRefuse: `b${BITS.errandRefused}`,
        onSuccess: `!b${BITS.errandAccepted}`, onFailure: `!b${BITS.errandAccepted}`,
        onAbort: `!b${BITS.errandAccepted}`,
        dispWeight: 2,
        offerText: "A trader on the exchange floor has twenty tons of equipment "
            + "for Coldharbour. Take it and come back.",
        briefText: "", compText: "Coldharbour signs for the equipment.",
        quickBrief: "Deliver equipment to Coldharbour, then return.",
    },
    {
        id: MISN.shipyardErrand, name: "Shipyard Errand",
        availStel: SPOB.port, availLoc: AVAIL_LOC.shipyard, availRecord: 0,
        availRating: -1, availRandom: 100, travelStel: SPOB.moon, returnStel: -4,
        cargoType: -1, cargoQty: -1, pickupMode: -1, dropoffMode: -1,
        payVal: 1500, shipCount: -1, shipSyst: -1, shipDude: -1, shipGoal: -1,
        shipBehav: -1, shipStart: 0, compGovt: -1, compReward: 0,
        timeLimit: 10, canAbort: 1, flags: 0,
        availBits: "", onAccept: "", onSuccess: "", onFailure: "", onAbort: "",
        dispWeight: 1,
        offerText: "The shipwright wants a hull scan from the Sallow Moon's "
            + "surface within ten days.",
        briefText: "", compText: "The shipwright reads the scan and pays.",
        quickBrief: "Scan from the Sallow Moon within ten days, then return.",
    },
    {
        // Gated on a control bit and a combat rating.
        id: MISN.outfitterErrand, name: "Outfitter Errand",
        availStel: SPOB.port, availLoc: AVAIL_LOC.outfitter, availRecord: 0,
        availRating: 10, availRandom: 100, travelStel: SPOB.refuge, returnStel: -4,
        cargoType: 3, cargoQty: 5, pickupMode: 0, dropoffMode: 0,
        payVal: 9000, shipCount: -1, shipSyst: -1, shipDude: -1, shipGoal: -1,
        shipBehav: -1, shipStart: 0, compGovt: GOVT.meridian, compReward: 1,
        timeLimit: -1, canAbort: 1, flags: 0,
        availBits: `b${BITS.outfitterErrandOpen}`, onAccept: "", onSuccess: "",
        onFailure: "", onAbort: "",
        dispWeight: 1,
        offerText: "The outfitter will pay well for five tons of luxuries run "
            + "to Halden Refuge, no questions asked.",
        briefText: "Take five tons of luxuries to Halden Refuge and return.",
        compText: "The outfitter pays, and asks no questions.",
        quickBrief: "Run luxuries to Halden Refuge, then return.",
    },
];

export interface RankDef {
    id: number;
    name: string;
    weight: number;
    affilGovt: number;
    priceMod: number;
    salary: number;
    salaryCap: number;
    flags: number;
    convName: string;
    convShortName: string;
}

/** ränk Flags bits this scenario uses. */
export const RANK_FLAGS = {
    /** Revoked when the pilot attacks the affiliated govt's ships / stellars. */
    lostWhenAttackingGovt: 0x0004, lostWhenAttackingStellars: 0x0040,
    govtShipsWontAttack: 0x0100, canAlwaysLandOnGovtStellars: 0x0200,
} as const;

export const RANKS: RankDef[] = [
    {
        id: RANK.warrant, name: "Meridian Warrant Officer", weight: 10,
        affilGovt: GOVT.meridian, priceMod: 90, salary: 100, salaryCap: 0,
        flags: RANK_FLAGS.canAlwaysLandOnGovtStellars,
        convName: "Warrant Officer", convShortName: "Warrant",
    },
    {
        id: RANK.confidant, name: "Verge Confidant", weight: 5,
        affilGovt: GOVT.raiders, priceMod: 100, salary: 0, salaryCap: 0,
        flags: RANK_FLAGS.govtShipsWontAttack | RANK_FLAGS.canAlwaysLandOnGovtStellars,
        convName: "Confidant of the Verge", convShortName: "Confidant",
    },
    {
        // A revocable "cover": the raiders leave the holder alone until
        // the holder attacks them, then the rank is lost.
        id: RANK.cover, name: "Verge Cover", weight: 1,
        affilGovt: GOVT.raiders, priceMod: 100, salary: 0, salaryCap: 0,
        flags: RANK_FLAGS.lostWhenAttackingGovt | RANK_FLAGS.lostWhenAttackingStellars
            | RANK_FLAGS.govtShipsWontAttack,
        convName: "Under Verge Cover", convShortName: "Cover",
    },
];

export interface CharDef {
    id: number;
    name: string;
    startingCredits: number;
    startingShip: number;
    startingSystems: number[];
    govtStatuses: Array<{ govt: number, status: number }>;
    combatRating: number;
    introDesc: number;
    introText: string;
    date: { day: number, month: number, year: number };
}

export const INTRO_DESC = 6000;

export const CHARS: CharDef[] = [
    {
        id: CHAR.courier, name: "Amberline courier", startingCredits: 25000,
        startingShip: SHIP.skiff, startingSystems: [SYST.thessaly],
        govtStatuses: [{ govt: GOVT.meridian, status: 0 }], combatRating: 0,
        introDesc: INTRO_DESC,
        introText: "You have a skiff, a licence and twenty-five thousand "
            + "credits. Thessaly Reach is waiting.",
        date: { day: 12, month: 3, year: 1101 },
    },
];

// ---------------------------------------------------------------------
// Persons and specialised cargo
// ---------------------------------------------------------------------

export interface PersDef {
    id: number;
    name: string;
    /** LinkSyst: -1 any, a sÿst id, or the govt ranges (10000/20000 + n). */
    linkSystem: number;
    govt: number;
    aiType: number;
    aggression: number;
    cowardice: number;
    ship: number;
    weapons: Array<{ id: number, count: number, ammo: number }>;
    credits: number;
    shieldMod: number;
    /** 1-based indices into STR# 7100 / 7101, or -1. */
    commQuote: number;
    hailQuote: number;
    linkMission: number;
    flags: number;
    activeOn: string;
    grantClass: number;
    grantCount: number;
    grantChance: number;
    subtitle: string;
    color: number;
}

/** përs Flags bits this scenario uses (EVN Bible pp. 47-49). */
export const PERS_FLAGS = {
    keepsGrudge: 0x0001, hailOnlyWhenLikesPlayer: 0x0008,
    replaceWithSpecialShip: 0x0040, hailOnlyOnce: 0x0080,
    deactivateAfterMission: 0x0100, offerMissionOnBoarding: 0x0200,
    leavesAfterMissionAccepted: 0x0800,
} as const;
/** LinkSyst "systems not belonging to govt": 20000 + (govt - 128). */
export const notGovtSystems = (govt: number) => 20000 + (govt - 128);

export const PERSONS: PersDef[] = [
    {
        // Bound to one system; a raider warship that holds a grudge.
        id: PERS.lask, name: "Corva Lask", linkSystem: SYST.kestrel,
        govt: GOVT.raiders, aiType: 3, aggression: 2, cowardice: 20,
        ship: SHIP.corsair, weapons: [{ id: WEAP.missile, count: 1, ammo: 4 }],
        credits: 4000, shieldMod: 130, commQuote: 1, hailQuote: 1,
        linkMission: -1, flags: PERS_FLAGS.keepsGrudge, activeOn: "",
        grantClass: -1, grantCount: 0, grantChance: 0,
        subtitle: "Night-Warden of Halden", color: 0x00c84040,
    },
    {
        // Anywhere at all; a Meridian trader who only hails pilots the
        // Concord likes.
        id: PERS.pell, name: "Old Pell", linkSystem: -1,
        govt: GOVT.meridian, aiType: 1, aggression: 1, cowardice: 60,
        ship: SHIP.skiff, weapons: [], credits: 800, shieldMod: 100,
        commQuote: 2, hailQuote: 2, linkMission: -1,
        flags: PERS_FLAGS.hailOnlyWhenLikesPlayer, activeOn: "",
        grantClass: -1, grantCount: 0, grantChance: 0,
        subtitle: "Mail runner", color: 0,
    },
    {
        // Any system NOT the Concord's; gated on a control bit that is
        // clear in a fresh pilot (so ActiveOn is true).
        id: PERS.vey, name: "Tamsin Vey", linkSystem: notGovtSystems(GOVT.meridian),
        govt: GOVT.raiders, aiType: 3, aggression: 3, cowardice: 10,
        ship: SHIP.corsair, weapons: [], credits: 2500, shieldMod: 100,
        commQuote: 3, hailQuote: 3, linkMission: -1, flags: 0,
        activeOn: `!b${BITS.courierDone}`,
        grantClass: -1, grantCount: 0, grantChance: 0,
        subtitle: "Verge courier", color: 0,
    },
    {
        // The stranded skiff: hails with a rescue offer, and the mission's
        // special ship replaces this one when it is accepted.
        id: PERS.stranded, name: "Stranded Courier", linkSystem: -1,
        govt: -1, aiType: 1, aggression: 1, cowardice: 90,
        ship: SHIP.skiff, weapons: [], credits: 0, shieldMod: 100,
        commQuote: -1, hailQuote: 4, linkMission: MISN.rescue,
        flags: PERS_FLAGS.replaceWithSpecialShip | PERS_FLAGS.deactivateAfterMission,
        activeOn: "", grantClass: -1, grantCount: 0, grantChance: 0,
        subtitle: "Out of fuel", color: 0,
    },
    {
        // A derelict (its govt's ships start disabled): offers its
        // mission when BOARDED, and grants a little on boarding.
        id: PERS.wreck, name: "Hollow Wreck", linkSystem: SYST.ossory,
        govt: GOVT.wrecks, aiType: 1, aggression: 1, cowardice: 0,
        ship: SHIP.warden, weapons: [], credits: 12000, shieldMod: 100,
        commQuote: -1, hailQuote: -1, linkMission: MISN.salvage,
        flags: PERS_FLAGS.offerMissionOnBoarding, activeOn: "",
        grantClass: -1, grantCount: 0, grantChance: 0,
        subtitle: "Adrift", color: 0x00606060,
    },
];

export interface JunkDef {
    id: number;
    name: string;
    soldAt: number[];
    boughtAt: number[];
    basePrice: number;
    flags: number;
    scanMask: number;
    lcName: string;
    abbrev: string;
    buyOn: string;
    sellOn: string;
}

/** jünk Flags bits. */
export const JUNK_FLAGS = { multiplies: 0x0001, decays: 0x0002 } as const;

export const JUNKS: JunkDef[] = [
    {
        // Bought at the port, sold at the raiders' refuge.
        id: JUNK.resin, name: "Amber Resin", soldAt: [SPOB.port], boughtAt: [SPOB.refuge],
        basePrice: 800, flags: 0, scanMask: 0, lcName: "amber resin", abbrev: "Resin",
        buyOn: "", sellOn: "",
    },
    {
        // The other way round, perishable, and only buyable once the gate
        // survey is accepted; contraband to the Concord (scan mask bit 1).
        id: JUNK.alloy, name: "Gate Alloy", soldAt: [SPOB.refuge],
        boughtAt: [SPOB.port, SPOB.coldharbour],
        basePrice: 1200, flags: JUNK_FLAGS.decays, scanMask: 0x0001,
        lcName: "gate alloy", abbrev: "Alloy",
        buyOn: `b${BITS.surveyAccepted}`, sellOn: "",
    },
];

// ---------------------------------------------------------------------
// String tables
// ---------------------------------------------------------------------

/**
 * Builds a string list of `length` entries, `""` except for the indices
 * given: the stock tables are long and the game reads them by position.
 */
export function sparseStrings(length: number,
    entries: { [index: number]: string }): string[] {
    const strings = new Array<string>(length).fill("");
    for (const [index, text] of Object.entries(entries)) {
        strings[Number(index)] = text;
    }
    return strings;
}

export const STANDARD_CARGO = ["Food", "Industrial", "Medical", "Luxury Goods", "Metal", "Equipment"];

export const STRING_TABLES: Array<{ id: number, name: string, strings: string[] }> = [
    {
        id: STRN.captions, name: "Button captions",
        strings: ["Buy", "Sell", "Done", "Hire Escort", "Accept", "Refuse", "Leave"],
    },
    {
        id: STRN.misc, name: "Misc strings",
        // The positions nova's landed UI and hail logic read (their
        // fallbacks cover the rest; see mission_board.ts, hire_escort.ts,
        // outfitter_rules.ts, hail.ts).
        strings: sparseStrings(360, {
            52: "No response.",
            81: "Docking request denied.",
            82: "Landing request denied.",
            95: "You are cleared to dock.",
            98: "You are cleared to land.",
            123: "You already lead as many ships as you can manage.",
            172: "Forbidden",
            173: "Hostile",
            206: "They don't deal in these here.",
            207: "You need to sell",
            208: "unit",
            209: "units",
            210: "of ammunition before selling the",
            211: "launcher.",
            223: "Nobody is looking for work today.",
            352: "The board is empty.",
            358: "Postings",
        }),
    },
    {
        // përs quotes, read 1-based (the Bible's "index number of an entry").
        id: STRN.persCommQuotes, name: "Person comm quotes",
        strings: [
            "You are in Verge water, courier. Turn around.",
            "Pell here. Mail for anywhere, cheap.",
            "Nothing personal. The Verge needs what you carry.",
        ],
    },
    {
        id: STRN.persHailQuotes, name: "Person hail quotes",
        strings: [
            "<OSN>: The Night-Warden sees you.",
            "<OSN>: Fair skies, friend of the Concord.",
            "<OSN>: Heave to.",
            "<OSN>: I need assistance, can you help?",
        ],
    },
    {
        id: STRN.shipComm, name: "Ship comm strings",
        strings: sparseStrings(140, {
            0: "Channel open.", 1: "Go ahead.", 2: "Receiving.", 3: "We hear you.",
            4: "Talk.",
            10: "What do you want?", 11: "Make it quick.", 12: "Speak.",
            13: "What is it?", 14: "Well?",
            45: "Good to meet you.", 46: "Hello there.", 47: "Greetings.",
            48: "Fair skies.", 49: "Hail.",
            70: "You look fine to us.", 71: "Nothing's wrong out there.",
            72: "Nothing wrong with your ship.", 73: "You don't need us.",
            74: "Carry on.",
            75: "We'll lend a hand.", 76: "On our way.", 77: "Hold on.",
            78: "We've got you.", 79: "Coming about.",
            80: "We're busy.", 81: "Not now.", 82: "Later.", 83: "No time.",
            84: "Some other day.",
            135: "Fine. We'll leave you be.", 136: "Keep it.", 137: "Go on, then.",
            138: "Consider yourself lucky.", 139: "Off with you.",
        }),
    },
    {
        id: STRN.stellarComm, name: "Stellar comm strings",
        strings: sparseStrings(50, {
            0: "Channel open to ", 1: "Port control for ", 2: "This is ",
            3: "You have reached ", 4: "Go ahead, ",
            25: "Tribute accepted.", 26: "We yield.",
            30: "Not for sale.", 31: "Leave now.", 32: "No.", 33: "Try elsewhere.",
            34: "Denied.",
            35: "Tribute released.", 36: "You are free of us.",
            40: "We can overlook the paperwork for ", 41: "Slip in for ",
            42: "The gate opens for ", 43: "Docking, for ", 44: "For a fee of ",
        }),
    },
    { id: STRN.cargoNames, name: "Cargo names", strings: STANDARD_CARGO },
    {
        id: STRN.cargoPrices, name: "Cargo prices",
        strings: ["75", "350", "750", "900", "200", "550"],
    },
    ...GOVTS.map(govt => ({
        id: govtGreetings(govt.id), name: `${govt.name} greetings`,
        strings: govt.greetings,
    })),
];
