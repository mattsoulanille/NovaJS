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

export const GOVT = { meridian: 128, raiders: 129 } as const;
export const SYST = { thessaly: 128, kestrel: 129, ossory: 130, vael: 131 } as const;
export const SPOB = {
    port: 128, moon: 129, kestrelGate: 130, vaelGate: 131, refuge: 132,
} as const;
export const SHIP = { skiff: 128, corsair: 129, warden: 130 } as const;
export const WEAP = {
    blaster: 128, missile: 129, beam: 130, turret: 131, pointDefense: 132,
    skiffBay: 133,
} as const;
export const OUTF = {
    blaster: 128, launcher: 129, missileAmmo: 130, beam: 131, turret: 132,
    pointDefense: 133, cloak: 134, shieldCapacitor: 135, cargoPod: 136,
    fuelTank: 137, skiffBay: 138, skiffFighter: 139,
} as const;
export const DUDE = { traders: 128, patrol: 129, raiders: 130 } as const;
export const FLET = { raiderWing: 128 } as const;
export const MISN = { courier: 128, gateSurvey: 129, bounty: 130 } as const;
export const RANK = { warrant: 128, confidant: 129 } as const;
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
} as const;
/** Control bits the missions set; the scenario's own numbering. */
export const BITS = { courierAccepted: 100, courierDone: 101, surveyAccepted: 102 } as const;

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
 * The scenario's global ids, for specs: `SYNTHETIC.systems.thessaly` is
 * the sÿst's "nova:128". Sorted-first ids matter to several fixtures
 * (makeSimulationBridgeHarness, makeDeterminismWorld pick them): those
 * are Thessaly Reach and the Wren Skiff here.
 */
export const SYNTHETIC = {
    prefix: SYNTHETIC_PREFIX,
    govts: { meridian: sid(GOVT.meridian), raiders: sid(GOVT.raiders) },
    systems: {
        thessaly: sid(SYST.thessaly), kestrel: sid(SYST.kestrel),
        ossory: sid(SYST.ossory), vael: sid(SYST.vael),
    },
    planets: {
        port: sid(SPOB.port), moon: sid(SPOB.moon),
        kestrelGate: sid(SPOB.kestrelGate), vaelGate: sid(SPOB.vaelGate),
        refuge: sid(SPOB.refuge),
    },
    ships: { skiff: sid(SHIP.skiff), corsair: sid(SHIP.corsair), warden: sid(SHIP.warden) },
    weapons: {
        blaster: sid(WEAP.blaster), missile: sid(WEAP.missile), beam: sid(WEAP.beam),
        turret: sid(WEAP.turret), pointDefense: sid(WEAP.pointDefense),
        skiffBay: sid(WEAP.skiffBay),
    },
    outfits: Object.fromEntries(Object.entries(OUTF).map(([k, v]) => [k, sid(v)])) as
        { [K in keyof typeof OUTF]: string },
    dudes: { traders: sid(DUDE.traders), patrol: sid(DUDE.patrol), raiders: sid(DUDE.raiders) },
    fleets: { raiderWing: sid(FLET.raiderWing) },
    missions: { courier: sid(MISN.courier), gateSurvey: sid(MISN.gateSurvey), bounty: sid(MISN.bounty) },
    ranks: { warrant: sid(RANK.warrant), confidant: sid(RANK.confidant) },
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
}

/** gövt Flags (EVN Bible): the bits this scenario uses. */
export const GOVT_FLAGS = {
    xenophobic: 0x0001, attacksPlayerIfCriminal: 0x0002,
    alwaysAttacksPlayer: 0x0004, warshipsTakeBribes: 0x0200,
    plundersBeforeDestroying: 0x1000,
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
        id: SYST.thessaly, name: "Thessaly Reach", position: [0, 0],
        links: [SYST.kestrel, SYST.ossory], spobs: [SPOB.port, SPOB.moon],
        dudes: [{ id: DUDE.traders, chance: 70 }, { id: DUDE.patrol, chance: 30 }],
        avgShips: 6, govt: GOVT.meridian, asteroids: 0, asteroidTypes: 0,
        interference: 0, murk: 0, backgroundColor: 0,
    },
    {
        id: SYST.kestrel, name: "Kestrel Drift", position: [200, 50],
        // Vael is declared from this end only: the parser closes the
        // link (system backlinks), and a spec can pin that it does.
        links: [SYST.thessaly, SYST.vael], spobs: [SPOB.kestrelGate],
        dudes: [{ id: DUDE.raiders, chance: 60 }, { id: -FLET.raiderWing, chance: 40 }],
        avgShips: 3, govt: GOVT.raiders, asteroids: 0, asteroidTypes: 0,
        interference: 20, murk: 0, backgroundColor: 0,
    },
    {
        id: SYST.ossory, name: "Ossory Shoal", position: [-150, 120],
        links: [SYST.thessaly], spobs: [SPOB.refuge],
        dudes: [{ id: DUDE.raiders, chance: 50 }, { id: DUDE.traders, chance: 50 }],
        avgShips: 2, govt: -1, asteroids: 4, asteroidTypes: 0x0001,
        interference: 50, murk: 35, backgroundColor: 0x00101820,
    },
    {
        id: SYST.vael, name: "Vael Hollow", position: [350, -80],
        links: [], spobs: [SPOB.vaelGate],
        dudes: [{ id: DUDE.patrol, chance: 100 }],
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
}

/** oütf Flags bits this scenario uses. */
export const OUTF_FLAGS = { fixedGun: 0x0001, turret: 0x0002 } as const;
/** ModTypes (EVN Bible) this scenario uses. */
export const MOD = {
    weapon: 1, freeCargo: 2, ammunition: 3, shield: 4, energy: 12, cloak: 17,
} as const;
/**
 * The cloak's ModVal bitfield (novadatainterface/cloak_data): fuel 2/s
 * (0x0020), hides from radar (0x0002 clear), drops shields (0x0004).
 */
export const CLOAK_MODVAL = 0x0020 | 0x0004;

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
export const SHIP_FLAGS = { playerFuelRegen: 0x0008 } as const;
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
    availBits: string;
    onAccept: string;
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
            223: "Nobody is looking for work today.",
            352: "The board is empty.",
            358: "Postings",
        }),
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
