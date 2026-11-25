/**
 * The novaref TEST KIT plug-in: a sealed test system with known ships,
 * weapons, governments and missions, so scenarios on the original game are
 * deterministic. Build it with
 *
 *   novaref plugin-make scripts/novaref/kits/testkit.mjs
 *
 * Everything uses ids no stock resource uses (plugin-make refuses to
 * override a stock id unless a resource says "override": true). Id ranges
 * are bounded by what a PILOT can reference: shïp <= 895, oütf <= 639,
 * wëap <= 383, gövt <= 383 (mission/govt fields), düde <= 639,
 * jünk <= 255, sÿst/spöb <= 2175.
 *
 * Map (sÿst 2100 "Kit Range", govt 360, no hyperlinks, no traffic):
 *   spöb 2100 Kit Port   (0,0)    land/trade/outfit/shipyard/bar, sells the kit
 *   spöb 2101 Kit Market (900,0)  land/trade/bar (opposite trade tiers)
 *   spöb 2102-2107 uninhabited markers on a 600 px grid (motion tracking)
 * See scripts/novaref/README.md ("Test kit") for every id.
 */

import { discShipGraphics } from "novaparse/plugin_kit/sprites";
import { circle, polygon, rgb15, rotationFrames, TRANSPARENT } from "novaparse/synthetic/raster";
import { encodeRled } from "novaparse/synthetic/rled";

const KIT_TECH = 9000; // kit ships/outfits are sold only where specialTech lists it
const none4 = [-1, -1, -1, -1];
const zero4 = [0, 0, 0, 0];
const none8 = new Array(8).fill(-1);
const zero8 = new Array(8).fill(0);
const none16 = new Array(16).fill(-1);
const zero16 = new Array(16).fill(0);

/** Neutralizes everything a cloned stock hull would drag along. */
const shipBase = {
    weapons: none4, weaponCounts: zero4, weaponAmmo: zero4,
    weapons2: none4, weaponCounts2: zero4, weaponAmmo2: zero4,
    outfits: none4, outfitCounts: zero4, outfits2: none4, outfitCounts2: zero4,
    availability: "", appearOn: "", onPurchase: "", onCapture: "", onRetire: "",
    contribute: 0, require: 0, techLevel: KIT_TECH, cost: 1000, buyRandom: 100,
    hireRandom: 0, keyCarried: -1, escortUpgradeTo: -1, escortUpgradeCost: 0,
    escortSellValue: 0, escortType: -1, govt: -1, deathDelay: 10, crew: 10,
    fuel: 3000, fuelRegen: 0, skillVar: 0, podCount: 0,
};

function ship(id, name, clone, set) {
    return [
        { type: "shïp", id, name, clone: `shïp:${clone}`, set: { ...shipBase, shortName: name, longName: name, commName: name, subtitle: "", ...set } },
        // A hull's graphics are the shän with the SAME id.
        { type: "shän", id, name, clone: `shän:${clone}` },
    ];
}

/**
 * A hull drawn as a solid disc of one exact 15-bit colour (r, g, b 0-31)
 * on all 36 frames: find it in a recording by colour, its centroid is the
 * ship's position (analysis/discs.mjs). rlëD ids 2000+.
 */
function discShip(id, name, rledId, rgb, set, size = 24, diameter = size - 2) {
    const g = discShipGraphics(rledId, rgb, size, 36, diameter);
    return [
        { type: "shïp", id, name, clone: "shïp:128", set: { ...shipBase, shortName: name, longName: name, commName: name, subtitle: "", ...set } },
        // The stock Shuttle's shän with only its base sprite swapped (one
        // 36-frame set): a from-scratch shän crashed the game on Enter Ship.
        { type: "shän", id, name, clone: "shän:128", set: { "@0:i16": rledId, "@2:i16": rledId + 1, "@4:i16": 1 } },
        { type: "rlëD", id: rledId, name, hex: Buffer.from(g.rled).toString("hex") },
    ];
}
/** Exact disc colours (15-bit components) and their 8-bit screen values. */
export const DISC_COLOURS = {
    white: [31, 31, 31], red: [31, 0, 0], green: [0, 31, 0], blue: [0, 0, 31],
    yellow: [31, 31, 0], magenta: [31, 0, 31], cyan: [0, 31, 31],
};

const weapBase = {
    ammoType: -1, inaccuracy: 0, flags2: 0, flags3: 0, ionization: 0, recoil: 0,
    burstCount: 0, burstReload: 0, proxSafety: 0, jamVuln: zero4, maxAmmo: 0,
    subCount: 0, subType: -1, subTheta: 0, subLimit: 0,
};
const weap = (id, name, clone, set) => ({ type: "wëap", id, name, clone: `wëap:${clone}`, set: { ...weapBase, ...set } });

/** A player-installable outfit for weapon `wid`. */
const gun = (id, name, wid) => ({
    type: "oütf", id, name, clone: "oütf:130",
    set: {
        displayWeight: 1000 + id, mass: 0, techLevel: KIT_TECH, modType: 1, modVal: wid, max: 32,
        flags: 0, cost: 1000, modType2: -1, modVal2: 0, modType3: -1, modVal3: 0, modType4: -1, modVal4: 0,
        contribute: 0, require: 0, availability: "", onPurchase: "", onSell: "",
        shortName: name, lcName: name.toLowerCase(), lcPlural: name.toLowerCase() + "s",
        itemClass: 0, scanMask: 0, buyRandom: 100,
    },
});

const govt = (id, name, set = {}) => ({
    type: "gövt", id, name, clone: "gövt:128",
    set: {
        voiceType: -1, flags: 0, flags2: 0, scanFine: 0, crimeTol: 10, smugPenalty: 0,
        disabPenalty: 50, boardPenalty: 50, killPenalty: 100, shootPenalty: 0, initialRec: 0,
        maxOdds: 1000, classes: none4, allies: none4, enemies: none4, skillMult: 100,
        scanMask: 0, commName: name.slice(0, 15), targetCode: "", require: 0, inhJam: zero4,
        mediumName: name, ...set,
    },
});

const dude = (id, name, ai, govtId, shipId) => ({
    type: "düde", id, name, clone: "düde:128",
    set: { ai, govt: govtId, flags: 0, infoTypes: 0, ships: [shipId, ...none16.slice(1)], probs: [100, ...zero16.slice(1)] },
});

const system = (id, name, x, y, govtId, spobs) => ({
    type: "sÿst", id, name, clone: "sÿst:130",
    set: {
        x, y, links: none16, spobs: [...spobs, ...none16].slice(0, 16),
        dudes: none8, dudeProbs: zero8, avgShips: 0, govt: govtId, buoy: -1, asteroids: 0,
        interference: 0, persons: none8, personProbs: zero8, murk: 0, asteroidTypes: 0,
        visibility: "", reinfFleet: -1, reinfTime: 0, reinfInterval: 0,
    },
});

const spob = (id, name, x, y, clone, set) => ({
    type: "spöb", id, name, clone: `spöb:${clone}`,
    set: {
        x, y, tribute: 0, techLevel: 1, specialTech: [KIT_TECH, -1, -1], specialTech2: [-1, -1, -1, -1, -1],
        govt: -1, minStatus: -32767, custPic: -1, custSnd: -1, defenseDude: -1, defenseCount: 0,
        flags2: 0, hyperlinks: none8, onDominate: "", onRelease: "", landingFee: 0, gravity: 0,
        weapon: -1, strength: 0, deadType: -1, deadTime: 0, explodeType: -1, onDestroy: "", onRegen: "",
        ...set,
    },
});

// Spöb flags (EVN Bible): 0x01 land, 0x02 commodities, 0x04 outfitter,
// 0x08 shipyard, 0x20 uninhabited, 0x40 bar; trade tiers in the high bits.
const PORT_FLAGS = 0x10000000 | 0x02000000 | 0x00400000 | 0x00010000 | 0x00002000 | 0x00000400 | 0x4f;
const MARKET_FLAGS = 0x40000000 | 0x01000000 | 0x00200000 | 0x00040000 | 0x00001000 | 0x00000200 | 0x43;

const misnBase = {
    availStel: 2100, availLoc: 3, availRecord: 0, availRating: -1, availRandom: 100,
    travelStel: -1, returnStel: -1, cargoType: -1, cargoQty: 0, pickupMode: -1, dropoffMode: -1,
    scanMask: 0, payVal: 0, shipCount: -1, shipSyst: -1, shipDude: -1, shipGoal: -1, shipBehav: -1,
    shipNameID: -1, shipStart: 0, compGovt: -1, compReward: 0, shipSubtitle: -1, briefText: -1,
    quickBrief: -1, loadCargText: -1, dropCargText: -1, compText: -1, failText: -1, timeLimit: -1,
    canAbort: 1, shipDoneText: -1, auxShipCount: -1, auxShipDude: -1, auxShipSyst: -1, flags: 0,
    flags2: 0, refuseText: -1, availShipType: -1, onAccept: "", onRefuse: "", onSuccess: "",
    onFailure: "", onAbort: "", require: 0, datePostInc: 0, onShipDone: "", acceptButton: "",
    refuseButton: "", dispWeight: 0,
};
/** A mission offered in Kit Port's main spaceport dialog (AvailLoc 3) while bit `bit` is set. */
const misn = (id, name, bit, set) => [
    { type: "mïsn", id, name, clone: "mïsn:128", set: { ...misnBase, availBits: `b${bit}`, ...set } },
    // Offer text: dësc 4000 + (id - 128).
    { type: "dësc", id: 4000 + id - 128, text: `${name}. (novaref test kit mission ${id}, gated by bit ${bit}.)` },
];

export default {
    name: "novaref-testkit",
    resources: [
        // --- Ships. Probes A-C have round Accel/Speed/Turn for unit checks (#316).
        ...ship(700, "Kit Probe A", 128, { accel: 300, speed: 300, turn: 10, armor: 30000, shield: 30000, mass: 50, freeMass: 500, cargo: 50, maxGuns: 8, maxTurrets: 8, ai: 1, strength: 10, flags: 0, flags2: 0x0088 }),
        ...ship(701, "Kit Probe B", 128, { accel: 150, speed: 600, turn: 30, armor: 30000, shield: 30000, mass: 50, freeMass: 500, cargo: 50, maxGuns: 8, maxTurrets: 8, ai: 1, strength: 10, flags: 0, flags2: 0x0088 }),
        ...ship(702, "Kit Probe C", 128, { accel: 600, speed: 200, turn: 20, armor: 30000, shield: 30000, mass: 50, freeMass: 500, cargo: 50, maxGuns: 8, maxTurrets: 8, ai: 1, strength: 10, flags: 0, flags2: 0x0088 }),
        // Inertialess (flags2 0x0040): stops when thrust is released.
        ...ship(703, "Kit Lancer", 135, { accel: 2000, speed: 800, turn: 60, armor: 30000, shield: 30000, shieldRecharge: 1000, mass: 50, freeMass: 1000, cargo: 200, maxGuns: 16, maxTurrets: 16, ai: 3, strength: 100, flags: 0, flags2: 0x00C8 }),
        // Escort for protect-the-player tests (mïsn ShipBehav 1).
        ...ship(704, "Kit Escort", 163, { armor: 4000, shield: 4000, accel: 600, speed: 330, turn: 70, weapons: [365, -1, -1, -1], weaponCounts: [2, 0, 0, 0], weaponAmmo: [0, 0, 0, 0], ai: 3, strength: 100, crew: 20 }),
        ...ship(705, "Kit Fighter", 167, { armor: 300, shield: 300, weapons: [365, -1, -1, -1], weaponCounts: [1, 0, 0, 0], weaponAmmo: [0, 0, 0, 0], ai: 3, strength: 20, crew: 1 }),
        ...ship(706, "Kit Carrier", 162, { armor: 6000, shield: 6000, weapons: [365, 366, -1, -1], weaponCounts: [2, 1, 0, 0], weaponAmmo: [0, 4, 0, 0], ai: 3, strength: 200, crew: 40 }),
        ...ship(707, "Kit Raider", 149, { armor: 1500, shield: 1500, weapons: [367, -1, -1, -1], weaponCounts: [2, 0, 0, 0], weaponAmmo: [0, 0, 0, 0], ai: 3, strength: 80, crew: 15 }),
        ...ship(708, "Kit Trader", 138, { armor: 1000, shield: 1000, ai: 1, strength: 20, crew: 10 }),
        // A stationary, unkillable target (missile turn tests).
        ...ship(709, "Kit Target", 136, { armor: 30000, shield: 0, accel: 0, speed: 0, turn: 0, ai: 1, strength: 1, crew: 1 }),
        // Inertialess player hull whose shield bar visibly drops under fire
        // (1500 shield, no recharge) -- shows who is shooting the player.
        ...ship(710, "Kit Lancer Lite", 135, { accel: 2000, speed: 800, turn: 60, armor: 3000, shield: 1500, shieldRecharge: 0, armorRecharge: 0, mass: 50, freeMass: 1000, cargo: 200, maxGuns: 16, maxTurrets: 16, ai: 3, strength: 100, flags: 0, flags2: 0x00C8 }),

        // --- Weapons.
        weap(360, "Kit Beam Turret", 170, { reload: 30, duration: 4, armorDamage: 5000, shieldDamage: 5000, guidance: 3, beamLength: 1500 }),
        weap(361, "Kit Tickler", 130, { reload: 15, duration: 90, armorDamage: 1, shieldDamage: 1, guidance: 4, speed: 2500 }),
        // wëap 362-364 were the #316b Kit Missiles T10/T30/T60 (GuidedTurn
        // 10/30/60); retired in wave 4 for jamming types 2-4 (wave4Resources).
        weap(365, "Kit Escort Gun", 131, { reload: 20, duration: 60, armorDamage: 30, shieldDamage: 30, guidance: 4 }),
        // Fighter bay: AmmoType of a bay is the carried shïp id itself (the
        // stock Viper Bay, wëap 149, holds 144). Until wave 6 the kit wrote
        // id - 128, which named no ship (or a stock one): see
        // docs/reference_experiments.md "B wave 6".
        weap(366, "Kit Fighter Bay", 149, { reload: 30, guidance: 99, ammoType: 705 }),
        weap(367, "Kit Raider Gun", 130, { reload: 20, duration: 60, armorDamage: 20, shieldDamage: 20, guidance: 4 }),
        // wëap 368/369 were the #316 Kit Speed Guns 300/600 (unguided, Speed
        // 300/600); retired in wave 4 for the escort weapon tests (see
        // wave4Resources). Pilot probe_gun.json now gets the new weapons.

        // --- Outfits (player weapons).
        gun(600, "Kit Beam Turret", 360),
        gun(601, "Kit Tickler", 361),
        // oütf 602-604 (launchers for 362-364) are redefined in wave4Resources.
        gun(605, "Kit Fixed Gun", 368),
        gun(606, "Kit Rear Turret", 369),
        gun(607, "Kit Escort Gun", 365),

        // --- Governments. No classes/allies/enemies: only the player's
        // legal record (set in the pilot) relates them.
        govt(360, "Kit Escort Govt"),
        // 361 is "nosy" (gövt 0x0002): it enforces the record in systems it does
        // not own, so a player criminal in Kit Range is hostile to it.
        govt(361, "Kit Trader Govt", { flags: 0x0002 }),
        // 362 always attacks the player (gövt 0x0004).
        govt(362, "Kit Raider Govt", { flags: 0x0004 }),
        govt(363, "Kit Neutral Govt"),

        // --- Dudes.
        dude(600, "Kit Escort", 3, 360, 704),
        dude(601, "Kit Carrier Escort", 3, 360, 706),
        dude(602, "Kit Raiders", 3, 362, 707),
        // düde 603-606 (Q2b traders, Q3 own-govt raiders, the #316b Kit
        // Target, Q2c hostile traders) were retired in wave 4 for jamming
        // targets (wave4Resources), with their missions 962, 963, 965, 966.

        // --- The sealed test system, owned by the escort govt so a pilot's
        // record in sÿst 2100 is its record with govt 360 (EV Nova keeps
        // legal records PER SYSTEM). The other kit govts each own one
        // empty, unlinked "home" system so a pilot can carry a record with
        // them too (sÿst 2101 -> 361, 2102 -> 362, 2103 -> 363).
        system(2100, "Kit Range", -600, -600, 360, [2100, 2101, 2102, 2103, 2104, 2105, 2106, 2107]),
        system(2101, "Kit Trader Home", -640, -600, 361, []),
        system(2102, "Kit Raider Home", -600, -640, 362, []),
        system(2103, "Kit Neutral Home", -640, -640, 363, []),
        spob(2100, "Kit Port", 0, 0, 128, { flags: PORT_FLAGS }),
        spob(2101, "Kit Market", 900, 0, 138, { flags: MARKET_FLAGS }),
        ...[[-600, -600], [0, -600], [600, -600], [-600, 600], [0, 600], [600, 600]].map(([x, y], i) =>
            spob(2102 + i, `Kit Marker ${i + 1}`, x, y, 132, { flags: 0x20, techLevel: 0, specialTech: [-1, -1, -1] })),
        { type: "dësc", id: 10000 + 2100 - 128, text: "Kit Port bar (novaref test kit)." },
        { type: "dësc", id: 10000 + 2101 - 128, text: "Kit Market bar (novaref test kit)." },

        // --- Special commodities (#321): bought at Kit Port, sold at Kit Market and vice versa.
        { type: "jünk", id: 200, name: "Kit Widgets", clone: "jünk:128", set: { soldAt: [2100, ...none8.slice(1)], boughtAt: [2101, ...none8.slice(1)], basePrice: 1000, flags: 0, scanMask: 0, lcName: "kit widgets", abbrev: "Widgets", buyOn: "", sellOn: "" } },
        { type: "jünk", id: 201, name: "Kit Gadgets", clone: "jünk:128", set: { soldAt: [2101, ...none8.slice(1)], boughtAt: [2100, ...none8.slice(1)], basePrice: 150, flags: 0, scanMask: 0, lcName: "kit gadgets", abbrev: "Gadgets", buyOn: "", sellOn: "" } },

        // --- Protect-the-player missions (mïsn ShipBehav 1, ShipGoal 3),
        // each offered on landing at Kit Port while its bit is set in the pilot.
        // Special ship(s) start on nav default 1 (Kit Port, ShipStart -1).
        ...misn(960, "Kit Q1 escort alone", 9001, { shipCount: 1, shipDude: 600, shipGoal: 3, shipBehav: 1, shipStart: -1 }),
        ...misn(961, "Kit Q2a escort vs raiders", 9002, { shipCount: 1, shipDude: 600, shipGoal: 3, shipBehav: 1, shipStart: -1, auxShipCount: 2, auxShipDude: 602, auxShipSyst: -1 }),
        ...misn(964, "Kit Q4 carrier vs raiders", 9005, { shipCount: 1, shipDude: 601, shipGoal: 3, shipBehav: 1, shipStart: -1, auxShipCount: 2, auxShipDude: 602, auxShipSyst: -1 }),
        // Q4b: the STOCK Fed Carrier (stock bays and Vipers) as the escort.
        // mïsn 967 (Q4b, the stock Fed Carrier escort) was retired in wave 4.
        // B: an NPC carrier (neutral govt 363) whose fighters drop the 1-frame blast bomb.
        // mïsn 968 (B, NPC Kit Bomb Carrier) was retired in wave 4.

        // --- Blast-damage kit (does a blast hurt its firer's parent?):
        // the bomb detonates at the end of a 2-frame life (wëap flag 0x8000)
        // with a 300 px blast, i.e. right at the muzzle.
        weap(370, "Kit Blast Bomb", 134, { reload: 45, duration: 2, armorDamage: 50, shieldDamage: 50, guidance: -1, speed: 300, proxRadius: 0, blastRadius: 300, flags: 0x8000, guidedTurn: 0 }),
        // The AI only fires within range (Speed x Duration), so NPCs get a
        // ranged version: 180 px reach, proximity 30, 400 px blast.
        weap(372, "Kit Blast Shell", 134, { reload: 45, duration: 60, armorDamage: 50, shieldDamage: 50, guidance: -1, speed: 300, proxRadius: 30, blastRadius: 400, flags: 0x8000, guidedTurn: 0 }),
        weap(371, "Kit Bomber Bay", 149, { reload: 30, guidance: 99, ammoType: 711 }),
        gun(608, "Kit Bomber Bay", 371),
        gun(609, "Kit Blast Bomb", 370),
        // B4: the same muzzle blast at 2000 damage, to destroy one's own escort.
        weap(373, "Kit Big Blast", 134, { reload: 45, duration: 2, armorDamage: 2000, shieldDamage: 2000, guidance: -1, speed: 300, proxRadius: 0, blastRadius: 300, flags: 0x8000, guidedTurn: 0 }),
        gun(610, "Kit Big Blast", 373),
        ...ship(711, "Kit Bomber", 167, { armor: 500, shield: 500, weapons: [372, -1, -1, -1], weaponCounts: [1, 0, 0, 0], weaponAmmo: [0, 0, 0, 0], ai: 3, strength: 20, crew: 1 }),
        ...ship(712, "Kit Bomb Carrier", 143, { armor: 3000, shield: 3000, weapons: [365, 371, -1, -1], weaponCounts: [2, 1, 0, 0], weaponAmmo: [0, 4, 0, 0], ai: 3, strength: 100, crew: 40 }),
        // düde 607/608 (Q4b Fed Carrier escort, B bomb carrier) were
        // retired in wave 4 for the asteroid tests (wave4Rocks).
        // Two always-attack-the-player raiders armed only with the blast bomb:
        // do their own/each other's blasts hurt them, and do they retaliate?
        ...ship(713, "Kit Bomb Raider", 149, { armor: 1500, shield: 1500, weapons: [372, -1, -1, -1], weaponCounts: [1, 0, 0, 0], weaponAmmo: [0, 0, 0, 0], ai: 3, strength: 80, crew: 15 }),
        // düde 609 (Kit Bomb Raiders) and mïsn 969 were retired in wave 4
        // for the K9 bracket tests (wave4Brackets).

        // --- Trackable disc hulls (formation and motion experiments).
        // 720 leader (white): Speed/Accel 300, Turn 30. 721-726 escorts
        // (red, green, blue, yellow, magenta, cyan): Speed/Accel 600, Turn 60.
        ...discShip(720, "Kit Disc Leader", 1970, DISC_COLOURS.white, { accel: 300, speed: 300, turn: 30, armor: 30000, shield: 30000, mass: 50, freeMass: 500, cargo: 50, maxGuns: 8, maxTurrets: 8, ai: 3, strength: 100, flags: 0, flags2: 0 }),
        ...["red", "green", "blue", "yellow", "magenta", "cyan"].flatMap((c, i) =>
            discShip(721 + i, `Kit Disc ${c[0].toUpperCase()}${c.slice(1)}`, 1971 + i, DISC_COLOURS[c], { accel: 600, speed: 600, turn: 60, armor: 30000, shield: 30000, mass: 50, freeMass: 100, cargo: 10, ai: 3, strength: 50, flags: 0, flags2: 0, cost: 10000 })),

        ...a14Resources(),
        ...wave2Resources(),
        ...wave3Resources(),
        ...wave4Resources(),
        ...wave6Resources(),
        ...wave7Resources(),
        ...wave8Resources(),
        ...wave10Resources(),
        ...wave11Resources(),
        ...wave12Resources(),
        ...wave13Resources(),
        ...wave14Resources(),
        ...wave15Resources(),
        ...wave16Resources(),
        ...wave17Resources(),
        ...wave18Resources(),
        ...wave19Resources(),
        ...wave20Resources(),
        ...wave21Resources(),
        ...wave22Resources(),
        ...wave23Resources(),
        ...wave24Resources(),
        ...wave25Resources(),
        ...wave26Resources(),
        ...wave27Resources(),
        ...wave28Resources(),
        ...wave29Resources(),
        ...wave30Resources(),
        ...wave31Resources(),
    ].map(wave15Patches).map(withoutRunningLights),
};

/**
 * Wave-31 experiments (docs/reference_experiments.md, "... wave 31").
 * Nothing retired (no mïsn needed). sÿst 1278-1299, spöb 1744-1799, oütf
 * 467. Map row y = -2220 (x -800 .. 40). The next free ids: sÿst 1300+, spöb
 * 1800+ (spares 1495, 1496, 1499), shïp 547+, düde 477+, ränk 205+, mïsn
 * NONE (retire an old kit mission to add one), gövt 297 and below, flët
 * 317+, wëap 295+, oütf 468+, bits 9250+.
 *
 * Every rig starts the pilot at rest on a decoration stellar (spöb flags 0)
 * at (0, 0) beside ONE stellar at (d, 0), as wave 29-30's Kit Gate Far. A
 * stellar cloned for its art keeps the clone's Type (spïn 2000 + Type picks
 * the art).
 *
 *  L   A PLANET's or STATION's clearance zone vs its landing window: landable
 *      ports with a chosen art at (d, 0): sÿst 1278-1280 Kit Land P72 140 /
 *      230 / 260 (stock spöb 138's 72 x 72 art; decorations spöb 1744 /
 *      1746 / 1748, ports 1745 / 1747 / 1749), 1281-1283 Kit Land P250 230 /
 *      245 / 260 (stock spöb 176's 250 x 250 art; 1750-1755), 1284 / 1285
 *      Kit Land S17 140 / 230 (stock spöb 299 Holpa Station's 17 x 31 art, a
 *      station; 1756-1759), 1286 / 1287 Kit Land S315 230 / 260 (stock spöb
 *      311 Gladius Shipyards' 315 x 200 art, a station; 1760-1763).
 *  M   A request standing while the ship COASTS in: sÿst 1288 Kit Land
 *      Toward P72 / 1289 Kit Land Toward P250 (decoration 1764 / 1772 at
 *      (0, 0), moon rulers 1765-1770 / 1773-1778 at (300 .. 800, 60), the
 *      port 1771 / 1779 at (1100, 0)), as wave 30's Kit Gate Toward.
 *  G   The hypergate clearance zone and entry window across art sizes:
 *      usable gates (flags 0x11, Flags2 0x1000, HyperLinks to N1's gate
 *      1610) with stock art: sÿst 1290-1292 Kit Gate S17 140 / 245 / 255
 *      (Holpa Station's 17 x 31 art; decorations 1780 / 1782 / 1784, gates
 *      1781 / 1783 / 1785), 1293-1295 Kit Gate J325 245 / 255 / 300 (stock
 *      Jupiter's 325 x 325 art, spöb 159; 1786-1791), 1296 / 1297 Kit Gate
 *      M96 155 / 172 (stock spöb 145 Sirius Prime's 96 x 96 art: 1.7 W =
 *      163; 1792-1795), 1298 / 1299 Kit Gate Small 245 / 255 (spöb 138's 72
 *      x 72 art; 1796-1799).
 *  A   oütf 467 Kit Ammo Launcher (ModType 1, ModVal 289): wave 30's Ammo
 *      take did nothing with wëap 289 written into the pilot without an
 *      outfit ("No Secondary Weapon"); this installs it as an outfit.
 */
function wave31Resources() {
    const out = [];
    const Y = -2220;
    let col = 0;
    const nextX = () => -800 + 40 * col++;
    const decoration = (id, name, x = 0, y = 0) => spob(id, name, x, y, 132, { flags: 0, techLevel: 0, specialTech: [-1, -1, -1] });
    // A landable port with another stellar's art (its Type kept by the clone).
    const artPort = (id, name, x, clone, flags) => spob(id, name, x, 0, clone, { flags, govt: -1, minStatus: -32767 });
    // A usable hypergate with another stellar's art.
    const artGate = (id, name, x, clone) => spob(id, name, x, 0, clone, { flags: 0x11, flags2: 0x1000, govt: -1, minStatus: -32767,
        techLevel: 0, specialTech: [-1, -1, -1], hyperlinks: [1610, ...none8].slice(0, 8) });
    let sid = 1278, pid = 1744;
    const rig = (label, d, make) => {
        out.push(system(sid, label, nextX(), Y, 363, [pid, pid + 1]), decoration(pid, `${label} Start`), make(pid + 1, label, d));
        sid++;
        pid += 2;
    };

    // --- L: planets and stations at rest.
    const ART = { P72: [138, 0x43], P250: [176, 0x43], S17: [299, 0x11], S315: [311, 0x11] };
    for (const [art, ds] of [["P72", [140, 230, 260]], ["P250", [230, 245, 260]], ["S17", [140, 230]], ["S315", [230, 260]]]) {
        for (const d of ds) rig(`Kit Land ${art} ${d}`, d, (id, name, x) => artPort(id, name, x, ...ART[art]));
    }
    // --- M: coasting in toward a port at (1100, 0) with moon rulers.
    for (const art of ["P72", "P250"]) {
        const name = `Kit Land Toward ${art}`;
        const rulers = [300, 400, 500, 600, 700, 800];
        const ids = [pid, ...rulers.map((_, i) => pid + 1 + i), pid + 7];
        out.push(system(sid, name, nextX(), Y, 363, ids), decoration(pid, `${name} Start`),
            ...rulers.map((x, i) => decoration(pid + 1 + i, `${name} Ruler ${x}`, x, 60)), artPort(pid + 7, name, 1100, ...ART[art]));
        sid++;
        pid += 8;
    }
    // --- G: gates with other art.
    const GATE_ART = { S17: 299, J325: 159, M96: 145, Small: 138 };
    for (const [art, ds] of [["S17", [140, 245, 255]], ["J325", [245, 255, 300]], ["M96", [155, 172]], ["Small", [245, 255]]]) {
        for (const d of ds) rig(`Kit Gate ${art} ${d}`, d, (id, name, x) => artGate(id, name, x, GATE_ART[art]));
    }
    // --- A: the launcher for wëap 289 as an outfit.
    out.push(gun(467, "Kit Ammo Launcher", 289));
    return out;
}

/**
 * Wave-30 experiments (docs/reference_experiments.md, "... wave 30").
 * Nothing retired (no mïsn needed: the mïsn ids are still used up). sÿst
 * 1254-1277, spöb 1690-1743, shïp 545-546, düde 475-476, flët 314-316.
 * Map row y = -2160 (x -800 .. 120). The next free ids: sÿst 1278+, spöb
 * 1744+ (spares 1495, 1496, 1499), shïp 547+, düde 477+, ränk 205+, mïsn
 * NONE (retire an old kit mission to add one), gövt 297 and below, flët
 * 317+, wëap 295+, oütf 467+, bits 9250+.
 *
 * LESSONS: a spöb's Type picks its art (spïn 2000 + Type), so a stellar
 * cloned for its art must keep the clone's Type (Kit Gate Small 140's first
 * build set Type 1 and drew the hypergate). An idle gate IS drawn (its
 * closed sprite): start gate rigs beside the gate, not on it.
 *
 *  G   The hypergate `l` radius and entry zone from a STOPPED ship (wave 29's
 *      Kit Gate Far rig: a decoration stellar at (0, 0) where the pilot
 *      starts, a usable kit hypergate at (d, 0), HyperLinks to N1's gate
 *      1610): sÿst 1254-1257 Kit Gate Far 492 / 494 / 496 / 498
 *      (decorations spöb 1690 / 1692 / 1694 / 1696, gates 1691 / 1693 / 1695
 *      / 1697); sÿst 1258-1264 Kit Gate Far 206 / 212 / 218 / 225 / 231 /
 *      237 / 243 (decorations 1698 .. 1710 even, gates 1699 .. 1711 odd);
 *      sÿst 1265 Kit Gate Far Diagonal 180 (the gate at (180, 180): max 180,
 *      distance 255; a square entry zone of half-side 200+ clears it, a
 *      circle of radius 250 or less does not; decoration 1712, gate 1713).
 *  M   A MOVING ship's `l`: sÿst 1266 Kit Gate Toward (decoration 1714 at
 *      (0, 0), rulers 1715-1720 at (300 .. 800, 60): decorations drawn as
 *      moons, `l` never selects them; the gate 1721 at (1100, 0)), and sÿst
 *      1267 Kit Gate Away (decoration 1722 at (0, 0), rulers 1723-1725 at
 *      (100 / 200 / 300, 60), the gate 1726 at (-300, 0)). The pilot is
 *      turned to face +x (evidence tools/move.mjs), then coasts. Added during
 *      the wave: Kit Gate Far 246 / 248 (sÿst 1271 / 1272, decorations spöb
 *      1733 / 1735, gates 1734 / 1736); Kit Gate Small 140 / 230 (sÿst 1273 /
 *      1276: the same usable gate with stock spöb 138's 72 x 72 art at (140,
 *      0) / (230, 0); decorations 1737 / 1741, gates 1738 / 1742).
 *  P   (added during the wave) Plunder odds: live immobile 50 t hulks (wave
 *      27's kind, no blast) as the only traffic of their system: shïp 545
 *      Kit Hulk Ammo (wëap 289 with 5 rounds; düde 475; sÿst 1274 Kit Board
 *      Ammo, port spöb 1739) and shïp 546 Kit Hulk Crew 50 (crew 50; düde
 *      476; sÿst 1275 Kit Board Crew, port 1740).
 *  R   (added during the wave) sÿst 1277 Kit Bribe Freighters (gövt 304,
 *      port spöb 1743, MinStatus 0): wave 22's düde 451 AI 1 freighters as
 *      its only traffic (a 0x2000 freighter's Beg For Mercy above 20M; they
 *      were not hostile at record -50).
 *  N   NPC fleets of 10 / 12 / 13 escorts (F1c): flët 314 Kit Disc Fleet 10
 *      (red x3, green x3, blue x2, yellow x2), 315 Kit Disc Fleet 12 (three
 *      of each), 316 Kit Disc Fleet 13 (red x4, three of the others), as
 *      wave 29's flët 312 / 313; the only traffic of sÿst 1268-1270 Kit
 *      Fleet Ten / Twelve / Thirteen (ports spöb 1727-1729 at (0, 0),
 *      markets 1730-1732 at (1200, 0)), avgShips 6.
 */
function wave30Resources() {
    const out = [];
    const Y = -2160;
    let col = 0;
    const nextX = () => -800 + 40 * col++;
    const port = (id, name, x = 0, y = 0, set = {}) => spob(id, name, x, y, 138, { flags: 0x43, ...set });
    const decoration = (id, name, x = 0, y = 0) => spob(id, name, x, y, 132, { flags: 0, techLevel: 0, specialTech: [-1, -1, -1] });
    const gate = (id, name, x, y) => spob(id, name, x, y, 1400, { type: 1, flags: 0x11, flags2: 0x1000, govt: -1, minStatus: -32767,
        techLevel: 0, specialTech: [-1, -1, -1], custPic: 37, custSnd: 120, hyperlinks: [1610, ...none8].slice(0, 8) });

    // --- G: the radius (492-498) and the entry zone (206-243, the 180 / 180 diagonal).
    const farGate = (sid, label, gx, gy, startId, gateId) => out.push(system(sid, `Kit Gate Far ${label}`, nextX(), Y, 363, [startId, gateId]),
        decoration(startId, `Kit Gate Far ${label} Start`), gate(gateId, `Kit Gate Far ${label}`, gx, gy));
    [492, 494, 496, 498].forEach((d, i) => farGate(1254 + i, d, d, 0, 1690 + 2 * i, 1691 + 2 * i));
    [206, 212, 218, 225, 231, 237, 243].forEach((d, i) => farGate(1258 + i, d, d, 0, 1698 + 2 * i, 1699 + 2 * i));
    farGate(1265, "Diagonal 180", 180, 180, 1712, 1713);

    // --- M: a moving ship's `l` (rulers at y = 60 so the ship's path along y = 0 does not cover them).
    out.push(system(1266, "Kit Gate Toward", nextX(), Y, 363, [1714, 1715, 1716, 1717, 1718, 1719, 1720, 1721]),
        decoration(1714, "Kit Gate Toward Start"),
        ...[300, 400, 500, 600, 700, 800].map((x, i) => decoration(1715 + i, `Kit Gate Toward Ruler ${x}`, x, 60)),
        gate(1721, "Kit Gate Toward", 1100, 0));
    out.push(system(1267, "Kit Gate Away", nextX(), Y, 363, [1722, 1723, 1724, 1725, 1726]),
        decoration(1722, "Kit Gate Away Start"),
        ...[100, 200, 300].map((x, i) => decoration(1723 + i, `Kit Gate Away Ruler ${x}`, x, 60)),
        gate(1726, "Kit Gate Away", -300, 0));

    // --- N: NPC fleets of 10 / 12 / 13 (as wave 29's flët 312 / 313).
    [[314, "Kit Disc Fleet 10", [3, 3, 2, 2], 1268, "Ten"], [315, "Kit Disc Fleet 12", [3, 3, 3, 3], 1269, "Twelve"],
        [316, "Kit Disc Fleet 13", [4, 3, 3, 3], 1270, "Thirteen"]].forEach(([fid, fname, counts, sid, sname], i) => {
        out.push({ type: "flët", id: fid, name: fname, clone: "flët:128", set: { "@0:i16": 720, "@2:i16x4": [721, 722, 723, 724],
            "@10:i16x4": counts, "@18:i16x4": counts, "@26:i16": 363, "@28:i16": sid, "@30:str256": "", "@286:i16": -1, "@288:u16": 0 } });
        const s = system(sid, `Kit Fleet ${sname}`, nextX(), Y, 363, [1727 + i, 1730 + i]);
        s.set = { ...s.set, avgShips: 6, dudes: [-fid, ...none8.slice(1)], dudeProbs: [100, ...zero8.slice(1)] };
        out.push(s, port(1727 + i, `Kit Fleet ${sname} Port`), port(1730 + i, `Kit Fleet ${sname} Market`, 1200, 0));
    });

    // --- Added during the wave (243 cleared, 250 a request): Kit Gate Far 246 / 248, sÿst 1271 / 1272 (decorations
    // spöb 1733 / 1735, gates 1734 / 1736), on the same row after the fleets.
    [246, 248].forEach((d, i) => farGate(1271 + i, d, d, 0, 1733 + 2 * i, 1734 + 2 * i));
    // And (248 cleared: the 150 px gate's zone is about 249, not the planets' 212 cap): is it 1.66 x the frame or a
    // fixed 250? sÿst 1273 Kit Gate Small 140: the same usable gate with the 72 x 72 New England art (stock spöb 138)
    // at (140, 0) (decoration spöb 1737, gate 1738). 1.7 x 72 = 122 says a request, a fixed 250 the clearance. The spöb
    // Type picks the art (spïn 2000 + Type), so it keeps New England's: the first try set Type 1 and drew the gate art.
    out.push(system(1273, "Kit Gate Small 140", nextX(), Y, 363, [1737, 1738]), decoration(1737, "Kit Gate Small 140 Start"),
        spob(1738, "Kit Gate Small 140", 140, 0, 138, { flags: 0x11, flags2: 0x1000, govt: -1, minStatus: -32767,
            techLevel: 0, specialTech: [-1, -1, -1], hyperlinks: [1610, ...none8].slice(0, 8) }));
    // And (the 72 px gate at 140 px: the first `l` CLEARED it, the second was "too far": the clearance zone is not the
    // entry window): the same gate at (230, 0), sÿst 1276 Kit Gate Small 230 (decoration spöb 1741, gate 1742).
    out.push(system(1276, "Kit Gate Small 230", nextX(), Y, 363, [1741, 1742]), decoration(1741, "Kit Gate Small 230 Start"),
        spob(1742, "Kit Gate Small 230", 230, 0, 138, { flags: 0x11, flags2: 0x1000, govt: -1, minStatus: -32767,
            techLevel: 0, specialTech: [-1, -1, -1], hyperlinks: [1610, ...none8].slice(0, 8) }));

    // --- P (added during the wave): the plunder self-destruct's odds for AMMO and against a big CREW. Live immobile
    // 50 t hulks as wave 27's (AI 4 of gövt 363, 300 armor, the pointer art; 50 t: no blast), each the only traffic of
    // its system: shïp 545 Kit Hulk Ammo (carries wëap 289 Kit Ammo Missile with 5 rounds; düde 475; sÿst 1274 Kit
    // Board Ammo, port spöb 1739) and shïp 546 Kit Hulk Crew 50 (crew 50; düde 476; sÿst 1275 Kit Board Crew, port 1740).
    const hulk = (id, name, set) => [
        { type: "shïp", id, name, clone: "shïp:128", set: { ...shipBase, shortName: name, longName: name, commName: name, subtitle: "", armor: 300,
            shield: 0, accel: 0, speed: 0, turn: 0, mass: 50, freeMass: 100, cargo: 50, ai: 1, strength: 1, crew: 1, flags: 0, flags2: 0,
            cost: 50000, deathDelay: 10, ...set } },
        { type: "shän", id, name, clone: "shän:128", set: { "@0:i16": 1959, "@2:i16": 1960, "@4:i16": 1, "@6:i16": 24, "@8:i16": 24 } }];
    [[545, "Kit Hulk Ammo", { weapons: [289, -1, -1, -1], weaponCounts: [1, 0, 0, 0], weaponAmmo: [5, 0, 0, 0] }, 475, 1274, "Ammo", 1739],
        [546, "Kit Hulk Crew 50", { crew: 50 }, 476, 1275, "Crew", 1740]].forEach(([sid, name, set, did, sys, label, portId]) => {
        out.push(...hulk(sid, name, set));
        const d = dude(did, name, 4, 363, sid);
        d.set = { ...d.set, flags: 0x0041 };
        const s = system(sys, `Kit Board ${label}`, nextX(), Y, 363, [portId]);
        s.set = { ...s.set, avgShips: 1, dudes: [did, ...none8].slice(0, 8), dudeProbs: [100, ...zero8].slice(0, 8) };
        out.push(d, s, port(portId, `Kit Board ${label} Port`));
    });

    // --- R7 (added during the wave): a 0x2000 FREIGHTER's Beg For Mercy price above 20M. sÿst 1277 Kit Bribe
    // Freighters (gövt 304 Kit Bribe Plain: 0x4000 | 0x2000 | 0x0200), its port spöb 1743 (gövt 304, MinStatus 0) and
    // three of wave 22's unused düde 451 Kit Bribe Freighter Plain (AI 1, shïp 504) as its only traffic.
    const freighters = system(1277, "Kit Bribe Freighters", nextX(), Y, 304, [1743]);
    freighters.set = { ...freighters.set, avgShips: 3, dudes: [451, ...none8].slice(0, 8), dudeProbs: [100, ...zero8].slice(0, 8) };
    out.push(freighters, port(1743, "Kit Bribe Freighters Port", 0, 0, { govt: 304, minStatus: 0 }));
    return out;
}

/**
 * Wave-29 experiments (docs/reference_experiments.md, "... wave 29").
 * Nothing retired. sÿst 1222-1253, spöb 1627-1689, shïp 542-544, düde
 * 473-474, flët 312-313, mïsn 959 / 969 / 1125 / 1126 / 1127 (bits
 * 9245-9249; offer texts dësc 4831 / 4841 / 4997-4999). Map rows y = -1980
 * (x -800 .. -480), -2040 (x -800 .. -480) and -2100 (x -800 .. -280). The
 * next free ids: sÿst 1254+, spöb 1690+ (spares 1495, 1496, 1499), shïp
 * 545+, düde 475+, ränk 205+, mïsn NONE (every id the pilot can reference,
 * up to 1127, is used: retire an old kit mission to add one), gövt 297 and
 * below, flët 314+, wëap 295+, oütf 467+, bits 9250+.
 *
 * LESSONS: a mission ship with ShipStart -2 sits EXACTLY on nav default 2
 * (dx 170.0 from a player on nav default 1), so the B rig places a wreck at
 * any distance, off screen too. The Kit Ring Lancer is inertial (Down does
 * not brake): start a pilot ON the port it must land at (W2 below).
 *
 *  B   The blast reach at heavy masses, with the wreck at a CHOSEN distance:
 *      sÿst 1222-1227 Kit Blast 170 / 230 / 380 / 470 / 700 / 880 each hold
 *      a port at (0, 0) (nav default 1, where the pilot starts and lands) and
 *      an uninhabited marker at (d, 0) (nav default 2). A mission accepted on
 *      landing (AvailLoc 3, ShipSyst -1, ShipStart -2: "on top of nav default
 *      2") puts ONE live immobile hulk on the marker, so after take-off the
 *      player (at rest on the port) and the hulk are d px apart along x and
 *      the Kit Pulse Beam (wëap 290, 5000 px) kills it from there: mïsn 959
 *      the 2,000 t hulk (düde 463, b9245), 969 the 5,000 t DeathDelay-10
 *      hulk (düde 459, b9246), 1125 the 5,000 t DeathDelay-60 hulk (düde 457,
 *      b9247), 1126 a new 10,000 t DeathDelay-10 hulk (shïp 542 Kit Hulk
 *      Pointer 10000, düde 473, b9248). No traffic in these systems.
 *      Added during the wave: Kit Blast 760 / 820 (sÿst 1233 / 1234, ports
 *      spöb 1649 / 1650, markers 1651 / 1652), Kit Blast 190 / 210 / 400 / 440
 *      (sÿst 1240-1243, ports 1663-1666, markers 1667-1670), shïp 543 Kit
 *      Big Boarder (the Tough boarder with the stock Fed Carrier's shän 143:
 *      is the reach to the victim's centre or its hull?) and shïp 544 Kit
 *      Hulk Big 2000 (the 2,000 t hulk with that art; düde 474, mïsn 1127,
 *      b9249: the wreck's side).
 *  G   The hypergate `l` selection range from a STOPPED ship: Kit Gate Far d,
 *      each a decoration stellar (flags 0: no landing, not drawn) at (0, 0)
 *      where the pilot starts and a usable kit hypergate (as wave 24's) at
 *      (d, 0), HyperLinks to N1's gate 1610: sÿst 1228-1230 (d 500 / 1000 /
 *      2000; decorations spöb 1639-1641, gates 1642-1644), 1235-1237 (150 /
 *      300 / 400; 1653-1655, 1656-1658), 1238 (450; 1659, 1660), 1239 (the
 *      gate at (330, 330); 1661, 1662), 1244 (475; 1671, 1672), 1245 (the
 *      gate at (420, 420); 1673, 1674), 1248 / 1249 (485 / 490; 1678-1681),
 *      1250 / 1251 (200 / 250; 1682-1685).
 *  R   The request lines (#76-80) from a stopped ship: sÿst 1231 Kit Request
 *      Port (decoration spöb 1645 at 0, 0; a landable port spöb 1646 at
 *      (1000, 0)) and sÿst 1232 Kit Request Station (decoration 1647; a
 *      landable station spöb 1648, a clone of stock spöb 299 Holpa Station,
 *      at (1000, 0)).
 *  N   NPC fleets of 6 and 9 escorts (F1c): flët 312 Kit Disc Fleet 6 / 313
 *      Kit Disc Fleet 9 (white lead 720, discs 721-724 in field order),
 *      the only traffic of sÿst 1252 Kit Fleet Six / 1253 Kit Fleet Nine
 *      (ports spöb 1686 / 1687, markets 1688 / 1689).
 *  W   How long a planet's bribe withdrawal lasts: sÿst 1246 Kit Bribe Stay
 *      (gövt 304) with the refusing port spöb 1675 (gövt 304, MinStatus 0) at
 *      (0, 0) and an open port spöb 1677 at (300, 0), linked to sÿst 1247 Kit
 *      Bribe Away (port spöb 1676).
 */
function wave29Resources() {
    const out = [];
    const Y = -1980;
    const port = (id, name, x = 0, y = 0, set = {}) => spob(id, name, x, y, 138, { flags: 0x43, ...set });
    const marker = (id, name, x, y) => spob(id, name, x, y, 132, { flags: 0x20, techLevel: 0, specialTech: [-1, -1, -1] });
    const decoration = (id, name) => spob(id, name, 0, 0, 132, { flags: 0, techLevel: 0, specialTech: [-1, -1, -1] });

    // --- B: a 10,000 t live hulk (as wave 27's liveHulk, no traffic of its own).
    out.push({ type: "shïp", id: 542, name: "Kit Hulk Pointer 10000", clone: "shïp:128", set: { ...shipBase, shortName: "Kit Hulk Pointer 10000",
        longName: "Kit Hulk Pointer 10000", commName: "Kit Hulk Pointer 10000", subtitle: "", armor: 300, shield: 0, accel: 0, speed: 0, turn: 0,
        mass: 10000, freeMass: 100, cargo: 50, ai: 1, strength: 1, crew: 1, flags: 0, flags2: 0, cost: 50000, deathDelay: 10 } });
    out.push({ type: "shän", id: 542, name: "Kit Hulk Pointer 10000", clone: "shän:128", set: { "@0:i16": 1959, "@2:i16": 1960, "@4:i16": 1, "@6:i16": 24, "@8:i16": 24 } });
    const big = dude(473, "Kit Hulk Pointer 10000", 4, 363, 542);
    big.set = { ...big.set, flags: 0x0041 };
    out.push(big);
    [170, 230, 380, 470, 700, 880].forEach((d, i) => {
        const sid = 1222 + i;
        out.push(system(sid, `Kit Blast ${d}`, -800 + 40 * i, Y, 363, [1627 + i, 1633 + i]),
            port(1627 + i, `Kit Blast ${d} Port`), marker(1633 + i, `Kit Blast ${d} Mark`, d, 0));
    });
    // Added during the wave (10,000 t hit at 700 and missed at 880): Kit Blast 760 / 820 (sÿst 1233 / 1234, ports spöb
    // 1649 / 1650, markers 1651 / 1652) on the row y = -2040.
    [760, 820].forEach((d, i) => {
        const sid = 1233 + i;
        out.push(system(sid, `Kit Blast ${d}`, -720 + 40 * i, Y - 60, 363, [1649 + i, 1651 + i]),
            port(1649 + i, `Kit Blast ${d} Port`), marker(1651 + i, `Kit Blast ${d} Mark`, d, 0));
    });
    // And (tighter brackets at 2,000 / 5,000 t): Kit Blast 190 / 210 / 400 / 440 (sÿst 1240-1243, ports spöb
    // 1663-1666, markers 1667-1670) on the row y = -2100.
    [190, 210, 400, 440].forEach((d, i) => {
        const sid = 1240 + i;
        out.push(system(sid, `Kit Blast ${d}`, -800 + 40 * i, Y - 120, 363, [1663 + i, 1667 + i]),
            port(1663 + i, `Kit Blast ${d} Port`), marker(1667 + i, `Kit Blast ${d} Mark`, d, 0));
    });
    // And: is the reach to the victim's CENTRE or its hull? shïp 543 Kit Big Boarder, the Tough boarder (100 / 3000,
    // shïp 528's numbers) drawn with the stock Fed Carrier's shän (143), against the 2,000 t hulk at 230 px (the 24 px
    // Tough missed there).
    out.push({ type: "shïp", id: 543, name: "Kit Big Boarder", clone: "shïp:128", set: { ...shipBase, shortName: "Kit Big Boarder",
        longName: "Kit Big Boarder", commName: "Kit Big Boarder", subtitle: "", accel: 2000, speed: 100, turn: 30, armor: 3000, shield: 100,
        shieldRecharge: 0, mass: 50, freeMass: 1000, cargo: 50, maxGuns: 8, maxTurrets: 8, ai: 3, strength: 50, crew: 10, flags: 0, flags2: 0x00C8 } });
    out.push({ type: "shän", id: 543, name: "Kit Big Boarder", clone: "shän:143" });
    // And the WRECK's side: shïp 544 Kit Hulk Big 2000 (the 2,000 t live hulk with the Fed Carrier's art), düde 474,
    // placed by mïsn 1127 (b9249, the kit's last free mïsn id) like the others.
    out.push({ type: "shïp", id: 544, name: "Kit Hulk Big 2000", clone: "shïp:128", set: { ...shipBase, shortName: "Kit Hulk Big 2000",
        longName: "Kit Hulk Big 2000", commName: "Kit Hulk Big 2000", subtitle: "", armor: 300, shield: 0, accel: 0, speed: 0, turn: 0,
        mass: 2000, freeMass: 100, cargo: 50, ai: 1, strength: 1, crew: 1, flags: 0, flags2: 0, cost: 50000, deathDelay: 10 } });
    out.push({ type: "shän", id: 544, name: "Kit Hulk Big 2000", clone: "shän:143" });
    const bigWreck = dude(474, "Kit Hulk Big 2000", 4, 363, 544);
    bigWreck.set = { ...bigWreck.set, flags: 0x0041 };
    out.push(bigWreck);
    const hulkMisn = (id, name, bit, dudeId) => misn(id, name, bit, { availStel: -1, onAccept: `!b${bit}`, shipCount: 1, shipSyst: -1, shipDude: dudeId,
        shipGoal: -1, shipBehav: -1, shipStart: -2 });
    out.push(...hulkMisn(959, "Kit blast hulk 2000 t", 9245, 463), ...hulkMisn(969, "Kit blast hulk 5000 t DD10", 9246, 459),
        ...hulkMisn(1125, "Kit blast hulk 5000 t DD60", 9247, 457), ...hulkMisn(1126, "Kit blast hulk 10000 t", 9248, 473),
        ...hulkMisn(1127, "Kit blast big hulk 2000 t", 9249, 474));

    // --- G: a usable hypergate at a chosen distance from where the pilot starts.
    const farGate = (sid, d, x, y, startId, gateId) => {
        out.push(system(sid, `Kit Gate Far ${d}`, x, y, 363, [startId, gateId]), decoration(startId, `Kit Gate Far ${d} Start`),
            spob(gateId, `Kit Gate Far ${d}`, d, 0, 1400, { type: 1, flags: 0x11, flags2: 0x1000, govt: -1, minStatus: -32767, techLevel: 0,
                specialTech: [-1, -1, -1], custPic: 37, custSnd: 120, hyperlinks: [1610, ...none8].slice(0, 8) }));
    };
    [500, 1000, 2000].forEach((d, i) => farGate(1228 + i, d, -560 + 40 * i, Y, 1639 + i, 1642 + i));
    // Added during the wave (nothing selected from 500 px): gates at 150 / 300 / 400 px, sÿst 1235-1237 (decorations
    // spöb 1653-1655, gates 1656-1658) on the row y = -2040.
    [150, 300, 400].forEach((d, i) => farGate(1235 + i, d, -640 + 40 * i, Y - 60, 1653 + i, 1656 + i));
    // And (selected from 400, nothing from 500): 450 px, sÿst 1238 (decoration spöb 1659, gate 1660); a DIAGONAL gate
    // at (330, 330) (max 330 < 400 < distance 467 < 500: square or circle?), sÿst 1239 (decoration 1661, gate 1662).
    farGate(1238, 450, -520, Y - 60, 1659, 1660);
    farGate(1239, "Diagonal", -480, Y - 60, 1661, 1662);
    out.at(-1).set.x = 330;
    out.at(-1).set.y = 330;
    // And (450 and the 467 px diagonal both selected): 475 px, sÿst 1244 (decoration 1671, gate 1672), and a far
    // diagonal at (420, 420) (max 420, distance 594: beyond the 500 px miss on the axis), sÿst 1245 (1673, 1674).
    farGate(1244, 475, -640, Y - 120, 1671, 1672);
    farGate(1245, "Diagonal 420", -600, Y - 120, 1673, 1674);
    out.at(-1).set.x = 420;
    out.at(-1).set.y = 420;
    // And (475 selected, 500 not): 485 / 490 px, sÿst 1248 / 1249 (decorations 1678 / 1680, gates 1679 / 1681).
    farGate(1248, 485, -480, Y - 120, 1678, 1679);
    farGate(1249, 490, -440, Y - 120, 1680, 1681);
    // And (150 px cleared, 300 px requested): 200 / 250 px, sÿst 1250 / 1251 (decorations 1682 / 1684, gates 1683 / 1685).
    farGate(1250, 200, -400, Y - 120, 1682, 1683);
    farGate(1251, 250, -360, Y - 120, 1684, 1685);

    // --- R: a port and a station 1,000 px from where the pilot starts.
    out.push(system(1231, "Kit Request Port", -800, Y - 60, 363, [1645, 1646]), decoration(1645, "Kit Request Port Start"), port(1646, "Kit Request Port", 1000, 0));
    out.push(system(1232, "Kit Request Station", -760, Y - 60, 363, [1647, 1648]), decoration(1647, "Kit Request Station Start"),
        spob(1648, "Kit Request Station", 1000, 0, 299, { flags: 0x11 }));

    // --- N (added during the wave): NPC fleets of 6 and 9 escorts (F1c / F1n), placed by their system's DudeTypes as
    // wave 3's flët 300: the white Kit Disc Leader (720) with discs in field order. flët 312 Kit Disc Fleet 6 (red x2,
    // green x2, blue, yellow), flët 313 Kit Disc Fleet 9 (red x3, green x2, blue x2, yellow x2); sÿst 1252 / 1253 Kit
    // Fleet Six / Nine (ports spöb 1686 / 1687 at 0, 0; markets 1688 / 1689 at 1200, 0), avgShips 6, row y = -2100.
    [[312, "Kit Disc Fleet 6", [2, 2, 1, 1], 1252, "Six", -320], [313, "Kit Disc Fleet 9", [3, 2, 2, 2], 1253, "Nine", -280]]
        .forEach(([fid, fname, counts, sid, sname, x], i) => {
            out.push({ type: "flët", id: fid, name: fname, clone: "flët:128", set: { "@0:i16": 720, "@2:i16x4": [721, 722, 723, 724],
                "@10:i16x4": counts, "@18:i16x4": counts, "@26:i16": 363, "@28:i16": sid, "@30:str256": "", "@286:i16": -1, "@288:u16": 0 } });
            const s = system(sid, `Kit Fleet ${sname}`, x, Y - 120, 363, [1686 + i, 1688 + i]);
            s.set = { ...s.set, avgShips: 6, dudes: [-fid, ...none8.slice(1)], dudeProbs: [100, ...zero8.slice(1)] };
            out.push(s, port(1686 + i, `Kit Fleet ${sname} Port`), port(1688 + i, `Kit Fleet ${sname} Market`, 1200, 0));
        });

    // --- W (added during the wave): how long a planet's bribe withdrawal lasts. sÿst 1246 Kit Bribe Stay (gövt 304,
    // wave 22's Kit Bribe Plain govt) holds the refusing port spöb 1675 (gövt 304, MinStatus 0: a pilot at -50 is
    // refused) at (0, 0) and an OPEN port spöb 1677 (gövt -1) at (300, 0) for a land-and-take-off in the same system;
    // it links to sÿst 1247 Kit Bribe Away (port spöb 1676) for a jump out and back. Row y = -2100.
    const stay = system(1246, "Kit Bribe Stay", -560, Y - 120, 304, [1675, 1677]);
    stay.set = { ...stay.set, links: [1247, ...none16].slice(0, 16) };
    const away = system(1247, "Kit Bribe Away", -520, Y - 120, 363, [1676]);
    away.set = { ...away.set, links: [1246, ...none16].slice(0, 16) };
    out.push(stay, away, port(1675, "Kit Bribe Stay Port", 0, 0, { govt: 304, minStatus: 0 }), port(1677, "Kit Bribe Stay Open", 300, 0),
        port(1676, "Kit Bribe Away Port"));
    return out;
}

/**
 * Wave-28 experiments (docs/reference_experiments.md, "... wave 28").
 * Nothing retired. sÿst 1214-1221, spöb 1619-1626, shïp 536-541, düde
 * 467-472, ränk 204, mïsn 958 (bit 9244; offer text dësc 4830). Map row
 * y = -1920 (x -300 .. 0) plus (-700,-1920) and (-660,-1920). The next free
 * ids: sÿst 1222+, spöb 1627+ (spares 1495, 1496, 1499), shïp 542+, düde
 * 473+, ränk 205+, mïsn 959 (then the stock gap 919-959 is used up: find a
 * new mïsn range), gövt 297 and below, flët 312+, wëap 295+, oütf 467+,
 * bits 9245+.
 *
 * LESSONS: only the 90 t and 99 t hulks were driven (both did nothing, so
 * 60-95 were not needed). A ship's ordinary death beside the player is the
 * same blast as a plunder trip, and its reach is a SQUARE, so the
 * w28_death_at* scenarios (the board loop's fire point used as a kill
 * distance) read hit / no hit by max(|dx|, |dy|), not by distance.
 *
 *  P   The self-destruct blast's cut-off between 50 t (nothing, wave 26) and
 *      100 t (28.4, wave 27): live immobile hulks like wave 27's (AI 4 of
 *      the neutral gövt 363, 300 armor, DeathDelay 10) of 60 / 70 / 80 / 90
 *      / 95 / 99 t: shïp 536-541 Kit Hulk Pointer 60 ... 99, düde 467-472,
 *      the only traffic of sÿst 1214-1219 Kit Board 60 ... 99 (ports spöb
 *      1619-1624), at (-300 .. 0, -1920).
 *  G   A hypergate that REFUSES the player (the clearance lines' denied
 *      case): sÿst 1220 Kit Gate Deny (-700,-1920; gövt 363), its only
 *      stellar the kit hypergate spöb 1625 owned by gövt 363 with MinStatus
 *      100 (a clean record is 0), HyperLinks to N1's gate 1610.
 *  M   ränk 0x0200 against a MinStatus refusal: ränk 204 Kit Land Anywhere
 *      Rank (AffilGovt 363, Flags 0x0200), given by offer 958 (b9244,
 *      OnAccept K204) at Kit Mixed Open (spöb 1490, wave 24's sÿst 1187),
 *      next to Kit Map Picky (1188: port 1491 MinStatus 100, gövt 363).
 *  H   The hail pane on another ODD overflow: sÿst 1221 Kit Hail Jupiter
 *      (-660,-1920), its only stellar spöb 1626 (a clone of stock Jupiter,
 *      spöb 159, with its 325 x 325 rlëD 2005, made a landable port).
 */
function wave28Resources() {
    const out = [];
    const Y = -1920;
    const traffic = (s, dudes, avgShips) => {
        s.set = { ...s.set, dudes: [...dudes.map((d) => d[0]), ...none8].slice(0, 8), dudeProbs: [...dudes.map((d) => d[1]), ...zero8].slice(0, 8), avgShips };
        return s;
    };
    const port = (id, name, x = 0, y = 0, set = {}) => spob(id, name, x, y, 138, { flags: 0x43, ...set });
    const shareRled = (id, name, rledId, size, set) => [
        { type: "shïp", id, name, clone: "shïp:128", set: { ...shipBase, shortName: name, longName: name, commName: name, subtitle: "", ...set } },
        { type: "shän", id, name, clone: "shän:128", set: { "@0:i16": rledId, "@2:i16": rledId + 1, "@4:i16": 1, "@6:i16": size, "@8:i16": size } },
    ];
    const RLED_POINTER = 1959;

    // --- P: the blast cut-off between 50 and 100 t.
    [60, 70, 80, 90, 95, 99].forEach((mass, i) => {
        const shipId = 536 + i, dudeId = 467 + i, sysId = 1214 + i;
        const name = `Kit Hulk Pointer ${mass}`;
        out.push(...shareRled(shipId, name, RLED_POINTER, 24, { armor: 300, shield: 0, accel: 0, speed: 0, turn: 0, mass, freeMass: 100, cargo: 50,
            ai: 1, strength: 1, crew: 1, flags: 0, flags2: 0, cost: 50000, deathDelay: 10 }));
        const d = dude(dudeId, name, 4, 363, shipId);
        d.set = { ...d.set, flags: 0x0041 };
        out.push(d, traffic(system(sysId, `Kit Board ${mass}`, -300 + 60 * i, Y, 363, [sysId + 405]), [[dudeId, 100]], 1),
            port(sysId + 405, `Kit Board ${mass} Port`));
    });

    // --- G: a hypergate that refuses the player (MinStatus 100 at a clean record).
    out.push(system(1220, "Kit Gate Deny", -700, Y, 363, [1625]));
    out.push(spob(1625, "Kit Gate Deny", 0, 0, 1400, { type: 1, flags: 0x11, flags2: 0x1000, govt: 363, minStatus: 100, techLevel: 0,
        specialTech: [-1, -1, -1], custPic: 37, custSnd: 120, hyperlinks: [1610, ...none8].slice(0, 8) }));

    // --- M: ränk 0x0200 against a MinStatus refusal (wave 24's Kit Map Picky, gövt 363, port MinStatus 100).
    out.push({ type: "ränk", id: 204, name: "Kit Land Anywhere Rank", clone: "ränk:128",
        set: { "@0:i16": 1, "@2:i16": 363, "@4:i16": 100, "@6:i32": 0, "@10:i32": 0, "@22:i16": 0x0200 } });
    out.push(...misn(958, "Kit land-anywhere rank of 363", 9244, { availStel: 1490, onAccept: "!b9244 K204" }));

    // --- H: the hail pane's width on another ODD overflow: a landable port with Jupiter's 325 x 325 art (rlëD 2005).
    out.push(system(1221, "Kit Hail Jupiter", -660, Y, 363, [1626]));
    out.push(spob(1626, "Kit Hail Jupiter", 0, 0, 159, { flags: 0x43, govt: -1, minStatus: -32767 }));
    return out;
}

/**
 * Wave-27 experiments (docs/reference_experiments.md, "... wave 27").
 * Nothing retired. sÿst 1204-1213, spöb 1610-1618, shïp 529-535, düde
 * 461-466, gövt 298, wëap 294, oütf 466, mïsn 957 (bit 9243; offer text
 * dësc 4829). Map rows y = -1860 / -1920. The next free ids: sÿst 1214+,
 * spöb 1619+ (spares 1495, 1496, 1499), shïp 536+, düde 467+, mïsn 958-959
 * (then the stock gap 919-959 is used up: find a new mïsn range), gövt 297
 * and below, flët 312+, wëap 295+, oütf 467+, bits 9244+.
 *
 * LESSONS: two kit systems at one map position draw as one dot (Kit Map
 * Permit first sat on wave 26's Kit Board Heavy Quick, -760,-1800). Check a
 * new one: node -e 'import("./kits/testkit.mjs").then(m => { const p = new
 * Map(); for (const r of m.default.resources) if (r.type === "sÿst") { const
 * k = r.set.x + "," + r.set.y; if (p.has(k)) console.log(k, p.get(k), r.id);
 * else p.set(k, r.id); } })' (four old pairs, 2059/2078, 1550/2099,
 * 1510/2085, 1511/2082, are known). A live AI 4 hulk is not always on the
 * radar at Enter Ship (2 "target not found" in 13 plunder runs): rerun.
 *
 *  G   The gate map's UNEXPLORED destination that is a hyperspace NEIGHBOUR
 *      (wave 25's A2 was not one: arrow, no dot) and ordinary hyperspace
 *      lanes on the gate map: sÿst 1204 Kit Gate N1 (-760,-1860; its only
 *      stellar the usable kit hypergate spöb 1610, HyperLinks 1611 + 1612;
 *      hyperspace links 1205, 1207, 1208), sÿst 1205 Kit Gate N2 (-700,-1860,
 *      gate spöb 1611 -> 1610; linked to 1204 by hyperspace too: the
 *      unexplored NEIGHBOUR), sÿst 1206 Kit Gate N3 (-760,-1920, gate spöb
 *      1612 -> 1610; NOT a hyperspace neighbour: wave 25's A2 control),
 *      sÿst 1207 Kit Gate Lane (-820,-1860, no stellar: an explored ordinary
 *      neighbour, a plain hyperspace lane from N1).
 *  M   A refusal that is not MinStatus (a travel permit): gövt 298 Kit Permit
 *      Owner (Require 0x1: the kit hulls contribute nothing, so every port of
 *      the govt refuses) owns sÿst 1208 Kit Map Permit (-820,-1920; port spöb
 *      1613, MinStatus -32767), a hyperspace neighbour of N1.
 *  P   The self-destruct blast's mass curve (wave 26: none visible from 50
 *      t, 100 shield + about 200 armor from 5,000 t, floored): live hulks
 *      (AI 4 of the neutral gövt 363, immobile, DeathDelay 10, like 526)
 *      shïp 529 Kit Hulk Pointer 500 / 530 1000 / 531 2000 (Mass 500 / 1,000
 *      / 2,000 t), düde 461-463, sÿst 1209-1211 Kit Board 500 / 1000 / 2000
 *      (ports spöb 1614-1616); added during the wave: shïp 534 Kit Hulk
 *      Pointer 200 (200 t), düde 465, sÿst 1212 Kit Board 200 (port spöb
 *      1617); shïp 535 Kit Hulk Pointer 100, düde 466, sÿst 1213 / spöb 1618. Whether the floor IS the disable threshold:
 *      shïp 532 Kit Ring Crawler Fragile Ten (the Fragile boarder, 100 / 300,
 *      with shïp Flags 0x0010 "disabled at 10% armor instead of 33%").
 *  D   The UNPROVOKED disabled fleet lead: wëap 294 Kit Disable Missile (the
 *      Kit Disable Gun's 3000 shield / 2100 armor in one GUIDED missile,
 *      reload 30000 so one shot a run; a guided shot homes on its target and
 *      should pass other ships), oütf 466. Used on wave 24's Kit Fleet Big
 *      (sÿst 1192, flët 308).
 *  R19 What triggers a call with no hit: shïp 533 Kit RV Guard S50 Unarmed
 *      (shïp 494 with no weapon), düde 464 (AI 4, gövt 311), placed by mïsn
 *      957 (b9243, offered on landing at Kit Reinf Far M's 3,000 px port spöb
 *      1449) with ShipBehav 0: it targets the player but can never fire.
 */
function wave27Resources() {
    const out = [];
    const Y = -1860;
    const traffic = (s, dudes, avgShips) => {
        s.set = { ...s.set, dudes: [...dudes.map((d) => d[0]), ...none8].slice(0, 8), dudeProbs: [...dudes.map((d) => d[1]), ...zero8].slice(0, 8), avgShips };
        return s;
    };
    const port = (id, name, x = 0, y = 0, set = {}) => spob(id, name, x, y, 138, { flags: 0x43, ...set });
    const shareRled = (id, name, rledId, size, set) => [
        { type: "shïp", id, name, clone: "shïp:128", set: { ...shipBase, shortName: name, longName: name, commName: name, subtitle: "", ...set } },
        { type: "shän", id, name, clone: "shän:128", set: { "@0:i16": rledId, "@2:i16": rledId + 1, "@4:i16": 1, "@6:i16": size, "@8:i16": size } },
    ];
    const RLED = { pointer: 1959, ring: 1955 };
    const links = (ids) => [...ids, ...none16].slice(0, 16);

    // --- G: a gate whose unexplored destination is also a hyperspace neighbour.
    const gate = (sid, pid, name, x, y, hyperlinks, sysLinks) => {
        const s = system(sid, `Kit Gate ${name}`, x, y, 363, pid === undefined ? [] : [pid]);
        s.set = { ...s.set, links: links(sysLinks) };
        out.push(s);
        if (pid !== undefined) {
            out.push(spob(pid, `Kit Gate ${name}`, 0, 0, 1400, { type: 1, flags: 0x11, flags2: 0x1000, govt: -1, minStatus: -32767, techLevel: 0,
                specialTech: [-1, -1, -1], custPic: 37, custSnd: 120, hyperlinks: [...hyperlinks, ...none8].slice(0, 8) }));
        }
    };
    gate(1204, 1610, "N1", -760, Y, [1611, 1612], [1205, 1207, 1208]);
    gate(1205, 1611, "N2", -700, Y, [1610], [1204]);
    gate(1206, 1612, "N3", -760, Y - 60, [1610], []);
    gate(1207, undefined, "Lane", -820, Y, [], [1204]);

    // --- M: a travel-permit refusal.
    out.push(govt(298, "Kit Permit Owner", { require: 1, crimeTol: 30000, classes: [298, -1, -1, -1] }));
    // At (-820,-1920): (-760,-1800) is wave 26's Kit Board Heavy Quick (the first gate run read the two dots as one).
    const permit = system(1208, "Kit Map Permit", -820, Y - 60, 298, [1613]);
    permit.set = { ...permit.set, links: links([1204]) };
    out.push(permit, port(1613, "Kit Map Permit Port", 0, 0, { govt: 298 }));

    // --- P: live hulks of 500 / 1,000 / 2,000 t; a boarder disabled at 10%.
    const liveHulk = (shipId, mass, dudeId, sysId, x) => {
        const name = `Kit Hulk Pointer ${mass}`;
        out.push(...shareRled(shipId, name, RLED.pointer, 24, { armor: 300, shield: 0, accel: 0, speed: 0, turn: 0, mass, freeMass: 100, cargo: 50,
            ai: 1, strength: 1, crew: 1, flags: 0, flags2: 0, cost: 50000, deathDelay: 10 }));
        const d = dude(dudeId, name, 4, 363, shipId);
        d.set = { ...d.set, flags: 0x0041 };
        out.push(d, traffic(system(sysId, `Kit Board ${mass}`, x, Y - 60, 363, [sysId + 405]), [[dudeId, 100]], 1),
            port(sysId + 405, `Kit Board ${mass} Port`));
    };
    liveHulk(529, 500, 461, 1209, -600);
    liveHulk(530, 1000, 462, 1210, -540);
    liveHulk(531, 2000, 463, 1211, -480);
    // Added during the wave (the 50 t hulk of wave 26 did nothing visible, 500 t about 44): shïp 534 Kit Hulk Pointer 200
    // (200 t), düde 465, sÿst 1212 Kit Board 200 (port spöb 1617).
    liveHulk(534, 200, 465, 1212, -420);
    // And (the 200 t blast fit the 500-30,000 t line, 50 t did nothing): shïp 535 Kit Hulk Pointer 100, düde 466,
    // sÿst 1213 Kit Board 100 (port spöb 1618).
    liveHulk(535, 100, 466, 1213, -360);
    const crawler = { accel: 2000, speed: 100, turn: 30, armor: 300, shield: 100, shieldRecharge: 0, mass: 50, freeMass: 1000, cargo: 50, maxGuns: 8, maxTurrets: 8,
        ai: 3, strength: 50, crew: 10, flags: 0x0010, flags2: 0x00C8 };
    out.push(...shareRled(532, "Kit Ring Crawler Fragile Ten", RLED.ring, 24, crawler));

    // --- D: a guided disabling shot for the unprovoked fleet lead.
    out.push(weap(294, "Kit Disable Missile", 134, { reload: 30000, duration: 300, armorDamage: 2100, shieldDamage: 3000, guidance: 1, speed: 600, guidedTurn: 60,
        proxRadius: 0, blastRadius: 0, flags: 0, seekerFlags: 0, jamVuln: zero4 }));
    out.push(gun(466, "Kit Disable Missile", 294));

    // --- R19: an attacker that can never fire.
    out.push(...shareRled(533, "Kit RV Guard S50 Unarmed", RLED.pointer, 24, { accel: 100, speed: 100, turn: 30, mass: 50, freeMass: 100, cargo: 10, crew: 10,
        flags: 0, flags2: 0, ai: 4, armor: 30000, shield: 30000, shieldRecharge: 0, strength: 50 }));
    out.push(dude(464, "Kit RV Guard S50 Unarmed", 4, 311, 533));
    out.push(...misn(957, "Kit R unarmed attacker far port", 9243, { availStel: 1449, shipCount: 1, shipSyst: -1, shipDude: 464, shipGoal: -1,
        shipBehav: 0, shipStart: -1 }));
    return out;
}

/**
 * Wave-26 experiments (docs/reference_experiments.md, "... wave 26").
 * Nothing retired. sÿst 1197-1203, spöb 1603-1609, shïp 517-528, düde
 * 456-460, gövt 299, flët 310-311, mïsn 956 (bit 9242; offer text dësc
 * 4828). Map rows y = -1760 / -1800. The next free ids: sÿst 1204+, spöb
 * 1610+ (spares 1495, 1496, 1499), shïp 529+, düde 461+, mïsn 957-959 (the
 * stock gap ends at 959; then a new mïsn range is needed), gövt 298 and
 * below, flët 312+, wëap 294+, oütf 466+, bits 9243+.
 *
 * LESSONS: Flags 0x0008 ("player's shots won't hit") does NOT work through
 * an ATTRIBUTES InherentGovt (1299): the bolt disabled the escort; a
 * derelict placed by traffic can sit 3,000 px out where the walk never
 * reaches it (use the live AI 4 kind).
 *
 *  R19 An ARMED AI 3 victim (waves 22 / 24's AI 3 victims were the unarmed
 *      mobile S50 and left at once): shïp 517 Kit RV Mobile S50 AI3 Armed
 *      (shïp 499 with the Kit Escort Gun turret), düde 456 (AI 3, gövt 311),
 *      the only traffic of sÿst 1197 Kit Reinf AI3 Armed (gövt 311, flët
 *      305, ReinfTime 300, ReinfIntrval 0; port spöb 1603), avgShips 1.
 *  R19 The arrival centre: mïsn 956 (bit 9242), offered on landing at Kit
 *      Reinf Far M's port (spöb 1449, 3,000 px from the centre of sÿst
 *      1158: no traffic, ReinfTime 150): one düde 441 (the AI 4 Kit RV
 *      Guard S50 of gövt 311) at ShipStart -1 with ShipBehav 0 (always
 *      attacks the player), so the victim comes to the player at the far
 *      port instead of wandering off.
 *  D   An UNPROVOKED disabled fleet lead (wave 25: the bolt hit an escort
 *      first): flët 310 Kit Pass Fleet (gövt 363), lead shïp 518 Kit TF Lead
 *      (cyan, AI 3, Speed 300, Kit Escort Gun, 3000 / 3000: one Kit Disable
 *      Gun hit disables), escorts shïp 519 Kit TF Red / 520 Kit TF Green
 *      (the same with InherentGovt 1299: the ATTRIBUTES govt gövt 299 Kit
 *      Shots Pass Attr, Flags 0x0008 "player's shots won't hit"), the only
 *      traffic of sÿst 1198 Kit Fleet Pass (port spöb 1604), avgShips 3.
 *      Fallback: flët 311 Kit Slow Escort Fleet (lead 518, escorts shïp 521
 *      / 522 Kit TS Red / Green at Speed / Accel 40, so they trail), the
 *      only traffic of sÿst 1199 Kit Fleet Slow (port spöb 1605).
 *  P   Plunder self-destruct damage: shïp 523 Kit Ring Crawler Fragile (the
 *      Kit Ring Crawler with 100 shield / 300 armor, no recharge: one point
 *      of damage is 1% of the shield bar); shïp 524 Kit Hulk Pointer Heavy
 *      (the derelict Kit Hulk Pointer with Mass 5000 and DeathDelay 60, the
 *      Bible's "huge explosion proportional to mass"), düde 457 (AI 4 of
 *      the neutral gövt 363 like wave 8's Kit Live Pointer: the player
 *      disables it; a derelict version sat 3,000 px out of reach), the only
 *      traffic of sÿst 1200 Kit Board Heavy (port spöb 1606).
 *      Added during the wave: shïp 526 Kit Hulk Pointer Heavy Quick (5,000 t,
 *      DeathDelay 10; düde 459, sÿst 1202 / spöb 1608), 527 Kit Hulk Pointer
 *      Massive (30,000 t, DeathDelay 60; düde 460, sÿst 1203 / spöb 1609),
 *      both live; shïp 528 Kit Ring Crawler Tough (100 shield / 3000 armor).
 *  C   A faster coast: shïp 525 Kit Coast Fast Trader (wave 25's 516 at
 *      Speed / Accel 250), düde 458 (AI 1, gövt 312), the only traffic of
 *      sÿst 1201 Kit Coast Fast Range (port spöb 1607), avgShips 1.
 */
function wave26Resources() {
    const out = [];
    const Y = -1760;
    const traffic = (s, dudes, avgShips) => {
        s.set = { ...s.set, dudes: [...dudes.map((d) => d[0]), ...none8].slice(0, 8), dudeProbs: [...dudes.map((d) => d[1]), ...zero8].slice(0, 8), avgShips };
        return s;
    };
    const port = (id, name, x = 0, y = 0, set = {}) => spob(id, name, x, y, 138, { flags: 0x43, ...set });
    const shareRled = (id, name, rledId, size, set) => [
        { type: "shïp", id, name, clone: "shïp:128", set: { ...shipBase, shortName: name, longName: name, commName: name, subtitle: "", ...set } },
        { type: "shän", id, name, clone: "shän:128", set: { "@0:i16": rledId, "@2:i16": rledId + 1, "@4:i16": 1, "@6:i16": size, "@8:i16": size } },
    ];
    const fleet = (id, name, lead, escorts, govtId, linkSyst) => ({ type: "flët", id, name, clone: "flët:128",
        set: { "@0:i16": lead, "@2:i16x4": escorts.map((e) => e[0]), "@10:i16x4": escorts.map((e) => e[1]), "@18:i16x4": escorts.map((e) => e[2]),
            "@26:i16": govtId, "@28:i16": linkSyst, "@30:str256": "", "@286:i16": -1, "@288:u16": 0 } });
    const RLED = { red: 1971, green: 1972, cyan: 1976, pointer: 1959, ring: 1955 };
    const armed = { weapons: [365, -1, -1, -1], weaponCounts: [1, 0, 0, 0], weaponAmmo: [0, 0, 0, 0] };
    const mobile = { accel: 300, speed: 300, turn: 30, mass: 50, freeMass: 100, cargo: 10, crew: 10, flags: 0, flags2: 0 };

    // --- R19: an armed AI 3 victim.
    out.push(...shareRled(517, "Kit RV Mobile S50 AI3 Armed", RLED.pointer, 24, { ...mobile, ai: 3, armor: 30000, shield: 30000, shieldRecharge: 0, strength: 50, ...armed }));
    out.push(dude(456, "Kit RV Mobile S50 AI3 Armed", 3, 311, 517));
    const ai3 = traffic(system(1197, "Kit Reinf AI3 Armed", -760, Y, 311, [1603]), [[456, 100]], 1);
    ai3.set = { ...ai3.set, reinfFleet: 305, reinfTime: 300, reinfInterval: 0 };
    out.push(ai3, port(1603, "Kit Reinf AI3 Armed Port"));

    // --- R19: the arrival centre, a victim that comes to the player at the 3,000 px port.
    out.push(...misn(956, "Kit R attacker 441 far port", 9242, { availStel: 1449, shipCount: 1, shipSyst: -1, shipDude: 441, shipGoal: -1,
        shipBehav: 0, shipStart: -1 }));

    // --- D: a fleet whose escorts the player's shots pass through; a fleet whose escorts trail.
    out.push(govt(299, "Kit Shots Pass Attr", { flags: 0x0008, classes: [299, -1, -1, -1], crimeTol: 30000 }));
    const fleetHull = { ...mobile, ai: 3, armor: 3000, shield: 3000, strength: 50, ...armed };
    out.push(...shareRled(518, "Kit TF Lead", RLED.cyan, 24, fleetHull));
    out.push(...shareRled(519, "Kit TF Red", RLED.red, 24, { ...fleetHull, govt: 1299 }));
    out.push(...shareRled(520, "Kit TF Green", RLED.green, 24, { ...fleetHull, govt: 1299 }));
    out.push(fleet(310, "Kit Pass Fleet", 518, [[519, 1, 1], [520, 1, 1], [519, 0, 0], [519, 0, 0]], 363, 1198));
    out.push(traffic(system(1198, "Kit Fleet Pass", -680, Y, 363, [1604]), [[-310, 100]], 3), port(1604, "Kit Fleet Pass Port"));
    out.push(...shareRled(521, "Kit TS Red", RLED.red, 24, { ...fleetHull, speed: 40, accel: 40 }));
    out.push(...shareRled(522, "Kit TS Green", RLED.green, 24, { ...fleetHull, speed: 40, accel: 40 }));
    out.push(fleet(311, "Kit Slow Escort Fleet", 518, [[521, 1, 1], [522, 1, 1], [521, 0, 0], [521, 0, 0]], 363, 1199));
    out.push(traffic(system(1199, "Kit Fleet Slow", -600, Y, 363, [1605]), [[-311, 100]], 3), port(1605, "Kit Fleet Slow Port"));

    // --- P: a fragile boarder and a heavy derelict.
    const crawler = { accel: 2000, speed: 100, turn: 30, armor: 300, shield: 100, shieldRecharge: 0, mass: 50, freeMass: 1000, cargo: 50, maxGuns: 8, maxTurrets: 8,
        ai: 3, strength: 50, crew: 10, flags: 0, flags2: 0x00C8 };
    out.push(...shareRled(523, "Kit Ring Crawler Fragile", RLED.ring, 24, crawler));
    out.push(...shareRled(524, "Kit Hulk Pointer Heavy", RLED.pointer, 24, { armor: 300, shield: 0, accel: 0, speed: 0, turn: 0, mass: 5000, freeMass: 100, cargo: 50,
        ai: 1, strength: 1, crew: 1, flags: 0, flags2: 0, cost: 50000, deathDelay: 60 }));
    // Built first as a derelict (gövt 378): it was placed ~3,000 px out and the walk never reached it, so it is wave
    // 8's LIVE kind instead (AI 4 of the neutral gövt 363, immobile; the player disables it), like Kit Board Live.
    const heavy = dude(457, "Kit Hulk Pointer Heavy", 4, 363, 524);
    heavy.set = { ...heavy.set, flags: 0x0041 };
    out.push(heavy, traffic(system(1200, "Kit Board Heavy", -520, Y, 363, [1606]), [[457, 100]], 1), port(1606, "Kit Board Heavy Port"));
    // Added after the first trips (the 5,000 t hulk's trip took 100 shield + about 200 armor, the 50 t one nothing
    // visible): which of Mass and DeathDelay sets it, and is the player's armor floored at a third? shïp 526 Kit Hulk
    // Pointer Heavy Quick (5,000 t, DeathDelay 10), düde 459, sÿst 1202 / spöb 1608; shïp 527 Kit Hulk Pointer
    // Massive (30,000 t, DeathDelay 60), düde 460, sÿst 1203 / spöb 1609. Both live (AI 4, gövt 363).
    const liveHulk = (shipId, name, mass, deathDelay, dudeId, sysId, x) => {
        out.push(...shareRled(shipId, name, RLED.pointer, 24, { armor: 300, shield: 0, accel: 0, speed: 0, turn: 0, mass, freeMass: 100, cargo: 50,
            ai: 1, strength: 1, crew: 1, flags: 0, flags2: 0, cost: 50000, deathDelay }));
        const d = dude(dudeId, name, 4, 363, shipId);
        d.set = { ...d.set, flags: 0x0041 };
        out.push(d, traffic(system(sysId, `Kit Board ${name.replace("Kit Hulk Pointer ", "")}`, x, Y - 40, 363, [sysId + 406]), [[dudeId, 100]], 1),
            port(sysId + 406, `Kit Board ${name.replace("Kit Hulk Pointer ", "")} Port`));
    };
    liveHulk(526, "Kit Hulk Pointer Heavy Quick", 5000, 10, 459, 1202, -760);
    liveHulk(527, "Kit Hulk Pointer Massive", 30000, 60, 460, 1203, -680);
    // Both left the Fragile boarder at 0 shield and a THIRD of its armor: a floor at the disable threshold, or a fixed
    // blast? shïp 528 Kit Ring Crawler Tough (100 shield / 3000 armor): a floor leaves ~1000, a ~300 blast ~2,800.
    out.push(...shareRled(528, "Kit Ring Crawler Tough", RLED.ring, 24, { ...crawler, armor: 3000 }));

    // --- C: a faster disabled coast.
    out.push(...shareRled(525, "Kit Coast Fast Trader", RLED.pointer, 24, { ...mobile, accel: 250, speed: 250, strength: 50, ai: 1, armor: 3000, shield: 3000 }),
        dude(458, "Kit Coast Fast Trader", 1, 312, 525));
    out.push(traffic(system(1201, "Kit Coast Fast Range", -440, Y, 363, [1607]), [[458, 100]], 1), port(1607, "Kit Coast Fast Range Port"));
    return out;
}

/**
 * Wave-25 experiments (docs/reference_experiments.md, "... wave 25").
 * Nothing retired. **A new spöb range 1600-1999** (above the stock maximum
 * 1420 and below the kit's 2000; checked unused by the stock .ndat files and
 * the kit: the 1421-1599 ranges are full). sÿst 1189 and 1195-1196, spöb
 * 1600-1602, shïp 515-516, düde 455. Map row y = -1700. The next free ids:
 * sÿst 1197+, spöb 1603+ (spares 1495, 1496, 1499), shïp 517+, düde 456+,
 * mïsn 956+ (the stock gap ends at 959), gövt 299 and below (stock gövt stop
 * at 195; none of 196-299 is used), flët 310+, wëap 294+, oütf 466+, bits
 * 9242+.
 *
 *  H   The hire pool's gate (NovaJS e87f6873 takes an exact SpecialTech
 *      match; wave 23 saw only TechLevel): sÿst 1189 Kit Hire Special (363),
 *      port spöb 1600 (land, commodities, shipyard, bar; TechLevel 0,
 *      SpecialTech 9100); shïp 515 Kit Hire Special Disc (shïp 514 with
 *      TechLevel 9100: it can only come through the SpecialTech; HireRandom
 *      100, BuyRandom 100). sÿst 1195 Kit Hire None (363), port spöb 1601
 *      (the same flags, TechLevel 0, no SpecialTech): nothing for hire (no
 *      stock hull with HireRandom > 0 has TechLevel below 3; 514 is TL 1).
 *  C   A disabled ship's coast: shïp 516 Kit Coast Trader (wave 18's magenta
 *      pointer trader 466 with Speed / Accel 100, so its coast stays on the
 *      radar), düde 455 (AI 1, gövt 312), the only traffic of sÿst 1196 Kit
 *      Coast Range (363, port spöb 1602), avgShips 1.
 */
function wave25Resources() {
    const out = [];
    const traffic = (s, dudes, avgShips) => {
        s.set = { ...s.set, dudes: [...dudes.map((d) => d[0]), ...none8].slice(0, 8), dudeProbs: [...dudes.map((d) => d[1]), ...zero8].slice(0, 8), avgShips };
        return s;
    };
    const shareRled = (id, name, rledId, size, set) => [
        { type: "shïp", id, name, clone: "shïp:128", set: { ...shipBase, shortName: name, longName: name, commName: name, subtitle: "", ...set } },
        { type: "shän", id, name, clone: "shän:128", set: { "@0:i16": rledId, "@2:i16": rledId + 1, "@4:i16": 1, "@6:i16": size, "@8:i16": size } },
    ];
    // Land 0x01, commodities 0x02, shipyard 0x08, bar 0x40.
    const hirePort = (id, name, specialTech) => spob(id, name, 0, 0, 138, { flags: 0x4b, techLevel: 0, specialTech });

    // --- H: a TechLevel-0 port whose only hireable hull comes through its SpecialTech; a port with nothing for hire.
    out.push(...shareRled(515, "Kit Hire Special Disc", 1974, 24, { accel: 600, speed: 600, turn: 60, armor: 30000, shield: 30000, mass: 50, freeMass: 100,
        cargo: 10, ai: 3, strength: 50, flags: 0, flags2: 0, cost: 10000, hireRandom: 100, buyRandom: 100, techLevel: 9100 }));
    out.push(system(1189, "Kit Hire Special", -760, -1700, 363, [1600]), hirePort(1600, "Kit Hire Special Port", [9100, -1, -1]));
    out.push(system(1195, "Kit Hire None", -680, -1700, 363, [1601]), hirePort(1601, "Kit Hire None Port", [-1, -1, -1]));

    // --- C: a slow AI 1 trader to disable in flight and watch coast.
    out.push(...shareRled(516, "Kit Coast Trader", 1959, 24, { accel: 100, speed: 100, turn: 30, mass: 50, freeMass: 100, cargo: 10, strength: 50, crew: 10,
        flags: 0, flags2: 0, ai: 1, armor: 3000, shield: 3000 }), dude(455, "Kit Coast Trader", 1, 312, 516));
    out.push(traffic(system(1196, "Kit Coast Range", -600, -1700, 363, [1602]), [[455, 100]], 1), spob(1602, "Kit Coast Range Port", 0, 0, 138, { flags: 0x43 }));
    return out;
}

/**
 * Wave-23 experiments (docs/reference_experiments.md, "... wave 23").
 * Nothing retired. sÿst 1174-1179, spöb 1476-1481, shïp 511-514, düde
 * none, gövt 301, flët 307. Map rows y = -1340 to -1470 (the R1 star). The
 * next free ids: sÿst 1180+, spöb 1482+, shïp 515+, düde 454+, mïsn 956+
 * (the stock gap ends at 959), gövt 300 and below, flët 308+, wëap 294+,
 * oütf 466+, bits 9242+.
 *
 *  S   Fleet escort scans (NovaJS f75e50dc, the Heraan Firebird): gövt 301
 *      Kit Scan Fleet (ScanMask 0x0001, ScanFine 500, SmugPenalty 50,
 *      CrimeTol 30000 so a find never makes the pilot hostile) owns sÿst
 *      1174 Kit Fleet Scan (port spöb 1476 at (0,0)); its only traffic is
 *      flët 307 Kit Scan Fleet: lead shïp 511 Kit SF Lead (cyan disc, AI 3)
 *      and one each of shïp 512 Kit SF Escort Red / 513 Kit SF Escort Green
 *      (AI 4), all one Kit Escort Gun, 3000 / 3000; avgShips 3. A clean pilot
 *      and one carrying oütf 458 Kit Contraband Pod (ScanMask 0x0001) sit
 *      by the port.
 *  M   R1 map dots vs a govt's FLAGS: sÿst 1175 Kit Map Hub (363, port
 *      1477) linked to 1176 Kit Map Attacks (owner 362 Kit Raider Govt,
 *      0x0004, port 1478 of 362), 1177 Kit Map Xeno (owner 344 Kit Xeno,
 *      0x0001, port 1479 of 344), 1178 Kit Map Wanted (owner 360 Kit Escort
 *      Govt, CrimeTol 10: the pilot carries -500 there; port 1480 of 360) and
 *      1179 Kit Map Clean (363, port 1481); 1176 - 1177 are also linked, so
 *      a run can go hub -> 1176 -> 1177. No traffic anywhere.
 *  H   Stellar hail: spöb 1480 is a STATION (Flags 0x11 | 0x02,
 *      MinStatus 0) on spöb Type 1, the 150 px, 42-frame hypergate art (not
 *      a gate): a hostile, animated station's comm.
 */
function wave23Resources() {
    const out = [];
    const links = (...ids) => [...ids, ...none16].slice(0, 16);
    const traffic = (s, dudes, avgShips) => {
        s.set = { ...s.set, dudes: [...dudes.map((d) => d[0]), ...none8].slice(0, 8), dudeProbs: [...dudes.map((d) => d[1]), ...zero8].slice(0, 8), avgShips };
        return s;
    };
    const port = (id, name, x = 0, y = 0, set = {}) => spob(id, name, x, y, 138, { flags: 0x43, ...set });
    const shareRled = (id, name, rledId, size, set) => [
        { type: "shïp", id, name, clone: "shïp:128", set: { ...shipBase, shortName: name, longName: name, commName: name, subtitle: "", ...set } },
        { type: "shän", id, name, clone: "shän:128", set: { "@0:i16": rledId, "@2:i16": rledId + 1, "@4:i16": 1, "@6:i16": size, "@8:i16": size } },
    ];
    const fleet = (id, name, lead, escorts, govtId, linkSyst) => ({ type: "flët", id, name, clone: "flët:128",
        set: { "@0:i16": lead, "@2:i16x4": escorts.map((e) => e[0]), "@10:i16x4": escorts.map((e) => e[1]), "@18:i16x4": escorts.map((e) => e[2]),
            "@26:i16": govtId, "@28:i16": linkSyst, "@30:str256": "", "@286:i16": -1, "@288:u16": 0 } });
    const armed = { weapons: [365, -1, -1, -1], weaponCounts: [1, 0, 0, 0], weaponAmmo: [0, 0, 0, 0] };
    const hull = { accel: 300, speed: 300, turn: 30, mass: 50, freeMass: 100, cargo: 10, crew: 10, flags: 0, flags2: 0,
        armor: 3000, shield: 3000, strength: 50, ...armed };

    // --- S: an AI 3 lead and two AI 4 escorts of a ScanMask govt.
    out.push(govt(301, "Kit Scan Fleet", { scanMask: 0x0001, scanFine: 500, smugPenalty: 50, crimeTol: 30000, classes: [301, -1, -1, -1] }));
    out.push(...shareRled(511, "Kit SF Lead", 1976, 24, { ...hull, ai: 3 }));
    out.push(...shareRled(512, "Kit SF Escort Red", 1971, 24, { ...hull, ai: 4 }));
    out.push(...shareRled(513, "Kit SF Escort Green", 1972, 24, { ...hull, ai: 4 }));
    out.push(fleet(307, "Kit Scan Fleet", 511, [[512, 1, 1], [513, 1, 1], [512, 0, 0], [512, 0, 0]], 301, 1174));
    out.push(traffic(system(1174, "Kit Fleet Scan", -640, -1340, 301, [1476]), [[-307, 100]], 3), port(1476, "Kit Fleet Scan Port"));

    // --- M / H: the R1 star (map dots by govt flags) and a hostile animated station.
    const hub = system(1175, "Kit Map Hub", -400, -1400, 363, [1477]);
    hub.set.links = links(1176, 1177, 1178, 1179);
    const attacks = system(1176, "Kit Map Attacks", -470, -1400, 362, [1478]);
    attacks.set.links = links(1175, 1177);
    const xeno = system(1177, "Kit Map Xeno", -330, -1400, 344, [1479]);
    xeno.set.links = links(1175, 1176);
    const wanted = system(1178, "Kit Map Wanted", -400, -1470, 360, [1480]);
    wanted.set.links = links(1175);
    const clean = system(1179, "Kit Map Clean", -400, -1340, 363, [1481]);
    clean.set.links = links(1175);
    out.push(hub, attacks, xeno, wanted, clean);
    out.push(port(1477, "Kit Map Hub Port"), port(1478, "Kit Map Attacks Port", 0, 0, { govt: 362 }), port(1479, "Kit Map Xeno Port", 0, 0, { govt: 344 }),
        port(1480, "Kit Map Wanted Station", 0, 0, { govt: 360, minStatus: 0, type: 1, flags: 0x11 | 0x02 }), port(1481, "Kit Map Clean Port"));

    // --- Escort cap (hub, added during the wave): shïp 514 Kit Hire Disc (the Kit Disc Yellow's art and stats,
    // HireRandom 100, TechLevel 1, cost 10,000: a 1,000 fee) is offered in every bar every day. (Wave 23 read "hiring is gated by TechLevel, not SpecialTech" off a
    // TechLevel-9000 version; wave 25 refuted it: a SpecialTech match puts a hull in the hire pool. The first version had HireRandom 100 too,
    // but its runs carried six escorts, so the cap greyed the button.)
    out.push(...shareRled(514, "Kit Hire Disc", 1974, 24, { accel: 600, speed: 600, turn: 60, armor: 30000, shield: 30000, mass: 50, freeMass: 100,
        cargo: 10, ai: 3, strength: 50, flags: 0, flags2: 0, cost: 10000, hireRandom: 100, techLevel: 1 }));
    return out;
}

/**
 * Wave-24 experiments (docs/reference_experiments.md, "... wave 24").
 * Nothing retired. sÿst 1180-1188 and 1190-1194, spöb 1482-1494, 1497 and
 * 1498, shïp none, düde 454, gövt 300, flët 308-309. Map rows y = -1530 to
 * -1640. The next free ids: sÿst 1189 and 1195+, spöb 1495, 1496, 1499 (the
 * 1421-1499 range is then FULL: a later wave needs another spöb range, e.g.
 * 1600-1999 checked free first), shïp 515+, düde 455+, mïsn 956+ (the stock
 * gap ends at 959), gövt 299 and below, flët 310+, wëap 294+, oütf 466+,
 * bits 9242+.
 *
 *  G   The gate map: kit hypergates cloned from the stock HG-V01 (spöb
 *      1400: Type 1, Flags 0x11, the 42-frame gate art) but usable (govt
 *      -1, MinStatus -32767, Flags2 0x1000 only), each alone in a gövt-363
 *      system with no hyperlinks. Network A: spöb 1482 Kit Gate A1 (sÿst
 *      1180) <-> 1483 A2 (1181). Network B: 1484 B1 (1182) <-> 1485 B2
 *      (1183). Network C with a ONE-WAY lane: 1486 C1 (1184) -> 1487 C2
 *      (1185) (C2 does not list C1), 1487 C2 <-> 1488 C3 (1186).
 *  M   Map dots (wave-23 leftovers): sÿst 1187 Kit Map Mixed (owner gövt 360,
 *      CrimeTol 10; the pilot at -500) with a refusing planet spöb 1489
 *      (MinStatus 0) and an open one 1490 (MinStatus -32767); sÿst 1188
 *      Kit Map Picky (363) whose only port 1491 has MinStatus 100 (a clean
 *      pilot is refused); sÿst 1193 Kit Map Wanted Planet (360, the pilot
 *      at -500) whose only port is a PLANET 1497 with MinStatus 0 (wave
 *      23's red was a station). 1187 - 1188 - 1193 linked.
 *  S   Scan controls: sÿst 1190 Kit Lone Scan (owner gövt 301, port 1492)
 *      whose only traffic is düde 454 (the AI 4 red escort hull shïp 512
 *      ALONE, gövt 301), avgShips 2; gövt 300 Kit Scan Fleet Strict (301
 *      with CrimeTol 10) and its flët 309 (lead 511, escorts 512 / 513 as
 *      flët 307) the only traffic of sÿst 1194 Kit Fleet Scan Strict (port
 *      1498).
 *  D   Disabled ships: sÿst 1191 Kit Lone Leaver (363, port 1493), traffic
 *      wave 18's düde 424 (gövt 312 AI 1 magenta pointer hulls, two Kit
 *      Disable Gun hits disable) at avgShips 1, so no other ship of its govt
 *      is around to push the boarder; flët 308 Kit Big Fleet (wave 19's
 *      cyan lead 467 with exactly one each of the red / orange / yellow /
 *      green escorts 468-471, gövt 363) the only traffic of sÿst 1192 Kit
 *      Fleet Big (port 1494), avgShips 5.
 */
function wave24Resources() {
    const out = [];
    const links = (...ids) => [...ids, ...none16].slice(0, 16);
    const traffic = (s, dudes, avgShips) => {
        s.set = { ...s.set, dudes: [...dudes.map((d) => d[0]), ...none8].slice(0, 8), dudeProbs: [...dudes.map((d) => d[1]), ...zero8].slice(0, 8), avgShips };
        return s;
    };
    const port = (id, name, x = 0, y = 0, set = {}) => spob(id, name, x, y, 138, { flags: 0x43, ...set });
    const fleet = (id, name, lead, escorts, govtId, linkSyst) => ({ type: "flët", id, name, clone: "flët:128",
        set: { "@0:i16": lead, "@2:i16x4": escorts.map((e) => e[0]), "@10:i16x4": escorts.map((e) => e[1]), "@18:i16x4": escorts.map((e) => e[2]),
            "@26:i16": govtId, "@28:i16": linkSyst, "@30:str256": "", "@286:i16": -1, "@288:u16": 0 } });

    // --- G: three hypergate networks with no lane between them; C has a one-way lane C1 -> C2.
    const gate = (sid, pid, name, x, y, hyperlinks) => {
        out.push(system(sid, `Kit Gate ${name}`, x, y, 363, [pid]));
        out.push(spob(pid, `Kit Gate ${name}`, 0, 0, 1400, { type: 1, flags: 0x11, flags2: 0x1000, govt: -1, minStatus: -32767, techLevel: 0,
            specialTech: [-1, -1, -1], custPic: 37, custSnd: 120, hyperlinks: [...hyperlinks, ...none8].slice(0, 8) }));
    };
    gate(1180, 1482, "A1", -760, -1530, [1483]);
    gate(1181, 1483, "A2", -640, -1530, [1482]);
    gate(1182, 1484, "B1", -760, -1610, [1485]);
    gate(1183, 1485, "B2", -640, -1610, [1484]);
    gate(1184, 1486, "C1", -520, -1530, [1487]);
    gate(1185, 1487, "C2", -400, -1530, [1488]);
    gate(1186, 1488, "C3", -400, -1610, [1487]);

    // --- M: red with one refusing and one open port; a refusing port at a clean record; a refusing PLANET.
    const mixed = system(1187, "Kit Map Mixed", -280, -1640, 360, [1489, 1490]);
    mixed.set.links = links(1188);
    const picky = system(1188, "Kit Map Picky", -200, -1640, 363, [1491]);
    picky.set.links = links(1187, 1193);
    const wantedPlanet = system(1193, "Kit Map Wanted Planet", -120, -1640, 360, [1497]);
    wantedPlanet.set.links = links(1188);
    out.push(mixed, picky, wantedPlanet);
    out.push(port(1489, "Kit Mixed Refusing", 0, 0, { govt: 360, minStatus: 0 }), port(1490, "Kit Mixed Open", 400, 0, { govt: 360 }),
        port(1491, "Kit Picky Port", 0, 0, { govt: 363, minStatus: 100 }), port(1497, "Kit Wanted Planet", 0, 0, { govt: 360, minStatus: 0 }));

    // --- S: a lone AI 4 of the fleet-scan govt; the fleet with a CrimeTol-10 govt.
    out.push(dude(454, "Kit Lone Scanner", 4, 301, 512));
    out.push(traffic(system(1190, "Kit Lone Scan", -280, -1560, 301, [1492]), [[454, 100]], 2), port(1492, "Kit Lone Scan Port"));
    out.push(govt(300, "Kit Scan Fleet Strict", { scanMask: 0x0001, scanFine: 500, smugPenalty: 50, crimeTol: 10, classes: [300, -1, -1, -1] }));
    out.push(fleet(309, "Kit Scan Fleet Strict", 511, [[512, 1, 1], [513, 1, 1], [512, 0, 0], [512, 0, 0]], 300, 1194));
    out.push(traffic(system(1194, "Kit Fleet Scan Strict", -200, -1560, 300, [1498]), [[-309, 100]], 3), port(1498, "Kit Fleet Scan Strict Port"));

    // --- D: a lone disabled leaver to board; a fleet of five for the disabled-leader case.
    out.push(traffic(system(1191, "Kit Lone Leaver", -120, -1560, 363, [1493]), [[424, 100]], 1), port(1493, "Kit Lone Leaver Port"));
    out.push(fleet(308, "Kit Big Fleet", 467, [[468, 1, 1], [469, 1, 1], [470, 1, 1], [471, 1, 1]], 363, 1192));
    out.push(traffic(system(1192, "Kit Fleet Big", -40, -1560, 363, [1494]), [[-308, 100]], 5), port(1494, "Kit Fleet Big Port"));
    return out;
}

/**
 * Wave-22 experiments (docs/reference_experiments.md, "... wave 22").
 * Nothing retired. sÿst 1160-1173, spöb 1451-1475, shïp 498-510, düde
 * 445-453, gövt 302-305, wëap 291-293, mïsn 941-955 (bits 9233-9241; offer
 * text dësc 4813-4827), bar dësc 11332. Map row y = -1300. The next free
 * ids: sÿst 1174+, spöb 1476+, shïp 511+, düde 454+, mïsn 956+ (the stock
 * gap ends at 959), gövt 301 and below, flët 307+, wëap 294+, oütf 466+,
 * bits 9242+.
 *
 *  R19 What makes an AI 1 victim call (one thing varied at a time from
 *      wave 20's mobile S50, shïp 488, at sÿst 1143): every system is owned
 *      by gövt 311 (flët 305, ReinfTime 300, ReinfIntrval 0), avgShips 1,
 *      port at (0,0). shïp 498 Kit RV Mobile S50 AI2 (488 with AI 2, düde
 *      445, sÿst 1160), 499 AI3 (düde 446, sÿst 1161), 500 AI4 (düde 447,
 *      sÿst 1162), 501 Kit RV Mobile S50 Quiet (488 with InherentGovt 1305:
 *      the ATTRIBUTES govt gövt 305 Kit Quiet Attr, Flags2 0x0008 "don't send
 *      distress messages"; düde 448 of 311, sÿst 1163), 502 Kit RV Mobile
 *      S50 Sp20 (488 with Speed 20, Accel kept at 300; düde 449, sÿst 1164);
 *      ports spöb 1451-1455.
 *      The arrival centre: sÿst 1165 Kit Reinf Far C (the mobile AI 1 S50,
 *      düde 437), port spöb 1456 at (3000, 0) (the first nav default),
 *      uninhabited markers 1457 at (0, 0) (the centre) and 1458 at (3000,
 *      1000) (to calibrate the radar from the port).
 *  Mission ships (wave-21 leftover: offer 940's düde 441 never appeared on
 *      the port at 3000 px): sÿst 1166 Kit Ship Test (363), port spöb 1459
 *      at (0,0): BBS job 941 (b9239) düde 441 at ShipStart -1. At Kit Reinf
 *      Far M's port (spöb 1449 at (3000, 0)): BBS jobs 942 (düde 437, the
 *      mobile AI 1 of 311), 943 (düde 426, an AI 4 warship of 363), 944
 *      (düde 441 again), all b9240, ShipStart -1.
 *  #324 sÿst 1167 Kit Live Refilter (363), port spöb 1460 (PORT_FLAGS),
 *      linked to 1168 Kit Live Refilter Next (no stellar). BBS 945 job X
 *      (!b9233), bar offer 946 Y (!b9234, OnAccept "b9233 b9234": X stops
 *      qualifying, set OUTSIDE the BBS), BBS 947 job Z (!b9235, OnAccept
 *      b9235: an accept that re-checks the list); BBS 950 setter (!b9236,
 *      OnAccept b9236), shipyard offer 948 (AvailLoc 5) and outfitter offer
 *      949 (AvailLoc 6), both b9236; BBS 951-954 Kit L rand
 *      1-4 (AvailRandom 50, !b9237) to see when random offers are re-rolled
 *      (a re-landing vs a jump and back; the Bible says "each time you warp
 *      into a system").
 *  H1  ränk 0x0400 with no raider at all: offer 955 (b9241) at Kit Rank
 *      Calm (spöb 1447), OnAccept "!b9241 K200", no ship.
 *  Added during the wave (hub requests): R7 bribes (gövt 304 / 303 / 302,
 *      sÿst 1169 / 1170 / 1173, ports spöb 1461 / 1462 / 1475, shïp 503 /
 *      504, düde 450-453); K8 radar shapes (sÿst 1171 with spöb 1463-1469,
 *      sÿst 1172 with spöb 1470-1474); F1c formation fill (shïp 505-510,
 *      wëap 291-293). Each block below says what it holds.
 *
 * LESSONS: an AI 1 / AI 2 victim calls the fleet only when hit from near
 * (475 px yes, 700 px no); gövt 0x0008 is a different flag in Flags and
 * Flags2 (Kit Quiet Attr was first built with the Flags one); a stock
 * station (spöb Flags 0x10) is a radar dot at any size.
 */
function wave22Resources() {
    const out = [];
    const links = (...ids) => [...ids, ...none16].slice(0, 16);
    const traffic = (s, dudes, avgShips) => {
        s.set = { ...s.set, dudes: [...dudes.map((d) => d[0]), ...none8].slice(0, 8), dudeProbs: [...dudes.map((d) => d[1]), ...zero8].slice(0, 8), avgShips };
        return s;
    };
    const port = (id, name, x = 0, y = 0, set = {}) => spob(id, name, x, y, 138, { flags: 0x43, ...set });
    const marker = (id, name, x, y) => spob(id, name, x, y, 132, { flags: 0x20, techLevel: 0, specialTech: [-1, -1, -1] });
    const shareRled = (id, name, rledId, size, set) => [
        { type: "shïp", id, name, clone: "shïp:128", set: { ...shipBase, shortName: name, longName: name, commName: name, subtitle: "", ...set } },
        { type: "shän", id, name, clone: "shän:128", set: { "@0:i16": rledId, "@2:i16": rledId + 1, "@4:i16": 1, "@6:i16": size, "@8:i16": size } },
    ];
    const Y = -1300;
    const POINTER = 1959;
    // shïp 488 Kit RV Mobile S50 (wave 20), the one AI 1 victim that called.
    const mobile = { accel: 300, speed: 300, turn: 30, mass: 50, freeMass: 100, cargo: 10, crew: 10, flags: 0, flags2: 0, ai: 1,
        armor: 30000, shield: 30000, shieldRecharge: 0, strength: 50 };
    const reinf = (id, name, x, spobId, dudeId) => {
        const s = traffic(system(id, name, x, Y, 311, [spobId]), [[dudeId, 100]], 1);
        s.set = { ...s.set, reinfFleet: 305, reinfTime: 300, reinfInterval: 0 };
        return [s, port(spobId, `${name} Port`)];
    };

    // --- R19: one thing varied at a time from the mobile S50.
    out.push(govt(305, "Kit Quiet Attr", { flags2: 0x0008, classes: [305, -1, -1, -1], crimeTol: 30000 }));
    const variants = [
        [498, "Kit RV Mobile S50 AI2", { ai: 2 }, 1160, "Kit Reinf AI2"],
        [499, "Kit RV Mobile S50 AI3", { ai: 3 }, 1161, "Kit Reinf AI3"],
        [500, "Kit RV Mobile S50 AI4", { ai: 4 }, 1162, "Kit Reinf AI4"],
        [501, "Kit RV Mobile S50 Quiet", { govt: 1305 }, 1163, "Kit Reinf Quiet"],
        [502, "Kit RV Mobile S50 Sp20", { speed: 20 }, 1164, "Kit Reinf Sp20"],
    ];
    variants.forEach(([shipId, name, set, sysId, sysName], i) => {
        out.push(...shareRled(shipId, name, POINTER, 24, { ...mobile, ...set }));
        out.push(dude(445 + i, name, set.ai ?? 1, 311, shipId));
        out.push(...reinf(sysId, sysName, -520 + 40 * i, 1451 + i, 445 + i));
    });
    // The arrival centre: the port 3,000 px from the centre, markers at the centre and 1,000 px off the port.
    const farC = traffic(system(1165, "Kit Reinf Far C", -320, Y, 311, [1456, 1457, 1458]), [[437, 100]], 1);
    farC.set = { ...farC.set, reinfFleet: 305, reinfTime: 300, reinfInterval: 0 };
    out.push(farC, port(1456, "Kit Reinf Far C Port", 3000, 0), marker(1457, "Kit Far C Centre", 0, 0), marker(1458, "Kit Far C Side", 3000, 1000));

    // --- Mission ships: düde 441 on a (0,0) port; three düdes on the 3,000 px port.
    out.push(system(1166, "Kit Ship Test", -280, Y, 363, [1459]), port(1459, "Kit Ship Test Port"));
    const job = (id, name, bit, set) => misn(id, name, bit, { availLoc: 0, dispWeight: 30000, ...set });
    const shipJob = (id, name, bit, stel, dudeId, w) => job(id, name, bit, { availStel: stel, shipCount: 1, shipSyst: -1, shipDude: dudeId,
        shipGoal: -1, shipBehav: -1, shipStart: -1, dispWeight: w });
    out.push(...shipJob(941, "Kit S guard 441 at a centre port", 9239, 1459, 441, 30000));
    out.push(...shipJob(942, "Kit S mobile 437 far port", 9240, 1449, 437, 30000));
    out.push(...shipJob(943, "Kit S warship 426 far port", 9240, 1449, 426, 29999));
    out.push(...shipJob(944, "Kit S guard 441 far port", 9240, 1449, 441, 29998));

    // --- #324: a reopened BBS, the shipyard / outfitter venues, random offers.
    const live = system(1167, "Kit Live Refilter", -240, Y, 363, [1460]);
    live.set.links = links(1168);
    const next = system(1168, "Kit Live Refilter Next", -200, Y, 363, []);
    next.set.links = links(1167);
    out.push(live, port(1460, "Kit Live Refilter Port", 0, 0, { flags: PORT_FLAGS }), next);
    out.push({ type: "dësc", id: 10000 + 1460 - 128, text: "Kit Live Refilter Port bar (novaref test kit)." });
    const at = { availStel: 1460 };
    out.push(...job(945, "Kit L job X", 9233, { ...at, availBits: "!b9233" }));
    out.push(...misn(946, "Kit L bar Y", 9234, { ...at, availLoc: 1, availBits: "!b9234", onAccept: "b9233 b9234" }));
    out.push(...job(947, "Kit L job Z", 9235, { ...at, availBits: "!b9235", onAccept: "b9235", dispWeight: 29999 }));
    out.push(...job(950, "Kit L job setter", 9236, { ...at, availBits: "!b9236", onAccept: "b9236", dispWeight: 29998 }));
    out.push(...misn(948, "Kit L shipyard offer", 9236, { ...at, availLoc: 5 }));
    out.push(...misn(949, "Kit L outfitter offer", 9236, { ...at, availLoc: 6 }));
    [951, 952, 953, 954].forEach((id, i) =>
        out.push(...job(id, `Kit L rand ${i + 1}`, 9237, { ...at, availBits: "!b9237", availRandom: 50, dispWeight: 29990 - i })));

    // --- H1: ränk 0x0400 with no raider.
    out.push(...misn(955, "Kit H rank alone", 9241, { availStel: 1447, onAccept: "!b9241 K200" }));

    // --- R7 (added during the wave, Matthew's playtest): the bribe price.
    out.push(govt(304, "Kit Bribe Plain", { flags: 0x4000 | 0x2000 | 0x0200, classes: [304, -1, -1, -1], crimeTol: 10 }));
    out.push(govt(303, "Kit Bribe Large", { flags: 0x8000, classes: [303, -1, -1, -1], crimeTol: 10 }));
    const briber = { accel: 300, speed: 200, turn: 30, mass: 50, freeMass: 100, cargo: 10, crew: 10, flags: 0, flags2: 0,
        armor: 30000, shield: 30000, shieldRecharge: 0, strength: 50, weapons: [365, -1, -1, -1], weaponCounts: [1, 0, 0, 0], weaponAmmo: [0, 0, 0, 0] };
    out.push(...shareRled(503, "Kit Bribe Warship", POINTER, 24, { ...briber, ai: 3 }));
    out.push(...shareRled(504, "Kit Bribe Freighter", POINTER, 24, { ...briber, ai: 1, weapons: none4, weaponCounts: zero4 }));
    out.push(dude(450, "Kit Bribe Warship Plain", 3, 304, 503), dude(451, "Kit Bribe Freighter Plain", 1, 304, 504), dude(452, "Kit Bribe Warship Large", 3, 303, 503));
    out.push(traffic(system(1169, "Kit Bribe Plain", -160, Y, 304, [1461]), [[450, 100]], 3), port(1461, "Kit Bribe Plain Port", 0, 0, { govt: 304, minStatus: 0 }));
    out.push(traffic(system(1170, "Kit Bribe Large", -120, Y, 303, [1462]), [[452, 100]], 2), port(1462, "Kit Bribe Large Port", 0, 0, { govt: 303, minStatus: 0 }));
    // Added after the first runs (gövt 303's warships, 0x8000 alone, refused every Beg For Mercy): gövt 302 Kit Bribe
    // Large Ships (0x8000 | 0x0200), sÿst 1173 (port spöb 1475), its warships düde 453.
    out.push(govt(302, "Kit Bribe Large Ships", { flags: 0x8000 | 0x0200, classes: [302, -1, -1, -1], crimeTol: 10 }));
    out.push(dude(453, "Kit Bribe Warship Large Ships", 3, 302, 503));
    out.push(traffic(system(1173, "Kit Bribe Large Ships", 0, Y, 302, [1475]), [[453, 100]], 3), port(1475, "Kit Bribe Large Ships Port", 0, 0, { govt: 302, minStatus: 0 }));

    // --- K8 (added during the wave): the radar shape of a stellar by its sprite. sÿst 1171 Kit Radar Shapes (363):
    // the port spöb 1463 at (0,0) and six landable stellars 700 px around it whose spöb Type picks a stock spïn
    // (2000 + Type): 1464 Type 1 (spïn 2001, the hypergate's 150 px art, NOT a gate here), 1465 Type 6 (2006, 72 px),
    // 1466 Type 19 (2019, 87), 1467 Type 24 (2024, 88), 1468 Type 26 (2026, 96), 1469 Type 17 (2017, 104).
    const shapes = [[1464, 1, 0], [1465, 6, 60], [1466, 19, 120], [1467, 24, 180], [1468, 26, 240], [1469, 17, 300]];
    out.push(system(1171, "Kit Radar Shapes", -80, Y, 363, [1463, ...shapes.map((s) => s[0])]), port(1463, "Kit Radar Shapes Port"));
    // Positions rounded from 700 px at the listed bearings (0 = east, clockwise on screen: y grows down).
    const at700 = { 0: [700, 0], 60: [350, 606], 120: [-350, 606], 180: [-700, 0], 240: [-350, -606], 300: [350, -606] };
    shapes.forEach(([id, type, deg]) => out.push(port(id, `Kit Radar T${type}`, at700[deg][0], at700[deg][1], { type })));
    // Added after the stock run (HG-Secundus, flags 0x11, drew a DOT; its station neighbours too): the station flag
    // (spöb Flags 0x10) or the gate? sÿst 1172 Kit Radar Station (363): port spöb 1470 at (0,0); 1471 Type 1 (the
    // 150 px gate art) with Flags 0x11 (a station, no gate flag) east, 1472 Type 17 (104 px) 0x11 west, 1473 Type 26
    // (96 px) 0x01 (a plain planet: the ring control) south, 1474 Type 6 (72 px) 0x11 north.
    const stations = [[1471, 1, 0x11, 700, 0], [1472, 17, 0x11, -700, 0], [1473, 26, 0x01, 0, 700], [1474, 6, 0x11, 0, -700]];
    out.push(system(1172, "Kit Radar Station", -40, Y, 363, [1470, ...stations.map((s) => s[0])]), port(1470, "Kit Radar Station Port"));
    stations.forEach(([id, type, flags, x, y]) => out.push(port(id, `Kit Radar S${type} ${flags.toString(16)}`, x, y, { type, flags })));

    // --- F1c (added during the wave, Matthew): formation slots past rank 3. Three more hired disc escorts with the
    // Kit Disc Red's stats (shïp 721): shïp 505 orange, 506 azure, 507 purple (the wave-15 disc rlëDs 1956 / 1958 /
    // 1960, 24 px). Disc FIGHTERS for the player's own bays: shïp 508 / 509 / 510 Kit F1c Fighter Red / Green / Blue
    // (the 721-723 rlëDs, same stats), launched by wëap 291 / 292 / 293 Kit F1c Bay Red / Green / Blue (Kit Fighter
    // Bay 366's bytes, AmmoType = the fighter's shïp id).
    const discEsc = { accel: 600, speed: 600, turn: 60, armor: 30000, shield: 30000, mass: 50, freeMass: 100, cargo: 10, ai: 3, strength: 50, flags: 0, flags2: 0, cost: 10000 };
    [[505, "Orange", 1956], [506, "Azure", 1958], [507, "Purple", 1960], [508, "F1c Fighter Red", 1971], [509, "F1c Fighter Green", 1972], [510, "F1c Fighter Blue", 1973]]
        .forEach(([id, c, rled]) => out.push(...shareRled(id, `Kit Disc ${c}`, rled, 24, discEsc)));
    [[291, "Red", 508], [292, "Green", 509], [293, "Blue", 510]].forEach(([id, c, fighter]) =>
        out.push(weap(id, `Kit F1c Bay ${c}`, 149, { reload: 30, guidance: 99, ammoType: fighter })));
    return out;
}

/**
 * Wave-21 experiments (docs/reference_experiments.md, "... wave 21").
 * Nothing retired. sÿst 1148-1159, spöb 1439-1450, shïp 497, gövt 306, mïsn
 * 930-940 (bits 9227-9232; offer text dësc 4802-4812), bar dësc 11311 /
 * 11314. Map row y = -1260. The next free ids: sÿst 1160+, spöb 1451+,
 * shïp 498+, düde 445+, mïsn 941+ (the stock gap ends at 959), gövt 305
 * and below, flët 307+, wëap 291+, oütf 466+, bits 9233+.
 *
 *  #324 What the BBS, the venues and the map show after an accept in the
 *      same visit. sÿst 1148 Kit Live Range (gövt 363), port spöb 1439 Kit
 *      Live Port (bar, trade center), linked to 1152 Kit Live Next (no
 *      stellar, for a jump without a landing). BBS jobs at 1439 (DispWeight
 *      30000 so they list first): 930 Kit L job A (!b9227, OnAccept "b9227
 *      b9228", destination spöb 1440 in sÿst 1149), 931 Kit L job B
 *      (!b9227, OnAccept b9227: withdrawn by A's accept if live), 932 Kit L
 *      job C (b9228: made available by A's accept if live); 933 a trade
 *      center offer (AvailLoc 4) and 934 a bar offer (AvailLoc 1), both
 *      b9228. sÿst 1149 Kit Live Shown (Visibility b9228, port 1440) and
 *      1150 Kit Live Hidden (Visibility !b9228, port 1441).
 *      A record change in the visit: gövt 306 Kit Live Owner owns sÿst 1151
 *      Kit Live Record (port spöb 1442); BBS jobs there: 935 Kit L comp
 *      abort (Flags 0x0040, CompGovt 306, CompReward 100, !b9229, OnAccept
 *      b9229: aborting it costs -500), 936 Kit L clean only (AvailRecord
 *      50), 937 Kit L wanted only (AvailRecord -100), 938 Kit L abort D
 *      (always offered, OnAccept "A935": an NCB abort of 935).
 *  R19 Where the fleet comes in (wave-20 leftover): sÿst 1153 Kit Reinf Far
 *      A (gövt 311, flët 305, ReinfTime 150, the AI 4 S50 guard düde 441)
 *      and 1154 Kit Reinf Far B (the mobile AI 1 S50, düde 437), each with
 *      its ONLY stellar, port spöb 1443 / 1444, at (6000, 0): far from the
 *      system's centre. A departed victim: sÿst 1155 Kit Reinf Two (two
 *      slow AI 1 S50 victims, düde 430, avgShips 2, ReinfTime 600) and 1156
 *      Kit Reinf Leave One (one, avgShips 1), ports 1445 / 1446 at (0,0).
 *  H1  ränk 0x0400 and a warship not yet fighting: sÿst 1157 Kit Rank Calm
 *      (gövt 363, port spöb 1447 (0,0), marker 1448 (3500,0)), AI 4
 *      warships of 363 (düde 426), avgShips 3; offer 939 (b9231): OnAccept
 *      K200 and a Kit Raider (düde 602) on the far marker (ShipStart -2;
 *      it appeared beside the port all the same).
 *  Added during the wave: shïp 497 Kit Ring Lancer (the Kit Ring Crawler's
 *      pointer sprite with the Kit Lancer's speed and Strength 100, to fly
 *      to a far victim by heading); sÿst 1158 Kit Reinf Far M (no traffic,
 *      port spöb 1449 at (3000, 0), first (6000, 0)) with offer 940 (b9232:
 *      the AI 4 S50 guard on the port; it NEVER appeared, at either
 *      distance); sÿst 1159 Kit Reinf Slow 300 (the slow AI 1 S50, ReinfTime
 *      300, port spöb 1450).
 *
 * LESSONS: a port with trade tiers (PORT_FLAGS) also lists stock cargo jobs
 * ("Delivery to Earth") on its BBS, first despite DispWeight 30000; a 0x43
 * port has no Trade Center. Traffic in a system whose only stellar is 6,000
 * px out does not gather at that stellar (the victims stayed thousands of
 * px off), and the radar there reaches only about 1,600 px.
 */
function wave21Resources() {
    const out = [];
    const links = (...ids) => [...ids, ...none16].slice(0, 16);
    const traffic = (s, dudes, avgShips) => {
        s.set = { ...s.set, dudes: [...dudes.map((d) => d[0]), ...none8].slice(0, 8), dudeProbs: [...dudes.map((d) => d[1]), ...zero8].slice(0, 8), avgShips };
        return s;
    };
    const port = (id, name, x = 0, y = 0, set = {}) => spob(id, name, x, y, 138, { flags: 0x43, ...set });
    const Y = -1260;
    const job = (id, name, bit, set) => misn(id, name, bit, { availLoc: 0, dispWeight: 30000, ...set });

    // --- #324: the BBS, venues and map after an accept in the same visit.
    const live = system(1148, "Kit Live Range", -520, Y, 363, [1439]);
    live.set.links = links(1152);
    const next = system(1152, "Kit Live Next", -560, Y, 363, []);
    next.set.links = links(1148);
    // PORT_FLAGS (trade tiers, outfitter, shipyard): a 0x43 port has no Trade Center button.
    out.push(live, port(1439, "Kit Live Port", 0, 0, { flags: PORT_FLAGS }), next);
    out.push({ type: "dësc", id: 10000 + 1439 - 128, text: "Kit Live Port bar (novaref test kit)." });
    const shown = system(1149, "Kit Live Shown", -480, Y, 363, [1440]);
    shown.set.visibility = "b9228";
    const hidden = system(1150, "Kit Live Hidden", -440, Y, 363, [1441]);
    hidden.set.visibility = "!b9228";
    out.push(shown, port(1440, "Kit Live Shown Port"), hidden, port(1441, "Kit Live Hidden Port"));
    const at = { availStel: 1439 };
    out.push(...job(930, "Kit L job A", 9227, { ...at, availBits: "!b9227", onAccept: "b9227 b9228", travelStel: 1440, payVal: 1000 }));
    out.push(...job(931, "Kit L job B", 9227, { ...at, availBits: "!b9227", onAccept: "b9227", dispWeight: 29999 }));
    out.push(...job(932, "Kit L job C", 9228, { ...at, dispWeight: 29998 }));
    out.push(...misn(933, "Kit L trade offer", 9228, { ...at, availLoc: 4 }));
    out.push(...misn(934, "Kit L bar offer", 9228, { ...at, availLoc: 1 }));
    // A record change in the visit.
    out.push(govt(306, "Kit Live Owner", { classes: [306, -1, -1, -1], crimeTol: 30000 }));
    out.push(system(1151, "Kit Live Record", -400, Y, 306, [1442]), port(1442, "Kit Live Record Port"));
    out.push({ type: "dësc", id: 10000 + 1442 - 128, text: "Kit Live Record Port bar (novaref test kit)." });
    const rec = { availStel: 1442 };
    out.push(...job(935, "Kit L comp abort", 9229, { ...rec, availBits: "!b9229", onAccept: "b9229", flags: 0x0040, compGovt: 306, compReward: 100, canAbort: 1 }));
    out.push(...job(936, "Kit L clean only", 9229, { ...rec, availBits: "", availRecord: 50, dispWeight: 29999 }));
    out.push(...job(937, "Kit L wanted only", 9229, { ...rec, availBits: "", availRecord: -100, dispWeight: 29998 }));
    out.push(...job(938, "Kit L abort D", 9229, { ...rec, availBits: "", onAccept: "A935", dispWeight: 29997 }));

    // --- R19: where the fleet comes in; a victim that leaves.
    const reinf = (id, name, x, spobId, dudeId, avgShips, reinfTime, portX) => {
        const s = traffic(system(id, name, x, Y, 311, [spobId]), [[dudeId, 100]], avgShips);
        s.set = { ...s.set, reinfFleet: 305, reinfTime, reinfInterval: 0 };
        return [s, port(spobId, `${name} Port`, portX, 0)];
    };
    out.push(...reinf(1153, "Kit Reinf Far A", -360, 1443, 441, 1, 150, 6000));
    out.push(...reinf(1154, "Kit Reinf Far B", -320, 1444, 437, 1, 150, 6000));
    out.push(...reinf(1155, "Kit Reinf Two", -280, 1445, 430, 2, 600, 0));
    out.push(...reinf(1156, "Kit Reinf Leave One", -240, 1446, 430, 1, 600, 0));
    // Added during the wave (the slow AI 1 S50 never called at ReinfTime 600,
    // though it stayed over a minute): the same victim at ReinfTime 300, sÿst
    // 1159 Kit Reinf Slow 300, port spöb 1450.
    out.push(...reinf(1159, "Kit Reinf Slow 300", -120, 1450, 430, 1, 300, 0));

    // Added during the wave: shïp 497 Kit Ring Lancer, the player's hull for
    // flying to a far victim: the Kit Ring Crawler's pointer sprite (rlëD 1955,
    // heading readable with analysis/pointer.mjs; Turn 30 = 87.1 deg/s) with
    // the Kit Lancer's speed and strength (inertialess, Speed 800, Strength 100).
    out.push({ type: "shïp", id: 497, name: "Kit Ring Lancer", clone: "shïp:128", set: { ...shipBase, shortName: "Kit Ring Lancer", longName: "Kit Ring Lancer", commName: "Kit Ring Lancer", subtitle: "",
        accel: 2000, speed: 800, turn: 30, armor: 30000, shield: 30000, shieldRecharge: 1000, mass: 50, freeMass: 1000, cargo: 200, maxGuns: 16, maxTurrets: 16, ai: 3, strength: 100, crew: 10, flags: 0, flags2: 0x00C8 } },
    { type: "shän", id: 497, name: "Kit Ring Lancer", clone: "shän:128", set: { "@0:i16": 1955, "@2:i16": 1956, "@4:i16": 1, "@6:i16": 24, "@8:i16": 24 } });

    // Added during the wave (traffic victims spawn far from a far port, and the
    // radar here reaches only about 1,600 px): sÿst 1158 Kit Reinf Far M (gövt
    // 311, flët 305, ReinfTime 150, NO traffic), port spöb 1449 at (3000, 0);
    // offer 940 (b9232) puts the AI 4 S50 guard (düde 441) on the port
    // (ShipStart -1), beside the player and 3,000 px from the system's centre.
    // (First built at (6000, 0): the mission ship never appeared there, and the
    // radar showed the arrow that points back to the centre.)
    const farM = system(1158, "Kit Reinf Far M", -160, Y, 311, [1449]);
    farM.set = { ...farM.set, reinfFleet: 305, reinfTime: 150, reinfInterval: 0 };
    out.push(farM, port(1449, "Kit Reinf Far M Port", 3000, 0));
    out.push(...misn(940, "Kit R19 victim on a far port", 9232, { availStel: 1449, shipCount: 1, shipDude: 441, shipGoal: -1, shipBehav: -1, shipStart: -1, onAccept: "!b9232" }));

    // --- H1: ränk 0x0400 and a warship not yet fighting.
    out.push(traffic(system(1157, "Kit Rank Calm", -200, Y, 363, [1447, 1448]), [[426, 100]], 3));
    out.push(port(1447, "Kit Rank Calm Port"), spob(1448, "Kit Rank Calm Mark", 3500, 0, 264, { flags: 0x20, techLevel: 0, specialTech: [-1, -1, -1] }));
    out.push(...misn(939, "Kit H rank and a far raider", 9231, { availStel: 1447, shipCount: 1, shipDude: 602, shipGoal: -1, shipBehav: -1, shipStart: -2, onAccept: "!b9231 K200" }));
    return out;
}

/**
 * Wave-20 experiments (docs/reference_experiments.md, "... wave 20").
 * Nothing retired. A NEW sÿst / spöb range above the stock maxima (sÿst
 * 1127, spöb 1420) and below the wave-15 range 1500 (now full), sÿst
 * 1128-1499 / spöb 1421-1499 (checked: no stock or kit resource used
 * them). Used: sÿst 1130-1147, spöb 1421-1438, shïp
 * 482-496, düde 430-444, gövt 307-308, flët 306, wëap 290, oütf 463-465,
 * mïsn 929 (bits 9225-9226, offer text dësc 4801; the stock gap 919-959).
 * Map row y = -1220. The next free ids: sÿst 1148+, spöb 1439+, shïp
 * 497+, düde 445+, mïsn 930+, gövt 306 and below, flët 307+, wëap 291+,
 * oütf 466+.
 *
 * LESSON (first runs): an ANCHORED victim (Speed 0) never calls the fleet
 * (its AI does not run), and an AI 1 victim jumps out about 10 s after the
 * hit, and then no fleet comes; so the anchors below were made slow-mobile
 * (Speed 20) and the ReinfTime / Int2 / Base / Ally systems use an AI 4
 * victim that stays (shïp 494).
 *
 *  R19 Reinforcement fleets, second pass. Every system has ONE kind of
 *      traffic, avgShips 1: a slow (Speed 20, Accel 50; first built
 *      anchored, see the lesson), unarmed AI 1 victim on the magenta pointer
 *      sprite with 30000 / 30000 and NO shield recharge, so each Kit Pulse
 *      Beam hit takes exactly 10% of its shield. Victims of gövt 311 (wave 19's Kit
 *      Reinf Owner, MaxOdds 100, flët 305): shïp 482 Kit RV Anchor S50
 *      (Strength 50, düde 430), 483 S110 (431), 484 S150 (432), 485 S200
 *      (433), 486 S300 (434), 487 S400 (435).
 *      Odds (ReinfTime 300, ReinfIntrval 0; the Kit Lancer is Strength
 *      100): sÿst 1130 Kit Odds 110, 1131 Kit Odds 150, 1132 Kit Odds 200,
 *      1133 Kit Odds 300, 1134 Kit Odds 400 (ports spöb 1421-1425).
 *      ReinfTime (S50 victim, ReinfIntrval 0): sÿst 1135 Kit Reinf T600,
 *      1136 T1800, 1137 T1200, 1138 T150 (ports 1426-1429).
 *      ReinfIntrval 2: sÿst 1139 Kit Reinf Int2 (S50, ReinfTime 300, port
 *      1430). Base / inhibitor: sÿst 1140 Kit Reinf Base (S50, 300, 0, port
 *      1431); oütf 464 Kit Reinf Inhibitor (ModType 44, ModVal 311: gövt
 *      311's class) and 465 Kit Reinf Inhibitor All (ModVal -1).
 *      An ally as the victim: gövt 307 Kit Reinf Owner B (MaxOdds 100,
 *      MediumName "Kit Reinf B", ally 308) and 308 Kit Reinf Friend (ally
 *      307), flët 306 Kit Reinf Fleet B (wave 19's purple lead and two blue
 *      guards, gövt 307, LinkSyst 1594); sÿst 1141 Kit Reinf Ally (owner
 *      307, ReinfFleet 306, ReinfTime 300, ReinfIntrval 0, port 1432),
 *      traffic: the S50 anchor of gövt 308 (düde 436).
 *      Player weapon: wëap 290 Kit Pulse Beam (turreted beam, ONE frame of
 *      3000 shield / 2100 armor, reload 60, beamLength 5000: an instant
 *      hit anywhere a victim is likely to sit) + oütf 463.
 */
function wave20Resources() {
    const out = [];
    const shareRled = (id, name, rledId, size, set) => [
        { type: "shïp", id, name, clone: "shïp:128", set: { ...shipBase, shortName: name, longName: name, commName: name, subtitle: "", ...set } },
        { type: "shän", id, name, clone: "shän:128", set: { "@0:i16": rledId, "@2:i16": rledId + 1, "@4:i16": 1, "@6:i16": size, "@8:i16": size } },
    ];
    const traffic = (s, dudes, avgShips) => {
        s.set = { ...s.set, dudes: [...dudes.map((d) => d[0]), ...none8].slice(0, 8), dudeProbs: [...dudes.map((d) => d[1]), ...zero8].slice(0, 8), avgShips };
        return s;
    };
    const port = (id, name, x = 0, y = 0, set = {}) => spob(id, name, x, y, 138, { flags: 0x43, ...set });
    const fleet = (id, name, lead, escorts, govtId, linkSyst) => ({ type: "flët", id, name, clone: "flët:128",
        set: { "@0:i16": lead, "@2:i16x4": escorts.map((e) => e[0]), "@10:i16x4": escorts.map((e) => e[1]), "@18:i16x4": escorts.map((e) => e[2]),
            "@26:i16": govtId, "@28:i16": linkSyst, "@30:str256": "", "@286:i16": -1, "@288:u16": 0 } });
    const POINTER = 1959;
    const anchor = { accel: 50, speed: 20, turn: 30, mass: 50, freeMass: 100, cargo: 10, crew: 10, flags: 0, flags2: 0, ai: 1,
        armor: 30000, shield: 30000, shieldRecharge: 0 };

    // Player weapon and the inhibitors.
    out.push(weap(290, "Kit Pulse Beam", 170, { reload: 60, duration: 1, armorDamage: 2100, shieldDamage: 3000, guidance: 3, beamLength: 5000, flags: 0 }));
    out.push(gun(463, "Kit Pulse Beam", 290));
    const inhibitor = (id, name, modVal) => {
        const o = gun(id, name, 0);
        o.set = { ...o.set, modType: 44, modVal, max: 1 };
        return o;
    };
    out.push(inhibitor(464, "Kit Reinf Inhibitor", 311), inhibitor(465, "Kit Reinf Inhibitor All", -1));

    // Anchored victims of 311 by Strength.
    const strengths = [[482, 50], [483, 110], [484, 150], [485, 200], [486, 300], [487, 400]];
    strengths.forEach(([id, s], i) => {
        out.push(...shareRled(id, `Kit RV Anchor S${s}`, POINTER, 24, { ...anchor, strength: s }));
        out.push(dude(430 + i, `Kit RV Anchor S${s}`, 1, 311, id));
    });
    const sys = (id, name, x, govtId, spobId, dudeId, reinfFleet, reinfTime, reinfInterval) => {
        const s = traffic(system(id, name, x, -1220, govtId, [spobId]), [[dudeId, 100]], 1);
        s.set = { ...s.set, reinfFleet, reinfTime, reinfInterval };
        return [s, port(spobId, `${name} Port`)];
    };
    // Odds: Strength 110 / 150 / 200 / 300 / 400 victims, ReinfTime 300.
    [[1130, 110, 431], [1131, 150, 432], [1132, 200, 433], [1133, 300, 434], [1134, 400, 435]].forEach(([id, s, d], i) =>
        out.push(...sys(id, `Kit Odds ${s}`, -520 + 40 * i, 311, 1421 + i, d, 305, 300, 0)));
    // ReinfTime 600 / 1800 / 1200 / 150 with the S50 victim.
    [[1135, 600], [1136, 1800], [1137, 1200], [1138, 150]].forEach(([id, t], i) =>
        out.push(...sys(id, `Kit Reinf T${t}`, -320 + 40 * i, 311, 1426 + i, 441, 305, t, 0)));
    out.push(...sys(1139, "Kit Reinf Int2", -160, 311, 1430, 441, 305, 300, 2));
    out.push(...sys(1140, "Kit Reinf Base", -120, 311, 1431, 441, 305, 300, 0));

    // An ally of the fleet govt as the victim.
    out.push(govt(307, "Kit Reinf Owner B", { maxOdds: 100, disabPenalty: 1, boardPenalty: 1, killPenalty: 1, crimeTol: 30000, classes: [307, -1, -1, -1], allies: [308, -1, -1, -1], mediumName: "Kit Reinf B" }));
    out.push(govt(308, "Kit Reinf Friend", { disabPenalty: 1, boardPenalty: 1, killPenalty: 1, crimeTol: 30000, classes: [308, -1, -1, -1], allies: [307, -1, -1, -1] }));
    out.push(fleet(306, "Kit Reinf Fleet B", 472, [[473, 2, 2], [473, 0, 0], [473, 0, 0], [473, 0, 0]], 307, 1594));
    out.push(dude(436, "Kit RV Anchor S50 Friend", 1, 308, 482));
    out.push(...sys(1141, "Kit Reinf Ally", -80, 307, 1432, 442, 306, 300, 0));

    // Added after the first run (a lone anchored S50 victim never called the
    // fleet): two anchored S50 victims (sÿst 1142 Kit Reinf Pair, avgShips 2),
    // and one MOBILE AI 1 S50 victim (shïp 488 Kit RV Mobile S50, wave 19's
    // trader without shield recharge, düde 437; sÿst 1143 Kit Reinf Mobile).
    const pair = sys(1142, "Kit Reinf Pair", -40, 311, 1433, 430, 305, 300, 0);
    pair[0].set = { ...pair[0].set, avgShips: 2 };
    out.push(...pair);
    out.push(...shareRled(488, "Kit RV Mobile S50", POINTER, 24, { ...anchor, accel: 300, speed: 300, strength: 50 }));
    out.push(dude(437, "Kit RV Mobile S50", 1, 311, 488));
    out.push(...sys(1143, "Kit Reinf Mobile", 0, 311, 1434, 437, 305, 300, 0));

    // One-hit odds points (added during the wave: later pulses often missed, so
    // each run fires ONE pulse): the victim's shield sets where that hit leaves
    // it. shïp 489 Kit RV S400 Sh3000 (one hit -> 0% shield, düde 438, sÿst
    // 1144 Kit Odds 400 Zero), 490 S400 Sh6000 (-> 50%, düde 439, sÿst 1145
    // Kit Odds 400 Half), 491 S1000 Sh3000 (-> 0%, düde 440, sÿst 1146 Kit
    // Odds 1000 Zero); ports spöb 1435-1437. Player hulls: shïp 492 Kit Lancer
    // S300 and 493 Kit Lancer S50 (the Kit Lancer with Strength 300 / 50).
    [[489, 400, 3000, 1144, "Kit Odds 400 Zero"], [490, 400, 6000, 1145, "Kit Odds 400 Half"], [491, 1000, 3000, 1146, "Kit Odds 1000 Zero"]].forEach(([id, s, sh, sysId, name], i) => {
        out.push(...shareRled(id, `Kit RV S${s} Sh${sh}`, POINTER, 24, { ...anchor, strength: s, shield: sh }));
        out.push(dude(438 + i, `Kit RV S${s} Sh${sh}`, 1, 311, id));
        out.push(...sys(sysId, name, 40 + 40 * i, 311, 1435 + i, 438 + i, 305, 300, 0));
    });
    const lancer = { accel: 2000, speed: 800, turn: 60, armor: 30000, shield: 30000, shieldRecharge: 1000, mass: 50, freeMass: 1000, cargo: 200, maxGuns: 16, maxTurrets: 16, ai: 3, flags: 0, flags2: 0x00C8 };
    out.push(...ship(492, "Kit Lancer S300", 135, { ...lancer, strength: 300 }));
    out.push(...ship(493, "Kit Lancer S50", 135, { ...lancer, strength: 50 }));
    // A victim that STAYS until the fleet arrives (an AI 1 victim jumps out about
    // 10 s after the hit, and then no fleet came): shïp 494 Kit RV Guard S50, AI 4,
    // Speed 100, the Kit Escort Gun, 30000 / 30000, no shield recharge; düde 441
    // (gövt 311) and 442 (gövt 308). The ReinfTime, Int2, Base and Ally systems
    // (1135-1141) use these instead of the S50 anchor.
    out.push(...shareRled(494, "Kit RV Guard S50", POINTER, 24, { ...anchor, ai: 4, accel: 100, speed: 100, strength: 50,
        weapons: [365, -1, -1, -1], weaponCounts: [1, 0, 0, 0], weaponAmmo: [0, 0, 0, 0] }));
    out.push(dude(441, "Kit RV Guard S50", 4, 311, 494), dude(442, "Kit RV Guard S50 Friend", 4, 308, 494));
    // Where the fleet comes in: a FAST AI 4 victim (shïp 495 Kit RV Chaser S50,
    // Speed / Accel 400) that follows the player far from the port after the
    // hit; sÿst 1147 Kit Reinf Chase (ReinfTime 1800: 46 s to fly off), düde 443,
    // port spöb 1438.
    out.push(...shareRled(495, "Kit RV Chaser S50", POINTER, 24, { ...anchor, ai: 4, accel: 400, speed: 400, strength: 50,
        weapons: [365, -1, -1, -1], weaponCounts: [1, 0, 0, 0], weaponAmmo: [0, 0, 0, 0] }));
    out.push(dude(443, "Kit RV Chaser S50", 4, 311, 495));
    out.push(...sys(1147, "Kit Reinf Chase", 160, 311, 1438, 443, 305, 1800, 0));

    // Rescue (wave-19 leftover): a ShipStart-2 rescue ship WITH a cloaking
    // device. shïp 496 Kit Cloak Rescue (the pointer hull, AI 3, the stock
    // Wraith Cloaking Device oütf 266 and the Wraith's cloak Flags2 0x5F00),
    // düde 444 (gövt 360 like the kit düde 330); mïsn 929 (b9225, offer text
    // dësc 4801) = wave 18's 924 (the Raczak cargo, ShipStart 2) at Kit Self
    // Defence (1585), OnSuccess b9226.
    out.push(...shareRled(496, "Kit Cloak Rescue", POINTER, 24, { ...anchor, ai: 3, accel: 300, speed: 300, strength: 50,
        armor: 3000, shield: 3000, flags2: 0x5F00, outfits: [266, -1, -1, -1], outfitCounts: [1, 0, 0, 0] }));
    out.push(dude(444, "Kit Cloak Rescue", 3, 360, 496));
    out.push(...misn(929, "Kit R cloaked ShipStart 2", 9225, { shipCount: 1, shipSyst: -1, shipDude: 444, shipGoal: 5, shipBehav: -1,
        shipNameID: 25002, compGovt: 144, compReward: 10, cargoType: 27, cargoQty: 1, pickupMode: 2, dropoffMode: 1, scanMask: 520,
        flags: 0x1214, flags2: 0x0001, returnStel: 1585, availShipType: 127, availStel: 1585, shipStart: 2, onAccept: "!b9225", onSuccess: "b9226" }));
    return out;
}

/**
 * Wave-19 experiments (docs/reference_experiments.md, "... wave 19").
 * Nothing retired. sÿst 1599 (the last id above wave 18's) and the free
 * sÿst 1506-1509 / 1512 and spöb 1506-1509 / 1598-1599 inside the wave-15
 * range (1500-1599 is otherwise full: the next wave needs a new range, e.g.
 * sÿst 1128-1499 / spöb 1421-1499 above the stock maxima); shïp 467-481,
 * düde 425-429, gövt 309-311, flët 304-305, ränk 202-203, bits 9221-9224,
 * mïsn 925-928 (the free stock-gap ids after wave 18's 919-924; offer text
 * dësc 4797-4800). Map row y = -1180.
 *
 *  T   Do FLEET members stay? sÿst 1599 Kit Fleet Stay (363, port spöb
 *      1598): the only traffic is flët 304 Kit Stay Fleet (gövt 363): lead
 *      shïp 467 Kit FS Lead (cyan, AI 3) and escorts shïp 468-471 Kit FS
 *      Red / Orange / Yellow / Green (AI 3), each 0-1, so every fleet has
 *      its own mix. avgShips 2.
 *  R19 Reinforcement fleets: gövt 311 Kit Reinf Owner (MaxOdds 100, Disab
 *      / Board / Kill 1, CrimeTol 30000, MediumName "Kit Reinf") owns sÿst
 *      1506 Kit Reinf Range (port spöb 1506; ReinfFleet 305, ReinfTime 300
 *      = 10 s, ReinfIntrval 0) and 1507 Kit Reinf Slow (port spöb 1507;
 *      ReinfTime 900 = 30 s, ReinfIntrval 1), linked. Traffic of both:
 *      311's AI 1 Kit RV Trader (shïp 474, the magenta pointer hulk, 30000
 *      / 30000, unarmed; düde 425), avgShips 2. flët 305 Kit Reinf Fleet
 *      (gövt 311): lead shïp 472 Kit RF Lead (purple, AI 3, Kit Escort
 *      Gun), two shïp 473 Kit RF Guard (blue); its LinkSyst is 1594 (Kit
 *      Disab One, no stellar) so it never appears as ordinary traffic here.
 *  H   Many staying neutral ships to hail: sÿst 1509 Kit Assist Stay (363,
 *      port spöb 1509): AI 4 warships of 363 (shïp 475-478 Kit AS Red /
 *      Orange / Yellow / Green, the Kit Escort Gun; düde 426), avgShips 6.
 *      Offer 925 (b9221): OnAccept K200 (ränk 0x0400, AffilGovt 363) and a
 *      Kit Raider (düde 602) at the port.
 *  H   ränk 0x0800 with an ALLY: gövt 310 Kit Rank Affil and 309 Kit Rank
 *      Ally (mutual allies); ränk 202 Kit Ally Repair Rank (AffilGovt 310,
 *      Flags 0x0800). sÿst 1508 Kit Ally Assist (363, port spöb 1508):
 *      AI 4 traffic of 309 (blue shïp 479, düde 427) and of 310 (purple
 *      shïp 480, düde 428), avgShips 4. BBS 926 (b9222, OnAccept K202);
 *      offer 927 (b9223) the Kit Disabler (düde 358) at the port.
 *  R19 ränk 0x0400 and reinforcements (added during the wave): sÿst 1512
 *      Kit Reinf Rank (311, port spöb 1599; ReinfFleet 305, ReinfTime 300,
 *      ReinfIntrval 0): 311's AI 4 warships (green shïp 481, düde 429),
 *      avgShips 3; offer 928 (b9224): OnAccept K203 (ränk 203 Kit Reinf
 *      Assist Rank, AffilGovt 311, Flags 0x0400) and a Kit Raider at the port.
 */
function wave19Resources() {
    const out = [];
    const shareRled = (id, name, rledId, size, set) => [
        { type: "shïp", id, name, clone: "shïp:128", set: { ...shipBase, shortName: name, longName: name, commName: name, subtitle: "", ...set } },
        { type: "shän", id, name, clone: "shän:128", set: { "@0:i16": rledId, "@2:i16": rledId + 1, "@4:i16": 1, "@6:i16": size, "@8:i16": size } },
    ];
    const mobile = { accel: 300, speed: 300, turn: 30, mass: 50, freeMass: 100, cargo: 10, strength: 50, crew: 10, flags: 0, flags2: 0 };
    const armed = (wid, n = 1, ammo = 0) => ({ weapons: [wid, -1, -1, -1], weaponCounts: [n, 0, 0, 0], weaponAmmo: [ammo, 0, 0, 0] });
    const links = (...ids) => [...ids, ...none16].slice(0, 16);
    const traffic = (s, dudes, avgShips) => {
        s.set = { ...s.set, dudes: [...dudes.map((d) => d[0]), ...none8].slice(0, 8), dudeProbs: [...dudes.map((d) => d[1]), ...zero8].slice(0, 8), avgShips };
        return s;
    };
    const port = (id, name, x = 0, y = 0, set = {}) => spob(id, name, x, y, 138, { flags: 0x43, ...set });
    const RLED = { white: 1970, red: 1971, green: 1972, blue: 1973, yellow: 1974, magenta: 1975, cyan: 1976, orange: 1956, azure: 1958, purple: 1960, pointer: 1959 };
    const fleet = (id, name, lead, escorts, govtId, linkSyst) => ({ type: "flët", id, name, clone: "flët:128",
        set: { "@0:i16": lead, "@2:i16x4": escorts.map((e) => e[0]), "@10:i16x4": escorts.map((e) => e[1]), "@18:i16x4": escorts.map((e) => e[2]),
            "@26:i16": govtId, "@28:i16": linkSyst, "@30:str256": "", "@286:i16": -1, "@288:u16": 0 } });
    const multiDude = (id, name, ai, govtId, shipIds) => ({ type: "düde", id, name, clone: "düde:128",
        set: { ai, govt: govtId, flags: 0, infoTypes: 0, ships: [...shipIds, ...none16].slice(0, 16),
            probs: [...shipIds.map(() => Math.floor(100 / shipIds.length)), ...zero16].slice(0, 16) } });

    // --- T: a fleet as the only traffic.
    out.push(...shareRled(467, "Kit FS Lead", RLED.cyan, 24, { ...mobile, ai: 3, armor: 3000, shield: 3000, ...armed(365) }));
    const fsEscorts = [[468, "Red"], [469, "Orange"], [470, "Yellow"], [471, "Green"]];
    fsEscorts.forEach(([id, c]) => out.push(...shareRled(id, `Kit FS ${c}`, RLED[c.toLowerCase()], 24, { ...mobile, ai: 3, armor: 3000, shield: 3000, ...armed(365) })));
    out.push(fleet(304, "Kit Stay Fleet", 467, fsEscorts.map(([id]) => [id, 0, 1]), 363, 1599));
    out.push(traffic(system(1599, "Kit Fleet Stay", -520, -1180, 363, [1598]), [[-304, 100]], 2), port(1598, "Kit Fleet Stay Port"));

    // --- R19: reinforcement fleets.
    out.push(govt(311, "Kit Reinf Owner", { maxOdds: 100, disabPenalty: 1, boardPenalty: 1, killPenalty: 1, crimeTol: 30000, classes: [311, -1, -1, -1], mediumName: "Kit Reinf" }));
    out.push(...shareRled(474, "Kit RV Trader", RLED.pointer, 24, { ...mobile, ai: 1, armor: 30000, shield: 30000 }), dude(425, "Kit RV Traders", 1, 311, 474));
    out.push(...shareRled(472, "Kit RF Lead", RLED.purple, 24, { ...mobile, ai: 3, armor: 3000, shield: 3000, ...armed(365) }));
    out.push(...shareRled(473, "Kit RF Guard", RLED.blue, 24, { ...mobile, ai: 3, armor: 3000, shield: 3000, ...armed(365) }));
    out.push(fleet(305, "Kit Reinf Fleet", 472, [[473, 2, 2], [473, 0, 0], [473, 0, 0], [473, 0, 0]], 311, 1594));
    const reinfA = traffic(system(1506, "Kit Reinf Range", -480, -1180, 311, [1506]), [[425, 100]], 2);
    reinfA.set = { ...reinfA.set, links: links(1507), reinfFleet: 305, reinfTime: 300, reinfInterval: 0 };
    const reinfB = traffic(system(1507, "Kit Reinf Slow", -440, -1180, 311, [1507]), [[425, 100]], 2);
    reinfB.set = { ...reinfB.set, links: links(1506), reinfFleet: 305, reinfTime: 900, reinfInterval: 1 };
    out.push(reinfA, port(1506, "Kit Reinf Port"), reinfB, port(1507, "Kit Reinf Slow Port"));

    // --- H: staying AI 4 warships of 363; ränk 0x0400 and a raider.
    const as = [[475, "Red"], [476, "Orange"], [477, "Yellow"], [478, "Green"]];
    as.forEach(([id, c]) => out.push(...shareRled(id, `Kit AS ${c}`, RLED[c.toLowerCase()], 24, { ...mobile, ai: 4, armor: 3000, shield: 3000, ...armed(365) })));
    out.push(multiDude(426, "Kit AS Warships", 4, 363, as.map((s) => s[0])));
    out.push(traffic(system(1509, "Kit Assist Stay", -360, -1180, 363, [1509]), [[426, 100]], 6), port(1509, "Kit Assist Stay Port"));
    out.push(...misn(925, "Kit H assist rank vs AI 4 warships", 9221, { availStel: 1509, shipCount: 1, shipDude: 602, shipGoal: -1, shipBehav: -1, shipStart: -1, onAccept: "!b9221 K200" }));

    // --- H: ränk 0x0800 with an ally of the affiliated govt.
    out.push(govt(310, "Kit Rank Affil", { classes: [310, -1, -1, -1], allies: [309, -1, -1, -1] }));
    out.push(govt(309, "Kit Rank Ally", { classes: [309, -1, -1, -1], allies: [310, -1, -1, -1] }));
    out.push({ type: "ränk", id: 202, name: "Kit Ally Repair Rank", clone: "ränk:128",
        set: { "@0:i16": 1, "@2:i16": 310, "@4:i16": 100, "@6:i32": 0, "@10:i32": 0, "@22:i16": 0x0800 } });
    out.push(...shareRled(479, "Kit Ally Blue", RLED.blue, 24, { ...mobile, ai: 4, armor: 3000, shield: 3000, ...armed(365) }), dude(427, "Kit Ally Blue", 4, 309, 479));
    out.push(...shareRled(480, "Kit Affil Purple", RLED.purple, 24, { ...mobile, ai: 4, armor: 3000, shield: 3000, ...armed(365) }), dude(428, "Kit Affil Purple", 4, 310, 480));
    out.push(traffic(system(1508, "Kit Ally Assist", -400, -1180, 363, [1508]), [[427, 50], [428, 50]], 4), port(1508, "Kit Ally Assist Port"));
    out.push(...misn(926, "Kit H ally repair rank", 9222, { availStel: 1508, availLoc: 0, dispWeight: 30000, onAccept: "!b9222 K202" }));
    out.push(...misn(927, "Kit H disabler at the ally port", 9223, { availStel: 1508, availLoc: 3, shipCount: 1, shipDude: 358, shipGoal: -1, shipBehav: -1, shipStart: -1, onAccept: "!b9223" }));

    // --- R19 + ränk 0x0400: does a warship of the reinforcement govt call the
    // fleet in for the player? sÿst 1512 Kit Reinf Rank (311, port spöb 1599;
    // ReinfFleet 305, ReinfTime 300, ReinfIntrval 0): 311's AI 4 warships
    // (green shïp 481, düde 429), avgShips 3. Offer 928 (b9224): OnAccept K203
    // (ränk 203 Kit Reinf Assist Rank: AffilGovt 311, Flags 0x0400) and a Kit
    // Raider (düde 602) at the port.
    out.push(...shareRled(481, "Kit RW Warship", RLED.green, 24, { ...mobile, ai: 4, armor: 3000, shield: 3000, ...armed(365) }), dude(429, "Kit RW Warships", 4, 311, 481));
    const reinfRank = traffic(system(1512, "Kit Reinf Rank", -320, -1180, 311, [1599]), [[429, 100]], 3);
    reinfRank.set = { ...reinfRank.set, reinfFleet: 305, reinfTime: 300, reinfInterval: 0 };
    out.push(reinfRank, port(1599, "Kit Reinf Rank Port"));
    out.push({ type: "ränk", id: 203, name: "Kit Reinf Assist Rank", clone: "ränk:128",
        set: { "@0:i16": 1, "@2:i16": 311, "@4:i16": 100, "@6:i32": 0, "@10:i32": 0, "@22:i16": 0x0400 } });
    out.push(...misn(928, "Kit R19 reinf assist rank and a raider", 9224, { availStel: 1599, shipCount: 1, shipDude: 602, shipGoal: -1, shipBehav: -1, shipStart: -1, onAccept: "!b9224 K203" }));
    return out;
}

/**
 * Wave-18 experiments (docs/reference_experiments.md, "... wave 18").
 * Nothing retired; ids above wave 17's: sÿst 1593-1598, spöb 1593-1597,
 * shïp 457-466, düde 421-424, gövt 312, ränk 201, bits 9210-9220. mïsn ids
 * past 1124 run out at the game's 1127, so wave 18 uses the free ids
 * between the stock missions (128-918) and the kit's 960: mïsn 919-924
 * (offer text dësc 4791-4796). Map row y = -1140.
 *
 *  A14 Per-system records (docs/npc_behavior_gaps.md "Legal records per
 *      system: guesses to measure" 1, 6, 11): gövt 312 Kit Spread Disab
 *      (Disab 400 / Board 800 / Kill 2000, CrimeTol 30000) owns sÿst 1593
 *      Kit Disab Owner (port spöb 1593) and 1594 Kit Disab One (no stellar);
 *      sÿst 1595 Kit Disab Unowned (govt -1, port spöb 1594). Links 1595 -
 *      1593 - 1594. Traffic of 1593 and 1595: gövt 312's AI 1 traders, the
 *      magenta pointer hulk sprite with 3000 / 3000 (shïp 466, düde 424): two
 *      Kit Disable Gun hits disable one, a third kills it.
 *  T   Who stays: sÿst 1596 Kit Traffic AI2 (363, port spöb 1595): AI 2
 *      traders of 363 with the Kit Escort Gun, red / orange / yellow / green
 *      (shïp 457-460, düde 421); sÿst 1597 Kit Traffic AI3 (363, port spöb
 *      1596): AI 3 warships of 363, azure / blue / purple / magenta (shïp
 *      461-464, düde 422). avgShips 4 each, nothing else.
 *  W1  sÿst 1598 Kit Burn One (363, port spöb 1597): wave 15's magenta
 *      0x0040 hull (düde 397, hostile 362) alone, avgShips 1.
 *  P   Self-defence against a hostile firing NOW: shïp 465 Kit Pest
 *      Anchored (red, Speed 0, 30000 / 30000, gövt 362 via düde 423, AI 3,
 *      the Kit Raider Gun turret: 20 damage every 20 frames, the gun the
 *      W1 hostiles fire at once), offer 919 (b9210) on Kit Self Defence's
 *      150 px marker 1587; with wave 17's BBS 1112 (b9194, the anchored
 *      nosy police on 1586).
 *  H   ränk 0x0400 against a WARSHIP: offer 920 (b9211) at Kit Assist Calm
 *      (1581: neutral 363 AI 3 warships and AI 1 traders): OnAccept K200
 *      and a Kit Raider (düde 602) at the port. ränk 201 Kit Free Repair
 *      Rank (AffilGovt 363, Flags 0x0800 "allied ships repair / refuel for
 *      free"): BBS 921 (b9212, OnAccept K201) at 1581, with wave 16's
 *      disabler offer 1105 (b9187).
 *  R   Rescues near the port: Kit Self Defence's marker 1586 (300 px):
 *      offer 922 (b9213) = 1080 (the kit düde 330 with the Raczak cargo),
 *      923 (b9215) = 1121 (no cargo), 924 (b9217) the kit düde with
 *      ShipStart 2 (appear randomly, cloaked); ReturnStel 1585, OnSuccess
 *      b9214 / b9216 / b9218.
 */
function wave18Resources() {
    const out = [];
    const shareRled = (id, name, rledId, size, set) => [
        { type: "shïp", id, name, clone: "shïp:128", set: { ...shipBase, shortName: name, longName: name, commName: name, subtitle: "", ...set } },
        { type: "shän", id, name, clone: "shän:128", set: { "@0:i16": rledId, "@2:i16": rledId + 1, "@4:i16": 1, "@6:i16": size, "@8:i16": size } },
    ];
    const mobile = { accel: 300, speed: 300, turn: 30, mass: 50, freeMass: 100, cargo: 10, strength: 50, crew: 10, flags: 0, flags2: 0 };
    const anchored = { ...mobile, accel: 0, speed: 0, armor: 30000, shield: 30000 };
    const armed = (wid, n = 1, ammo = 0) => ({ weapons: [wid, -1, -1, -1], weaponCounts: [n, 0, 0, 0], weaponAmmo: [ammo, 0, 0, 0] });
    const links = (...ids) => [...ids, ...none16].slice(0, 16);
    const traffic = (s, dudes, avgShips) => {
        s.set = { ...s.set, dudes: [...dudes.map((d) => d[0]), ...none8].slice(0, 8), dudeProbs: [...dudes.map((d) => d[1]), ...zero8].slice(0, 8), avgShips };
        return s;
    };
    const port = (id, name, x = 0, y = 0, set = {}) => spob(id, name, x, y, 138, { flags: 0x43, ...set });
    const RLED = { red: 1971, green: 1972, blue: 1973, yellow: 1974, magenta: 1975, orange: 1956, azure: 1958, purple: 1960, pointer: 1959 };
    const shipMisn = (id, name, bit, availStel, dudeId, shipStart, bbs) => misn(id, name, bit, {
        availStel, availLoc: bbs ? 0 : 3, shipCount: 1, shipDude: dudeId, shipGoal: -1, shipBehav: -1, shipStart,
        onAccept: `!b${bit}`, ...(bbs ? { dispWeight: 30000 } : {}) });
    const multiDude = (id, name, ai, govtId, shipIds) => ({ type: "düde", id, name, clone: "düde:128",
        set: { ai, govt: govtId, flags: 0, infoTypes: 0, ships: [...shipIds, ...none16].slice(0, 16),
            probs: [...shipIds.map(() => Math.floor(100 / shipIds.length)), ...zero16].slice(0, 16) } });

    // --- A14: a disable / boarding spreading, a crime inside an unowned system.
    out.push(govt(312, "Kit Spread Disab", { disabPenalty: 400, boardPenalty: 800, killPenalty: 2000, crimeTol: 30000, classes: [312, -1, -1, -1] }));
    out.push(...shareRled(466, "Kit Disab Trader", RLED.pointer, 24, { ...mobile, ai: 1, armor: 3000, shield: 3000 }), dude(424, "Kit Disab Trader", 1, 312, 466));
    const owner = traffic(system(1593, "Kit Disab Owner", -520, -1140, 312, [1593]), [[424, 100]], 3);
    owner.set.links = links(1594, 1595);
    const one = system(1594, "Kit Disab One", -480, -1140, 312, []);
    one.set.links = links(1593);
    const unowned = traffic(system(1595, "Kit Disab Unowned", -560, -1140, -1, [1594]), [[424, 100]], 3);
    unowned.set.links = links(1593);
    out.push(owner, port(1593, "Kit Disab Owner Port"), one, unowned, port(1594, "Kit Disab Unowned Port"));

    // --- T: AI 2 traders only / AI 3 warships only.
    const ai2 = [[457, "red"], [458, "orange"], [459, "yellow"], [460, "green"]];
    const ai3 = [[461, "azure"], [462, "blue"], [463, "purple"], [464, "magenta"]];
    ai2.forEach(([id, c]) => out.push(...shareRled(id, `Kit AI2 ${c}`, RLED[c], 24, { ...mobile, ai: 2, armor: 3000, shield: 3000, ...armed(365) })));
    ai3.forEach(([id, c]) => out.push(...shareRled(id, `Kit AI3 ${c}`, RLED[c], 24, { ...mobile, ai: 3, armor: 3000, shield: 3000, ...armed(365) })));
    out.push(multiDude(421, "Kit AI2 Traders", 2, 363, ai2.map((s) => s[0])), multiDude(422, "Kit AI3 Warships", 3, 363, ai3.map((s) => s[0])));
    out.push(traffic(system(1596, "Kit Traffic AI2", -400, -1140, 363, [1595]), [[421, 100]], 4), port(1595, "Kit Traffic AI2 Port"));
    out.push(traffic(system(1597, "Kit Traffic AI3", -360, -1140, 363, [1596]), [[422, 100]], 4), port(1596, "Kit Traffic AI3 Port"));

    // --- W1: one 0x0040 hull.
    out.push(traffic(system(1598, "Kit Burn One", -320, -1140, 363, [1597]), [[397, 100]], 1), port(1597, "Kit Burn One Port"));

    // --- P: a hostile firing continuously.
    out.push(...shareRled(465, "Kit Pest Anchored", RLED.red, 24, { ...anchored, ai: 3, ...armed(367) }), dude(423, "Kit Pest Anchored", 3, 362, 465));
    out.push(...shipMisn(919, "Kit P pest as the first shooter", 9210, 1585, 423, -3, false));

    // --- H: ränk 0x0400 and a warship; ränk 0x0800.
    out.push(...misn(920, "Kit H assist rank and a raider", 9211, { availStel: 1581, shipCount: 1, shipDude: 602, shipGoal: -1, shipBehav: -1, shipStart: -1, onAccept: "!b9211 K200" }));
    out.push({ type: "ränk", id: 201, name: "Kit Free Repair Rank", clone: "ränk:128",
        set: { "@0:i16": 1, "@2:i16": 363, "@4:i16": 100, "@6:i32": 0, "@10:i32": 0, "@22:i16": 0x0800 } });
    out.push(...misn(921, "Kit H free repair rank", 9212, { availStel: 1581, availLoc: 0, dispWeight: 30000, onAccept: "!b9212 K201" }));

    // --- R: rescues on the 300 px marker of Kit Self Defence.
    const raczak = { shipCount: 1, shipSyst: -1, shipDude: 330, shipGoal: 5, shipBehav: -1, shipNameID: 25002, compGovt: 144, compReward: 10,
        cargoType: 27, cargoQty: 1, pickupMode: 2, dropoffMode: 1, scanMask: 520, flags: 0x1214, flags2: 0x0001, returnStel: 1585, availShipType: 127, availStel: 1585 };
    const noCargo = { cargoType: -1, cargoQty: 0, pickupMode: -1, dropoffMode: -1 };
    out.push(...misn(922, "Kit R kit dude with cargo near", 9213, { ...raczak, shipStart: -2, onAccept: "!b9213", onSuccess: "b9214" }));
    out.push(...misn(923, "Kit R kit dude no cargo near", 9215, { ...raczak, ...noCargo, shipStart: -2, onAccept: "!b9215", onSuccess: "b9216" }));
    out.push(...misn(924, "Kit R kit dude ShipStart 2", 9217, { ...raczak, shipStart: 2, onAccept: "!b9217", onSuccess: "b9218" }));
    return out;
}

/**
 * Wave-17 experiments (docs/reference_experiments.md, "... wave 17").
 * Nothing retired; ids above wave 16's: sÿst / spöb 1585-1592, shïp
 * 454-456, düde 417-420, mïsn 1111-1124, bits 9193-9209, ränk 200 (the
 * first kit ränk; stock ränks are 128-158). Map row y = -1100.
 *
 *  P   Self-defence and the watch range: sÿst 1585 Kit Self Defence (owner
 *      326 Kit Police Nosy, no traffic): spöb 1585 port (0,0), markers 1586
 *      (300,0), 1587 (0,150), 1588 (5000,0), 1589 (-9000,0). Offer 1111
 *      (b9193): shïp 454 Kit Shooter Anchored (red, Speed 0, 30000 / 30000,
 *      the 1-damage Kit Tickler turret; düde 417, AI 3, gövt 362 "always
 *      attacks the player") on 1587, meant to fire at the player first (it
 *      never did); offer 1124 (b9209) wave 13's anchored Kit Disabler (düde
 *      358, one 1200-damage bolt) there instead, which did; BBS 1112
 *      (b9194) the anchored nosy police (düde 408) on 1586. Offer 1113
 *      (b9195): the anchored AI 1 victim of 343 (düde 405) at the port; BBS
 *      1114 / 1115 (b9196 / 9197) the anchored police on 1588 / 1589.
 *      AI 4 allies: düde 418 (AI 4 of 317, the ally of 343; the blue shïp
 *      433) and 419 (AI 4 of 343 itself; the orange 432) as BBS jobs 1116 /
 *      1117 (b9198 / 9199) at Kit Answer Range's port (1560), with wave
 *      16's victim offer 1088 (b9170) and raider BBS 1091 (b9173).
 *  H   ränk 200 Kit Assist Rank (AffilGovt 363, Flags 0x0400 "can always
 *      request battle assistance"), given by offer 1118 (b9200, OnAccept
 *      K200) at Kit Assist Range (1545: raiders, neutral 363 warships and
 *      traders). A disabled ALLY: shïp 456 Kit Fragile Ally (shïp 451 with
 *      InherentGovt 317, the ally of 343) at Kit Call Range B (1584, Kit
 *      Shipping traffic of 343), offer 1123 (b9208) the Kit Disabler at the
 *      port.
 *  C1  sÿst/spöb 1590 Kit Cloak Anchor (363), marker 1591 (200,0): offer
 *      1119 (b9201) shïp 455 Kit Cloak Yellow Anchored (shïp 443, the AI 3
 *      0x4000 cloaker, with Speed / Accel 0; düde 420) on the marker.
 *  S   sÿst/spöb 1592 Kit Scan Clean (owner 313 Kit Customs Big), its
 *      cutters (düde 410) the traffic, avgShips 4: is a clean ship
 *      approached by every cutter?
 *  R   Rescue away from the port: mïsn 1120 (b9202) = 1080 (the kit düde
 *      330 with cargo) and 1121 (b9204) = 1073 (no cargo), both with
 *      ShipStart -3 (Kit Range's marker 2102), OnSuccess b9203 / b9205.
 *      1122 (b9206) = 1070 (stock Raczak, ShipStart 2: appear randomly,
 *      cloaked), OnSuccess b9207. (Marker 2102 is about 3,000 px out: the
 *      board loop never reached it.)
 */
function wave17Resources() {
    const out = [];
    const shareRled = (id, name, rledId, size, set) => [
        { type: "shïp", id, name, clone: "shïp:128", set: { ...shipBase, shortName: name, longName: name, commName: name, subtitle: "", ...set } },
        { type: "shän", id, name, clone: "shän:128", set: { "@0:i16": rledId, "@2:i16": rledId + 1, "@4:i16": 1, "@6:i16": size, "@8:i16": size } },
    ];
    const mobile = { accel: 300, speed: 300, turn: 30, mass: 50, freeMass: 100, cargo: 10, strength: 50, crew: 10, flags: 0, flags2: 0 };
    const anchored = { ...mobile, accel: 0, speed: 0, armor: 30000, shield: 30000 };
    const armed = (wid, n = 1, ammo = 0) => ({ weapons: [wid, -1, -1, -1], weaponCounts: [n, 0, 0, 0], weaponAmmo: [ammo, 0, 0, 0] });
    const traffic = (s, dudes, avgShips) => {
        s.set = { ...s.set, dudes: [...dudes.map((d) => d[0]), ...none8].slice(0, 8), dudeProbs: [...dudes.map((d) => d[1]), ...zero8].slice(0, 8), avgShips };
        return s;
    };
    const port = (id, name, x = 0, y = 0, set = {}) => spob(id, name, x, y, 138, { flags: 0x43, ...set });
    const marker = (id, name, x, y) => spob(id, name, x, y, 132, { flags: 0x20, techLevel: 0, specialTech: [-1, -1, -1] });
    const RLED = { red: 1971, yellow: 1974 };
    const shipMisn = (id, name, bit, availStel, dudeId, shipStart, bbs) => misn(id, name, bit, {
        availStel, availLoc: bbs ? 0 : 3, shipCount: 1, shipDude: dudeId, shipGoal: -1, shipBehav: -1, shipStart,
        onAccept: `!b${bit}`, ...(bbs ? { dispWeight: 30000 } : {}) });

    // --- P: self-defence, the watch range at 5000 / 9000 px, AI 4 allies.
    out.push(...shareRled(454, "Kit Shooter Anchored", RLED.red, 24, { ...anchored, ai: 3, ...armed(361) }), dude(417, "Kit Shooter Anchored", 3, 362, 454));
    out.push(system(1585, "Kit Self Defence", -520, -1100, 326, [1585, 1586, 1587, 1588, 1589]), port(1585, "Kit Self Defence Port"),
        marker(1586, "Defence 300", 300, 0), marker(1587, "Defence South", 0, 150), marker(1588, "Watch 5000", 5000, 0), marker(1589, "Watch 9000", -9000, 0));
    out.push(...shipMisn(1111, "Kit P shooter", 9193, 1585, 417, -3, false), ...shipMisn(1112, "Kit P police 300", 9194, 1585, 408, -2, true),
        ...shipMisn(1113, "Kit P victim", 9195, 1585, 405, -1, false), ...shipMisn(1114, "Kit P police 5000", 9196, 1585, 408, -4, true),
        ...shipMisn(1115, "Kit P police 9000", 9197, 1585, 408, -5, true));
    out.push(dude(418, "Kit Shipping Ally AI4", 4, 317, 433), dude(419, "Kit Shipping Guard AI4", 4, 343, 432));
    out.push(...shipMisn(1116, "Kit P ally AI4 317", 9198, 1560, 418, -1, true), ...shipMisn(1117, "Kit P guard AI4 343", 9199, 1560, 419, -1, true));

    // --- H: a ränk with Flags 0x0400 for the neutral 363.
    out.push({ type: "ränk", id: 200, name: "Kit Assist Rank", clone: "ränk:128",
        set: { "@0:i16": 1, "@2:i16": 363, "@4:i16": 100, "@6:i32": 0, "@10:i32": 0, "@22:i16": 0x0400 } });
    out.push(...misn(1118, "Kit H assist rank", 9200, { availStel: 1545, onAccept: "!b9200 K200" }));
    // A disabled pilot asking an ALLY: shïp 456 Kit Fragile Ally (shïp 451 with
    // InherentGovt 317, the ally of 343) at Kit Call Range B (1584: traffic
    // Kit Shipping of 343); offer 1123 (b9208) the anchored Kit Disabler (düde
    // 358) at the port.
    out.push(...ship(456, "Kit Fragile Ally", 135, { accel: 2000, speed: 800, turn: 60, armor: 1500, shield: 0, shieldRecharge: 0, armorRecharge: 0, mass: 50,
        freeMass: 1000, cargo: 200, maxGuns: 16, maxTurrets: 16, ai: 3, strength: 100, flags: 0, flags2: 0x00C8, govt: 317 }));
    out.push(...shipMisn(1123, "Kit H disabler at Call B", 9208, 1584, 358, -1, false));
    // Added during the wave: the Kit Shooter never fired first (not at a Kit
    // Lancer, not at the Strength-1 Kit Lancer Heavy Weak), so offer 1124
    // (b9209) puts wave 13's anchored Kit Disabler (düde 358, gövt 362; it
    // fired at once at wave 16's H1 pilot) on 1587 instead.
    out.push(...shipMisn(1124, "Kit P disabler as the first shooter", 9209, 1585, 358, -3, false));

    // --- C1: the 0x4000 cloaker anchored on screen.
    out.push(...shareRled(455, "Kit Cloak Yellow Anchored", RLED.yellow, 24, { ...anchored, ai: 3, armor: 2000, shield: 2000, flags2: 0x4000,
        outfits: [266, -1, -1, -1], outfitCounts: [1, 0, 0, 0], ...armed(367) }), dude(420, "Kit Cloak Yellow Anchored", 3, 363, 455));
    out.push(system(1590, "Kit Cloak Anchor", -480, -1100, 363, [1590, 1591]), port(1590, "Kit Cloak Anchor Port"), marker(1591, "Cloak Mark", 200, 0));
    out.push(...shipMisn(1119, "Kit C anchored 0x4000", 9201, 1590, 420, -2, false));

    // --- S: a clean ship among four cutters.
    out.push(traffic(system(1592, "Kit Scan Clean", -440, -1100, 313, [1592]), [[410, 100]], 4), port(1592, "Kit Scan Clean Port"));

    // --- R: rescues away from the port (Kit Range marker 2102 is the third stellar).
    const raczak = { shipCount: 1, shipSyst: -1, shipDude: 258, shipGoal: 5, shipBehav: -1, shipNameID: 25002, compGovt: 144, compReward: 10,
        cargoType: 27, cargoQty: 1, pickupMode: 2, dropoffMode: 1, scanMask: 520, flags: 0x1214, flags2: 0x0001, returnStel: 2100, availShipType: 127 };
    const noCargo = { cargoType: -1, cargoQty: 0, pickupMode: -1, dropoffMode: -1 };
    out.push(...misn(1120, "Kit R kit dude with cargo at a marker", 9202, { ...raczak, shipDude: 330, shipStart: -3, onAccept: "!b9202", onSuccess: "b9203" }));
    out.push(...misn(1121, "Kit R kit dude no cargo at a marker", 9204, { ...raczak, ...noCargo, shipDude: 330, shipStart: -3, onAccept: "!b9204", onSuccess: "b9205" }));
    out.push(...misn(1122, "Kit R Raczak ShipStart 2 again", 9206, { ...raczak, shipStart: 2, onAccept: "!b9206", onSuccess: "b9207" }));
    return out;
}

/**
 * Wave-16 experiments (docs/reference_experiments.md, "... wave 16").
 * Nothing retired; ids above wave 15's: sÿst / spöb 1560-1584, shïp
 * 447-453, düde 405-416, gövt 313 / 314, mïsn 1088-1110, bits 9170-9192.
 * New map positions on the row y = -1060 (apart from every other system).
 * Added during the wave (the 30000-shield mission victims never called):
 * shïp 452 / 453 (thin anchored / mobile victims, düde 415 / 416, offers
 * 1107 / 1108, b9189 / b9190 at 1560); sÿst/spöb 1582 Kit Call Range A
 * (traffic raiders, the thin victim as offer 1109, b9191, on mark 1583) and
 * 1584 Kit Call Range B (traffic Kit Shipping, a mission raider as offer
 * 1110, b9192).
 *
 *  D   Distress answerers, the fight on screen: sÿst/spöb 1560 Kit Answer
 *      Range (owner 363, no traffic), spöb 1561 Answer Mark (160,0),
 *      uninhabited. Main-spaceport offer (one per pilot): an ANCHORED
 *      green victim of gövt 343 Kit Shipping on the mark (ShipStart -2;
 *      Speed 0, 30000 / 30000): mïsn 1088 AI 1 (b9170, shïp 447, düde
 *      405), 1089 AI 2 (b9171, 448, 406), 1090 AI 3 unarmed (b9172, 449,
 *      407). Mission BBS: 1091 (b9173) one yellow Kit Raider P (düde 374,
 *      gövt 328, enemy of 343) on the mark; one candidate answerer at the
 *      port (ShipStart -1): 1092 orange guard of 343 (b9174, düde 389),
 *      1093 blue AI 3 of the ally 317 (b9175, düde 390), 1094 cyan AI 3 of
 *      the unrelated 316 (b9176, düde 391), 1095 red AI 4 of the unrelated
 *      non-nosy 315 (b9177, düde 392).
 *  W   Police watch range: sÿst 1562 Kit Watch Range (owner 326 Kit Police
 *      Nosy, gövt 0x0002, no traffic): spöb 1562 Watch Port (0,0), markers
 *      1563 (300,0), 1564 (1000,0), 1565 (2500,0). Offer 1097 (b9179): the
 *      anchored AI 1 victim of 343 (düde 405) at the port. BBS: an ANCHORED
 *      nosy police (red, AI 4, Speed 0, Kit Escort Gun; shïp 450, düde 408)
 *      on 1563 / 1564 / 1565: mïsn 1098 / 1099 / 1100 (b9180-9182); 1101
 *      (b9183) a Kit Raider of 362 (always attacks the player; düde 602) at
 *      the port (self-defence); 1096 (b9178) a MOBILE nosy police (düde
 *      376) at the port and 1106 (b9188) a Kit Raider P (düde 374) at the
 *      port: NPC-on-NPC policing with the victim offer.
 *  A   A14, a second victim govt for the Independent neighbour: gövt 314
 *      Kit Victim Odd (Disab 400 / Board 7 / Kill 70, no relations), its
 *      bare traders (shïp 861, düde 409) are the traffic of sÿst/spöb 1566
 *      Kit Spread Kill 3 (owner 338), linked to 1567 Kit Spread Unowned 3
 *      (govt -1, port), linked to 1568 Kit Spread Beyond 3 (govt -1, no
 *      stellar).
 *  S   Contraband: gövt 313 Kit Customs Big (ScanMask 0x0001, ScanFine
 *      5000, Smug 50, CrimeTol 30000) owns sÿst/spöb 1569 Kit Scan Big, its
 *      cutters (shïp 855, düde 410) the traffic: a fine above the pilot's
 *      cash, and the thousands separator.
 *  N   Shuttles, one colour per düde (düde 411-414 = shïp 424-427 azure /
 *      blue / purple / magenta, gövt 346, 25% each): sÿst 1570 Kit Lane
 *      Range (owner 346), stellars in list order 1571 Lane East (150,40,
 *      346), 1572 Lane North (-60,200, 363), 1570 Lane Port (-140,-60, 346;
 *      the player), 1573 Lane Centre (0,0, 346): uneven distances, all on
 *      screen from the port, the port NOT at the system centre. sÿst 1574
 *      Kit Lane One: 1574 One Port (0,0, 346), 1575 / 1576 of the enemy 347
 *      at (220,0) / (0,220): one stop. sÿst 1577 Kit Lane None (owner 363):
 *      1577 None Port (0,0) and 1578 (220,0), both of 347: no stop.
 *  W1  sÿst/spöb 1579 Kit Hull Flags 2 (363): yellow 0x0002 (düde 395,
 *      35%), red 0x0080 (393, 25%), magenta Flags 0x0040 (397, 20%), green
 *      control (394, 20%), avgShips 5.
 *  C1  sÿst/spöb 1580 Kit Cloak Provoke (363, no traffic): offer 1102
 *      (b9184) the yellow AI 3 0x4000 cloaker (düde 401) at the port; BBS
 *      1103 (b9185) the blue AI 1 0x0400 (düde 399), 1104 (b9186) the
 *      orange AI 1 0x2000 (düde 400), both at the port.
 *  H1  sÿst/spöb 1581 Kit Assist Calm (363): the neutral warship (düde
 *      403) and trader (404), avgShips 3; offer 1105 (b9187) the anchored
 *      Kit Disabler of 362 (düde 358: one 1200-damage bolt, reload 30000)
 *      at the port, to disable a shïp 451 Kit Fragile player (shield 0,
 *      armor 1500).
 */
function wave16Resources() {
    const out = [];
    const shareRled = (id, name, rledId, size, set) => [
        { type: "shïp", id, name, clone: "shïp:128", set: { ...shipBase, shortName: name, longName: name, commName: name, subtitle: "", ...set } },
        { type: "shän", id, name, clone: "shän:128", set: { "@0:i16": rledId, "@2:i16": rledId + 1, "@4:i16": 1, "@6:i16": size, "@8:i16": size } },
    ];
    const mobile = { accel: 300, speed: 300, turn: 30, mass: 50, freeMass: 100, cargo: 10, strength: 50, crew: 10, flags: 0, flags2: 0 };
    const anchored = { ...mobile, accel: 0, speed: 0, armor: 30000, shield: 30000 };
    const links = (...ids) => [...ids, ...none16].slice(0, 16);
    const traffic = (s, dudes, avgShips) => {
        s.set = { ...s.set, dudes: [...dudes.map((d) => d[0]), ...none8].slice(0, 8), dudeProbs: [...dudes.map((d) => d[1]), ...zero8].slice(0, 8), avgShips };
        return s;
    };
    const port = (id, name, x = 0, y = 0, set = {}) => spob(id, name, x, y, 138, { flags: 0x43, ...set });
    const marker = (id, name, x, y) => spob(id, name, x, y, 132, { flags: 0x20, techLevel: 0, specialTech: [-1, -1, -1] });
    const RLED = { red: 1971, green: 1972 };
    const shipMisn = (id, name, bit, availStel, dudeId, shipStart, bbs) => misn(id, name, bit, {
        availStel, availLoc: bbs ? 0 : 3, shipCount: 1, shipDude: dudeId, shipGoal: -1, shipBehav: -1, shipStart,
        onAccept: `!b${bit}`, ...(bbs ? { dispWeight: 30000 } : {}) });

    // --- D: distress answerers.
    [[447, 1, 405], [448, 2, 406], [449, 3, 407]].forEach(([sid, ai, did]) => {
        out.push(...shareRled(sid, `Kit Anchored Victim AI${ai}`, RLED.green, 24, { ...anchored, ai }));
        out.push(dude(did, `Kit Anchored Victim AI${ai}`, ai, 343, sid));
    });
    out.push(system(1560, "Kit Answer Range", -520, -1060, 363, [1560, 1561]), port(1560, "Kit Answer Port"), marker(1561, "Answer Mark", 160, 0));
    out.push(...shipMisn(1088, "Kit D victim AI1", 9170, 1560, 405, -2, false), ...shipMisn(1089, "Kit D victim AI2", 9171, 1560, 406, -2, false),
        ...shipMisn(1090, "Kit D victim AI3", 9172, 1560, 407, -2, false), ...shipMisn(1091, "Kit D raider", 9173, 1560, 374, -2, true),
        ...shipMisn(1092, "Kit D guard 343", 9174, 1560, 389, -1, true), ...shipMisn(1093, "Kit D ally 317", 9175, 1560, 390, -1, true),
        ...shipMisn(1094, "Kit D bystander 316", 9176, 1560, 391, -1, true), ...shipMisn(1095, "Kit D bystander police 315", 9177, 1560, 392, -1, true));
    // Added during the wave (the 30000-shield anchored victims never called):
    // shïp 452 anchored with shield 300 / armor 30000 (düde 415, offer 1107,
    // b9189) and shïp 453 a mobile 3000 / 3000 AI 1 trader like the traffic
    // (düde 416, offer 1108, b9190), both of 343 on the mark.
    out.push(...shareRled(452, "Kit Anchored Victim Thin", RLED.green, 24, { ...anchored, ai: 1, shield: 300 }), dude(415, "Kit Anchored Victim Thin", 1, 343, 452));
    out.push(...shareRled(453, "Kit Mobile Victim", RLED.green, 24, { ...mobile, ai: 1, armor: 3000, shield: 3000 }), dude(416, "Kit Mobile Victim", 1, 343, 453));
    out.push(...shipMisn(1107, "Kit D victim thin", 9189, 1560, 415, -2, false), ...shipMisn(1108, "Kit D victim mobile", 9190, 1560, 416, -2, false));
    // Mission ships never called either, so: sÿst/spöb 1582 Kit Call Range A
    // (363; mark 1583 at (160,0)) with TRAFFIC raiders (düde 374, avgShips 2)
    // and the thin anchored victim as the offer (1109, b9191, on the mark);
    // sÿst/spöb 1584 Kit Call Range B (363) with TRAFFIC Kit Shipping (düde
    // 355, avgShips 3) and a MISSION raider (1110, b9192, offer, at the port).
    out.push(traffic(system(1582, "Kit Call Range A", -40, -1060, 363, [1582, 1583]), [[374, 100]], 2), port(1582, "Kit Call A Port"), marker(1583, "Call A Mark", 160, 0));
    out.push(traffic(system(1584, "Kit Call Range B", 0, -1060, 363, [1584]), [[355, 100]], 3), port(1584, "Kit Call B Port"));
    out.push(...shipMisn(1109, "Kit D thin victim, traffic raiders", 9191, 1582, 415, -2, false), ...shipMisn(1110, "Kit D mission raider, traffic victims", 9192, 1584, 374, -1, false));

    // --- W: police watch range, self-defence, NPC-on-NPC policing.
    out.push(...shareRled(450, "Kit Police Anchored", RLED.red, 24, { ...anchored, ai: 4, weapons: [365, -1, -1, -1], weaponCounts: [1, 0, 0, 0], weaponAmmo: [0, 0, 0, 0] }));
    out.push(dude(408, "Kit Police Nosy Anchored", 4, 326, 450));
    out.push(system(1562, "Kit Watch Range", -480, -1060, 326, [1562, 1563, 1564, 1565]), port(1562, "Kit Watch Port"),
        marker(1563, "Watch 300", 300, 0), marker(1564, "Watch 1000", 1000, 0), marker(1565, "Watch 2500", 2500, 0));
    out.push(...shipMisn(1097, "Kit W victim", 9179, 1562, 405, -1, false),
        ...shipMisn(1098, "Kit W police 300", 9180, 1562, 408, -2, true), ...shipMisn(1099, "Kit W police 1000", 9181, 1562, 408, -3, true),
        ...shipMisn(1100, "Kit W police 2500", 9182, 1562, 408, -4, true), ...shipMisn(1101, "Kit W self-defence raider", 9183, 1562, 602, -1, true),
        ...shipMisn(1096, "Kit W mobile nosy police", 9178, 1562, 376, -1, true), ...shipMisn(1106, "Kit W raider P", 9188, 1562, 374, -1, true));

    // --- A: a second victim govt for the unowned neighbour.
    out.push(govt(314, "Kit Victim Odd", { disabPenalty: 400, boardPenalty: 7, killPenalty: 70, classes: [314, -1, -1, -1] }));
    out.push(dude(409, "Kit Victim Odd Bare Trader", 1, 314, 861));
    const kill3 = traffic(system(1566, "Kit Spread Kill 3", -440, -1060, 338, [1566]), [[409, 100]], 3);
    kill3.set.links = links(1567);
    const unowned3 = system(1567, "Kit Spread Unowned 3", -400, -1060, -1, [1567]);
    unowned3.set.links = links(1566, 1568);
    const beyond3 = system(1568, "Kit Spread Beyond 3", -360, -1060, -1, []);
    beyond3.set.links = links(1567);
    out.push(kill3, port(1566, "Kit Spread Kill 3 Port"), unowned3, port(1567, "Kit Spread Unowned 3 Port"), beyond3);

    // --- S: a fine above the pilot's cash.
    out.push(govt(313, "Kit Customs Big", { scanMask: 0x0001, scanFine: 5000, smugPenalty: 50, crimeTol: 30000, classes: [313, -1, -1, -1] }));
    out.push(dude(410, "Kit Customs Big Cutter", 4, 313, 855));
    out.push(traffic(system(1569, "Kit Scan Big", -320, -1060, 313, [1569]), [[410, 100]], 2), port(1569, "Kit Scan Big Port"));

    // --- N: shuttle lanes, one stop, no stop.
    [424, 425, 426, 427].forEach((sid, i) => out.push(dude(411 + i, `Kit Lane Shuttle ${sid}`, 1, 346, sid)));
    const shuttleDudes = [[411, 25], [412, 25], [413, 25], [414, 25]];
    out.push(traffic(system(1570, "Kit Lane Range", -280, -1060, 346, [1571, 1572, 1570, 1573]), shuttleDudes, 4),
        port(1571, "Lane East", 150, 40, { govt: 346 }), port(1572, "Lane North", -60, 200, { govt: 363 }),
        port(1570, "Lane Port", -140, -60, { govt: 346 }), port(1573, "Lane Centre", 0, 0, { govt: 346 }));
    out.push(traffic(system(1574, "Kit Lane One", -240, -1060, 346, [1574, 1575, 1576]), shuttleDudes, 3),
        port(1574, "One Port", 0, 0, { govt: 346 }), port(1575, "One Hostile A", 220, 0, { govt: 347 }), port(1576, "One Hostile B", 0, 220, { govt: 347 }));
    out.push(traffic(system(1577, "Kit Lane None", -200, -1060, 363, [1577, 1578]), shuttleDudes, 3),
        port(1577, "None Port", 0, 0, { govt: 347 }), port(1578, "None B", 220, 0, { govt: 347 }));

    // --- W1: standoff, the missile-only ship, the AI afterburner.
    out.push(traffic(system(1579, "Kit Hull Flags 2", -160, -1060, 363, [1579]), [[395, 35], [393, 25], [397, 20], [394, 20]], 5), port(1579, "Kit Hull Flags 2 Port"));

    // --- C1: provoke the 0x4000 cloaker; 0x0400 / 0x2000 leaving.
    out.push(system(1580, "Kit Cloak Provoke", -120, -1060, 363, [1580]), port(1580, "Kit Cloak Provoke Port"));
    out.push(...shipMisn(1102, "Kit C 0x4000 yellow", 9184, 1580, 401, -1, false), ...shipMisn(1103, "Kit C 0x0400 blue", 9185, 1580, 399, -1, true),
        ...shipMisn(1104, "Kit C 0x2000 orange", 9186, 1580, 400, -1, true));

    // --- H1: a disabled pilot's request.
    out.push(...ship(451, "Kit Fragile", 135, { accel: 2000, speed: 800, turn: 60, armor: 1500, shield: 0, shieldRecharge: 0, armorRecharge: 0, mass: 50, freeMass: 1000, cargo: 200, maxGuns: 16, maxTurrets: 16, ai: 3, strength: 100, flags: 0, flags2: 0x00C8 }));
    out.push(traffic(system(1581, "Kit Assist Calm", -80, -1060, 363, [1581]), [[403, 50], [404, 50]], 3), port(1581, "Kit Assist Calm Port"));
    out.push(...shipMisn(1105, "Kit H disabler", 9187, 1581, 358, -1, false));
    return out;
}

/**
 * Wave-15 experiments (docs/reference_experiments.md, "... wave 15").
 * Nothing retired. **New id range:** every kit spöb id 2000-2175 was in
 * use after wave 14, so wave 15 opens sÿst / spöb **1500-1599** (between
 * the stock maxima, sÿst 1127 / spöb 1420, and the kit's 2000; a pilot
 * can name any id up to 2175) and shïp **416-699** (stock shïp ids stop at
 * 414, plus 895; the kit had used only 415). Also mïsn 1083+, bits 9160+,
 * düde 383+, gövt 315-321, wëap 289+, rlëD 1956 / 1958 / 1960 (new disc
 * colours: orange, azure, purple).
 *
 *  T/S Mixed traffic in one system whose stellars are ALL ON SCREEN from
 *      the player's port: sÿst 1500 Kit Square Range (owner 346 Kit Life
 *      Traders). Stellars, in sÿst list order: 1501 Square Hostile
 *      (220,220) of the enemy 347; 1502 Square Market (220,0) of 346; 1500
 *      Square Port (0,0) of 346 (the player); 1503 Square Neutral (0,220)
 *      of 363; 1504 Square Marker (-220,0), uninhabited. Traffic, avgShips
 *      6: düde 383 traders (AI 1, shïp 420-423: red / orange / yellow /
 *      green discs) and düde 384 shuttles (AI 1, Flags3 0x0002, shïp
 *      424-427: azure / blue / purple / magenta), 50 / 50. One colour per
 *      hull, so each ship can be followed.
 *  M   N1 by colour: sÿst/spöb 1505 Kit Mine Colour (16 metal rocks,
 *      gövt 363): the Kit Miner hull (AI 1, Flags3 0x0003, scoop, four
 *      wëap 181) as red / yellow / blue / magenta discs (shïp 428-431,
 *      düde 385), avgShips 2.
 *  A   A14: sÿst/spöb 1510 Kit Spread Unowned (no owner, govt -1; traffic
 *      düde 344, gövt 350's bare traders) linked to 2095 Kit Spread Kill
 *      (patched: 2095 gains the link) and to sÿst 1511 Kit Spread Beyond
 *      (owner 338, no stellar). mïsn 1083 (bit 9160) at Kit Port: CompGovt
 *      338, CompReward 1000, TimeLimit 1, ReturnStel Kit Market (fail it
 *      by letting the day pass at Kit Port): the failure's -R/2.
 *  S   Contraband: gövt 321 Kit Smug Ally Owner (SmugPenalty 70, no
 *      ScanMask; ally 320) owns sÿst/spöb 1515 Kit Scan Ally, whose
 *      traffic is the AI 4 cutters (shïp 855, düde 386) of its ALLY gövt
 *      320 Kit Customs Ally (ScanMask 0x0001, fine 500, Smug 50, CrimeTol
 *      30000). Several finds in one scan: jünk 203 Kit Contraband is also
 *      sold at Kit Scan Tolerant Port (2053; patched), and mïsn 1084 (bit
 *      9163) at 2053 carries 1 t of ScanMask-0x0001 food with Flags 0x0020.
 *  P   Police: sÿst/spöb 1520 Kit Nosy Gate (gövt 363) linked to 2001 Kit
 *      Nosy Range (patched), so a provoked nosy police can be left and
 *      revisited by jump. sÿst/spöb 1525 Kit Friend Ign Range (owner gövt
 *      319 Kit Police Allied Ign, police düde 387) with blue traders of its
 *      ally gövt 318 Kit Friend Ignored (gövt 0x0020; düde 388). sÿst/spöb
 *      1530 Kit Distress Range (owner 363): yellow raiders (düde 374, enemy
 *      of 343) and green Kit Shipping (343, düde 355) with possible
 *      answerers: orange AI 3 Kit Shipping Guard of 343 itself (shïp 432,
 *      düde 389), blue AI 3 of gövt 317 Kit Shipping Ally (allied to 343;
 *      shïp 433, düde 390), cyan AI 3 of gövt 316 Kit Bystander (no
 *      relations; shïp 434, düde 391), red AI 4 of gövt 315 Kit Bystander
 *      Police (no relations, not nosy; düde 392).
 *  item 4  Status bar "Special:": mïsn 1085 (bit 9166, the spaceport
 *      offer) and 1086 (bit 9167, a BBS job) both carry 3 t of cargo type 7
 *      "Military Stores" (STR# 4002 "Mil Stores"); 1087 (bit 9168, BBS)
 *      carries 3 t of type 11 "Money Train" ("$Train"). All to Kit Market.
 *  W1  Hull AI flags: sÿst/spöb 1535 Kit Hull Flags Range (363); hostile
 *      (gövt 362) AI 3 discs: red shïp 435 Flags2 0x0080 with only wëap 289
 *      Kit Ammo Missile (5 rounds), green 436 control (Kit Raider Gun),
 *      yellow 437 Flags2 0x0002 (standoff), blue 438 Flags2 0x0001 (swarm),
 *      magenta 439 shïp Flags 0x0040 (AI afterburner); düde 393-397.
 *  C1  NPC cloaking: sÿst/spöb 1540 Kit Cloak Range (363), the disc hull
 *      with the stock Wraith Cloaking Device (oütf 266), one Flags2 cloak
 *      bit each: green 440 AI 1 0x0800 (flying around), blue 441 AI 1
 *      0x0400 (hyperspacing), orange 442 AI 1 0x2000 (docking), yellow 443
 *      AI 3 (363) 0x4000 (preemptively attacked), red 444 AI 3 hostile
 *      (362) 0x0800 + 0x1000 (stays cloaked until close); düde 398-402.
 *  H1  Battle assistance: sÿst/spöb 1545 Kit Assist Range (363): Kit
 *      Raiders (düde 602, gövt 362), a neutral AI 3 warship (blue shïp 445,
 *      Kit Escort Gun, düde 403) and a neutral AI 1 trader (green shïp 446,
 *      düde 404).
 */
function wave15Resources() {
    const out = [];
    const shareRled = (id, name, rledId, size, set) => [
        { type: "shïp", id, name, clone: "shïp:128", set: { ...shipBase, shortName: name, longName: name, commName: name, subtitle: "", ...set } },
        { type: "shän", id, name, clone: "shän:128", set: { "@0:i16": rledId, "@2:i16": rledId + 1, "@4:i16": 1, "@6:i16": size, "@8:i16": size } },
    ];
    const mobile = { accel: 300, speed: 300, turn: 30, mass: 50, freeMass: 100, cargo: 10, strength: 50, crew: 10, flags: 0, flags2: 0 };
    const armed = (wid, n = 1, ammo = 0) => ({ weapons: [wid, -1, -1, -1], weaponCounts: [n, 0, 0, 0], weaponAmmo: [ammo, 0, 0, 0] });
    const links = (...ids) => [...ids, ...none16].slice(0, 16);
    const traffic = (s, dudes, avgShips) => {
        s.set = { ...s.set, dudes: [...dudes.map((d) => d[0]), ...none8].slice(0, 8), dudeProbs: [...dudes.map((d) => d[1]), ...zero8].slice(0, 8), avgShips };
        return s;
    };
    const port = (id, name, set = {}) => spob(id, name, 0, 0, 138, { flags: 0x43, ...set });
    /** A düde of several hulls, equal odds. */
    const mixDude = (id, name, ai, govtId, shipIds) => ({
        type: "düde", id, name, clone: "düde:128",
        set: { ai, govt: govtId, flags: 0, infoTypes: 0, ships: [...shipIds, ...none16].slice(0, 16),
            probs: [...shipIds.map((_, i) => Math.floor(100 / shipIds.length) + (i < 100 % shipIds.length ? 1 : 0)), ...zero16].slice(0, 16) },
    });
    // New disc colours (24 px, 22 px disc), rlëD ids free between the kit's.
    const RLED = { red: 1971, green: 1972, blue: 1973, yellow: 1974, magenta: 1975, cyan: 1976, orange: 1956, azure: 1958, purple: 1960 };
    for (const [c, rgb] of [["orange", [31, 16, 0]], ["azure", [0, 16, 31]], ["purple", [16, 0, 31]]]) {
        const g = discShipGraphics(RLED[c], rgb, 24, 36, 22);
        out.push({ type: "rlëD", id: RLED[c], name: `Kit Disc ${c}`, hex: Buffer.from(g.rled).toString("hex") });
    }

    // --- T/S: mixed traders and shuttles, every stellar on screen.
    const square = traffic(system(1500, "Kit Square Range", 260, -860, 346, [1501, 1502, 1500, 1503, 1504]), [[383, 50], [384, 50]], 6);
    out.push(square,
        spob(1501, "Square Hostile", 220, 220, 138, { flags: 0x43, govt: 347 }),
        spob(1502, "Square Market", 220, 0, 138, { flags: 0x43, govt: 346 }),
        spob(1500, "Square Port", 0, 0, 138, { flags: 0x43, govt: 346 }),
        spob(1503, "Square Neutral", 0, 220, 138, { flags: 0x43, govt: 363 }),
        spob(1504, "Square Marker", -220, 0, 132, { flags: 0x20, techLevel: 0, specialTech: [-1, -1, -1] }));
    const traders = [[420, "red"], [421, "orange"], [422, "yellow"], [423, "green"]];
    const shuttles = [[424, "azure"], [425, "blue"], [426, "purple"], [427, "magenta"]];
    for (const [id, c] of traders) out.push(...shareRled(id, `Kit Sq Trader ${c}`, RLED[c], 24, { ...mobile, ai: 1, armor: 1000, shield: 1000, flags3: 0 }));
    for (const [id, c] of shuttles) out.push(...shareRled(id, `Kit Sq Shuttle ${c}`, RLED[c], 24, { ...mobile, ai: 1, armor: 1000, shield: 1000, flags3: 0x0002 }));
    out.push(mixDude(383, "Kit Square Traders", 1, 346, traders.map((t) => t[0])), mixDude(384, "Kit Square Shuttles", 1, 346, shuttles.map((t) => t[0])));
    // Added during the wave: the shuttles held every slot of 1500 after 2
    // minutes, so the traders' destinations got only four visits. sÿst 1550
    // Kit Square Traders Range: the same five stellars (spöb 1551 Hostile,
    // 1552 Market, 1550 Port, 1553 Neutral, 1554 Marker, same list order and
    // positions), traders only (düde 383), avgShips 6.
    out.push(traffic(system(1550, "Kit Square Traders Range", 260, -900, 346, [1551, 1552, 1550, 1553, 1554]), [[383, 100]], 6),
        spob(1551, "Square T Hostile", 220, 220, 138, { flags: 0x43, govt: 347 }),
        spob(1552, "Square T Market", 220, 0, 138, { flags: 0x43, govt: 346 }),
        spob(1550, "Square T Port", 0, 0, 138, { flags: 0x43, govt: 346 }),
        spob(1553, "Square T Neutral", 0, 220, 138, { flags: 0x43, govt: 363 }),
        spob(1554, "Square T Marker", -220, 0, 132, { flags: 0x20, techLevel: 0, specialTech: [-1, -1, -1] }));

    // --- M: miners by colour.
    const miner = { ...mobile, ai: 1, armor: 1000, shield: 1000, flags3: 0x0003, cargo: 100, weapons: [181, -1, -1, -1], weaponCounts: [4, 0, 0, 0], weaponAmmo: [0, 0, 0, 0], outfits: [271, -1, -1, -1], outfitCounts: [1, 0, 0, 0] };
    const miners = [[428, "red"], [429, "yellow"], [430, "blue"], [431, "magenta"]];
    for (const [id, c] of miners) out.push(...shareRled(id, `Kit Miner ${c}`, RLED[c], 24, miner));
    out.push(mixDude(385, "Kit Colour Miners", 1, 363, miners.map((m) => m[0])));
    const mineColour = traffic(system(1505, "Kit Mine Colour", 300, -860, 363, [1505]), [[385, 100]], 2);
    mineColour.set = { ...mineColour.set, asteroids: 16, asteroidTypes: 0x000F };
    out.push(mineColour, port(1505, "Kit Mine Colour Port"));

    // --- A: an unowned system in the spread, and the failure's -R/2.
    const unowned = traffic(system(1510, "Kit Spread Unowned", 100, -820, -1, [1510]), [[344, 100]], 3);
    unowned.set.links = links(2095, 1511);
    const beyond = system(1511, "Kit Spread Beyond", 100, -780, 338, []);
    beyond.set.links = links(1510);
    out.push(unowned, port(1510, "Kit Spread Unowned Port"), beyond);
    out.push(...misn(1083, "Kit A comp fail 338", 9160, { compGovt: 338, compReward: 1000, timeLimit: 1, returnStel: 2101, onAccept: "!b9160", onFailure: "b9161", onSuccess: "b9162" }));

    // --- S: an ally of the owner scans; several finds in one scan.
    out.push(govt(321, "Kit Smug Ally Owner", { smugPenalty: 70, classes: [321, -1, -1, -1], allies: [320, -1, -1, -1] }));
    out.push(govt(320, "Kit Customs Ally", { scanMask: 0x0001, scanFine: 500, smugPenalty: 50, crimeTol: 30000, classes: [320, -1, -1, -1], allies: [321, -1, -1, -1] }));
    out.push(dude(386, "Kit Customs Ally Cutter", 4, 320, 855));
    out.push(traffic(system(1515, "Kit Scan Ally", -480, -780, 321, [1515]), [[386, 100]], 2), port(1515, "Kit Scan Ally Port"));
    out.push(...misn(1084, "Kit S several finds", 9163, { availStel: 2053, travelStel: 2055, returnStel: 2053, cargoType: 0, cargoQty: 1, pickupMode: 0, dropoffMode: 0,
        scanMask: 0x0001, flags: 0x0020, compGovt: 332, compReward: 10, onAccept: "!b9163", onFailure: "b9164", onSuccess: "b9165" }));

    // --- P: leaving a provoked nosy police; 0x0020 on an ally; distress answerers.
    const nosyGate = system(1520, "Kit Nosy Gate", -80, -780, 363, [1520]);
    nosyGate.set.links = links(2001);
    out.push(nosyGate, port(1520, "Kit Nosy Gate Port"));
    out.push(govt(319, "Kit Police Allied Ign", { classes: [319, -1, -1, -1], allies: [318, -1, -1, -1] }));
    out.push(govt(318, "Kit Friend Ignored", { classes: [318, -1, -1, -1], allies: [319, -1, -1, -1], flags: 0x0020 }));
    out.push(dude(387, "Kit Police Allied Ign", 4, 319, 868), dude(388, "Kit Friend Ignored", 1, 318, 883));
    out.push(traffic(system(1525, "Kit Friend Ign Range", -40, -860, 319, [1525]), [[387, 100], [388, 100]], 4), port(1525, "Kit Friend Ign Port"));
    out.push(govt(317, "Kit Shipping Ally", { classes: [317, -1, -1, -1], allies: [343, -1, -1, -1] }));
    out.push(govt(316, "Kit Bystander", { classes: [316, -1, -1, -1] }));
    out.push(govt(315, "Kit Bystander Police", { classes: [315, -1, -1, -1] }));
    const guard = { ...mobile, ai: 3, armor: 3000, shield: 3000, ...armed(365) };
    out.push(...shareRled(432, "Kit Shipping Guard", RLED.orange, 24, guard));
    out.push(...shareRled(433, "Kit Shipping Ally", RLED.blue, 24, guard));
    out.push(...shareRled(434, "Kit Bystander", RLED.cyan, 24, guard));
    out.push(dude(389, "Kit Shipping Guard", 3, 343, 432), dude(390, "Kit Shipping Ally", 3, 317, 433), dude(391, "Kit Bystander", 3, 316, 434), dude(392, "Kit Bystander Police", 4, 315, 868));
    out.push(traffic(system(1530, "Kit Distress Range", -80, -860, 363, [1530]), [[374, 100], [355, 100], [389, 60], [390, 60], [391, 60], [392, 60]], 9), port(1530, "Kit Distress Port"));

    // --- Item 4: the status bar's "Special:" line.
    const cargoMisn = (id, name, bit, cargoType, availLoc) => misn(id, name, bit, { availLoc, cargoType, cargoQty: 3, pickupMode: 0, dropoffMode: 1, returnStel: 2101,
        onAccept: `!b${bit}`, ...(availLoc === 0 ? { dispWeight: 30000 } : {}) });
    out.push(...cargoMisn(1085, "Kit Special stores offer", 9166, 7, 3), ...cargoMisn(1086, "Kit Special stores BBS", 9167, 7, 0), ...cargoMisn(1087, "Kit Special train BBS", 9168, 11, 0));

    // --- W1: hull AI flags.
    out.push(weap(289, "Kit Ammo Missile", 131, { reload: 60, duration: 90, armorDamage: 20, shieldDamage: 20, guidance: 1, speed: 400, guidedTurn: 30, ammoType: 289 - 128, maxAmmo: 5 }));
    const hullFlags = [[435, "red", { flags2: 0x0080, ...armed(289, 1, 5) }], [436, "green", armed(367)], [437, "yellow", { flags2: 0x0002, ...armed(367) }],
        [438, "blue", { flags2: 0x0001, ...armed(367) }], [439, "magenta", { flags: 0x0040, ...armed(367) }]];
    hullFlags.forEach(([id, c, set], i) => {
        out.push(...shareRled(id, `Kit Hull ${c}`, RLED[c], 24, { ...mobile, ai: 3, armor: 2000, shield: 2000, ...set }));
        out.push(dude(393 + i, `Kit Hull ${c}`, 3, 362, id));
    });
    out.push(traffic(system(1535, "Kit Hull Flags Range", 340, -860, 363, [1535]), hullFlags.map((_, i) => [393 + i, 20]), 8), port(1535, "Kit Hull Flags Port"));

    // --- C1: NPC cloaking, one Flags2 bit per colour.
    const cloak = { outfits: [266, -1, -1, -1], outfitCounts: [1, 0, 0, 0] };
    const cloakers = [[440, "green", 1, 363, 0x0800], [441, "blue", 1, 363, 0x0400], [442, "orange", 1, 363, 0x2000],
        [443, "yellow", 3, 363, 0x4000], [444, "red", 3, 362, 0x1800]];
    cloakers.forEach(([id, c, ai, g, f2], i) => {
        out.push(...shareRled(id, `Kit Cloak ${c}`, RLED[c], 24, { ...mobile, ai, armor: 2000, shield: 2000, flags2: f2, ...cloak, ...(ai === 3 ? armed(367) : {}) }));
        out.push(dude(398 + i, `Kit Cloak ${c}`, ai, g, id));
    });
    out.push(traffic(system(1540, "Kit Cloak Range", 380, -860, 363, [1540]), cloakers.map((_, i) => [398 + i, 20]), 6), port(1540, "Kit Cloak Port"));

    // --- H1: battle assistance.
    out.push(...shareRled(445, "Kit Assist Warship", RLED.blue, 24, { ...mobile, ai: 3, armor: 3000, shield: 3000, ...armed(365) }));
    out.push(...shareRled(446, "Kit Assist Trader", RLED.green, 24, { ...mobile, ai: 1, armor: 3000, shield: 3000 }));
    out.push(dude(403, "Kit Assist Warship", 3, 363, 445), dude(404, "Kit Assist Trader", 1, 363, 446));
    out.push(traffic(system(1545, "Kit Assist Range", 420, -860, 363, [1545]), [[602, 50], [403, 25], [404, 25]], 4), port(1545, "Kit Assist Port"));
    return out;
}

/** Wave 15's edits to earlier waves' resources (links and a sale list). */
function wave15Patches(r) {
    const addLink = (id) => {
        const l = r.set.links.filter((x) => x !== -1);
        return { ...r, set: { ...r.set, links: [...l, id, ...none16].slice(0, 16) } };
    };
    if (r.type === "sÿst" && r.id === 2095) return addLink(1510);
    if (r.type === "sÿst" && r.id === 2001) return addLink(1520);
    if (r.type === "jünk" && r.id === 203) return { ...r, set: { ...r.set, soldAt: [2069, 2053, ...none8].slice(0, 8) } };
    return r;
}

/**
 * Wave-14 experiments (docs/reference_experiments.md, "... wave 14").
 * Nothing retired; ids above wave 13's (shïp 882+, düde 369+, gövt
 * 323-338, mïsn 1078+, bits 9145+, jünk 203) and the last free sÿst / spöb
 * ids (2001, 2008, 2010, 2050-2059, 2062, 2063, 2065, 2095-2099, 2108,
 * 2109, 2129, 2135-2139, 2146, 2158, 2159).
 *
 *  A   A14 spread. Reward chain: gövt 338 Kit Spread Owner (Disab 2,
 *      Board 2, Kill 8000: a kill of an unrelated ship pays 1 + 4000 =
 *      4001; ally 337, enemy 336) owns sÿst 2095 Kit Spread Kill (traffic:
 *      düde 344, gövt 350's bare traders) and the chain 2096 - 2097 - 2098
 *      - 2099 - 2108 - 2109 (1-6 jumps). Also linked to 2095: 2135 owned by
 *      the ally 337 (40 / 2 / 60), 2136 by the enemy 336 (70 / 2 / 140),
 *      2137 by the victim's govt 350. 2138 (338) is reached from 2095 only
 *      through a HYPERGATE (spöb 2129 in 2095 <-> spöb 2138), 2139 (338)
 *      only through a WORMHOLE (spöb 2146 in 2095 <-> spöb 2139).
 *      Penalty: gövt 335 Kit Penalty Owner (2 / 2 / 8000, ally 334, enemy
 *      333) owns 2158 Kit Penalty Kill (traffic: its OWN bare traders, düde
 *      369) and 2159 (one jump); 2050 (334, 40 / 2 / 60) and 2051 (333,
 *      70 / 2 / 140) are linked to 2158. CompReward: mïsn 1079 (bit 9145)
 *      at Kit Port, no goal, CompGovt 338, CompReward 1000, ReturnStel Kit
 *      Port (OnSuccess b9146).
 *  S   Contraband. mïsn 1078 (bit 9147): a kit copy of stock mïsn 441
 *      "Rebel Food Drop" (Flags 0x0020 with ScanMask 0; 0x1060 kept, no
 *      ships) offered at Kit Scan Port: 10 t of food aboard at accept, to
 *      Kit Scan Gate Port (OnFailure b9148, OnSuccess b9149). Customs govts
 *      (all ScanMask 0x0001, AI 4 Kit Customs Cutters, shïp 855, two per
 *      system): 332 Kit Customs Tolerant (fine 500, Smug 50, CrimeTol
 *      30000: a scan never makes the pilot a criminal, so rescans can be
 *      counted) owns 2053; 331 Kit Customs Free (ScanFine 0, Smug 50) owns
 *      2055; 329 Kit Customs Percent (ScanFine -5, Smug 50) owns 2058;
 *      330 Kit Customs Nosy (0x0002, fine 500, Smug 50) owns 2056 Kit
 *      Customs Home, its cutters fly in 2057 Kit Scan Foreign (owned by the
 *      neutral 363, linked to 2056). jünk 203 Kit Contraband (ScanMask
 *      0x0001) is sold at Kit Scan Port (2069).
 *  P   Police. sÿst/spöb 2059 Kit Raid Range (owned by 342 Kit Police):
 *      police (düde 354), Kit Shipping (355, green), 327 Kit Shipping Quiet
 *      (Flags2 0x0008: no distress; shïp 883 blue, düde 375) and 328 Kit
 *      Raider P (enemy of 343 and 327; shïp 882 yellow, AI 3, Kit Raider
 *      Gun; düde 374). sÿst 2001 / spöb 2062 Kit Nosy Range (owned by 326
 *      Kit Police Nosy, gövt 0x0002: police düde 376) with Kit Shipping
 *      (355, green) and 325 Kit Shipping Ignored (gövt 0x0020; shïp 884
 *      cyan, düde 377). sÿst 2008 / spöb 2063 Kit Friend Range (owned by
 *      323 Kit Police Allied, police düde 378) with traders of its ally 324
 *      Kit Police Friend (shïp 883 blue, düde 379).
 *  M   Miners: sÿst 2010 / spöb 2065 Kit Mine Mixed (16 metal rocks, gövt
 *      363): the Kit Miner hull (Flags3 0x0003, scoop, four wëap 181) as
 *      AI 2 (shïp 885 green, düde 380) and AI 3 (shïp 886 yellow, düde 381),
 *      and a Flags3-0x0001-only AI 4 without a scoop (the Zephyr case; shïp
 *      887 red, düde 382), one third each, avgShips 4.
 *  R   mïsn 1080 (bit 9150): wave 13's 1071 (stock Raczak fields, cargo
 *      picked up by boarding, ShipStart -1) with the kit's düde 330.
 */
function wave14Resources() {
    const out = [];
    const shareRled = (id, name, rledId, size, set) => [
        { type: "shïp", id, name, clone: "shïp:128", set: { ...shipBase, shortName: name, longName: name, commName: name, subtitle: "", ...set } },
        { type: "shän", id, name, clone: "shän:128", set: { "@0:i16": rledId, "@2:i16": rledId + 1, "@4:i16": 1, "@6:i16": size, "@8:i16": size } },
    ];
    const mobile = { accel: 300, speed: 300, turn: 30, mass: 50, freeMass: 100, cargo: 10, strength: 50, crew: 10, flags: 0, flags2: 0 };
    const armed = (wid, n = 1) => ({ weapons: [wid, -1, -1, -1], weaponCounts: [n, 0, 0, 0], weaponAmmo: [0, 0, 0, 0] });
    const links = (...ids) => [...ids, ...none16].slice(0, 16);
    const traffic = (s, dudes, avgShips) => {
        s.set = { ...s.set, dudes: [...dudes.map((d) => d[0]), ...none8].slice(0, 8), dudeProbs: [...dudes.map((d) => d[1]), ...zero8].slice(0, 8), avgShips };
        return s;
    };
    const port = (id, name, set = {}) => spob(id, name, 0, 0, 138, { flags: 0x43, ...set });

    // --- A: the spread of a legal-record change.
    out.push(govt(338, "Kit Spread Owner", { disabPenalty: 2, boardPenalty: 2, killPenalty: 8000, classes: [338, -1, -1, -1], allies: [337, -1, -1, -1], enemies: [336, -1, -1, -1] }));
    out.push(govt(337, "Kit Spread Ally", { disabPenalty: 40, boardPenalty: 2, killPenalty: 60, classes: [337, -1, -1, -1], allies: [338, -1, -1, -1] }));
    out.push(govt(336, "Kit Spread Enemy", { disabPenalty: 70, boardPenalty: 2, killPenalty: 140, classes: [336, -1, -1, -1], enemies: [338, -1, -1, -1] }));
    const chain = [2096, 2097, 2098, 2099, 2108, 2109];
    const kill = traffic(system(2095, "Kit Spread Kill", 100, -900, 338, [2095, 2129, 2146]), [[344, 100]], 3);
    kill.set.links = links(chain[0], 2135, 2136, 2137);
    out.push(kill, port(2095, "Kit Spread Kill Port"));
    chain.forEach((id, i) => {
        const s = system(id, `Kit Spread ${i + 1}`, 140 + 40 * i, -900, 338, [id]);
        s.set.links = links(i === 0 ? 2095 : chain[i - 1], ...(i + 1 < chain.length ? [chain[i + 1]] : []));
        out.push(s, port(id, `Kit Spread ${i + 1} Port`));
    });
    for (const [id, name, owner, x, y] of [[2135, "Kit Spread Ally Home", 337, 100, -860], [2136, "Kit Spread Enemy Home", 336, 60, -900], [2137, "Kit Spread Victim Home", 350, 100, -940]]) {
        const s = system(id, name, x, y, owner, [id]);
        s.set.links = links(2095);
        out.push(s, port(id, `${name} Port`));
    }
    // The hypergate pair and the wormhole pair (stock HG-Aldebaran / Wormhole art and flags).
    out.push(system(2138, "Kit Spread Gate", 400, -900, 338, [2138]), system(2139, "Kit Spread Worm", 440, -900, 338, [2139]));
    out.push(spob(2129, "Kit Spread Gate A", 600, 0, 130, { flags: 0x30, flags2: 0x1000, hyperlinks: [2138, ...none8.slice(1)], techLevel: 0, specialTech: [-1, -1, -1] }));
    out.push(spob(2138, "Kit Spread Gate B", 0, 0, 130, { flags: 0x30, flags2: 0x1000, hyperlinks: [2129, ...none8.slice(1)], techLevel: 0, specialTech: [-1, -1, -1] }));
    out.push(spob(2146, "Kit Spread Worm A", -600, 0, 465, { flags: 0x21, flags2: 0x2200, hyperlinks: [2139, ...none8.slice(1)], techLevel: 0, specialTech: [-1, -1, -1] }));
    out.push(spob(2139, "Kit Spread Worm B", 0, 0, 465, { flags: 0x21, flags2: 0x2200, hyperlinks: [2146, ...none8.slice(1)], techLevel: 0, specialTech: [-1, -1, -1] }));
    // Penalty rig.
    out.push(govt(335, "Kit Penalty Owner", { disabPenalty: 2, boardPenalty: 2, killPenalty: 8000, classes: [335, -1, -1, -1], allies: [334, -1, -1, -1], enemies: [333, -1, -1, -1] }));
    out.push(govt(334, "Kit Penalty Ally", { disabPenalty: 40, boardPenalty: 2, killPenalty: 60, classes: [334, -1, -1, -1], allies: [335, -1, -1, -1] }));
    out.push(govt(333, "Kit Penalty Enemy", { disabPenalty: 70, boardPenalty: 2, killPenalty: 140, classes: [333, -1, -1, -1], enemies: [335, -1, -1, -1] }));
    out.push(dude(369, "Kit Penalty Bare Trader", 1, 335, 861));
    const pen = traffic(system(2158, "Kit Penalty Kill", 100, -980, 335, [2158]), [[369, 100]], 3);
    pen.set.links = links(2159, 2050, 2051);
    out.push(pen, port(2158, "Kit Penalty Kill Port"));
    for (const [id, name, owner, x, y] of [[2159, "Kit Penalty 1", 335, 140, -980], [2050, "Kit Penalty Ally Home", 334, 100, -1020], [2051, "Kit Penalty Enemy Home", 333, 60, -980]]) {
        const s = system(id, name, x, y, owner, [id]);
        s.set.links = links(2158);
        out.push(s, port(id, `${name} Port`));
    }
    // CompReward: a goal-less mission for gövt 338, accepted and completed at Kit Port.
    out.push(...misn(1079, "Kit A comp reward 338", 9145, { compGovt: 338, compReward: 1000, returnStel: 2100, onAccept: "!b9145", onSuccess: "b9146" }));

    // --- S: contraband.
    out.push(...misn(1078, "Kit S rebel food drop copy", 9147, { availStel: 2069, travelStel: 2068, returnStel: 2069, cargoType: 0, cargoQty: 10, pickupMode: 0, dropoffMode: 0,
        scanMask: 0, flags: 0x1060, compGovt: 354, compReward: 10, onAccept: "!b9147", onFailure: "b9148", onSuccess: "b9149" }));
    const customs = (gid, name, did, sid, sname, set) => {
        out.push(govt(gid, name, { scanMask: 0x0001, scanFine: 500, smugPenalty: 50, classes: [gid, -1, -1, -1], ...set }));
        out.push(dude(did, `${name} Cutter`, 4, gid, 855));
        if (sid) out.push(traffic(system(sid, sname, -280, -740 - 40 * (gid - 328), gid, [sid]), [[did, 100]], 2), port(sid, `${sname} Port`));
    };
    customs(332, "Kit Customs Tolerant", 370, 2053, "Kit Scan Tolerant", { crimeTol: 30000 });
    customs(331, "Kit Customs Free", 371, 2055, "Kit Scan Free", { scanFine: 0 });
    customs(329, "Kit Customs Percent", 373, 2058, "Kit Scan Percent", { scanFine: -5 });
    customs(330, "Kit Customs Nosy", 372, null, null, { flags: 0x0002 });
    const nosyHome = system(2056, "Kit Customs Home", -360, -780, 330, [2056]);
    nosyHome.set.links = links(2057);
    const foreign = traffic(system(2057, "Kit Scan Foreign", -400, -780, 363, [2057]), [[372, 100]], 2);
    foreign.set.links = links(2056);
    out.push(nosyHome, port(2056, "Kit Customs Home Port"), foreign, port(2057, "Kit Scan Foreign Port"));
    // Added during the wave: in 2057 the nosy scanner fined the pilot and no
    // record moved, but the owner 363's SmugPenalty is 0. sÿst 2029 / spöb
    // 2066 Kit Scan Smug Owner: owned by gövt 322 Kit Smug Owner (SmugPenalty
    // 70, no ScanMask), the nosy 330's cutters as traffic: whose
    // SmugPenalty, if any, lands on the 2029 record?
    out.push(govt(322, "Kit Smug Owner", { smugPenalty: 70, classes: [322, -1, -1, -1] }));
    out.push(traffic(system(2029, "Kit Scan Smug Owner", -440, -780, 322, [2066]), [[372, 100]], 2), port(2066, "Kit Scan Smug Owner Port"));
    // Added during the wave: in Kit Scan Range a pod pilot is scanned (and
    // made a criminal by the SmugPenalty) before it can land and accept
    // 1078, and a criminal is attacked, not rescanned. mïsn 1081 (bit 9152)
    // is 1078 offered at Kit Scan Tolerant Port (gövt 332, CrimeTol 30000:
    // the pilot stays legal, so it can be scanned again with the mission
    // aboard), to Kit Scan Free Port (OnFailure b9153, OnSuccess b9154).
    out.push(...misn(1081, "Kit S rebel food drop tolerant", 9152, { availStel: 2053, travelStel: 2055, returnStel: 2053, cargoType: 0, cargoQty: 10, pickupMode: 0, dropoffMode: 0,
        scanMask: 0, flags: 0x1060, compGovt: 332, compReward: 10, onAccept: "!b9152", onFailure: "b9153", onSuccess: "b9154" }));
    out.push({ type: "jünk", id: 203, name: "Kit Contraband", clone: "jünk:128", set: { soldAt: [2069, ...none8.slice(1)], boughtAt: none8, basePrice: 100, flags: 0, scanMask: 0x0001, lcName: "kit contraband", abbrev: "Contraband", buyOn: "", sellOn: "" } });

    // --- P: police, distress calls, nosy-ignore, a victim the police care about.
    out.push(govt(328, "Kit Raider P", { classes: [328, -1, -1, -1], enemies: [343, 327, -1, -1] }));
    out.push(govt(327, "Kit Shipping Quiet", { classes: [327, -1, -1, -1], flags2: 0x0008 }));
    out.push(govt(326, "Kit Police Nosy", { classes: [326, -1, -1, -1], flags: 0x0002 }));
    out.push(govt(325, "Kit Shipping Ignored", { classes: [325, -1, -1, -1], flags: 0x0020 }));
    out.push(govt(323, "Kit Police Allied", { classes: [323, -1, -1, -1], allies: [324, -1, -1, -1] }));
    out.push(govt(324, "Kit Police Friend", { classes: [324, -1, -1, -1], allies: [323, -1, -1, -1] }));
    out.push(...shareRled(882, "Kit Raider P", 1974, 24, { ...mobile, ai: 3, armor: 3000, shield: 3000, ...armed(367) }));
    out.push(...shareRled(883, "Kit Shipping Blue", 1973, 24, { ...mobile, ai: 1, armor: 3000, shield: 3000 }));
    out.push(...shareRled(884, "Kit Shipping Cyan", 1976, 24, { ...mobile, ai: 1, armor: 3000, shield: 3000 }));
    out.push(dude(374, "Kit Raider P", 3, 328, 882), dude(375, "Kit Shipping Quiet", 1, 327, 883), dude(376, "Kit Police Nosy", 4, 326, 868),
        dude(377, "Kit Shipping Ignored", 1, 325, 884), dude(378, "Kit Police Allied", 4, 323, 868), dude(379, "Kit Police Friend", 1, 324, 883));
    out.push(traffic(system(2059, "Kit Raid Range", -40, -740, 342, [2059]), [[354, 100], [355, 100], [375, 100], [374, 100]], 6), port(2059, "Kit Raid Port"));
    out.push(traffic(system(2001, "Kit Nosy Range", -40, -780, 326, [2062]), [[376, 100], [355, 100], [377, 100]], 5), port(2062, "Kit Nosy Port"));
    out.push(traffic(system(2008, "Kit Friend Range", -40, -820, 323, [2063]), [[378, 100], [379, 100]], 4), port(2063, "Kit Friend Port"));

    // --- M: AI 2 / AI 3 / AI 4 miners.
    const miner = { ...mobile, armor: 1000, shield: 1000, flags3: 0x0003, cargo: 100, weapons: [181, -1, -1, -1], weaponCounts: [4, 0, 0, 0], weaponAmmo: [0, 0, 0, 0], outfits: [271, -1, -1, -1], outfitCounts: [1, 0, 0, 0] };
    out.push(...shareRled(885, "Kit Miner Brave", 1972, 24, { ...miner, ai: 2 }));
    out.push(...shareRled(886, "Kit Miner Warship", 1974, 24, { ...miner, ai: 3 }));
    out.push(...shareRled(887, "Kit Rock Interceptor", 1971, 24, { ...miner, ai: 4, flags3: 0x0001, outfits: none4, outfitCounts: zero4 }));
    out.push(dude(380, "Kit Miner Brave", 2, 363, 885), dude(381, "Kit Miner Warship", 3, 363, 886), dude(382, "Kit Rock Interceptor", 4, 363, 887));
    const mixed = traffic(system(2010, "Kit Mine Mixed", 220, -860, 363, [2065]), [[380, 33], [381, 33], [382, 34]], 4);
    mixed.set = { ...mixed.set, asteroids: 16, asteroidTypes: 0x000F };
    out.push(mixed, port(2065, "Kit Mine Mixed Port"));

    // Added during the wave (leftovers). Rescans after a JUMP: sÿst 2031 /
    // spöb 2156 Kit Scan Tolerant Gate (gövt 363) linked to 2053 Kit Scan
    // Tolerant. The CompReward of an ABORT under mïsn Flags 0x0040: mïsn
    // 1082 (bit 9155) at Kit Port, CompGovt 338, CompReward 100, Flags
    // 0x0040 (OnAbort b9156): govt-wide like the success's spread?
    const tolerant = out.find((r) => r.type === "sÿst" && r.id === 2053);
    tolerant.set.links = links(2031);
    const tolGate = system(2031, "Kit Scan Tolerant Gate", -240, -720, 363, [2156]);
    tolGate.set.links = links(2053);
    out.push(tolGate, port(2156, "Kit Scan Tolerant Gate Port"));
    out.push(...misn(1082, "Kit A comp abort 338", 9155, { compGovt: 338, compReward: 100, flags: 0x0040, returnStel: 2100, onAccept: "!b9155", onAbort: "b9156", onSuccess: "b9157" }));

    // --- R: the Raczak rescue with the kit düde and the mission cargo.
    const raczak = { shipCount: 1, shipSyst: -1, shipDude: 330, shipGoal: 5, shipBehav: -1, shipNameID: 25002, compGovt: 144, compReward: 10,
        cargoType: 27, cargoQty: 1, pickupMode: 2, dropoffMode: 1, scanMask: 520, flags: 0x1214, flags2: 0x0001, returnStel: 2100, availShipType: 127 };
    out.push(...misn(1080, "Kit R kit dude with cargo", 9150, { ...raczak, shipStart: -1, onAccept: "!b9150", onSuccess: "b9151" }));
    return out;
}

/**
 * Wave-13 experiments (docs/reference_experiments.md, "... wave 13").
 * Nothing retired; ids above wave 12's (shïp 871+, wëap 285+, düde 357+,
 * gövt 339 and 344-349, sÿst/spöb 2081+, flët 303, mïsn 1064+, bits 9117+;
 * the blocks marked "added during the wave" are listed in the README row).
 *
 *  X   In-flight Abort from the `i` dialog. mïsn 1064 (bit 9117): the
 *      wave-11 Kit Ally Pointer (düde 330) as a ShipBehav 1 / ShipGoal 3
 *      escort at Kit Port; mïsn 1065 (9121): two Kit Abort Raiders (shïp
 *      871: the magenta pointer on a mobile AI 3 hull, 1000 / 1000, the
 *      1-damage Kit FF Pea; düde 357, gövt 363) with ShipBehav 0, ShipGoal 0
 *      (destroy). Both CompGovt 360 / 363, CompReward 10, OnAbort / OnFailure
 *      / OnSuccess bits 9118-9120 and 9122-9124.
 *  N   An NPC DISABLES a mission ship (no kill). In Kit FF Range: the
 *      spaceport offer mïsn 1066 (9125) puts shïp 872 Kit Disabler (red
 *      disc, anchored, gövt 362) on the far mark; it fires wëap 285 Kit
 *      Disabler (one 1200-damage turret bolt, reload 30000 frames: one
 *      shot) at the player, through the victim on the near mark. Victims
 *      (Mission BBS jobs, armor 1500, shield 0, so the hit leaves 300:
 *      disabled, alive): the wave-12 goal-1 duellist mïsn 1053 (9103), or
 *      mïsn 1067 (9126) shïp 873 Kit Ally Anchored (the magenta pointer,
 *      gövt 360 via düde 359, unarmed) as a ShipBehav 1 / ShipGoal 3 escort
 *      (OnFailure b9127, OnSuccess b9128).
 *  G   A guided missile locked on a same-govt ship: gövt 344 Kit Xeno
 *      (0x0001, xenophobic: "attack everyone except their allies"). In
 *      Kit FF Range: mïsn 1068 (9129) shïp 874 Kit Xeno Shooter (red disc,
 *      anchored, wëap 286 Kit Xeno Missile: guided, reach about 210 px) on
 *      the far mark; mïsn 1069 (9130, BBS job) shïp 875 Kit Xeno Victim
 *      (blue disc, anchored, shield 1000 no recharge, unarmed) on the near
 *      mark, 150 px away; düde 360 / 361.
 *  A   A14 third data point: gövt 345 Kit Odd Owner (Disab 11, Board 3,
 *      Kill 25: per-term halving gives 5 + 12 = 17, halving the sum 18)
 *      owns sÿst/spöb 2082 Kit Odd Traffic (traffic: düde 344, gövt 350's
 *      bare traders, unrelated to 345) and 2083 Kit Odd Home, linked to
 *      it, so the player can jump there and read `p` / the map.
 *  T   Traffic life cycle (npc_behavior_gaps.md T1): gövt 346 Kit Life
 *      Traders and 347 Kit Life Hostile (mutual enemies). sÿst 2085 Kit
 *      Life Range (owner 346): spöb 2085 Life Port (0,0), 2086 Life Market
 *      (1000,0), both 346; 2087 Life Marker (0,1000) uninhabited; 2088 Life
 *      Hostile Port (-1000,0) of 347. Traffic: düde 362, AI 1 shïp 876 Kit
 *      Life Trader (green disc), avgShips 6.
 *  S   Shuttles (N2): sÿst 2089 Kit Shuttle Range, the same layout
 *      (spöb 2089-2092), traffic düde 363: AI 1 shïp 877 Kit Life Shuttle
 *      (blue disc, Flags3 0x0002, no scoop), avgShips 6.
 *  M   Mining (N1): sÿst/spöb 2093 Kit Mine Range (16 metal asteroids),
 *      traffic düde 364: AI 1 shïp 878 Kit Miner (cyan disc, Flags3 0x0003,
 *      the stock Asteroid Scoop oütf 271 and four of the stock miner gun
 *      wëap 181, as the stock Asteroid Miner shïp 379), avgShips 3.
 */
function wave13Resources() {
    const out = [];
    const shareRled = (id, name, rledId, size, set) => [
        { type: "shïp", id, name, clone: "shïp:128", set: { ...shipBase, shortName: name, longName: name, commName: name, subtitle: "", ...set } },
        { type: "shän", id, name, clone: "shän:128", set: { "@0:i16": rledId, "@2:i16": rledId + 1, "@4:i16": 1, "@6:i16": size, "@8:i16": size } },
    ];
    const anchored = { accel: 0, speed: 0, turn: 60, mass: 50, freeMass: 100, cargo: 10, ai: 3, strength: 50, crew: 10, flags: 0, flags2: 0, shieldRecharge: 0, armorRecharge: 0 };
    const mobile = { accel: 300, speed: 300, turn: 30, mass: 50, freeMass: 100, cargo: 10, strength: 50, crew: 10, flags: 0, flags2: 0 };
    const armed = (wid, n = 1) => ({ weapons: [wid, -1, -1, -1], weaponCounts: [n, 0, 0, 0], weaponAmmo: [0, 0, 0, 0] });

    // --- X: aborting in flight.
    out.push(...misn(1064, "Kit X abort escort", 9117, { shipCount: 1, shipDude: 330, shipGoal: 3, shipBehav: 1, shipStart: -1,
        compGovt: 360, compReward: 10, onAccept: "!b9117", onAbort: "b9118", onSuccess: "b9119", onFailure: "b9120", returnStel: 2100 }));
    out.push(...shareRled(871, "Kit Abort Raider", 1959, 24, { ...mobile, ai: 3, armor: 1000, shield: 1000, shieldRecharge: 0, armorRecharge: 0, ...armed(267) }));
    out.push(dude(357, "Kit Abort Raider", 3, 363, 871));
    out.push(...misn(1065, "Kit X abort raiders", 9121, { shipCount: 2, shipDude: 357, shipGoal: 0, shipBehav: 0, shipStart: -1,
        compGovt: 363, compReward: 10, onAccept: "!b9121", onAbort: "b9122", onSuccess: "b9123", onFailure: "b9124", returnStel: 2100 }));

    // --- N: an NPC disables a mission ship with one shot.
    out.push(weap(285, "Kit Disabler", 131, { reload: 30000, duration: 90, armorDamage: 1200, shieldDamage: 1200, guidance: 4, speed: 600, proxRadius: 0, blastRadius: 0, flags: 0 }));
    out.push(...shareRled(872, "Kit Disabler", 1971, 24, { ...anchored, armor: 30000, shield: 30000, ...armed(285) }));
    out.push(dude(358, "Kit Disabler", 3, 362, 872));
    out.push(...misn(1066, "Kit N disabler", 9125, { availStel: 2047, shipCount: 1, shipDude: 358, shipGoal: -1, shipBehav: 0, shipStart: -3, onAccept: "!b9125" }));
    out.push(...shareRled(873, "Kit Ally Anchored", 1959, 24, { ...anchored, armor: 1500, shield: 0 }));
    out.push(dude(359, "Kit Ally Anchored", 3, 360, 873));
    out.push(...misn(1067, "Kit N escort ally", 9126, { availStel: 2047, availLoc: 0, shipCount: 1, shipDude: 359, shipGoal: 3, shipBehav: 1, shipStart: -2,
        returnStel: 2047, onAccept: "!b9126", onSuccess: "b9128", onFailure: "b9127", dispWeight: 30000 }));

    // Added during the wave: the ShipBehav-1 ally does not stay on the
    // near mark (it took a formation slot beside the player, off the line
    // of fire). So the disabler HUNTS it instead: gövt 348 Kit Ally Class
    // (class 348) for the ally, gövt 349 Kit Ally Hater (enemy of class 348,
    // neutral to the player) for the disabler. mïsn 1074 (bit 9139) the
    // disabler (düde 365, far mark) as the spaceport offer; mïsn 1075 (bit
    // 9140) the ally (düde 366, shïp 873) as the BBS job, ShipGoal 3,
    // ShipBehav 1, OnFailure b9141, OnSuccess b9142.
    out.push(govt(348, "Kit Ally Class", { classes: [348, -1, -1, -1] }));
    out.push(govt(349, "Kit Ally Hater", { classes: [349, -1, -1, -1], enemies: [348, -1, -1, -1] }));
    // Take 2 (the one-shot Kit Disabler spent its bolt on the player during
    // takeoff: its brackets were red, the ally's enemies are the player's):
    // shïp 879 Kit Hater, the same anchored red disc with wëap 287 Kit Hater
    // Gun (50 damage a second, 540 px reach), so the ally goes Disabled
    // after about 20 hits and dies after 30: is the failure at the disable?
    out.push(weap(287, "Kit Hater Gun", 131, { reload: 30, duration: 90, armorDamage: 50, shieldDamage: 50, guidance: 4, speed: 600, proxRadius: 0, blastRadius: 0, flags: 0 }));
    out.push(...shareRled(879, "Kit Hater", 1971, 24, { ...anchored, armor: 30000, shield: 30000, ...armed(287) }));
    out.push(dude(365, "Kit Ally Hater", 3, 349, 879));
    out.push(dude(366, "Kit Ally Classed", 3, 348, 873));
    out.push(...misn(1074, "Kit N ally hater", 9139, { availStel: 2047, shipCount: 1, shipDude: 365, shipGoal: -1, shipBehav: -1, shipStart: -3, onAccept: "!b9139" }));
    out.push(...misn(1075, "Kit N escort ally classed", 9140, { availStel: 2047, availLoc: 0, shipCount: 1, shipDude: 366, shipGoal: 3, shipBehav: 1, shipStart: -1,
        returnStel: 2047, onAccept: "!b9140", onSuccess: "b9142", onFailure: "b9141", dispWeight: 30000 }));

    // --- R: stock mïsn 394 "Rescue Raczak" moved to Kit Port (added during
    // the wave: in Heraan Astra the Moash fleet killed the UFS Excalibur
    // before the player found it). Every field as the stock resource but
    // AvailStel / AvailLoc 3 / AvailBits / ReturnStel / OnSuccess and no aux
    // ships: the stock Raczak düde 258 (the UFS Excalibur, ShipNameID
    // 25002), ShipGoal 5, ShipBehav -1, cargo 27 picked up on boarding the
    // special ship (PickupMode 2), Flags 0x1214, Flags2 0x0001, ShipSyst -1
    // (Kit Range). mïsn 1070 (bit 9131) keeps ShipStart 2 ("appear
    // randomly, cloaked"); mïsn 1071 (bit 9133) has ShipStart -1 (on
    // Kit Port, where the player takes off).
    const raczak = { shipCount: 1, shipSyst: -1, shipDude: 258, shipGoal: 5, shipBehav: -1, shipNameID: 25002, compGovt: 144, compReward: 10,
        cargoType: 27, cargoQty: 1, pickupMode: 2, dropoffMode: 1, scanMask: 520, flags: 0x1214, flags2: 0x0001, returnStel: 2100, availShipType: 127 };
    out.push(...misn(1070, "Kit R Raczak ShipStart 2", 9131, { ...raczak, shipStart: 2, onAccept: "!b9131", onSuccess: "b9132" }));
    out.push(...misn(1071, "Kit R Raczak at Kit Port", 9133, { ...raczak, shipStart: -1, onAccept: "!b9133", onSuccess: "b9134" }));
    // 1071 boarded ("You retrieved Admiral Raczak from this ship."), where
    // wave 11's kit rescues were refused. Which difference? mïsn 1072 (bit
    // 9135) = 1071 without the mission cargo (CargoType -1, PickupMode -1);
    // mïsn 1073 (bit 9137) = 1072 with the kit's düde 330 (Kit Ally Pointer,
    // gövt 360) instead of the stock Raczak düde.
    const noCargo = { cargoType: -1, cargoQty: 0, pickupMode: -1, dropoffMode: -1 };
    out.push(...misn(1072, "Kit R Raczak no cargo", 9135, { ...raczak, ...noCargo, shipStart: -1, onAccept: "!b9135", onSuccess: "b9136" }));
    out.push(...misn(1073, "Kit R kit dude no cargo", 9137, { ...raczak, ...noCargo, shipDude: 330, shipStart: -1, onAccept: "!b9137", onSuccess: "b9138" }));

    // --- G: a xenophobe's guided missile at its own govt.
    out.push(govt(344, "Kit Xeno", { flags: 0x0001, classes: [344, -1, -1, -1] }));
    out.push(weap(286, "Kit Xeno Missile", 134, { reload: 30, duration: 70, armorDamage: 10, shieldDamage: 10, guidance: 1, speed: 300, guidedTurn: 60, proxRadius: 0, blastRadius: 0, flags: 0, seekerFlags: 0, jamVuln: zero4 }));
    out.push(...shareRled(874, "Kit Xeno Shooter", 1971, 24, { ...anchored, armor: 30000, shield: 30000, ...armed(286) }));
    out.push(...shareRled(875, "Kit Xeno Victim", 1973, 24, { ...anchored, armor: 30000, shield: 1000 }));
    out.push(dude(360, "Kit Xeno Shooter", 3, 344, 874));
    out.push(dude(361, "Kit Xeno Victim", 3, 344, 875));
    out.push(...misn(1068, "Kit G xeno shooter", 9129, { availStel: 2047, shipCount: 1, shipDude: 360, shipGoal: -1, shipBehav: -1, shipStart: -3, onAccept: "!b9129" }));
    out.push(...misn(1069, "Kit G xeno victim", 9130, { availStel: 2047, availLoc: 0, shipCount: 1, shipDude: 361, shipGoal: -1, shipBehav: -1, shipStart: -2, onAccept: "!b9130", dispWeight: 30000 }));

    // Added during the wave: the xenophobe never fired at its own govt's
    // ship (80 s, its brackets red at the player, out of its reach). A
    // govt that lists its OWN class as an enemy: gövt 339 Kit Self Hater
    // (class 339, enemies 339), düde 367 / 368 (the same shooter / victim
    // hulls), mïsn 1076 (bit 9143, the spaceport offer, far mark) / 1077
    // (bit 9144, the BBS job, near mark).
    out.push(govt(339, "Kit Self Hater", { classes: [339, -1, -1, -1], enemies: [339, -1, -1, -1] }));
    out.push(dude(367, "Kit Self Hater Shooter", 3, 339, 874));
    out.push(dude(368, "Kit Self Hater Victim", 3, 339, 875));
    out.push(...misn(1076, "Kit G self hater shooter", 9143, { availStel: 2047, shipCount: 1, shipDude: 367, shipGoal: -1, shipBehav: -1, shipStart: -3, onAccept: "!b9143" }));
    out.push(...misn(1077, "Kit G self hater victim", 9144, { availStel: 2047, availLoc: 0, shipCount: 1, shipDude: 368, shipGoal: -1, shipBehav: -1, shipStart: -2, onAccept: "!b9144", dispWeight: 30000 }));

    // --- A: the A14 reward rule with odd owner penalties.
    out.push(govt(345, "Kit Odd Owner", { disabPenalty: 11, boardPenalty: 3, killPenalty: 25, classes: [345, -1, -1, -1] }));
    const odd = system(2082, "Kit Odd Traffic", 100, -780, 345, [2082]);
    odd.set = { ...odd.set, links: [2083, ...none16.slice(1)], dudes: [344, ...none8.slice(1)], dudeProbs: [100, ...zero8.slice(1)], avgShips: 3 };
    const oddHome = system(2083, "Kit Odd Home", 140, -780, 345, [2083]);
    oddHome.set = { ...oddHome.set, links: [2082, ...none16.slice(1)] };
    // Added during the wave: the kill gave 2082 +17 AND the linked 2083
    // (same owner) +11. Does the change spread to every LINKED system?
    // sÿst/spöb 2084 Kit Odd Neighbour (owned by the neutral gövt 363),
    // linked to 2082 as well; 2081 Kit Odd Far, owned by 345, linked only
    // to 2083 (two jumps from the kill).
    odd.set.links = [2083, 2084, ...none16.slice(2)];
    oddHome.set.links = [2082, 2081, ...none16.slice(2)];
    const oddNeighbour = system(2084, "Kit Odd Neighbour", 100, -740, 363, [2084]);
    oddNeighbour.set = { ...oddNeighbour.set, links: [2082, ...none16.slice(1)] };
    const oddFar = system(2081, "Kit Odd Far", 180, -780, 345, [2081]);
    oddFar.set = { ...oddFar.set, links: [2083, ...none16.slice(1)] };
    out.push(oddNeighbour, spob(2084, "Kit Odd Neighbour Port", 0, 0, 138, { flags: 0x43 }));
    out.push(oddFar, spob(2081, "Kit Odd Far Port", 0, 0, 138, { flags: 0x43 }));
    out.push(odd, spob(2082, "Kit Odd Traffic Port", 0, 0, 138, { flags: 0x43 }));
    out.push(oddHome, spob(2083, "Kit Odd Home Port", 0, 0, 138, { flags: 0x43 }));

    // --- T / S / M: traffic life cycle, shuttles, miners.
    out.push(govt(346, "Kit Life Traders", { classes: [346, -1, -1, -1], enemies: [347, -1, -1, -1] }));
    out.push(govt(347, "Kit Life Hostile", { classes: [347, -1, -1, -1], enemies: [346, -1, -1, -1] }));
    out.push(...shareRled(876, "Kit Life Trader", 1972, 24, { ...mobile, ai: 1, armor: 1000, shield: 1000, flags3: 0 }));
    out.push(...shareRled(877, "Kit Life Shuttle", 1973, 24, { ...mobile, ai: 1, armor: 1000, shield: 1000, flags3: 0x0002 }));
    out.push(...shareRled(878, "Kit Miner", 1976, 24, { ...mobile, ai: 1, armor: 1000, shield: 1000, flags3: 0x0003, cargo: 100,
        weapons: [181, -1, -1, -1], weaponCounts: [4, 0, 0, 0], weaponAmmo: [0, 0, 0, 0], outfits: [271, -1, -1, -1], outfitCounts: [1, 0, 0, 0] }));
    out.push(dude(362, "Kit Life Traders", 1, 346, 876));
    out.push(dude(363, "Kit Life Shuttles", 1, 346, 877));
    out.push(dude(364, "Kit Miners", 1, 363, 878));
    const lifeLayout = (sid, name, x, did) => {
        const s = system(sid, name, x, -820, 346, [sid, sid + 1, sid + 2, sid + 3]);
        s.set = { ...s.set, dudes: [did, ...none8.slice(1)], dudeProbs: [100, ...zero8.slice(1)], avgShips: 6 };
        const tag = name.replace("Kit ", "").replace(" Range", "");
        out.push(s,
            spob(sid, `${tag} Port`, 0, 0, 138, { flags: 0x43, govt: 346 }),
            spob(sid + 1, `${tag} Market`, 1000, 0, 138, { flags: 0x43, govt: 346 }),
            spob(sid + 2, `${tag} Marker`, 0, 1000, 132, { flags: 0x20, techLevel: 0, specialTech: [-1, -1, -1] }),
            spob(sid + 3, `${tag} Hostile Port`, -1000, 0, 138, { flags: 0x43, govt: 347 }));
    };
    lifeLayout(2085, "Kit Life Range", 100, 362);
    lifeLayout(2089, "Kit Shuttle Range", 140, 363);
    const mine = system(2093, "Kit Mine Range", 180, -820, 363, [2093]);
    mine.set = { ...mine.set, asteroids: 16, asteroidTypes: 0x000F, dudes: [364, ...none8.slice(1)], dudeProbs: [100, ...zero8.slice(1)], avgShips: 3 };
    out.push(mine, spob(2093, "Kit Mine Port", 0, 0, 138, { flags: 0x43 }));

    // --- P1 run 6: do fleet escorts defend their leader? flët 303 Kit
    // Convoy (gövt 343 Kit Shipping, neutral to the player): lead shïp 880
    // Kit Convoy Lead (green disc, AI 1, 3000 / 3000, unarmed), two shïp 881
    // Kit Convoy Guard (yellow disc, AI 3, 3000 / 3000, one Kit Escort Gun),
    // the only traffic of sÿst/spöb 2094 Kit Convoy Range (gövt 363).
    out.push(...shareRled(880, "Kit Convoy Lead", 1972, 24, { ...mobile, ai: 1, armor: 3000, shield: 3000 }));
    out.push(...shareRled(881, "Kit Convoy Guard", 1974, 24, { ...mobile, ai: 3, armor: 3000, shield: 3000, ...armed(365) }));
    out.push({ type: "flët", id: 303, name: "Kit Convoy", clone: "flët:128",
        set: { "@0:i16": 880, "@2:i16x4": [881, -1, -1, -1], "@10:i16x4": [2, 0, 0, 0], "@18:i16x4": [2, 0, 0, 0], "@26:i16": 343, "@28:i16": 2094, "@30:str256": "", "@286:i16": -1, "@288:u16": 0 } });
    const convoy = system(2094, "Kit Convoy Range", 220, -820, 363, [2094]);
    convoy.set = { ...convoy.set, dudes: [-303, ...none8.slice(1)], dudeProbs: [100, ...zero8.slice(1)], avgShips: 1 };
    out.push(convoy, spob(2094, "Kit Convoy Port", 0, 0, 138, { flags: 0x43 }));

    // --- P1 run 2: disable (not kill) a 3000 / 3000 Kit Shipping in two
    // hits, then board it in view of the police: wëap 288 Kit Disable Gun
    // (turret, 720 px, shield 3000 / armor 2100 a hit, one a second) + oütf 462.
    out.push(weap(288, "Kit Disable Gun", 130, { reload: 30, duration: 60, armorDamage: 2100, shieldDamage: 3000, guidance: 4, speed: 1200, proxRadius: 0, blastRadius: 0, flags: 0 }));
    out.push(gun(462, "Kit Disable Gun", 288));
    return out;
}

/**
 * Wave-12 experiments (docs/reference_experiments.md, "... wave 12").
 * Nothing retired; ids above wave 11's (shïp 856+, wëap 280+, oütf 459+,
 * düde 338+, gövt 355-357, sÿst/spöb 2071+, mïsn 1049+, bits 9097+, rlëD
 * 1965 / 1967: odd, so the mask id the shän names is no resource).
 *
 *  D   The "Fight to be Thurokiir" duel (stock mïsn 674: 5 Duellists of
 *      gövt 175, ShipGoal 1, ShipBehav 0). In Kit FF Range (sÿst 2047):
 *      gövt 355 Kit Duellist (stock 175's 0x0002, CrimeTol 0, no
 *      penalties). A shooter mission is the spaceport offer (ShipBehav 0,
 *      no goal, the far mark, ShipStart -3): mïsn 1049 (bit 9097) shïp 837
 *      Kit FF Shooter (10-damage bolt), 1050 (9098) shïp 858 Kit Duel
 *      Shooter Blast (wëap 281: 100 damage, 150 px blast), 1051 (9099) shïp
 *      857 Kit Duel Shooter Beam (wëap 280: a turreted beam, ONE frame of
 *      5000 damage; a beam stops on its own govt's ships, wave 10). The
 *      duellist is a Mission BBS job, mïsn 1052 (9100): shïp 856 Kit Duel
 *      Victim (the magenta pointer, anchored, shield 200, armor 1500, no
 *      recharge, a 1-damage pea) on the near mark, ShipGoal 1, ShipBehav
 *      0, ReturnStel Kit FF Port, OnSuccess b9101, OnFailure b9102,
 *      DispWeight 30000 (a stock BBS job listed above it got the Accept in
 *      the first blast run; the kit's BBS jobs now come first). düde
 *      338-341; mïsn 1053 (bit 9103) is the job with shïp 865 (shield 0,
 *      düde 350), which the beam kills in one frame. The player disables
 *      the duellist with wëap 282 Kit Duel Gun (turret,
 *      100 damage) + oütf 459.
 *  H   IFF of an NPC fighting another NPC: sÿst/spöb 2071 Kit Hunt Range
 *      (gövt 363) with traffic of gövt 356 Kit Hunter (yellow disc, shïp
 *      859) and 357 Kit Prey (cyan disc, shïp 860), each listing the
 *      other's class as an enemy, both AI 3, 5000 / 5000, Kit Raider Gun;
 *      düde 342 / 343, four ships on average. Neither is hostile to the
 *      player.
 *  A   A14 with SYSTEM traffic victims: shïp 861 Kit Bare Trader (AI 1,
 *      shield 0, armor 1000). sÿst/spöb 2072 Kit Owner Traffic (owned by
 *      351, traffic of 350's traders: düde 344), 2073 Kit Law Traffic
 *      (352, traffic of the enemy 353: düde 345), 2074 Kit Victim Traffic
 *      (350, its own traders: düde 344), 2075 Kit Negative Traffic (369,
 *      its own: düde 346). wëap 283 Kit One Shot (one 10000-damage bolt)
 *      + oütf 460.
 *  W   Whom does a trader fight when the player's escort shoots it?
 *      sÿst/spöb 2076 Kit Brave Range (gövt 363) with traffic of düde 347:
 *      AI 2 shïp 862 Kit Brave Trader (green disc, 3000 / 3000, two Kit
 *      Raider Guns), one on average.
 *  S   Submunition fuse vs an ELONGATED target, on Kit Sub Mark: shïp 863
 *      Kit Sub Bar Side (rlëD 1965: a 76 x 14 magenta bar across an 80 x 80
 *      frame, the same on all 36 frames, so it never turns end-on) and 864
 *      Kit Sub Bar End (rlëD 1967: the bar upright, 14 x 76), düde 348 /
 *      349, mïsn 1055 (bit 9106) / 1056 (9107).
 *  U   Scrolling dialogs: mïsn 1057 (bit 9108) offered at Kit Port with a
 *      60-line numbered offer text; mïsn 1058 (bit 9109) a Mission BBS job
 *      with the same text.
 */
function wave12Resources() {
    const out = [];
    const shareRled = (id, name, rledId, size, set) => [
        { type: "shïp", id, name, clone: "shïp:128", set: { ...shipBase, shortName: name, longName: name, commName: name, subtitle: "", ...set } },
        { type: "shän", id, name, clone: "shän:128", set: { "@0:i16": rledId, "@2:i16": rledId + 1, "@4:i16": 1, "@6:i16": size, "@8:i16": size } },
    ];
    const anchored = { accel: 0, speed: 0, turn: 60, mass: 50, freeMass: 100, cargo: 10, ai: 3, strength: 50, crew: 10, flags: 0, flags2: 0, shieldRecharge: 0, armorRecharge: 0 };
    const armed = (wid, n = 1) => ({ weapons: [wid, -1, -1, -1], weaponCounts: [n, 0, 0, 0], weaponAmmo: [0, 0, 0, 0] });

    // --- D: the duel.
    out.push(govt(355, "Kit Duellist", { flags: 0x0002, crimeTol: 0, disabPenalty: 0, boardPenalty: 0, killPenalty: 0, classes: [355, -1, -1, -1] }));
    out.push(weap(280, "Kit Duel Beam", 170, { reload: 90, duration: 1, armorDamage: 5000, shieldDamage: 5000, guidance: 3, beamLength: 400, flags: 0 }));
    out.push(weap(281, "Kit Duel Blast", 131, { reload: 60, duration: 90, armorDamage: 100, shieldDamage: 100, guidance: 4, speed: 600, proxRadius: 0, blastRadius: 150, flags: 0 }));
    out.push(weap(282, "Kit Duel Gun", 130, { reload: 20, duration: 60, armorDamage: 100, shieldDamage: 100, guidance: 4, speed: 900, proxRadius: 0, blastRadius: 0, flags: 0 }));
    out.push(gun(459, "Kit Duel Gun", 282));
    out.push(...shareRled(856, "Kit Duel Victim", 1959, 24, { ...anchored, ai: 4, armor: 1500, shield: 200, ...armed(267) }));
    out.push(...shareRled(857, "Kit Duel Shooter Beam", 1971, 24, { ...anchored, ai: 4, armor: 30000, shield: 30000, ...armed(280) }));
    out.push(...shareRled(858, "Kit Duel Shooter Blast", 1971, 24, { ...anchored, ai: 4, armor: 30000, shield: 30000, ...armed(281) }));
    out.push(dude(338, "Kit Duel Victim", 4, 355, 856));
    out.push(dude(339, "Kit Duel Shooter Bolt", 4, 355, 837));
    out.push(dude(340, "Kit Duel Shooter Blast", 4, 355, 858));
    out.push(dude(341, "Kit Duel Shooter Beam", 4, 355, 857));
    const duelShooter = { availStel: 2047, shipCount: 1, shipGoal: -1, shipBehav: 0, shipStart: -3 };
    out.push(...misn(1049, "Kit D shooter bolt", 9097, { ...duelShooter, shipDude: 339, onAccept: "!b9097" }));
    out.push(...misn(1050, "Kit D shooter blast", 9098, { ...duelShooter, shipDude: 340, onAccept: "!b9098" }));
    out.push(...misn(1051, "Kit D shooter beam", 9099, { ...duelShooter, shipDude: 341, onAccept: "!b9099" }));
    out.push(...misn(1052, "Kit D duellist", 9100, { availStel: 2047, availLoc: 0, shipCount: 1, shipDude: 338, shipGoal: 1, shipBehav: 0, shipStart: -2,
        returnStel: 2047, onAccept: "!b9100", onSuccess: "b9101", onFailure: "b9102", dispWeight: 30000 }));
    // The one-frame beam kills a HEALTHY duellist outright only if no
    // shield soaks the frame: shïp 865 Kit Duel Victim Bare (shield 0,
    // armor 1500), düde 350, mïsn 1053 (bit 9103), the same BBS job.
    out.push(...shareRled(865, "Kit Duel Victim Bare", 1959, 24, { ...anchored, ai: 4, armor: 1500, shield: 0, ...armed(267) }));
    out.push(dude(350, "Kit Duel Victim Bare", 4, 355, 865));
    out.push(...misn(1053, "Kit D duellist bare", 9103, { availStel: 2047, availLoc: 0, shipCount: 1, shipDude: 350, shipGoal: 1, shipBehav: 0, shipStart: -2,
        returnStel: 2047, onAccept: "!b9103", onSuccess: "b9101", onFailure: "b9102", dispWeight: 30000 }));

    // --- H: hunters and prey, both neutral to the player.
    out.push(govt(356, "Kit Hunter", { classes: [356, -1, -1, -1], enemies: [357, -1, -1, -1] }));
    out.push(govt(357, "Kit Prey", { classes: [357, -1, -1, -1], enemies: [356, -1, -1, -1] }));
    const fighter = { accel: 300, speed: 300, turn: 30, armor: 5000, shield: 5000, mass: 50, freeMass: 100, cargo: 10, ai: 3, strength: 50, crew: 10, flags: 0, flags2: 0, ...armed(367) };
    out.push(...shareRled(859, "Kit Hunter", 1974, 24, fighter));
    out.push(...shareRled(860, "Kit Prey", 1976, 24, fighter));
    out.push(dude(342, "Kit Hunters", 3, 356, 859));
    out.push(dude(343, "Kit Prey", 3, 357, 860));
    const hunt = system(2071, "Kit Hunt Range", -240, -740, 363, [2071]);
    hunt.set = { ...hunt.set, dudes: [342, 343, ...none8.slice(2)], dudeProbs: [50, 50, ...zero8.slice(2)], avgShips: 4 };
    out.push(hunt, spob(2071, "Kit Hunt Port", 0, 0, 138, { flags: 0x43 }));
    // Added during the wave: in Kit Hunt Range the traffic fought 600-1400
    // px away, off screen (no brackets to read). sÿst/spöb 2077 Kit Hunt
    // Arena (gövt 363, no traffic) gets one hunter as the spaceport offer
    // (mïsn 1054, bit 9104) and one prey as a Mission BBS job (mïsn 1059,
    // bit 9105), both on the port (ShipStart -1, no goal, own AI).
    out.push(system(2077, "Kit Hunt Arena", -240, -700, 363, [2077]), spob(2077, "Kit Hunt Arena Port", 0, 0, 138, { flags: 0x43 }));
    out.push(...misn(1054, "Kit H hunter", 9104, { availStel: 2077, shipCount: 1, shipDude: 342, shipGoal: -1, shipBehav: -1, shipStart: -1, onAccept: "!b9104" }));
    out.push(...misn(1059, "Kit H prey", 9105, { availStel: 2077, availLoc: 0, shipCount: 1, shipDude: 343, shipGoal: -1, shipBehav: -1, shipStart: -1, onAccept: "!b9105", dispWeight: 30000 }));
    // Added during the wave: in the arena the pair fought on screen for
    // a few seconds, then flew off. ANCHORED copies in Kit FF Range (sÿst
    // 2047): shïp 866 Kit Hunter Anchored (yellow, 30000 / 30000) on the far
    // mark, the spaceport offer mïsn 1060 (bit 9110); shïp 867 Kit Prey
    // Anchored (cyan) on the near mark, the BBS job mïsn 1061 (bit 9111);
    // düde 352 / 353. They trade turret fire 150 px apart, above the player.
    const anchoredFighter = { accel: 0, speed: 0, turn: 60, mass: 50, freeMass: 100, cargo: 10, ai: 3, strength: 50, crew: 10, flags: 0, flags2: 0, shieldRecharge: 0, armorRecharge: 0, armor: 30000, shield: 30000, ...armed(367) };
    out.push(...shareRled(866, "Kit Hunter Anchored", 1974, 24, anchoredFighter));
    out.push(...shareRled(867, "Kit Prey Anchored", 1976, 24, anchoredFighter));
    out.push(dude(352, "Kit Hunter Anchored", 3, 356, 866));
    out.push(dude(353, "Kit Prey Anchored", 3, 357, 867));
    out.push(...misn(1060, "Kit H hunter anchored", 9110, { availStel: 2047, shipCount: 1, shipDude: 352, shipGoal: -1, shipBehav: -1, shipStart: -3, onAccept: "!b9110" }));
    out.push(...misn(1061, "Kit H prey anchored", 9111, { availStel: 2047, availLoc: 0, shipCount: 1, shipDude: 353, shipGoal: -1, shipBehav: -1, shipStart: -2, onAccept: "!b9111", dispWeight: 30000 }));

    // --- S2 (docs/npc_behavior_gaps.md): illegal MISSION cargo. Offered on
    // landing at Kit Scan Port (wave 11's S1 rig: gövt 354 Kit Customs,
    // ScanMask 0x0001, ScanFine 500, SmugPenalty 50): 1 t of food with
    // ScanMask 0x0001 to Kit Scan Gate Port, CompGovt 354 / CompReward 10.
    // mïsn 1062 (bit 9112) with Flags 0x0020 ("fails if you're scanned",
    // OnFailure b9114), 1063 (bit 9113) without (OnFailure b9115).
    const s2 = { availStel: 2069, travelStel: 2068, cargoType: 0, cargoQty: 1, pickupMode: 0, dropoffMode: 0, scanMask: 0x0001, compGovt: 354, compReward: 10 };
    out.push(...misn(1062, "Kit S2 cargo 0x20", 9112, { ...s2, flags: 0x0020, onAccept: "!b9112", onFailure: "b9114", onSuccess: "b9116" }));
    out.push(...misn(1063, "Kit S2 cargo plain", 9113, { ...s2, onAccept: "!b9113", onFailure: "b9115", onSuccess: "b9116" }));

    // --- P1 run 1 (docs/npc_behavior_gaps.md): does a police interceptor
    // react when the player attacks a third party? sÿst/spöb 2079 Kit
    // Police Range (owned by gövt 342 Kit Police: AI 4 red discs, shïp 868,
    // 3000 / 3000, one Kit Escort Gun; düde 354) with traffic of gövt 343
    // Kit Shipping (AI 1 green discs, shïp 869, 3000 / 3000, unarmed; düde
    // 355); no relations between the two. Two of each on average.
    out.push(govt(342, "Kit Police", { classes: [342, -1, -1, -1] }));
    out.push(govt(343, "Kit Shipping", { classes: [343, -1, -1, -1] }));
    out.push(...shareRled(868, "Kit Police", 1971, 24, { ...fighter, ai: 4, armor: 3000, shield: 3000, ...armed(365) }));
    out.push(...shareRled(869, "Kit Shipping", 1972, 24, { ...fighter, ai: 1, armor: 3000, shield: 3000, weapons: none4, weaponCounts: zero4, weaponAmmo: zero4 }));
    out.push(dude(354, "Kit Police", 4, 342, 868));
    out.push(dude(355, "Kit Shipping", 1, 343, 869));
    const police = system(2079, "Kit Police Range", -40, -700, 342, [2079]);
    police.set = { ...police.set, dudes: [354, 355, ...none8.slice(2)], dudeProbs: [100, 100, ...zero8.slice(2)], avgShips: 4 };
    out.push(police, spob(2079, "Kit Police Port", 0, 0, 138, { flags: 0x43 }));

    // --- A14 (c), take 3: the AI 1 traders fled before the player could
    // disable them on purpose. shïp 870 Kit Anchored Trader (Kit Bare
    // Trader with Speed / Accel / Turn 0), düde 356 (AI 1, gövt 350), the
    // only traffic (one) of sÿst/spöb 2080 Kit Victim Anchored (owner 350).
    out.push(...ship(870, "Kit Anchored Trader", 138, { armor: 1000, shield: 0, shieldRecharge: 0, speed: 0, accel: 0, turn: 0, ai: 1, strength: 20, crew: 10 }));
    out.push(dude(356, "Kit Anchored Trader", 1, 350, 870));
    const anchoredRange = system(2080, "Kit Victim Anchored", -80, -700, 350, [2080]);
    anchoredRange.set = { ...anchoredRange.set, dudes: [356, ...none8.slice(1)], dudeProbs: [100, ...zero8.slice(1)], avgShips: 1 };
    out.push(anchoredRange, spob(2080, "Kit Victim Anchored Port", 0, 0, 138, { flags: 0x43 }));

    // --- A: A14 with system traffic as the victims.
    out.push(...ship(861, "Kit Bare Trader", 138, { armor: 1000, shield: 0, shieldRecharge: 0, ai: 1, strength: 20, crew: 10 }));
    out.push(dude(344, "Kit Victim Bare Trader", 1, 350, 861));
    out.push(dude(345, "Kit Pirate Bare Trader", 1, 353, 861));
    out.push(dude(346, "Kit Negative Bare Trader", 1, 369, 861));
    [[2072, "Kit Owner Traffic", -200, 351, 344], [2073, "Kit Law Traffic", -160, 352, 345],
        [2074, "Kit Victim Traffic", -120, 350, 344], [2075, "Kit Negative Traffic", -80, 369, 346]].forEach(([id, name, x, g, d]) => {
        const s = system(id, name, x, -740, g, [id]);
        s.set = { ...s.set, dudes: [d, ...none8.slice(1)], dudeProbs: [100, ...zero8.slice(1)], avgShips: 3 };
        out.push(s, spob(id, `${name} Port`, 0, 0, 138, { flags: 0x43 }));
    });
    out.push(weap(283, "Kit One Shot", 130, { reload: 60, duration: 60, armorDamage: 10000, shieldDamage: 10000, guidance: 4, speed: 1200, proxRadius: 0, blastRadius: 0, flags: 0 }));
    out.push(gun(460, "Kit One Shot", 283));
    // Added during the wave: with the 100-damage Kit Duel Gun the AI 1
    // trader fled out of reach at 70% armor. wëap 284 Kit Gun 300 (turret,
    // 300 damage: disabled on the third hit, dead on the fourth) + oütf 461.
    out.push(weap(284, "Kit Gun 300", 130, { reload: 20, duration: 60, armorDamage: 300, shieldDamage: 300, guidance: 4, speed: 1200, proxRadius: 0, blastRadius: 0, flags: 0 }));
    out.push(gun(461, "Kit Gun 300", 284));
    // Added during the wave: killing a NON-owner ship RAISED the local
    // record by half the owner's Disab + Kill. Control: the victim is the
    // owner's ALLY. gövt 340 Kit Ally Owner (Disab 30, Board 5, Kill 100,
    // class 340, allies class 341), 341 Kit Ally Victim (Disab 20, Board
    // 5, Kill 40, class 341); sÿst/spöb 2078 Kit Ally Traffic (owned by
    // 340) with traffic of 341's bare traders (düde 351).
    out.push(govt(340, "Kit Ally Owner", { disabPenalty: 30, boardPenalty: 5, killPenalty: 100, classes: [340, -1, -1, -1], allies: [341, -1, -1, -1] }));
    out.push(govt(341, "Kit Ally Victim", { disabPenalty: 20, boardPenalty: 5, killPenalty: 40, classes: [341, -1, -1, -1] }));
    out.push(dude(351, "Kit Ally Bare Trader", 1, 341, 861));
    const allyTraffic = system(2078, "Kit Ally Traffic", -40, -740, 340, [2078]);
    allyTraffic.set = { ...allyTraffic.set, dudes: [351, ...none8.slice(1)], dudeProbs: [100, ...zero8.slice(1)], avgShips: 3 };
    out.push(allyTraffic, spob(2078, "Kit Ally Traffic Port", 0, 0, 138, { flags: 0x43 }));

    // --- W: a brave trader shot by the player's escort.
    out.push(...shareRled(862, "Kit Brave Trader", 1972, 24, { ...fighter, ai: 2, armor: 3000, shield: 3000, ...armed(367, 2) }));
    out.push(dude(347, "Kit Brave Trader", 2, 363, 862));
    const brave = system(2076, "Kit Brave Range", -200, -700, 363, [2076]);
    brave.set = { ...brave.set, dudes: [347, ...none8.slice(1)], dudeProbs: [100, ...zero8.slice(1)], avgShips: 1 };
    out.push(brave, spob(2076, "Kit Brave Port", 0, 0, 138, { flags: 0x43 }));

    // --- S: elongated submunition targets (80 x 80 frames, a 76 x 14 bar).
    const magenta = rgb15(...DISC_COLOURS.magenta);
    const bar = (w, h) => {
        const pixels = [];
        for (let y = 0; y < 80; y++) {
            for (let x = 0; x < 80; x++) {
                pixels.push(Math.abs(x - 39.5) < w / 2 && Math.abs(y - 39.5) < h / 2 ? magenta : TRANSPARENT);
            }
        }
        return { width: 80, height: 80, pixels };
    };
    [[863, "Kit Sub Bar Side", 1965, bar(76, 14), 348, 1055, 9106], [864, "Kit Sub Bar End", 1967, bar(14, 76), 349, 1056, 9107]].forEach(([id, name, rled, frame, did, mid, bit]) => {
        out.push(...shareRled(id, name, rled, 80, { ...anchored, ai: 1, turn: 0, armor: 30000, shield: 0, strength: 1, crew: 1 }));
        out.push({ type: "rlëD", id: rled, name, hex: Buffer.from(encodeRled(Array.from({ length: 36 }, () => frame), { original: true })).toString("hex") });
        out.push(dude(did, name, 1, 363, id));
        out.push(...misn(mid, `Kit S ${name}`, bit, { availStel: 2045, shipCount: 1, shipDude: did, shipGoal: -1, shipBehav: -1, shipStart: -2, onAccept: `!b${bit}` }));
    });

    // --- U: a 60-line offer text (numbered lines, so a shot reads the scroll position).
    const longText = Array.from({ length: 60 }, (_, i) => `Line ${String(i + 1).padStart(2, "0")} of the novaref scrolling test.`).join("\r");
    for (const [id, bit, set] of [[1057, 9108, {}], [1058, 9109, { availLoc: 0, dispWeight: 30000 }]]) {
        const [m] = misn(id, `Kit U long text ${id}`, bit, { ...set, onAccept: `!b${bit}` });
        out.push(m, { type: "dësc", id: 4000 + id - 128, text: longText });
    }
    return out;
}

/**
 * Wave 11 (Matthew): every kit shän is a clone of a stock one, and most
 * carry the stock RUNNING LIGHTS (the Shuttle's shän 128, behind every
 * disc / pointer / ring hull, has LightImage 1600 blinking in mode 1).
 * Blinking light pixels can pass for shots, sparkles, bracket pixels or
 * radar blips and shift lit-pixel counts and blob centroids, so the kit
 * switches them off on EVERY kit shän: LightImage / LightMask -1 (offsets
 * 30 / 32) and BlinkMode 0 (offset 54). The engine glow (GlowImage, shown
 * while thrusting) is kept. Before wave 11 the lights were on.
 */
export function withoutRunningLights(r) {
    if (r.type !== "shän") return r;
    return { ...r, set: { ...(r.set ?? {}), "@30:i16": -1, "@32:i16": -1, "@54:i16": 0 } };
}

/**
 * Wave-11 experiments (docs/reference_experiments.md, "... wave 11").
 * Nothing retired; ids above wave 10's (shïp 849+, wëap 277+, oütf 456+,
 * düde 330+, gövt 350-353, sÿst/spöb 2061+, mïsn 1038+, bits 9081+, rlëD
 * 1963, free between the stock 1952 and the kit's 1970).
 *
 *  R   Reviving a disabled ally (wave 10 item 5). shïp 849 Kit Ally
 *      Pointer: the 24 px pointer hulk's sprite (rlëD 1959) on a working
 *      AI 3 hull (shield 1000, armor 3000, NO recharge, one Kit Escort
 *      Gun, fuel 300), so what a revive restores reads off the target
 *      panel. wëap 277 Kit Blast 600 (the Kit Blast Bomb at 600 damage) +
 *      oütf 456 disables it in a few taps. düde 330 (AI 3, gövt 360) /
 *      331 (AI 1, gövt 363). mïsn 1038 (bit 9081) ShipBehav 1 / ShipGoal 3
 *      at Kit Port (the mission ally); 1039 (9082) the same ship of the
 *      neutral govt, no goal (a plain NPC); 1040 (9083) ShipGoal 5 rescue
 *      + ShipBehav 1 + Flags 0x0001 (auto-abort) with CompGovt 360 /
 *      CompReward 20, OnAccept b9084, OnAbort b9085, OnSuccess b9086
 *      (#320 item 3's deferred case); 1041 (9087) the same rescue without
 *      0x0001, ReturnStel Kit Port. Hired escort: a pilot `escorts` entry.
 *  M   0x0400 trade-in and loaded mass (wave 10 item 11): oütf 457 Kit
 *      Mass Keep (0x0404: mass-scaled AND persistent, Mass 10); shïp 850 /
 *      851 Kit Mass Roomy 100 / 300 (Mass 100 / 300, 200 t free, cargo 50).
 *  S   Submunitions: wëap 278 Sub Beam Short (a turreted beam 100 px long,
 *      the target 150 px away: it ends untouched), 279 Sub Beam Fixed
 *      (guidance 0, 300 px, fired where the nose points); shïp 852 Kit Sub
 *      Target 48 (a 48 px magenta disc, rlëD 1963), düde 332, mïsn 1042
 *      (bit 9088) on Kit Sub Mark.
 *  A   A14 follow-ups. gövt 350 Kit Victim Govt (Disab 30, Board 5, Kill
 *      100), 351 Kit Owner Govt (Disab 7, Board 3, Kill 13). sÿst/spöb 2061
 *      Kit Owner Range (owned by 351), sÿst 2062 Kit Victim Home (350),
 *      2063 Kit Owner Home 2 (351). düde 333 Kit Victim Trader (AI 1, 350,
 *      shïp 708), mïsn 1043 (bit 9089) beside the player at 2061's port.
 *      gövt 352 Kit Law Govt (Disab 30, Kill 100; enemy of 353's class),
 *      353 Kit Pirate Govt (Disab 20, Kill 40; enemy of 352's class).
 *      sÿst/spöb 2064 Kit Law Range (352), sÿst 2065 Kit Pirate Home (353),
 *      2066 Kit Law Home 2 (352). düde 334 Kit Pirate Trader (AI 1, 353),
 *      mïsn 1044 (bit 9090) beside the player at 2064's port.
 *  E   AppearOn: shïp 853 / 854 Kit Appear A / B (Kit Trader clones whose
 *      AppearOn tests the unset bits 9095 / 9096), düde 335 (AI 1, gövt
 *      363, 50 / 50), mïsn 1045 (bit 9091) at Kit Port, ShipStart -1.
 */
function wave11Resources() {
    const out = [];
    const shareRled = (id, name, rledId, size, set) => [
        { type: "shïp", id, name, clone: "shïp:128", set: { ...shipBase, shortName: name, longName: name, commName: name, subtitle: "", ...set } },
        { type: "shän", id, name, clone: "shän:128", set: { "@0:i16": rledId, "@2:i16": rledId + 1, "@4:i16": 1, "@6:i16": size, "@8:i16": size } },
    ];

    // --- R: reviving a disabled ally.
    out.push(...shareRled(849, "Kit Ally Pointer", 1959, 24, {
        accel: 600, speed: 300, turn: 60, armor: 3000, shield: 1000, shieldRecharge: 0, armorRecharge: 0,
        mass: 50, freeMass: 100, cargo: 10, ai: 3, strength: 50, crew: 10, flags: 0, flags2: 0, fuel: 300, cost: 50000,
        weapons: [365, -1, -1, -1], weaponCounts: [1, 0, 0, 0], weaponAmmo: [0, 0, 0, 0],
    }));
    out.push(weap(277, "Kit Blast 600", 134, { reload: 45, duration: 2, armorDamage: 600, shieldDamage: 600, guidance: -1, speed: 300, proxRadius: 0, blastRadius: 300, flags: 0x8000, guidedTurn: 0 }));
    out.push(gun(456, "Kit Blast 600", 277));
    out.push(dude(330, "Kit Ally", 3, 360, 849));
    out.push(dude(331, "Kit Ally Neutral", 1, 363, 849));
    out.push(...misn(1038, "Kit R mission ally", 9081, { shipCount: 1, shipDude: 330, shipGoal: 3, shipBehav: 1, shipStart: -1, onAccept: "!b9081" }));
    out.push(...misn(1039, "Kit R plain NPC", 9082, { shipCount: 1, shipDude: 331, shipGoal: -1, shipBehav: -1, shipStart: -1, onAccept: "!b9082" }));
    const rescue = { shipCount: 1, shipDude: 330, shipGoal: 5, shipBehav: 1, shipStart: -1, compGovt: 360, compReward: 20 };
    out.push(...misn(1040, "Kit R rescue auto-abort", 9083, { ...rescue, flags: 0x0001, onAccept: "b9084 !b9083", onAbort: "b9085", onSuccess: "b9086" }));
    out.push(...misn(1041, "Kit R rescue", 9087, { ...rescue, returnStel: 2100, onAccept: "b9084 !b9087", onAbort: "b9085", onSuccess: "b9086" }));
    // Added during the wave: a ShipBehav-1 ship answered every board with
    // "You can't board this ship." while its mission ran, so mïsn 1046
    // (bit 9092) is the rescue with ShipBehav -1 (the ship's own AI 3).
    out.push(...misn(1046, "Kit R rescue free", 9092, { ...rescue, shipBehav: -1, returnStel: 2100, onAccept: "b9084 !b9092", onAbort: "b9085", onSuccess: "b9086" }));

    // --- M: a mass-scaled persistent outfit and two roomy hulls.
    const keep = gun(457, "Kit Mass Keep", 0);
    keep.set = { ...keep.set, displayWeight: 9989, modType: 12, modVal: 1, max: 20, flags: 0x0404, cost: 1000, mass: 10 };
    out.push(keep);
    [[850, 100], [851, 300]].forEach(([id, mass]) =>
        out.push(...ship(id, `Kit Mass Roomy ${mass}`, 128, { displayWeight: 9700 + mass, mass, freeMass: 200, cargo: 50, armor: 300, shield: 300, maxGuns: 4, maxTurrets: 4, ai: 1, strength: 10, cost: 100000 })));

    // --- S: submunitions from a beam that ends untouched; a third target size.
    const beamParent = { reload: 60, duration: 8, armorDamage: 1, shieldDamage: 1, speed: 0, graphic: -1,
        proxRadius: 0, blastRadius: 0, flags: 0x0002, flags2: 0, subCount: 4, subType: 251, subTheta: -90, subLimit: 0 };
    out.push(weap(278, "Sub Beam Short", 170, { ...beamParent, guidance: 3, beamLength: 100 }));
    out.push(weap(279, "Sub Beam Fixed", 170, { ...beamParent, guidance: 0, beamLength: 300 }));
    const g48 = discShipGraphics(1963, DISC_COLOURS.magenta, 48, 36, 46);
    out.push({ type: "shïp", id: 852, name: "Kit Sub Target 48", clone: "shïp:128", set: { ...shipBase, shortName: "Kit Sub Target 48", longName: "Kit Sub Target 48", commName: "Kit Sub Target 48", subtitle: "",
        accel: 0, speed: 0, turn: 0, mass: 50, freeMass: 100, cargo: 10, ai: 1, strength: 1, crew: 1, flags: 0, flags2: 0, shieldRecharge: 0, armorRecharge: 0, armor: 30000, shield: 0 } });
    out.push({ type: "shän", id: 852, name: "Kit Sub Target 48", clone: "shän:128", set: { "@0:i16": 1963, "@2:i16": 1964, "@4:i16": 1, "@6:i16": 48, "@8:i16": 48 } });
    out.push({ type: "rlëD", id: 1963, name: "Kit Sub Target 48", hex: Buffer.from(g48.rled).toString("hex") });
    out.push(dude(332, "Kit Sub Target 48", 1, 363, 852));
    out.push(...misn(1042, "Kit S sub target 48", 9088, { availStel: 2045, shipCount: 1, shipDude: 332, shipGoal: -1, shipBehav: -1, shipStart: -2 }));

    // --- A: whose record a crime changes (A14 follow-ups).
    out.push(govt(350, "Kit Victim Govt", { disabPenalty: 30, boardPenalty: 5, killPenalty: 100 }));
    out.push(govt(351, "Kit Owner Govt", { disabPenalty: 7, boardPenalty: 3, killPenalty: 13 }));
    out.push(system(2061, "Kit Owner Range", -440, -700, 351, [2061]));
    out.push(spob(2061, "Kit Owner Port", 0, 0, 138, { flags: 0x43 }));
    // Added during the wave (the 3c control): Kit Victim Home gets a port
    // (spöb 2067) and mïsn 1047 (bit 9093) puts the same trader there.
    out.push(system(2062, "Kit Victim Home", -440, -740, 350, [2067]));
    out.push(spob(2067, "Kit Victim Port", 0, 0, 138, { flags: 0x43 }));
    out.push(...misn(1047, "Kit A victim trader at home", 9093, { availStel: 2067, shipCount: 1, shipDude: 333, shipGoal: -1, shipBehav: -1, shipStart: -1, onAccept: "!b9093" }));
    out.push(system(2063, "Kit Owner Home 2", -400, -740, 351, []));
    out.push(dude(333, "Kit Victim Trader", 1, 350, 708));
    // Added during the wave: neither the mission trader in 2061 nor in its
    // own 2062 changed any record, unlike wave 5's AI 3 system warship.
    // sÿst 2070 Kit Victim Home 3 (gövt 350, spöb 2070 port) has system
    // traffic, düde 337 (AI 3 Kit Raiders of gövt 350, two on average),
    // AND mïsn 1048 (bit 9094) puts the mission trader there too.
    out.push(dude(337, "Kit Victim Warship", 3, 350, 707));
    const home3 = system(2070, "Kit Victim Home 3", -480, -740, 350, [2070]);
    home3.set = { ...home3.set, dudes: [337, ...none8.slice(1)], dudeProbs: [100, ...zero8.slice(1)], avgShips: 2 };
    out.push(home3, spob(2070, "Kit Victim Port 3", 0, 0, 138, { flags: 0x43 }));
    out.push(...misn(1048, "Kit A victim trader home 3", 9094, { availStel: 2070, shipCount: 1, shipDude: 333, shipGoal: -1, shipBehav: -1, shipStart: -1, onAccept: "!b9094" }));
    out.push(...misn(1043, "Kit A victim trader", 9089, { availStel: 2061, shipCount: 1, shipDude: 333, shipGoal: -1, shipBehav: -1, shipStart: -1, onAccept: "!b9089" }));
    out.push(govt(352, "Kit Law Govt", { disabPenalty: 30, boardPenalty: 5, killPenalty: 100, classes: [352, -1, -1, -1], enemies: [353, -1, -1, -1] }));
    out.push(govt(353, "Kit Pirate Govt", { disabPenalty: 20, boardPenalty: 5, killPenalty: 40, classes: [353, -1, -1, -1], enemies: [352, -1, -1, -1] }));
    out.push(system(2064, "Kit Law Range", -400, -700, 352, [2064]));
    out.push(spob(2064, "Kit Law Port", 0, 0, 138, { flags: 0x43 }));
    out.push(system(2065, "Kit Pirate Home", -360, -740, 353, []));
    out.push(system(2066, "Kit Law Home 2", -360, -700, 352, []));
    out.push(dude(334, "Kit Pirate Trader", 1, 353, 708));
    out.push(...misn(1044, "Kit A pirate trader", 9090, { availStel: 2064, shipCount: 1, shipDude: 334, shipGoal: -1, shipBehav: -1, shipStart: -1, onAccept: "!b9090" }));

    // --- E: a mission düde whose every class the player's bits exclude.
    out.push(...ship(853, "Kit Appear A", 138, { armor: 1000, shield: 1000, ai: 1, strength: 20, crew: 10, appearOn: "b9095" }));
    out.push(...ship(854, "Kit Appear B", 138, { armor: 1000, shield: 1000, ai: 1, strength: 20, crew: 10, appearOn: "b9096" }));
    const ad = dude(335, "Kit Appear", 1, 363, 853);
    ad.set = { ...ad.set, ships: [853, 854, ...none16.slice(2)], probs: [50, 50, ...zero16.slice(2)] };
    out.push(ad);
    out.push(...misn(1045, "Kit E appear-excluded", 9091, { shipCount: 1, shipDude: 335, shipGoal: -1, shipBehav: -1, shipStart: -1, onAccept: "!b9091" }));

    // --- S1 / I1 (docs/npc_behavior_gaps.md): contraband scanning and the
    // idle interceptor. gövt 354 Kit Customs (ScanMask 0x0001, ScanFine
    // 500, SmugPenalty 50) owns sÿst 2069 Kit Scan Range (spöb 2069 port;
    // traffic: düde 336, two AI 4 Kit Customs Cutters, shïp 855: the red
    // disc, Speed 300, one Kit Escort Gun). sÿst 2068 Kit Scan Gate
    // (neutral, spöb 2068 port) is its only link, so a pilot jumps in.
    // oütf 458 Kit Contraband Pod: ScanMask 0x0001, mass 0, +1 fuel.
    out.push(govt(354, "Kit Customs", { scanMask: 0x0001, scanFine: 500, smugPenalty: 50 }));
    out.push(...shareRled(855, "Kit Customs Cutter", 1971, 24, {
        accel: 300, speed: 300, turn: 30, armor: 3000, shield: 3000, mass: 50, freeMass: 100, cargo: 10,
        ai: 4, strength: 50, crew: 10, flags: 0, flags2: 0, ...{ weapons: [365, -1, -1, -1], weaponCounts: [1, 0, 0, 0], weaponAmmo: [0, 0, 0, 0] },
    }));
    out.push(dude(336, "Kit Customs Cutter", 4, 354, 855));
    const gate = system(2068, "Kit Scan Gate", -320, -700, 363, [2068]);
    gate.set = { ...gate.set, links: [2069, ...none16.slice(1)] };
    const range = system(2069, "Kit Scan Range", -280, -700, 354, [2069]);
    range.set = { ...range.set, links: [2068, ...none16.slice(1)], dudes: [336, ...none8.slice(1)], dudeProbs: [100, ...zero8.slice(1)], avgShips: 2 };
    out.push(gate, range);
    out.push(spob(2068, "Kit Scan Gate Port", 0, 0, 138, { flags: 0x43 }));
    out.push(spob(2069, "Kit Scan Port", 0, 0, 138, { flags: 0x43 }));
    const pod = gun(458, "Kit Contraband Pod", 0);
    pod.set = { ...pod.set, displayWeight: 9988, modType: 12, modVal: 1, max: 5, mass: 0, scanMask: 0x0001 };
    out.push(pod);
    return out;
}

/**
 * Wave-10 experiments (docs/reference_experiments.md, "Submunitions wave
 * 10", "NPC friendly fire wave 10", "#321 / #324 wave 10"). Nothing
 * retired; ids above wave 8's (shïp 836+, wëap 251+, düde 319+, sÿst/spöb
 * 2045+, mïsn 1023+, bits 9064+, gövt 358/359, jünk 202).
 *
 *  S   When does a shot fire its submunitions? sÿst 2045 Kit Sub Range
 *      (spöb 2045 Kit Sub Port at 0,0, a 15 x 21 station; spöb 2046 Kit
 *      Sub Mark, uninhabited, 150 px north). shïp 836 Kit Sub Target (an
 *      immobile 24 px magenta disc, 30000 armor), düde 319 (AI 1, gövt
 *      363), mïsn 1023 (bit 9064) puts it on the mark. wëap 251 Kit Sub
 *      Star is the submunition every test parent fires: 4 in a 90°
 *      starburst, Medium Blaster sprite, 2 s life, 0 damage, Flags2 0x0400
 *      (planet-type: passes through ships, so it stays visible at the
 *      target). Parents (secondaries, no ammo, reload 2 s, speed 600, 1
 *      damage, turret aim unless said): 252 prox 0 small sprite (Fusion
 *      Pulse, 16 px), 253 prox 0 big sprite (Superheavy Blaster, 89 px),
 *      254 prox 5, 255 prox 60, 256 life 15 frames (expires about 90 px
 *      out, short of the target), 257 = 256 + Flags2 0x0020, 258 = 252 +
 *      Flags2 0x0020, 259 guided prox 0, 260 guided prox 30, 261 a
 *      turreted beam (300 px) with subs, 262 = 255 + ProxSafety 30.
 *  F   NPC friendly fire: sÿst 2047 Kit FF Range (spöb 2047 port at 0,0;
 *      2048 / 2049 marks 110 / 260 px north). Anchored disc hulls: shïp
 *      837 Kit FF Shooter (red, 30000/30000) firing wëap 263 Kit FF Bolt
 *      (turret, 10 damage), 840 with 264 Kit FF Beam, 841 with 265 Kit FF
 *      Missile (guided), 842 with 266 Kit FF Blast (turret, 150 px blast);
 *      shïp 838 Kit FF Victim (blue, shield 1000 without recharge, armor
 *      30000, wëap 267 Kit FF Pea: a 1-damage turret, so whom it shoots
 *      shows). Shooters on the far mark (ShipStart -3): mïsn 1024 bolt /
 *      gövt 362 (bit 9065), 1025 beam / 362 (9066), 1026 missile / 362
 *      (9067), 1027 bolt / gövt 358 (9068), 1031 blast / 362 (9072).
 *      Victims on the near mark (ShipStart -2), Mission BBS jobs: mïsn 1028 gövt 362 (9069),
 *      1029 gövt 359 (9070), 1030 gövt 363 (9071). gövt 358 / 359 always
 *      attack the player and list each other's class as allies. Player
 *      hull shïp 839 Kit Ring Tank (Ring 24 sprite, 30000/30000).
 *  T   jünk 202 Kit Doodads (base 400), both sold and bought at Kit Port.
 *  M   #324: mïsn 1032 (bit 9073), a Mission BBS job (AvailLoc 0) at Kit
 *      Port to Kit BBS Dest (sÿst/spöb 2052), OnAccept b9074; sÿst 2054
 *      Kit BBS Shown (spöb 2055) is visible only while b9074 is set.
 */
function wave10Resources() {
    const out = [];
    const shareRled = (id, name, rledId, size, set) => [
        { type: "shïp", id, name, clone: "shïp:128", set: { ...shipBase, shortName: name, longName: name, commName: name, subtitle: "", ...set } },
        { type: "shän", id, name, clone: "shän:128", set: { "@0:i16": rledId, "@2:i16": rledId + 1, "@4:i16": 1, "@6:i16": size, "@8:i16": size } },
    ];
    const anchored = { accel: 0, speed: 0, turn: 60, mass: 50, freeMass: 100, cargo: 10, ai: 3, strength: 50, crew: 10, flags: 0, flags2: 0, shieldRecharge: 0, armorRecharge: 0 };
    const armed = (wid) => ({ weapons: [wid, -1, -1, -1], weaponCounts: [1, 0, 0, 0], weaponAmmo: [0, 0, 0, 0] });

    // --- S: submunitions.
    out.push(system(2045, "Kit Sub Range", -560, -700, 363, [2045, 2046]));
    out.push(spob(2045, "Kit Sub Port", 0, 0, 264, { flags: 0x43 }));
    out.push(spob(2046, "Kit Sub Mark", 0, -150, 264, { flags: 0x20, techLevel: 0, specialTech: [-1, -1, -1] }));
    out.push(...shareRled(836, "Kit Sub Target", 1975, 24, { ...anchored, ai: 1, turn: 0, armor: 30000, shield: 0, strength: 1, crew: 1 }));
    out.push(dude(319, "Kit Sub Target", 1, 363, 836));
    out.push(...misn(1023, "Kit S sub target", 9064, { availStel: 2045, shipCount: 1, shipDude: 319, shipGoal: -1, shipBehav: -1, shipStart: -2 }));
    out.push(weap(251, "Kit Sub Star", 130, {
        reload: 30, duration: 60, armorDamage: 0, shieldDamage: 0, guidance: -1, speed: 400, graphic: 1,
        proxRadius: 0, blastRadius: 0, flags: 0, flags2: 0x0400, explosion: -1,
    }));
    const parent = { reload: 60, duration: 45, armorDamage: 1, shieldDamage: 1, guidance: 4, speed: 600, graphic: 9,
        proxRadius: 0, blastRadius: 0, flags: 0x0002, flags2: 0, subCount: 4, subType: 251, subTheta: -90, subLimit: 0 };
    out.push(weap(252, "Sub P0", 130, parent));
    out.push(weap(253, "Sub P0 Big", 130, { ...parent, graphic: 18 }));
    out.push(weap(254, "Sub P5", 130, { ...parent, proxRadius: 5 }));
    out.push(weap(255, "Sub P60", 130, { ...parent, proxRadius: 60 }));
    out.push(weap(256, "Sub Expire", 130, { ...parent, duration: 15 }));
    out.push(weap(257, "Sub Expire 20", 130, { ...parent, duration: 15, flags2: 0x0020 }));
    out.push(weap(258, "Sub P0 20", 130, { ...parent, flags2: 0x0020 }));
    out.push(weap(259, "Sub Missile P0", 134, { ...parent, guidance: 1, guidedTurn: 60, graphic: 3, duration: 90, seekerFlags: 0, jamVuln: zero4 }));
    out.push(weap(260, "Sub Missile P30", 134, { ...parent, guidance: 1, guidedTurn: 60, graphic: 3, duration: 90, proxRadius: 30, seekerFlags: 0, jamVuln: zero4 }));
    out.push(weap(261, "Sub Beam", 170, { ...parent, guidance: 3, speed: 0, duration: 8, beamLength: 300, graphic: -1 }));
    out.push(weap(262, "Sub P60 Safe", 130, { ...parent, proxRadius: 60, proxSafety: 30 }));
    // Added during the wave (prox threshold): slow parents (Speed 200, 2 px
    // a frame, 5 s life) so the detonation point resolves to 2 px:
    // 268-273 small sprite prox 0 / 8 / 12 / 16 / 20 / 30, 274 / 275 the
    // 89 px sprite prox 0 / 20, 276 a copy of the beam (fired untargeted).
    // shïp 843 Kit Sub Target Big (the 96 px magenta disc, rlëD 1979, shän
    // 96 x 96), düde 328, mïsn 1033 (bit 9075) on the same mark.
    const slow = { ...parent, speed: 200, duration: 150 };
    [0, 8, 12, 16, 20, 30].forEach((p, i) => out.push(weap(268 + i, `Sub Slow P${p}`, 130, { ...slow, proxRadius: p })));
    out.push(weap(274, "Sub Slow Big P0", 130, { ...slow, graphic: 18 }));
    out.push(weap(275, "Sub Slow Big P20", 130, { ...slow, graphic: 18, proxRadius: 20 }));
    out.push(weap(276, "Sub Beam Free", 170, { ...parent, guidance: 3, speed: 0, duration: 8, beamLength: 300, graphic: -1 }));
    out.push(...shareRled(843, "Kit Sub Target Big", 1979, 96, { ...anchored, ai: 1, turn: 0, armor: 30000, shield: 0, strength: 1, crew: 1 }));
    out.push(dude(328, "Kit Sub Target Big", 1, 363, 843));
    out.push(...misn(1033, "Kit S sub target big", 9075, { availStel: 2045, shipCount: 1, shipDude: 328, shipGoal: -1, shipBehav: -1, shipStart: -2 }));

    // --- F: NPC friendly fire.
    out.push(system(2047, "Kit FF Range", -520, -700, 363, [2047, 2048, 2049]));
    out.push(spob(2047, "Kit FF Port", 0, 0, 264, { flags: 0x43 }));
    // Only ONE main-spaceport (AvailLoc 3) mission is offered per landing
    // (a bar mission did not show up, and a second landing offered nothing),
    // so the victims are Mission BBS jobs (AvailLoc 0).
    out.push({ type: "dësc", id: 10000 + 2047 - 128, text: "Kit FF Port bar (novaref test kit)." });
    out.push(spob(2048, "Kit FF Near", 0, -110, 264, { flags: 0x20, techLevel: 0, specialTech: [-1, -1, -1] }));
    out.push(spob(2049, "Kit FF Far", 0, -260, 264, { flags: 0x20, techLevel: 0, specialTech: [-1, -1, -1] }));
    out.push(weap(263, "Kit FF Bolt", 131, { reload: 20, duration: 90, armorDamage: 10, shieldDamage: 10, guidance: 4, speed: 600, proxRadius: 0, blastRadius: 0, flags: 0 }));
    out.push(weap(264, "Kit FF Beam", 170, { reload: 20, duration: 6, armorDamage: 10, shieldDamage: 10, guidance: 3, beamLength: 500, flags: 0 }));
    out.push(weap(265, "Kit FF Missile", 134, { reload: 30, duration: 150, armorDamage: 10, shieldDamage: 10, guidance: 1, speed: 600, guidedTurn: 60, proxRadius: 0, blastRadius: 0, flags: 0, seekerFlags: 0, jamVuln: zero4 }));
    out.push(weap(266, "Kit FF Blast", 131, { reload: 30, duration: 90, armorDamage: 10, shieldDamage: 10, guidance: 4, speed: 600, proxRadius: 0, blastRadius: 150, flags: 0 }));
    out.push(weap(267, "Kit FF Pea", 130, { reload: 20, duration: 90, armorDamage: 1, shieldDamage: 1, guidance: 4, speed: 600, proxRadius: 0, blastRadius: 0, flags: 0 }));
    const shooter = { ...anchored, armor: 30000, shield: 30000 };
    out.push(...shareRled(837, "Kit FF Shooter", 1971, 24, { ...shooter, ...armed(263) }));
    out.push(...shareRled(840, "Kit FF Shooter Beam", 1971, 24, { ...shooter, ...armed(264) }));
    out.push(...shareRled(841, "Kit FF Shooter Missile", 1971, 24, { ...shooter, ...armed(265) }));
    out.push(...shareRled(842, "Kit FF Shooter Blast", 1971, 24, { ...shooter, ...armed(266) }));
    out.push(...shareRled(838, "Kit FF Victim", 1973, 24, { ...anchored, armor: 30000, shield: 1000, ...armed(267) }));
    out.push(...shareRled(839, "Kit Ring Tank", 1955, 24, { accel: 2000, speed: 100, turn: 30, armor: 30000, shield: 30000, shieldRecharge: 0, armorRecharge: 0, mass: 50, freeMass: 1000, cargo: 50, maxGuns: 8, maxTurrets: 8, ai: 3, strength: 50, crew: 10, flags: 0, flags2: 0x00C8 }));
    out.push(govt(358, "Kit FF Ally A", { flags: 0x0004, classes: [358, -1, -1, -1], allies: [359, -1, -1, -1] }));
    out.push(govt(359, "Kit FF Ally B", { flags: 0x0004, classes: [359, -1, -1, -1], allies: [358, -1, -1, -1] }));
    [[320, "Bolt 362", 362, 837], [321, "Beam 362", 362, 840], [322, "Missile 362", 362, 841], [323, "Bolt 358", 358, 837], [324, "Blast 362", 362, 842]]
        .forEach(([did, name, g, sid]) => out.push(dude(did, `Kit FF Shooter ${name}`, 3, g, sid)));
    [[325, 362], [326, 359], [327, 363]].forEach(([did, g]) => out.push(dude(did, `Kit FF Victim ${g}`, 3, g, 838)));
    const ff = { availStel: 2047, shipCount: 1, shipGoal: -1, shipBehav: -1 };
    out.push(...misn(1024, "Kit F shooter bolt 362", 9065, { ...ff, shipDude: 320, shipStart: -3 }));
    out.push(...misn(1025, "Kit F shooter beam 362", 9066, { ...ff, shipDude: 321, shipStart: -3 }));
    out.push(...misn(1026, "Kit F shooter missile 362", 9067, { ...ff, shipDude: 322, shipStart: -3 }));
    out.push(...misn(1027, "Kit F shooter bolt 358", 9068, { ...ff, shipDude: 323, shipStart: -3 }));
    out.push(...misn(1031, "Kit F shooter blast 362", 9072, { ...ff, shipDude: 324, shipStart: -3 }));
    out.push(...misn(1028, "Kit F victim 362", 9069, { ...ff, shipDude: 325, shipStart: -2, availLoc: 0 }));
    out.push(...misn(1029, "Kit F victim 359", 9070, { ...ff, shipDude: 326, shipStart: -2, availLoc: 0 }));
    out.push(...misn(1030, "Kit F victim 363", 9071, { ...ff, shipDude: 327, shipStart: -2, availLoc: 0 }));

    // --- T: a jünk both sold and bought at Kit Port.
    out.push({ type: "jünk", id: 202, name: "Kit Doodads", clone: "jünk:128", set: { soldAt: [2100, ...none8.slice(1)], boughtAt: [2100, ...none8.slice(1)], basePrice: 400, flags: 0, scanMask: 0, lcName: "kit doodads", abbrev: "Doodads", buyOn: "", sellOn: "" } });

    // --- M: #324, the Mission BBS map after an accept.
    out.push(system(2052, "Kit BBS Dest", -560, -560, 363, [2052]));
    out.push(spob(2052, "Kit BBS Dest Port", 0, 0, 138, { flags: 0x43 }));
    const shown = system(2054, "Kit BBS Shown", -560, -640, 363, [2054]);
    shown.set = { ...shown.set, visibility: "b9074" };
    out.push(shown, spob(2054, "Kit BBS Shown Port", 0, 0, 138, { flags: 0x43 }));
    out.push(...misn(1032, "Kit M BBS job", 9073, { availLoc: 0, travelStel: 2052, payVal: 1000, onAccept: "b9074" }));
    // Added during the wave: did the accept set b9074? mïsn 1034 is offered
    // on landing at Kit Port only while b9074 is set.
    out.push(...misn(1034, "Kit M b9074 is set", 9074, {}));

    // --- #320 item 2: a gövt with NEGATIVE crime penalties. gövt 369 Kit
    // Negative Govt (Disab/Board/Kill -100) owns sÿst 2060 Kit Negative
    // Range (spöb 2060 port); mïsn 1035 (bit 9076) puts a Kit Trader of
    // that govt (düde 329, AI 1) beside the player at the port.
    out.push(govt(369, "Kit Negative Govt", { disabPenalty: -100, boardPenalty: -100, killPenalty: -100 }));
    out.push(system(2060, "Kit Negative Range", -480, -700, 369, [2060]));
    out.push(spob(2060, "Kit Negative Port", 0, 0, 138, { flags: 0x43 }));
    out.push(dude(329, "Kit Negative Trader", 1, 369, 708));
    out.push(...misn(1035, "Kit N negative-penalty trader", 9076, { availStel: 2060, shipCount: 1, shipDude: 329, shipGoal: -1, shipBehav: -1, shipStart: -1 }));

    // --- Item 9 (#320 item 3): an auto-aborting mission (Flags 0x0001,
    // one Kit Escort special ship so the abort triggers, no goal) with
    // CompGovt 360 / CompReward 20, OnAccept b9078, OnAbort b9079, offered
    // on landing at Kit Port: mïsn 1036 (bit 9077) with Flags 0x0040
    // ("Apply -5x CompReward reversal on abort"), mïsn 1037 (bit 9080)
    // without it.
    const aa = { shipCount: 1, shipDude: 600, shipGoal: -1, shipBehav: -1, shipStart: -1, compGovt: 360, compReward: 20, onAccept: "b9078", onAbort: "b9079" };
    out.push(...misn(1036, "Kit C auto-abort 0x40", 9077, { ...aa, flags: 0x0041 }));
    out.push(...misn(1037, "Kit C auto-abort plain", 9080, { ...aa, flags: 0x0001 }));

    // --- Item 11: outfits whose price / mass scale with the ship's Mass
    // (oütf Flags 0x0200 / 0x0400), sold at Kit Port at the top of the
    // list (DispWeight 9990+): oütf 452 Kit Mass Price (0x0200, Cost 100),
    // 453 Kit Mass Mass (0x0400, Mass 10, Cost 1000), 454 Kit Mass Both
    // (0x0600, Cost 100, Mass 10), 455 Kit Plain Mass (no flag, Mass 10,
    // Cost 1000). ModType 12 (+1 fuel), harmless. Player hulls shïp 844 /
    // 845 / 846 Kit Mass Hull 100 / 300 / 37 (Mass 100 / 300 / 37, 25 t
    // free; 25 t so a buy-until-refused count reads the mass); added
    // during the wave: 847 / 848 at Mass 155 / 50.
    [[452, "Kit Mass Price", 0x0200, 100, 0], [453, "Kit Mass Mass", 0x0400, 1000, 10],
        [454, "Kit Mass Both", 0x0600, 100, 10], [455, "Kit Plain Mass", 0, 1000, 10]].forEach(([id, name, flags, cost, mass], i) => {
        const o = gun(id, name, 0);
        o.set = { ...o.set, displayWeight: 9993 - i, modType: 12, modVal: 1, max: 20, flags, cost, mass };
        out.push(o);
    });
    [[844, 100], [845, 300], [846, 37], [847, 155], [848, 50]].forEach(([id, mass]) =>
        out.push(...ship(id, `Kit Mass Hull ${mass}`, 128, { mass, freeMass: 25, cargo: 20, armor: 300, shield: 300, maxGuns: 4, maxTurrets: 4, ai: 1, strength: 10, cost: 100000 })));
    return out;
}

/**
 * A 36-frame "pointer" sprite whose heading can be read off a screenshot
 * (wave 8): a disc (or, with `inner`, a ring whose hole shows what is under
 * it) of one colour and a spoke of another from `spokeFrom` to `spokeTo`
 * px out, pointing at the ship's nose (frame 0 up, clockwise, like a stock
 * sheet). Radii in px; the frame is `size` x `size`.
 */
export function pointerFrames(size, rgb, spokeRgb, { outer = size / 2 - 1, inner = 0, spokeFrom = 0, spokeTo = outer, spokeHalfWidth = 1 } = {}) {
    const h = (px) => px * 2; // raster units are half pixels
    const shapes = [circle(rgb15(...rgb), [0, 0], h(outer))];
    if (inner > 0) shapes.push(circle(TRANSPARENT, [0, 0], h(inner)));
    const w = h(spokeHalfWidth);
    shapes.push(polygon(rgb15(...spokeRgb), [[-w, -h(spokeTo)], [w, -h(spokeTo)], [w, -h(spokeFrom)], [-w, -h(spokeFrom)]]));
    return rotationFrames(size, size, shapes, 36);
}

/**
 * A hull drawn with pointerFrames. Like discShip it clones the stock
 * Shuttle's shän and swaps only the sprite, but it also writes the frame
 * size into the shän (discShip leaves the Shuttle's 24 x 24 there, so the
 * wave-7 96 px Kit Hulk Big declared 24 x 24). Wave 8 keeps its rlëD ids odd
 * so the mask the shän names (rledId + 1) is no resource at all.
 */
function pointerShip(id, name, rledId, size, frames, set) {
    return [
        { type: "shïp", id, name, clone: "shïp:128", set: { ...shipBase, shortName: name, longName: name, commName: name, subtitle: "", ...set } },
        { type: "shän", id, name, clone: "shän:128", set: { "@0:i16": rledId, "@2:i16": rledId + 1, "@4:i16": 1, "@6:i16": size, "@8:i16": size } },
        { type: "rlëD", id: rledId, name, hex: Buffer.from(encodeRled(frames, { original: true })).toString("hex") },
    ];
}

/**
 * Wave-8 experiments (docs/reference_experiments.md, "U9 wave 8" and "B
 * wave 8"). Nothing retired; ids above wave 7's (shïp 818+, düde 304+,
 * sÿst/spöb 2032+, mïsn 1021+, bits 9062+, rlëD 1955-1961 odd, free between the stock 1952 and the kit's 1970).
 *
 *  U9  Boarding with readable headings. rlëD 1955 Kit Ring 24 (a 2 px
 *      cyan ring, 24 px, with a white spoke at the nose and an open
 *      centre, so a hulk under it stays visible), rlëD 1957 Kit Ring 96
 *      (the same ring 96 px across), rlëD 1959 Kit Hulk Pointer (the 24 px
 *      magenta disc with a green spoke from the centre to the nose).
 *      Player hulls (Kit Crawler 100 stats, inertialess): shïp 818 Kit
 *      Ring Crawler (Ring 24, crew 10), 819 Kit Ring Crawler Big (Ring 96),
 *      826 Kit Ring Crawler Crew (Ring 24, crew 500).
 *      Hulks (immobile, derelict gövt 378, booty food + money, each the
 *      only traffic of its own system like wave 7's): shïp 820 Kit Hulk
 *      Pointer 50,000 (düde 304, sÿst/spöb 2032), 821-824 at 200,000 /
 *      300,000 / 750,000 / 1,000,000 (düde 305-308, sÿst/spöb 2033-2036),
 *      825 Kit Hulk Pointer Crew 20 (50,000, crew 20; düde 309, sÿst/spöb
 *      2037), 827 Kit Hulk Pointer Big (rlëD 1961: a 96 px magenta disc with
 *      a green spoke, shän 96 x 96, 50,000; düde 310, sÿst/spöb 2038).
 *  B   The carrier whose 1-damage bombers never let it fire: shïp 828 Kit
 *      Gun Carrier Anchored (shïp 800's hull and two Kit Escort Guns, no
 *      bay), düde 311 (gövt 362), mïsn 1021 (bit 9062) beside the player;
 *      shïp 830 Kit Empty Bay Carrier Anchored (shïp 802 with its bay
 *      empty), düde 313, mïsn 1022 (bit 9063).
 *  Added during the wave (capture): shïp 829 Kit Live Pointer (the pointer
 *      hulk of the NEUTRAL gövt 363, AI 4, not a derelict: the player
 *      disables it), düde 312, sÿst/spöb 2039 Kit Board Live; shïp 831 the
 *      same with crew 20, düde 314, sÿst/spöb 2040; 832 / 833 / 834 / 835
 *      crew 15 / 40 / 5 / 10, düde 315-318, sÿst/spöb 2041-2044.
 */
function wave8Resources() {
    const out = [];
    const cyan = [0, 31, 31], white = [31, 31, 31], magenta = [31, 0, 31], green = [0, 31, 0];
    const ring24 = pointerFrames(24, cyan, white, { outer: 11, inner: 9, spokeFrom: 5, spokeTo: 10 });
    const ring96 = pointerFrames(96, cyan, white, { outer: 47, inner: 45, spokeFrom: 36, spokeTo: 46, spokeHalfWidth: 1.5 });
    const hulkPtr = pointerFrames(24, magenta, green, { outer: 11, spokeFrom: 0, spokeTo: 11 });
    const hulkPtrBig = pointerFrames(96, magenta, green, { outer: 47, spokeFrom: 0, spokeTo: 47, spokeHalfWidth: 2 });
    const crawler = { accel: 2000, speed: 100, turn: 30, armor: 3000, shield: 3000, shieldRecharge: 0, mass: 50, freeMass: 1000, cargo: 50, maxGuns: 8, maxTurrets: 8, ai: 3, strength: 50, crew: 10, flags: 0, flags2: 0x00C8 };
    out.push(...pointerShip(818, "Kit Ring Crawler", 1955, 24, ring24, crawler));
    out.push(...pointerShip(819, "Kit Ring Crawler Big", 1957, 96, ring96, crawler));
    const shareRled = (id, name, rledId, size, set) => [
        { type: "shïp", id, name, clone: "shïp:128", set: { ...shipBase, shortName: name, longName: name, commName: name, subtitle: "", ...set } },
        { type: "shän", id, name, clone: "shän:128", set: { "@0:i16": rledId, "@2:i16": rledId + 1, "@4:i16": 1, "@6:i16": size, "@8:i16": size } },
    ];
    out.push(...shareRled(826, "Kit Ring Crawler Crew", 1955, 24, { ...crawler, crew: 500 }));

    const hulkSet = { armor: 300, shield: 0, accel: 0, speed: 0, turn: 0, mass: 50, freeMass: 100, cargo: 50, ai: 1, strength: 1, crew: 1, flags: 0, flags2: 0, cost: 50000 };
    const hulkSystem = (sid, did, shipId, name) => {
        const d = dude(did, name, 1, 378, shipId);
        d.set = { ...d.set, flags: 0x0041 };
        const s = system(sid, `Kit Board ${name}`, -600 + 30 * (sid - 2020), -800, 363, [sid]);
        s.set = { ...s.set, dudes: [did, ...none8.slice(1)], dudeProbs: [100, ...zero8.slice(1)], avgShips: 1 };
        out.push(d, s, spob(sid, `Kit Board ${name} Port`, 0, 0, 138, { flags: 0x43 }));
    };
    out.push(...pointerShip(820, "Kit Hulk Pointer", 1959, 24, hulkPtr, hulkSet));
    hulkSystem(2032, 304, 820, "Pointer");
    [[821, 200000], [822, 300000], [823, 750000], [824, 1000000]].forEach(([id, cost], i) => {
        out.push(...shareRled(id, `Kit Hulk Pointer ${cost}`, 1959, 24, { ...hulkSet, cost }));
        hulkSystem(2033 + i, 305 + i, id, `Pointer ${cost}`);
    });
    out.push(...shareRled(825, "Kit Hulk Pointer Crew 20", 1959, 24, { ...hulkSet, crew: 20 }));
    hulkSystem(2037, 309, 825, "Pointer Crew 20");
    out.push(...pointerShip(827, "Kit Hulk Pointer Big", 1961, 96, hulkPtrBig, hulkSet));
    hulkSystem(2038, 310, 827, "Pointer Big");
    // Added during the wave: the derelict hulk read "Capture Odds: 0%" even
    // with 90% of its armor shot away, so a hulk that is NOT a derelict:
    // shïp 829 Kit Live Pointer (the pointer hulk, 300 armor, so disabled
    // below 100) of the neutral gövt 363, düde 312 (booty food +
    // money; AI 4, so it neither jumps out nor lands), the only traffic of
    // sÿst/spöb 2039. The player disables it.
    // shïp 831 / düde 314 / sÿst 2040: the same with crew 20.
    const liveSystem = (sid, did, shipId, name) => {
        const d = dude(did, name, 4, 363, shipId);
        d.set = { ...d.set, flags: 0x0041 };
        const s = system(sid, `Kit Board ${name}`, -600 + 30 * (sid - 2020), -800, 363, [sid]);
        s.set = { ...s.set, dudes: [did, ...none8.slice(1)], dudeProbs: [100, ...zero8.slice(1)], avgShips: 1 };
        out.push(d, s, spob(sid, `Kit Board ${name} Port`, 0, 0, 138, { flags: 0x43 }));
    };
    out.push(...shareRled(829, "Kit Live Pointer", 1959, 24, hulkSet));
    liveSystem(2039, 312, 829, "Live");
    out.push(...shareRled(831, "Kit Live Pointer Crew 20", 1959, 24, { ...hulkSet, crew: 20 }));
    liveSystem(2040, 314, 831, "Live Crew 20");
    // And crew 15 / 40 (shïp 832 / 833, düde 315 / 316, sÿst 2041 / 2042)
    // to see how the odds fall with the crew ratio.
    out.push(...shareRled(832, "Kit Live Pointer Crew 15", 1959, 24, { ...hulkSet, crew: 15 }));
    liveSystem(2041, 315, 832, "Live Crew 15");
    out.push(...shareRled(833, "Kit Live Pointer Crew 40", 1959, 24, { ...hulkSet, crew: 40 }));
    liveSystem(2042, 316, 833, "Live Crew 40");
    // And crew 5 / 10 (shïp 834 / 835, düde 317 / 318, sÿst 2043 / 2044).
    out.push(...shareRled(834, "Kit Live Pointer Crew 5", 1959, 24, { ...hulkSet, crew: 5 }));
    liveSystem(2043, 317, 834, "Live Crew 5");
    out.push(...shareRled(835, "Kit Live Pointer Crew 10", 1959, 24, { ...hulkSet, crew: 10 }));
    liveSystem(2044, 318, 835, "Live Crew 10");

    // --- B: the anchored carrier's guns without a bay.
    out.push(...ship(828, "Kit Gun Carrier Anchored", 143, { armor: 3000, shield: 3000, weapons: [365, -1, -1, -1], weaponCounts: [2, 0, 0, 0], weaponAmmo: [0, 0, 0, 0], ai: 3, strength: 100, crew: 40, speed: 0, accel: 0 }));
    out.push(dude(311, "Kit Gun Carrier Anchored", 3, 362, 828));
    out.push(...misn(1021, "Kit B anchored gun carrier", 9062, { shipCount: 1, shipDude: 311, shipGoal: -1, shipBehav: -1, shipStart: -1 }));
    // Added during the wave: the gun-only carrier DID fire, so one more
    // factor: shïp 830, shïp 802 (Kit Bomber Bay 1) with its bay EMPTY
    // (ammo 0), düde 313, mïsn 1022 (bit 9063) beside the player.
    out.push(...ship(830, "Kit Empty Bay Carrier Anchored", 143, { armor: 3000, shield: 3000, weapons: [365, 247, -1, -1], weaponCounts: [2, 1, 0, 0], weaponAmmo: [0, 0, 0, 0], ai: 3, strength: 100, crew: 40, speed: 0, accel: 0 }));
    out.push(dude(313, "Kit Empty Bay Carrier Anchored", 3, 362, 830));
    out.push(...misn(1022, "Kit B anchored empty-bay carrier", 9063, { shipCount: 1, shipDude: 313, shipGoal: -1, shipBehav: -1, shipStart: -1 }));
    return out;
}

/**
 * Wave-7 experiments (docs/reference_experiments.md). Nothing retired; ids
 * above wave 6's (wëap 247+, oütf 451+, düde 292+, shïp 800+, sÿst/spöb
 * 2023+, mïsn 1010+, bits 9051+, gövt 368, rlëD 1979).
 *
 *  B   A carrier that stays in the fight with REAL kit bombers: shïp 800
 *      Kit Bomb Carrier Anchored (shïp 712 with Speed/Accel 0: 2 Kit Escort
 *      Guns, Kit Bomber Bay of 4 Kit Bombers with the 50-damage 400 px
 *      shell), düde 292 (AI 3, gövt 362), mïsn 1010 (bit 9051) beside the
 *      player. One factor changed: shïp 802 the same with wëap 247 Kit
 *      Bomber Bay 1 -> shïp 801 Kit Bomber 1 (the 1-damage shell, wëap
 *      243), düde 293, mïsn 1011 (bit 9052).
 *  U9  Boarding: Kit Hulk at other prices (shïp 803-806: 2,000 / 100,000 /
 *      500,000 / 2,000,000; düde 294-297; sÿst/spöb 2023-2026), a 96 px
 *      Kit Hulk Big at 50,000 (shïp 807, rlëD 1979, düde 298, sÿst/spöb
 *      2027). Player hulls: shïp 808 Kit Crawler 25 and 809 Kit Crawler 40
 *      (11 and 17.6 px/s) and 817 Kit Crawler Soft (Accel 200: the pass
 *      speed is set by the thrust tap) for the boarding speed gate, 810 Kit
 *      Crawler Crew
 *      (Crawler 100 with crew 500) for the capture odds.
 *  A   gövt 0x0010, distance vs damage rate: gövt 368 Kit Retreat Hostile
 *      (0x0010 | 0x0004 always attacks the player, so the tank closes from
 *      any distance unprovoked), düde 299 (AI 3 AI Tank Disc of 368); mïsn
 *      1012 (bit 9053) beside the player at Kit Port, mïsn 1013 (bit 9054)
 *      at Kit Jam Far's marker, 1800 px from the port (sÿst 2151). wëap 248
 *      Kit Long Beam 50 + oütf 451 (the Kit Long Beam at 50 per beam frame).
 *      mïsn 1020 (bit 9061): the neutral gövt 383 tank of waves 4-6 (düde
 *      637) at Kit Market, 900 px out.
 *  J   InhJam from the HULL's inherent govt: shïp 811 Jam Target Inh (the
 *      J0 hull with shïp govt 364, InhJam1 100), düde 300 (govt 364), mïsn
 *      1014 (bit 9055) at Kit Market. Two different jammers on one hull:
 *      shïp 812 (Kit Jammer 25 then Kit Jammer 75) and 813 (75 then 25),
 *      düde 301/302, mïsn 1015/1016 (bits 9056/9057) at Kit Market.
 *      Interference 30 / 60: sÿst 2028 Kit Static 30 (spöb 2028 port, 2029
 *      marker at 900,0) and sÿst 2030 Kit Static 60 (spöb 2030/2031), mïsn
 *      1017/1018 (bits 9058/9059) put the J0 target on the marker.
 *      Where ionization starts: shïp 814 Kit Lancer Ion Slow (IonizeMax
 *      100, Deionize 1), shïp 815 Ion Target Green (an immobile green disc,
 *      rlëD 1972, firing wëap 249 Kit Ion Gun 10: 1 damage, Ionization 10,
 *      one shot every 45 frames), düde 303 (gövt 362), mïsn 1019 (bit 9060)
 *      beside the player.
 *  E   Front-quadrant turrets: wëap 250 Kit Front Turret (the Kit Escort
 *      Gun with guidance 7), shïp 816 Kit Disc Blue Front (2 x 250).
 */
function wave7Resources() {
    const out = [];
    // --- B: the anchored Kit Bomb Carrier.
    const carrierSet = { armor: 3000, shield: 3000, weaponCounts: [2, 1, 0, 0], weaponAmmo: [0, 4, 0, 0], ai: 3, strength: 100, crew: 40, speed: 0, accel: 0 };
    out.push(...ship(800, "Kit Bomb Carrier Anchored", 143, { ...carrierSet, weapons: [365, 371, -1, -1] }));
    out.push(dude(292, "Kit Bomb Carrier Anchored", 3, 362, 800));
    out.push(...misn(1010, "Kit B anchored Kit Bomb Carrier", 9051, { shipCount: 1, shipDude: 292, shipGoal: -1, shipBehav: -1, shipStart: -1 }));
    out.push(...ship(801, "Kit Bomber 1", 167, { armor: 500, shield: 500, weapons: [243, -1, -1, -1], weaponCounts: [1, 0, 0, 0], weaponAmmo: [0, 0, 0, 0], ai: 3, strength: 20, crew: 1 }));
    out.push(weap(247, "Kit Bomber Bay 1", 149, { reload: 30, guidance: 99, ammoType: 801 }));
    out.push(...ship(802, "Kit Bomb Carrier Anchored 1", 143, { ...carrierSet, weapons: [365, 247, -1, -1] }));
    out.push(dude(293, "Kit Bomb Carrier Anchored 1", 3, 362, 802));
    out.push(...misn(1011, "Kit B anchored Kit Bomb Carrier 1", 9052, { shipCount: 1, shipDude: 293, shipGoal: -1, shipBehav: -1, shipStart: -1 }));

    // --- U9: hulks at other prices, a big hulk, player hulls.
    const hulkSet = { ...shipBase, subtitle: "", armor: 300, shield: 0, accel: 0, speed: 0, turn: 0, mass: 50, freeMass: 100, cargo: 50, ai: 1, strength: 1, crew: 1, flags: 0, flags2: 0 };
    const hulkSystem = (sid, did, shipId, name) => {
        const d = dude(did, name, 1, 378, shipId);
        d.set = { ...d.set, flags: 0x0041 };
        const s = system(sid, `Kit Board ${name}`, -600 + 30 * (sid - 2020), -770, 363, [sid]);
        s.set = { ...s.set, dudes: [did, ...none8.slice(1)], dudeProbs: [100, ...zero8.slice(1)], avgShips: 1 };
        out.push(d, s, spob(sid, `Kit Board ${name} Port`, 0, 0, 138, { flags: 0x43 }));
    };
    [[803, 2000], [804, 100000], [805, 500000], [806, 2000000]].forEach(([id, cost], i) => {
        const name = `Kit Hulk ${cost}`;
        out.push({ type: "shïp", id, name, clone: "shïp:128", set: { ...hulkSet, shortName: name, longName: name, commName: name, cost } });
        out.push({ type: "shän", id, name, clone: "shän:128", set: { "@0:i16": 1975, "@2:i16": 1976, "@4:i16": 1 } });
        hulkSystem(2023 + i, 294 + i, id, name);
    });
    out.push(...discShip(807, "Kit Hulk Big", 1979, DISC_COLOURS.magenta, { ...hulkSet, cost: 50000 }, 96));
    hulkSystem(2027, 298, 807, "Kit Hulk Big");
    const crawler = { accel: 2000, turn: 30, armor: 3000, shield: 3000, shieldRecharge: 0, mass: 50, freeMass: 1000, cargo: 50, maxGuns: 8, maxTurrets: 8, ai: 3, strength: 50, flags: 0, flags2: 0x00C8 };
    out.push(...ship(808, "Kit Crawler 25", 135, { ...crawler, speed: 25 }));
    out.push(...ship(809, "Kit Crawler 40", 135, { ...crawler, speed: 40 }));
    out.push(...ship(810, "Kit Crawler Crew", 135, { ...crawler, speed: 100, crew: 500 }));
    // Added during the wave: at 11 px/s (Crawler 25) a pass straight over the
    // hulk got "not close enough" all the way, so slower still. A slow TOP
    // speed would take many minutes to reach the hulk, so instead Kit Crawler
    // Soft: top speed 44 px/s but Accel 200 (about 35 px/s^2): an inertialess
    // hull keeps the speed it has when thrust is released, so the pass speed
    // is set by the length of the thrust tap (args.pass.thrustMs).
    out.push(...ship(817, "Kit Crawler Soft", 135, { ...crawler, speed: 100, accel: 200 }));

    // --- A: gövt 0x0010 tank that always attacks the player.
    out.push(govt(368, "Kit Retreat Hostile", { flags: 0x0014 }));
    out.push(dude(299, "AI Tank 3 retreat hostile", 3, 368, 762));
    out.push(...misn(1012, "Kit A hostile retreat tank near", 9053, { shipCount: 1, shipDude: 299, shipGoal: -1, shipBehav: -1, shipStart: -1 }));
    out.push(...misn(1013, "Kit A hostile retreat tank far", 9054, { availStel: 2152, shipCount: 1, shipDude: 299, shipGoal: -1, shipBehav: -1, shipStart: -2 }));
    out.push(weap(248, "Kit Long Beam 50", 170, { reload: 15, duration: 4, armorDamage: 50, shieldDamage: 50, guidance: 3, beamLength: 1500 }));
    out.push(gun(451, "Kit Long Beam 50", 248));
    // Added during the wave: the waves 4-6 tank (düde 637, neutral gövt 383,
    // which only fights once provoked) at Kit Market, 900 px out, inside the
    // beam's 1500 px: mïsn 1020 (bit 9061). Beside the player it is wave 3's
    // mïsn 988 (bit 9029).
    out.push(...misn(1020, "Kit A neutral retreat tank far", 9061, { shipCount: 1, shipDude: 637, shipGoal: -1, shipBehav: -1, shipStart: -2 }));

    // --- J: InhJam on the hull's own govt; two different jammers; Interference 30/60; ion threshold.
    const j0 = { armor: 100, shield: 0, accel: 0, speed: 0, turn: 0, ai: 1, strength: 1, crew: 1 };
    out.push(...ship(811, "Jam Target Inh", 136, { ...j0, govt: 364 }));
    out.push(dude(300, "Jam Target Inh", 1, 364, 811));
    out.push(...misn(1014, "Kit J InhJam hull govt", 9055, { shipCount: 1, shipDude: 300, shipGoal: -1, shipBehav: -1, shipStart: -2 }));
    [[812, 301, 1015, 9056, [623, 626]], [813, 302, 1016, 9057, [626, 623]]].forEach(([id, did, mid, bit, outfits]) => {
        const name = `Jam Target ${outfits[0] === 623 ? "25+75" : "75+25"}`;
        out.push(...ship(id, name, 136, { ...j0, outfits: [...outfits, -1, -1], outfitCounts: [1, 1, 0, 0] }));
        out.push(dude(did, name, 1, 363, id));
        out.push(...misn(mid, `Kit J ${name}`, bit, { shipCount: 1, shipDude: did, shipGoal: -1, shipBehav: -1, shipStart: -2 }));
    });
    [[2028, "Kit Static 30", 30, 1017, 9058], [2030, "Kit Static 60", 60, 1018, 9059]].forEach(([sid, name, interference, mid, bit]) => {
        const s = system(sid, name, -1200 + 30 * (sid - 2000), -790, 363, [sid, sid + 1]);
        s.set = { ...s.set, interference };
        out.push(s, spob(sid, `${name} Port`, 0, 0, 138, { flags: 0x43 }),
            spob(sid + 1, `${name} Marker`, 900, 0, 132, { flags: 0x20, techLevel: 0, specialTech: [-1, -1, -1] }));
        out.push(...misn(mid, `Kit ${name} J0 target`, bit, { availStel: sid, shipCount: 1, shipDude: 615, shipGoal: -1, shipBehav: -1, shipStart: -2 }));
    });
    out.push(...ship(814, "Kit Lancer Ion Slow", 135, {
        accel: 2000, speed: 800, turn: 60, armor: 30000, shield: 30000, shieldRecharge: 0, armorRecharge: 0, mass: 50, freeMass: 1000,
        cargo: 200, maxGuns: 16, maxTurrets: 16, ai: 3, strength: 100, flags: 0, flags2: 0x00C8, ionization: 100, deionize: 1,
    }));
    out.push(weap(249, "Kit Ion Gun 10", 131, { reload: 45, duration: 60, armorDamage: 1, shieldDamage: 1, guidance: 4, ionization: 10 }));
    out.push({ type: "shïp", id: 815, name: "Ion Target Green", clone: "shïp:128", set: { ...shipBase, shortName: "Ion Target Green", longName: "Ion Target Green", commName: "Ion Target Green", subtitle: "",
        armor: 100, shield: 0, accel: 0, speed: 0, turn: 0, mass: 50, freeMass: 100, cargo: 10, ai: 3, strength: 1, crew: 1, flags: 0, flags2: 0,
        weapons: [249, -1, -1, -1], weaponCounts: [1, 0, 0, 0], weaponAmmo: [0, 0, 0, 0] } });
    out.push({ type: "shän", id: 815, name: "Ion Target Green", clone: "shän:128", set: { "@0:i16": 1972, "@2:i16": 1973, "@4:i16": 1 } });
    out.push(dude(303, "Ion Target Green", 3, 362, 815));
    out.push(...misn(1019, "Kit J ion threshold", 9060, { shipCount: 1, shipDude: 303, shipGoal: -1, shipBehav: -1, shipStart: -1 }));

    // --- E: front-quadrant turret escorts.
    out.push(weap(250, "Kit Front Turret", 131, { reload: 20, duration: 60, armorDamage: 30, shieldDamage: 30, guidance: 7 }));
    out.push({ type: "shïp", id: 816, name: "Kit Disc Blue Front", clone: "shïp:128", set: { ...shipBase, shortName: "Kit Disc Blue Front", longName: "Kit Disc Blue Front", commName: "Kit Disc Blue Front", subtitle: "",
        accel: 600, speed: 600, turn: 60, armor: 4000, shield: 4000, mass: 50, freeMass: 100, cargo: 10,
        weapons: [250, -1, -1, -1], weaponCounts: [2, 0, 0, 0], weaponAmmo: [0, 0, 0, 0],
        ai: 3, strength: 100, crew: 20, flags: 0, flags2: 0, escortType: 2, cost: 10000 } });
    out.push({ type: "shän", id: 816, name: "Kit Disc Blue Front", clone: "shän:128", set: { "@0:i16": 1973, "@2:i16": 1974, "@4:i16": 1 } });
    return out;
}

/**
 * Wave-6 experiments (docs/reference_experiments.md). Nothing retired: like
 * wave 5 it uses the gaps above the stock ids (wëap 238+, oütf 446+, düde
 * 280+, sÿst/spöb 2013+, shïp 783+, mïsn 1001+, bits 9042+).
 *
 *  U9  Landing range of the tiny stock stellars. One landable stellar at
 *      (0,0) per system, cloned from a stock spöb so it keeps its graphic:
 *        sÿst/spöb 2013 Type 53 (spöb 299 Holpa Station) 17x31, station
 *        2014 Type 51 (spöb 264 A'j He) 15x21, station
 *        2015 Type 48 (spöb 235 Kel'a He) 35x22, station
 *        2016 Type 53 again, but a PLANET (flags 0x43): does the station
 *             flag matter?
 *      The stations keep the stock station flags (0x11: land + station).
 *      shïp 783 Kit Crawler Mini: Kit Crawler 50 on the stock Shuttle's
 *      24 px sprite (the Lightning's 48 px frame outshines a 15x21 station
 *      in planet_track.mjs's largest-blob search).
 *  B   NPC carrier vs its own fighters' blasts: mïsn 1001 (bit 9042) puts
 *      the STOCK Fed Carrier of always-attacks gövt 362 (düde 278) at Kit
 *      Port beside the player (ShipStart -1); use with kits/viper_blast.mjs.
 *      mïsn 1002 (bit 9043): the same hull anchored (shïp 790, the stock
 *      Fed Carrier byte for byte with Speed/Accel 0; düde 283).
 *      Kit bombers that never launch, one factor at a time (each its own
 *      traffic system like sÿst 2011, gövt 362, avgShips 1; the stock Fed
 *      Carrier hull with its Viper bay swapped, Anaconda bay KEPT as an
 *      in-run control):
 *        sÿst 2017 / düde 280 / shïp 787 / wëap 238 -> shïp 784 Kit Viper
 *             Clone: the stock Viper byte for byte under a new id;
 *        sÿst 2018 / düde 281 / shïp 788 / wëap 239 -> shïp 785 Kit Viper
 *             Shell: that clone armed ONLY with the Kit Blast Shell;
 *        sÿst 2019 / düde 282 / shïp 789 / wëap 240 -> shïp 786 Kit Viper
 *             Base: that clone with the kit's shipBase fields (tech 9000,
 *             cost 1000, crew 1, ...) but its stock guns.
 *  J   Seeker 0x0020 "can't fire if ionized": wëap 241 JamM Ion (JamVuln
 *      0, Seeker 0x0020) and oütf 446 its launcher; control = wëap 375 with
 *      oütf 616 (no jammer anywhere, so its JamVuln plays no part). shïp
 *      792 Kit Lancer Ion: Kit Lancer Heavy with IonizeMax 100 and Deionize
 *      1. The target, shïp 793 Ion Target (immobile, armor 100, shield 0)
 *      of always-attacks gövt 362, AI 3, fires wëap 242 Kit Ion Turret
 *      (the Tickler with Ionization 50) at the player; düde 285, mïsn 1003
 *      (bit 9044) at Kit Market.
 *      Cloaked targets: shïp 794 Cloak Target (the J0 target with oütf 447
 *      Kit Cloak, ModType 17, and shïp Flags2 0x0800 "cloak when just
 *      flying around"), düde 286 (AI 1, govt 363), mïsn 1004 (bit 9045) at
 *      Kit Market; oütf 448 Kit Cloak Scanner (ModType 30, 0x000F: radar,
 *      screen, untargetable and cloaked targeting) for the player.
 *  Added during the wave (each block's comment below says why): shïp 415
 *      Kit Viper Low + carrier 796 / bay wëap 244 / düde 288 / sÿst 2021;
 *      wëap 243 Kit Blast Shell 1 (kits/viper_blast1.mjs); mïsn 1007 (bit
 *      9048) Kit Bomb Carrier beside the player; wëap 245 Kit Ion Gun, shïp
 *      797 Ion Target Near, düde 289, mïsn 1005 (bit 9046); mïsn 1006 (bit
 *      9047) the Cloak Target beside the player, oütf 449 Kit Cloak Scanner
 *      T; shïp 798 Cloak Target W (stock Wraith cloak), düde 290, mïsn
 *      1008/1009 (bits 9049/9050); wëap 246 Kit Long Beam + oütf 450 (0x0010
 *      tank); shïp 795 Kit Hulk, düde 287, sÿst/spöb 2020 Kit Board Range
 *      (boarding loop); shïp 799 Kit Hulk Cheap, düde 291, sÿst/spöb 2022.
 *  Kit-wide fix: a bay's AmmoType is the carried shïp id itself (stock wëap
 *      149 holds 144), not id - 128 as the kit wrote until now.
 */
function wave6Resources() {
    const out = [];
    // --- U9: tiny stellars.
    const land = (sid, name, clone, flags) => {
        out.push(system(sid, name, -1200 + 30 * (sid - 2000), -740, 363, [sid]));
        out.push(spob(sid, `${name} Port`, 0, 0, clone, { flags }));
    };
    land(2013, "Kit Land 17x31", 299, 0x11);
    land(2014, "Kit Land 15x21", 264, 0x11);
    land(2015, "Kit Land 35x22", 235, 0x11);
    land(2016, "Kit Land 17x31 Planet", 299, 0x43);
    out.push(...ship(783, "Kit Crawler Mini", 128, {
        accel: 2000, speed: 50, turn: 30, armor: 3000, shield: 3000, shieldRecharge: 0, mass: 50, freeMass: 1000,
        cargo: 50, maxGuns: 8, maxTurrets: 8, ai: 3, strength: 50, flags: 0, flags2: 0x00C8,
    }));

    // --- B: the stock Fed Carrier beside the player.
    out.push(...misn(1001, "Kit B Fed Carrier at Kit Port", 9042, { shipCount: 1, shipDude: 278, shipGoal: -1, shipBehav: -1, shipStart: -1 }));
    out.push({ type: "shïp", id: 790, name: "Kit Fed Carrier Anchored", clone: "shïp:143", set: {
        speed: 0, accel: 0, shortName: "Kit Fed Carrier Anchored", longName: "Kit Fed Carrier Anchored", commName: "Kit Fed Carrier Anchored" } });
    out.push({ type: "shän", id: 790, name: "Kit Fed Carrier Anchored", clone: "shän:143" });
    out.push(dude(283, "Kit Fed Carrier Anchored 362", 3, 362, 790));
    // The Kit Blast Shell at 1 damage (kits/viper_blast1.mjs): the Vipers
    // survive their own blasts, and the carrier is still "hit" by every one.
    out.push(weap(243, "Kit Blast Shell 1", 134, { reload: 45, duration: 60, armorDamage: 1, shieldDamage: 1, guidance: -1, speed: 300, proxRadius: 30, blastRadius: 400, flags: 0x8000, guidedTurn: 0 }));
    // With the bay AmmoType fixed, the kit's own Kit Bomb Carrier (shïp 712:
    // 3000/3000, Kit Bomber Bay of Kit Bombers with the 50-damage 400 px
    // Kit Blast Shell; düde 277, gövt 362) beside the player: mïsn 1007,
    // bit 9048.
    out.push(...misn(1007, "Kit B Kit Bomb Carrier at Kit Port", 9048, { shipCount: 1, shipDude: 277, shipGoal: -1, shipBehav: -1, shipStart: -1 }));
    out.push(...misn(1002, "Kit B anchored Fed Carrier at Kit Port", 9043, { shipCount: 1, shipDude: 283, shipGoal: -1, shipBehav: -1, shipStart: -1 }));

    // --- B: launch factors. Stock Fed Carrier slots: 132 x2, 135 x2 (90),
    // 149 (4 Vipers), 150 (2 Anacondas); here 149 -> the test bay.
    const viper = (id, name, set) => [
        { type: "shïp", id, name, clone: "shïp:144", set: { shortName: name, longName: name, commName: name, ...set } },
        { type: "shän", id, name, clone: "shän:144" },
    ];
    out.push(...viper(784, "Kit Viper Clone", {}));
    out.push(...viper(785, "Kit Viper Shell", { weapons: [372, -1, -1, -1], weaponCounts: [1, 0, 0, 0], weaponAmmo: [0, 0, 0, 0] }));
    // shipBase minus its weapon fields: the Viper keeps its stock guns.
    const { weapons: _w, weaponCounts: _c, weaponAmmo: _a, weapons2: _w2, weaponCounts2: _c2, weaponAmmo2: _a2, ...baseNoGuns } = shipBase;
    out.push(...viper(786, "Kit Viper Base", { ...baseNoGuns, escortType: 0 }));
    // The same clone at shïp 415, the first id after the stock block
    // 128-414 (sÿst 2021, düde 288, carrier shïp 796, bay wëap 244). Its
    // first run, with the old AmmoType = id - 128, pointed the bay at stock
    // shïp 287 (Pirate Carrier) and filled the system with pirates: that is
    // how the AmmoType bug was found.
    out.push(...viper(415, "Kit Viper Low", {}));
    [[2017, 280, 787, 238, 784], [2018, 281, 788, 239, 785], [2019, 282, 789, 240, 786], [2021, 288, 796, 244, 415]].forEach(([sid, did, cid, bay, fighter]) => {
        const name = `Kit Fed Carrier ${fighter}`;
        out.push({ type: "wëap", id: bay, name: `Kit Viper Bay ${fighter}`, clone: "wëap:149", set: { ammoType: fighter } });
        out.push({ type: "shïp", id: cid, name, clone: "shïp:143", set: {
            weapons: [132, 135, bay, 150], weaponCounts: [2, 2, 1, 1], weaponAmmo: [-1, 90, 4, 2], shortName: name, longName: name, commName: name } });
        out.push({ type: "shän", id: cid, name, clone: "shän:143" });
        out.push(dude(did, `${name} traffic 362`, 3, 362, cid));
        const s = system(sid, `Kit Launch ${fighter}`, -1200 + 30 * (sid - 2000), -740, 363, [sid]);
        s.set = { ...s.set, dudes: [did, ...none8.slice(1)], dudeProbs: [100, ...zero8.slice(1)], avgShips: 1 };
        out.push(s, spob(sid, `Kit Launch ${fighter} Port`, 0, 0, 138, { flags: 0x43 }));
    });

    // --- J: Seeker 0x0020 and ionization.
    out.push(weap(241, "JamM Ion", 134, {
        reload: 15, duration: 300, armorDamage: 1, shieldDamage: 1, guidance: 1, speed: 600, guidedTurn: 60,
        seekerFlags: 0x0020, jamVuln: [0, 0, 0, 0], proxRadius: 25, blastRadius: 0, flags: 0x0002,
    }));
    out.push(gun(446, "JamM Launcher Ion", 241));
    out.push(...ship(792, "Kit Lancer Ion", 135, {
        accel: 2000, speed: 800, turn: 60, armor: 30000, shield: 30000, shieldRecharge: 0, armorRecharge: 0, mass: 50, freeMass: 1000,
        cargo: 200, maxGuns: 16, maxTurrets: 16, ai: 3, strength: 100, flags: 0, flags2: 0x00C8, ionization: 100, deionize: 1,
    }));
    out.push(weap(242, "Kit Ion Turret", 130, { reload: 15, duration: 90, armorDamage: 1, shieldDamage: 1, guidance: 4, speed: 2500, ionization: 50 }));
    out.push(...ship(793, "Ion Target", 136, {
        armor: 100, shield: 0, accel: 0, speed: 0, turn: 0, ai: 3, strength: 1, crew: 1,
        weapons: [242, -1, -1, -1], weaponCounts: [1, 0, 0, 0], weaponAmmo: [0, 0, 0, 0],
    }));
    out.push(dude(285, "Ion Target", 3, 362, 793));
    out.push(...misn(1003, "Kit J ion target", 9044, { shipCount: 1, shipDude: 285, shipGoal: -1, shipBehav: -1, shipStart: -2 }));
    // Take 2: the first Ion Target never fired its Tickler-based turret at
    // 900 px (no bolts reached the player, which turned at full rate). Now
    // the Kit Escort Gun the AI is known to fire, at 1 damage with
    // Ionization 200 (wëap 245), on an immobile target that starts beside
    // the player at Kit Port (shïp 797, düde 289, mïsn 1005, bit 9046).
    out.push(weap(245, "Kit Ion Gun", 131, { reload: 10, duration: 60, armorDamage: 1, shieldDamage: 1, guidance: 4, ionization: 200 }));
    out.push(...ship(797, "Ion Target Near", 136, {
        armor: 100, shield: 0, accel: 0, speed: 0, turn: 0, ai: 3, strength: 1, crew: 1,
        weapons: [245, -1, -1, -1], weaponCounts: [1, 0, 0, 0], weaponAmmo: [0, 0, 0, 0],
    }));
    out.push(dude(289, "Ion Target Near", 3, 362, 797));
    out.push(...misn(1005, "Kit J ion target near", 9046, { shipCount: 1, shipDude: 289, shipGoal: -1, shipBehav: -1, shipStart: -1 }));

    // --- J: cloaked target.
    const cloak = gun(447, "Kit Cloak", 0);
    cloak.set = { ...cloak.set, modType: 17, modVal: 0x0002, max: 1 };
    const scanner = gun(448, "Kit Cloak Scanner", 0);
    scanner.set = { ...scanner.set, modType: 30, modVal: 0x000F, max: 1 };
    out.push(cloak, scanner);
    out.push(...ship(794, "Cloak Target", 136, {
        armor: 100, shield: 0, accel: 0, speed: 0, turn: 0, ai: 1, strength: 1, crew: 1, flags2: 0x0800,
        outfits: [447, -1, -1, -1], outfitCounts: [1, 0, 0, 0],
    }));
    out.push(dude(286, "Cloak Target", 1, 363, 794));
    out.push(...misn(1004, "Kit J cloak target", 9045, { shipCount: 1, shipDude: 286, shipGoal: -1, shipBehav: -1, shipStart: -2 }));
    // Take 2: the first run hit as often as an uncloaked target, and from
    // 900 px nothing showed whether it had cloaked at all. The same target
    // beside the player at Kit Port (mïsn 1006, bit 9047, ShipStart -1),
    // and oütf 449 Kit Cloak Scanner T (0x000C: targeting only, so a
    // cloaked target stays invisible on screen and radar).
    out.push(...misn(1006, "Kit J cloak target near", 9047, { shipCount: 1, shipDude: 286, shipGoal: -1, shipBehav: -1, shipStart: -1 }));
    // Take 3: take 2's target never cloaked (Tab found it without a
    // scanner). The same immobile hull with the STOCK Wraith Cloaking
    // Device (oütf 266) and the stock Wraith's cloak Flags2 0x5F00, AI 3
    // (an AI 1 hull may never "fly around"): shïp 798, düde 290, mïsn 1008
    // (bit 9049) beside the player.
    out.push(...ship(798, "Cloak Target W", 136, {
        armor: 100, shield: 0, accel: 0, speed: 0, turn: 0, ai: 3, strength: 1, crew: 1, flags2: 0x5F00,
        outfits: [266, -1, -1, -1], outfitCounts: [1, 0, 0, 0],
    }));
    out.push(dude(290, "Cloak Target W", 3, 363, 798));
    out.push(...misn(1008, "Kit J cloak target W near", 9049, { shipCount: 1, shipDude: 290, shipGoal: -1, shipBehav: -1, shipStart: -1 }));
    // Take 4: it does cloak, but beside the player a missile's 25 px fuse
    // hits it at launch, guided or not. The same at Kit Market (900 px):
    // mïsn 1009, bit 9050.
    out.push(...misn(1009, "Kit J cloak target W far", 9050, { shipCount: 1, shipDude: 290, shipGoal: -1, shipBehav: -1, shipStart: -2 }));
    const scannerT = gun(449, "Kit Cloak Scanner T", 0);
    scannerT.set = { ...scannerT.set, modType: 30, modVal: 0x000C, max: 1 };
    out.push(scannerT);

    // --- A: gövt 0x0010, jump or stand off? In waves 4-6 the tanks that
    // jumped were already 260+ px off when their shield crossed 25%, the ones
    // that stood off were in an attack pass. wëap 246 Kit Long Beam (beam
    // turret, 1500 px, every 15 frames) + oütf 450 strips the tank's shield
    // far out, before it closes. A beam deals its damage on every frame of
    // its Duration: at 200 it disabled the 30000-armor tank in about 17 s
    // (the first two runs), so it is 15 now (about 120 a second).
    out.push(weap(246, "Kit Long Beam", 170, { reload: 15, duration: 4, armorDamage: 15, shieldDamage: 15, guidance: 3, beamLength: 1500 }));
    out.push(gun(450, "Kit Long Beam", 246));

    // --- U9: boarding a NON-mission disabled ship. Ordinary sÿst traffic of
    // the derelict gövt 378 (flags 0x0800: its ships start disabled): shïp
    // 795 Kit Hulk, an immobile magenta disc (Kit Disc Magenta's rlëD 1975)
    // that loops/board.mjs finds by colour; düde 287 (booty 0x0041 food and
    // money); sÿst 2020 Kit Board Range, spöb 2020 Kit Board Port.
    out.push({ type: "shïp", id: 795, name: "Kit Hulk", clone: "shïp:128", set: { ...shipBase, shortName: "Kit Hulk", longName: "Kit Hulk", commName: "Kit Hulk", subtitle: "",
        armor: 300, shield: 0, accel: 0, speed: 0, turn: 0, mass: 50, freeMass: 100, cargo: 50, ai: 1, strength: 1, crew: 1, cost: 50000, flags: 0, flags2: 0 } });
    out.push({ type: "shän", id: 795, name: "Kit Hulk", clone: "shän:128", set: { "@0:i16": 1975, "@2:i16": 1976, "@4:i16": 1 } });
    const hulk = dude(287, "Kit Hulk", 1, 378, 795);
    hulk.set = { ...hulk.set, flags: 0x0041 };
    out.push(hulk);
    const board = system(2020, "Kit Board Range", -600, -740, 363, [2020]);
    board.set = { ...board.set, dudes: [287, ...none8.slice(1)], dudeProbs: [100, ...zero8.slice(1)], avgShips: 1 };
    out.push(board, spob(2020, "Kit Board Port", 0, 0, 138, { flags: 0x43 }));
    // The same hulk at another price (cost 20,000; shïp 799, düde 291, sÿst
    // and spöb 2022): is the 1,250-credit booty a share of the price?
    out.push({ type: "shïp", id: 799, name: "Kit Hulk Cheap", clone: "shïp:128", set: { ...shipBase, shortName: "Kit Hulk Cheap", longName: "Kit Hulk Cheap", commName: "Kit Hulk Cheap", subtitle: "",
        armor: 300, shield: 0, accel: 0, speed: 0, turn: 0, mass: 50, freeMass: 100, cargo: 50, ai: 1, strength: 1, crew: 1, cost: 20000, flags: 0, flags2: 0 } });
    out.push({ type: "shän", id: 799, name: "Kit Hulk Cheap", clone: "shän:128", set: { "@0:i16": 1975, "@2:i16": 1976, "@4:i16": 1 } });
    const hulkCheap = dude(291, "Kit Hulk Cheap", 1, 378, 799);
    hulkCheap.set = { ...hulkCheap.set, flags: 0x0041 };
    out.push(hulkCheap);
    const boardCheap = system(2022, "Kit Board Range Cheap", -540, -740, 363, [2022]);
    boardCheap.set = { ...boardCheap.set, dudes: [291, ...none8.slice(1)], dudeProbs: [100, ...zero8.slice(1)], avgShips: 1 };
    out.push(boardCheap, spob(2022, "Kit Board Cheap Port", 0, 0, 138, { flags: 0x43 }));
    return out;
}

/**
 * Wave-4 experiments (docs/reference_experiments.md).
 *
 *  U9  Landing range vs planet sprite size: sÿst 2160-2164 "Kit Land NN",
 *      unlinked, owned by neutral 363, each with ONE landable stellar at
 *      (0,0) (spöb 2160-2164) cloned from a stock spöb so it keeps that
 *      spöb's graphic (spöb Type -> spïn 1000+Type):
 *        2160 Type 3  (spöb 132)  40x40
 *        2161 Type 6  (spöb 138)  72x72
 *        2162 Type 25 (spöb 176)  250x250
 *        2163 Type 5  (spöb 159)  325x325 (Jupiter)
 *        2164 Type 18 (spöb 169)  304x134 (non-square: width or height?)
 *        2165 Type 9  (spöb 145)  96x96
 *        2166 Type 10 (spöb 174)  112x112
 *        2167 Type 39 (spöb 311)  315x200 (non-square)
 *        2168 Type 16 (spöb 168)  80x80
 *        2169 Type 24 (spöb 183)  88x88
 *      Kit Port (Type 0, 150x150) is the wave-3 point.
 *      Landing speed gate: shïp 771 Kit Crawler Slowbrake (inertialess,
 *      Speed 100, Accel 60) and 772 Kit Crawler Slowbrake 200 (Speed 200,
 *      Accel 120) brake slowly under Down, so `l` pressed while braking
 *      samples the gate.
 *  A   mïsn 991 (bit 9032): FOUR AI 1 subjects (düde 630) at Kit Port, for
 *      unprovoked departure times.
 *  E   wëap 368 Kit Fixed Gun (guidance -1, the Kit Escort Gun otherwise),
 *      369 Kit Rear Turret (guidance 8). They retire the #316 speed guns.
 *      shïp 769 Kit Disc Blue Fixed (2 x 368), 770 Kit Disc Blue Rear
 *      (2 x 369): the blue armed escort disc with those weapons (sprite
 *      reuses rlëD 1973, Kit Disc Blue's).
 */
function wave4Resources() {
    const out = [];
    const sizes = [[2160, "Kit Land 40", 132], [2161, "Kit Land 72", 138], [2162, "Kit Land 250", 176],
        [2163, "Kit Land 325", 159], [2164, "Kit Land 304x134", 169],
        [2165, "Kit Land 96", 145], [2166, "Kit Land 112", 174], [2167, "Kit Land 315x200", 311],
        [2168, "Kit Land 80", 168], [2169, "Kit Land 88", 183]];
    sizes.forEach(([id, name, clone], i) => {
        out.push(system(id, name, -1080, -620 + 30 * i, 363, [id]));
        out.push(spob(id, `${name} Port`, 0, 0, clone, { flags: 0x43 }));
    });
    // Speed 100 (44 px/s) with Accel 60 (about 11 px/s^2): Down brakes it
    // over about 4 s, so `l` pressed while braking samples the speed gate.
    out.push(...ship(771, "Kit Crawler Slowbrake", 135, {
        accel: 60, speed: 100, turn: 30, armor: 3000, shield: 3000, shieldRecharge: 0, mass: 50, freeMass: 1000,
        cargo: 50, maxGuns: 8, maxTurrets: 8, ai: 3, strength: 50, flags: 0, flags2: 0x00C8,
    }));
    // The same at Speed 200 (87 px/s), Accel 120: is the speed gate absolute
    // or a share of the hull's top speed?
    out.push(...ship(772, "Kit Crawler Slowbrake 200", 135, {
        accel: 120, speed: 200, turn: 30, armor: 3000, shield: 3000, shieldRecharge: 0, mass: 50, freeMass: 1000,
        cargo: 50, maxGuns: 8, maxTurrets: 8, ai: 3, strength: 50, flags: 0, flags2: 0x00C8,
    }));
    out.push(...misn(991, "Kit AI 1 subjects x4", 9032, { shipCount: 4, shipDude: 630, shipGoal: -1, shipBehav: -1, shipStart: -1 }));
    // The Kit Escort Gun (wëap 365, clone of 131) with another guidance.
    const escortGun = { reload: 20, duration: 60, armorDamage: 30, shieldDamage: 30 };
    out.push(weap(368, "Kit Fixed Gun", 131, { ...escortGun, guidance: -1 }));
    out.push(weap(369, "Kit Rear Turret", 131, { ...escortGun, guidance: 8 }));
    const blueEscort = (id, name, wid) => [
        { type: "shïp", id, name, clone: "shïp:128", set: { ...shipBase, shortName: name, longName: name, commName: name, subtitle: "",
            accel: 600, speed: 600, turn: 60, armor: 4000, shield: 4000, mass: 50, freeMass: 100, cargo: 10,
            weapons: [wid, -1, -1, -1], weaponCounts: [2, 0, 0, 0], weaponAmmo: [0, 0, 0, 0],
            ai: 3, strength: 100, crew: 20, flags: 0, flags2: 0, escortType: 2, cost: 10000 } },
        { type: "shän", id, name, clone: "shän:128", set: { "@0:i16": 1973, "@2:i16": 1974, "@4:i16": 1 } },
    ];
    out.push(...blueEscort(769, "Kit Disc Blue Fixed", 368), ...blueEscort(770, "Kit Disc Blue Rear", 369));
    out.push(...jamWave4(), ...wave4Rocks(), ...wave4Brackets(), ...wave5Resources());
    return out;
}

/**
 * Wave-5 experiments (docs/reference_experiments.md). Nothing retired.
 * Besides the last kit-range ids (sÿst/spöb 2172-2175), wave 5 uses the
 * gaps ABOVE the stock ids, which plugin-make allows and the game accepts
 * like any plug-in id: sÿst/spöb 2000-2099 (stock sÿst stop at 1127, spöb
 * at 1420), düde 275+ (stock stop at 274), gövt 365-369 (free inside the
 * kit range), flët 301+ (stock 128-255, kit 300), shïp 778+.
 *
 *  J   Decoy capture: sÿst 2172 Kit Decoy Range (owner 363) holds ONE
 *      asteroid (AsteroidTypes 0x0001, röid 128 only), spöb 2172 Kit Decoy
 *      Port at (0,0) and spöb 2173 Kit Decoy Marker at (250,0), inside the
 *      832x604 window's play area. mïsn 996 (bit 9037) puts the J0 target
 *      (düde 615) on the marker. sÿst 2174 Kit Decoy Range 3 is the same
 *      with THREE asteroids (spöb 2174 port, 2175 marker; mïsn 997, bit
 *      9038). The player fires single JamM Decoy missiles (wëap 379: Seeker
 *      0x0002, JamVuln 0) one at a time; analysis/decoy_track.mjs gives each
 *      missile's path and the rocks' positions.
 *  A   AI 1 sÿst traffic: sÿst 2000 Kit Traffic Range (owner 363) with two
 *      landable stellars, spöb 2000 Traffic Port (0,0) and 2001 Traffic
 *      Market (900,0), and ordinary traffic of düde 630 (the AI 1 yellow AI
 *      Subject Disc that mïsn 991 used as a mission ship in wave 4),
 *      avgShips 4.
 *  A   gövt 0x0010 retreat: shïp 778 Kit Lancer Heavy Weak (the 763 player
 *      hull with Strength 1) and 779 Kit Lancer Heavy Strong (Strength
 *      10000), to tell attacker strength from damage rate.
 *  A14 one-way alliances: gövt 365 "A14 GtoO" (class 77, lists the Owner's
 *      class 70 as ally; 370 does not list 77) and 366 "A14 OtoG" (class
 *      78, no allies) with 367 "A14 Owner2" (class 79, lists 78 as ally).
 *      sÿst 2002 A14 GtoO (owner 370) spawns AI 3 warships of 365 (düde
 *      275); sÿst 2003 A14 OtoG (owner 367) spawns warships of 366 (düde
 *      276). One landable stellar each (spöb 2002, 2003).
 *  B   NPC carrier: sÿst 2004 Kit Carrier Range (owner 363, spöb 2004)
 *      spawns düde 277, an AI 3 Kit Bomb Carrier (shïp 712: 2 Kit Escort
 *      Guns and a Kit Bomber Bay of 4 Kit Bombers armed with the 400 px
 *      blast shell) of the always-attacks gövt 362, avgShips 1.
 *  F1n fleets: flët 301 (white 720 lead; escorts: Kit Big Red 741 (96 px),
 *      green 722, blue 723, yellow 724: mixed sprite sizes) placed by sÿst
 *      2005 Kit Fleet Mixed; flët 302 (white lead; escorts red 721 x2 and
 *      green 722 x2: repeated types) placed by sÿst 2006 Kit Fleet Repeat.
 *      Both govt 363; one landable stellar each (spöb 2005, 2006).
 */
function wave5Resources() {
    const out = [];
    const decoyRange = (sid, name, x, rocks, misnId, bit) => {
        const s = system(sid, name, x, -650, 363, [sid, sid + 1]);
        s.set = { ...s.set, asteroids: rocks, asteroidTypes: 0x0001 };
        out.push(s, spob(sid, `${name} Port`, 0, 0, 138, { flags: 0x43 }),
            spob(sid + 1, `${name} Marker`, 250, 0, 132, { flags: 0x20, techLevel: 0, specialTech: [-1, -1, -1] }));
        out.push(...misn(misnId, `Kit decoy J0 target ${rocks}`, bit, { availStel: sid, shipCount: 1, shipDude: 615, shipGoal: -1, shipBehav: -1, shipStart: -2 }));
    };
    decoyRange(2172, "Kit Decoy Range", -1140, 1, 996, 9037);
    decoyRange(2174, "Kit Decoy Range 3", -1170, 3, 997, 9038);

    // One landable stellar at (0,0) per system; sÿst positions on a row far from everything else.
    const oneStellar = (sid, name, owner, set = {}) => {
        const s = system(sid, name, -1200 + 30 * (sid - 2000), -700, owner, [sid]);
        s.set = { ...s.set, ...set };
        out.push(s, spob(sid, `${name} Port`, 0, 0, 138, { flags: 0x43 }));
        return s;
    };
    const traffic = oneStellar(2000, "Kit Traffic Range", 363, { dudes: [630, ...none8.slice(1)], dudeProbs: [100, ...zero8.slice(1)], avgShips: 4 });
    traffic.set.spobs = [2000, 2001, ...none16].slice(0, 16);
    out.push(spob(2001, "Kit Traffic Market", 900, 0, 138, { flags: 0x43 }));

    const heavy = { accel: 2000, speed: 800, turn: 60, armor: 30000, shield: 30000, shieldRecharge: 0, armorRecharge: 0, mass: 50, freeMass: 1000, cargo: 200, maxGuns: 16, maxTurrets: 16, ai: 3, flags: 0, flags2: 0x00C8 };
    out.push(...ship(778, "Kit Lancer Heavy Weak", 135, { ...heavy, strength: 1 }));
    out.push(...ship(779, "Kit Lancer Heavy Strong", 135, { ...heavy, strength: 10000 }));

    out.push(govt(365, "A14 GtoO", { maxOdds: 1000, crimeTol: 10, classes: [77, -1, -1, -1], allies: [70, -1, -1, -1] }));
    out.push(govt(366, "A14 OtoG", { maxOdds: 1000, crimeTol: 10, classes: [78, -1, -1, -1] }));
    out.push(govt(367, "A14 Owner2", { maxOdds: 1000, crimeTol: 10, classes: [79, -1, -1, -1], allies: [78, -1, -1, -1] }));
    out.push(dude(275, "A14 Warships 365", 3, 365, 730), dude(276, "A14 Warships 366", 3, 366, 730));
    const warships = (d) => ({ dudes: [d, ...none8.slice(1)], dudeProbs: [100, ...zero8.slice(1)], avgShips: 2 });
    oneStellar(2002, "A14 GtoO", 370, warships(275));
    oneStellar(2003, "A14 OtoG", 367, warships(276));

    out.push(dude(277, "Kit Bomb Carrier traffic", 3, 362, 712));
    oneStellar(2004, "Kit Carrier Range", 363, { dudes: [277, ...none8.slice(1)], dudeProbs: [100, ...zero8.slice(1)], avgShips: 1 });
    // The Kit Bomb Carrier neither attacked nor launched in 110 s, so the
    // same with the STOCK Fed Carrier (shïp 143, its own bays and Vipers).
    out.push(dude(278, "Fed Carrier traffic 362", 3, 362, 143));
    oneStellar(2011, "Kit Fed Carrier Range", 363, { dudes: [278, ...none8.slice(1)], dudeProbs: [100, ...zero8.slice(1)], avgShips: 1 });
    // The stock Fed Carrier launched its Vipers and Anacondas, so: the stock
    // hull byte for byte (no shipBase) with only its Viper bay swapped for
    // the Kit Bomber Bay (wëap 371: Kit Bombers with the 400 px blast shell)
    // and its Anaconda bay removed. Stock slots: 132 x2, 135 x2 (90), 149
    // (4 Vipers), 150 (2 Anacondas); 133 x2 stays in the second block.
    out.push({ type: "shïp", id: 780, name: "Kit Fed Bomb Carrier", clone: "shïp:143", set: {
        weapons: [132, 135, 371, -1], weaponCounts: [2, 2, 1, 0], weaponAmmo: [-1, 90, 4, 0],
        shortName: "Kit Fed Bomb Carrier", longName: "Kit Fed Bomb Carrier", commName: "Kit Fed Bomb Carrier" } });
    out.push({ type: "shän", id: 780, name: "Kit Fed Bomb Carrier", clone: "shän:143" });
    out.push(dude(279, "Kit Fed Bomb Carrier traffic 362", 3, 362, 780));
    // That one did not launch either, so the bay and fighter are the
    // difference. Second try: wëap 237 = the stock Viper bay (149) byte for
    // byte except AmmoType (-> shïp 781), and shïp 781 Kit Bomber F = the
    // Kit Bomber with EscortType 0 (fighter, like the stock Viper; the kit's
    // shipBase sets -1). düde 279 now flies shïp 782, the Fed hull with 237.
    out.push({ type: "wëap", id: 237, name: "Kit Bomber Bay F", clone: "wëap:149", set: { ammoType: 781 } });
    out.push(...ship(781, "Kit Bomber F", 167, { armor: 500, shield: 500, weapons: [372, -1, -1, -1], weaponCounts: [1, 0, 0, 0], weaponAmmo: [0, 0, 0, 0], ai: 3, strength: 20, crew: 1, escortType: 0 }));
    out.push({ type: "shïp", id: 782, name: "Kit Fed Bomb Carrier F", clone: "shïp:143", set: {
        weapons: [132, 135, 237, -1], weaponCounts: [2, 2, 1, 0], weaponAmmo: [-1, 90, 4, 0],
        shortName: "Kit Fed Bomb Carrier F", longName: "Kit Fed Bomb Carrier F", commName: "Kit Fed Bomb Carrier F" } });
    out.push({ type: "shän", id: 782, name: "Kit Fed Bomb Carrier F", clone: "shän:143" });
    out[out.findIndex((r) => r.type === "düde" && r.id === 279)].set.ships[0] = 782;
    oneStellar(2012, "Kit Fed Bomb Range", 363, { dudes: [279, ...none8.slice(1)], dudeProbs: [100, ...zero8.slice(1)], avgShips: 1 });

    const fleet = (id, name, escorts, mins, maxs, sid) => ({
        type: "flët", id, name, clone: "flët:128",
        set: { "@0:i16": 720, "@2:i16x4": escorts, "@10:i16x4": mins, "@18:i16x4": maxs, "@26:i16": 363, "@28:i16": sid, "@30:str256": "", "@286:i16": -1, "@288:u16": 0 },
    });
    out.push(fleet(301, "Kit Disc Fleet Mixed", [741, 722, 723, 724], [1, 1, 1, 1], [1, 1, 1, 1], 2005));
    out.push(fleet(302, "Kit Disc Fleet Repeat", [721, 722, -1, -1], [2, 2, 0, 0], [2, 2, 0, 0], 2006));
    const fleetSys = (f) => ({ dudes: [-f, ...none8.slice(1)], dudeProbs: [100, ...zero8.slice(1)], avgShips: 6 });
    oneStellar(2005, "Kit Fleet Mixed", 363, fleetSys(301));
    oneStellar(2006, "Kit Fleet Repeat", 363, fleetSys(302));
    out.push(...jamWave5());
    return out;
}

/**
 * Wave-5 jamming oddities (wëap/oütf ids above the stock ones: stock wëap
 * stop at 234, oütf at 443).
 *
 *  wëap 235 JamM Interf (Seeker 0x0008 "confused by sensor interference",
 *       JamVuln 0), oütf 444 its launcher. sÿst 2007 Kit Static Range
 *       (owner 363, Interference 100): spöb 2007 port (0,0), 2008 marker
 *       (900,0); mïsn 998 (bit 9039) puts the J0 target on the marker.
 *       sÿst 2009 Kit Static Control is the same with Interference 0
 *       (spöb 2009, 2010; mïsn 999, bit 9040).
 *  wëap 236 JamM Parent V100 (Seeker 0x8000 "may attack parent ship if
 *       jammed", JamVuln1 100), oütf 445. mïsn 1000 (bit 9041) puts Jam
 *       Target S100 (düde 608: ONE +100 jammer, so every V100 missile is
 *       jammed) at Kit Market, 900 px from Kit Port. Flown from Kit Lancer
 *       Lite (1500 shield, no recharge), the parent's shield bar shows any
 *       missile that turns back on it.
 */
function jamWave5() {
    const out = [];
    const jm = (id, name, vuln, seeker) => weap(id, name, 134, {
        reload: 15, duration: 300, armorDamage: 1, shieldDamage: 1, guidance: 1, speed: 600, guidedTurn: 60,
        seekerFlags: seeker, jamVuln: [vuln, 0, 0, 0], proxRadius: 25, blastRadius: 0, flags: 0x0002,
    });
    out.push(jm(235, "JamM Interf", 0, 0x0008), gun(444, "JamM Launcher Interf", 235));
    out.push(jm(236, "JamM Parent V100", 100, 0x8000), gun(445, "JamM Launcher Parent", 236));
    const range = (sid, name, x, interference, misnId, bit) => {
        const s = system(sid, name, x, -760, 363, [sid, sid + 1]);
        s.set = { ...s.set, interference };
        out.push(s, spob(sid, `${name} Port`, 0, 0, 138, { flags: 0x43 }),
            spob(sid + 1, `${name} Marker`, 900, 0, 132, { flags: 0x20, techLevel: 0, specialTech: [-1, -1, -1] }));
        out.push(...misn(misnId, `Kit ${name} J0 target`, bit, { availStel: sid, shipCount: 1, shipDude: 615, shipGoal: -1, shipBehav: -1, shipStart: -2 }));
    };
    range(2007, "Kit Static Range", -1200, 100, 998, 9039);
    range(2009, "Kit Static Control", -1170, 0, 999, 9040);
    out.push(...misn(1000, "Kit J parent S100 target", 9041, { availStel: 2100, shipCount: 1, shipDude: 608, shipGoal: -1, shipBehav: -1, shipStart: -2 }));
    return out;
}

/**
 * Wave-3 experiments (docs/reference_experiments.md). Id budget note: a
 * pilot can only name wëap <= 383 and oütf <= 639, and düde ids stop at
 * 639 (Max Dude Types 512), so this wave uses the last free ones.
 *
 *  J   wëap 382 JamM V100 Long: wëap 375 with a 30 s life (duration 900),
 *      for the distance series; oütf 624 its launcher. wëap 383 JamM
 *      TurnAway Long: the same with Seeker 0x0010; oütf 625.
 *      sÿst 2150 Kit Jam Near (spöb 2150 port at 0,0; 2151 marker at 450,0)
 *      and 2151 Kit Jam Far (spöb 2152 port; 2153 marker at 1800,0), both
 *      owned by neutral 363. mïsn 982/983 (bits 9023/9024) put a J100
 *      target on the marker (ShipStart -2 = nav default 2); 984/985 (9025/
 *      9026) a J0 target at far/near.
 *      gövt 364 Kit Jam Govt (InhJam1 100) and düde 635, a J0 target hull of
 *      that govt; mïsn 986 (bit 9027) puts it at Kit Market (900 px).
 *  A   shïp 762 AI Tank Disc: the yellow AI Subject Disc with 30000 armor, so
 *      a player gun strips its 1000 shield without disabling it. düde 636 AI 2
 *      (govt 363), 637 AI 3 of gövt 383 (retreat below 25% shield), 638 AI 3
 *      (govt 363); mïsn 987-989 (bits 9028-9030) at Kit Port (ShipStart -1).
 *      shïp 763 Kit Lancer Heavy: player hull, inertialess, 30000 shield and
 *      armor with no recharge, so every hit shows on the shield bar.
 *  E   shïp 764 Kit Disc Blue Armed (blue disc, 2 Kit Escort Guns, EscortType 2)
 *      for hired escorts; sÿst 2153 Kit Fight Range (owner 363, spöb 2154
 *      Kit Fight Port) spawns red always-attacks warships (düde 612).
 *  F1n flët 300 Kit Disc Fleet 2 (lead 720 white, one each of 721-724,
 *      govt 363). sÿst DudeTypes name fleets as -128..-383, and sÿst 2128
 *      Kit Fleet Range now places it as -300.
 *  U9  shïp 765 Kit Prize (immobile, shield 0, armor 300, crew 1); düde 639
 *      (AI 1, govt 363, booty 0x0041 food + money); mïsn 990 (bit 9031) at
 *      Kit Port.
 *  M5  sÿst 2154-2156 of Major Blue (380), unlinked and 100 map units apart:
 *      2154 Map B Inhab (landable stellar; leave it unexplored),
 *      2155 Map B Empty (no stellar; explore it), 2156 Map B Unland
 *      (unlandable stellar; explore it).
 */
function wave3Resources() {
    const out = [];
    out.push(weap(382, "JamM V100 Long", 134, {
        reload: 15, duration: 900, armorDamage: 1, shieldDamage: 1, guidance: 1, speed: 600, guidedTurn: 60,
        seekerFlags: 0, jamVuln: [100, 0, 0, 0], proxRadius: 25, blastRadius: 0, flags: 0x0002,
    }));
    out.push(gun(624, "JamM Launcher 382", 382));
    // The same with Seeker 0x0010 (turns away if jammed): does its loss grow
    // with flight time (a per-frame roll) or not (one roll per missile)?
    out.push(weap(383, "JamM TurnAway Long", 134, {
        reload: 15, duration: 900, armorDamage: 1, shieldDamage: 1, guidance: 1, speed: 600, guidedTurn: 60,
        seekerFlags: 0x0010, jamVuln: [100, 0, 0, 0], proxRadius: 25, blastRadius: 0, flags: 0x0002,
    }));
    out.push(gun(625, "JamM Launcher 383", 383));
    const marker = (id, name, x) => spob(id, name, x, 0, 132, { flags: 0x20, techLevel: 0, specialTech: [-1, -1, -1] });
    out.push(system(2150, "Kit Jam Near", -960, -620, 363, [2150, 2151]),
        spob(2150, "Kit Jam Near Port", 0, 0, 138, { flags: 0x43 }), marker(2151, "Kit Jam Near Marker", 450));
    out.push(system(2151, "Kit Jam Far", -990, -620, 363, [2152, 2153]),
        spob(2152, "Kit Jam Far Port", 0, 0, 138, { flags: 0x43 }), marker(2153, "Kit Jam Far Marker", 1800));
    const tgt = (id, name, bit, stel, dudeId) =>
        misn(id, name, bit, { availStel: stel, shipCount: 1, shipDude: dudeId, shipGoal: -1, shipBehav: -1, shipStart: -2 });
    out.push(...tgt(982, "Kit J near J100", 9023, 2150, 619), ...tgt(983, "Kit J far J100", 9024, 2152, 619),
        ...tgt(984, "Kit J far J0", 9025, 2152, 615), ...tgt(985, "Kit J near J0", 9026, 2150, 615));
    out.push(govt(364, "Kit Jam Govt", { inhJam: [100, 0, 0, 0] }));
    // AI 3 from run inh_v50 on; the first run (inh_v100) used AI 1 and lost nothing.
    out.push(dude(635, "Jam Target InhJam", 3, 364, 732));
    out.push(...tgt(986, "Kit J InhJam100", 9027, 2100, 635));
    out.push(...discShip(762, "AI Tank Disc", 1977, DISC_COLOURS.yellow, {
        armor: 30000, shield: 1000, accel: 300, speed: 300, turn: 30, mass: 50, freeMass: 100, cargo: 10,
        weapons: [367, -1, -1, -1], weaponCounts: [2, 0, 0, 0], weaponAmmo: [0, 0, 0, 0], ai: 1, strength: 50, crew: 10, flags: 0, flags2: 0,
    }));
    out.push(dude(636, "AI Tank 2", 2, 363, 762), dude(637, "AI Tank 3 retreat", 3, 383, 762), dude(638, "AI Tank 3", 3, 363, 762));
    [[987, 9028, 636], [988, 9029, 637], [989, 9030, 638]].forEach(([id, bit, d]) =>
        out.push(...misn(id, `Kit AI tank ${d}`, bit, { shipCount: 1, shipDude: d, shipGoal: -1, shipBehav: -1, shipStart: -1 })));
    out.push(...ship(763, "Kit Lancer Heavy", 135, { accel: 2000, speed: 800, turn: 60, armor: 30000, shield: 30000, shieldRecharge: 0, armorRecharge: 0, mass: 50, freeMass: 1000, cargo: 200, maxGuns: 16, maxTurrets: 16, ai: 3, strength: 100, flags: 0, flags2: 0x00C8 }));
    out.push(...discShip(764, "Kit Disc Blue Armed", 1978, DISC_COLOURS.blue, {
        accel: 600, speed: 600, turn: 60, armor: 4000, shield: 4000, mass: 50, freeMass: 100, cargo: 10,
        weapons: [365, -1, -1, -1], weaponCounts: [2, 0, 0, 0], weaponAmmo: [0, 0, 0, 0],
        ai: 3, strength: 100, crew: 20, flags: 0, flags2: 0, escortType: 2, cost: 10000,
    }));
    const fight = system(2153, "Kit Fight Range", -1020, -620, 363, [2154]);
    fight.set = { ...fight.set, dudes: [612, ...none8.slice(1)], dudeProbs: [100, ...zero8.slice(1)], avgShips: 2 };
    out.push(fight, spob(2154, "Kit Fight Port", 0, 0, 138, { flags: 0x43 }));
    out.push({
        type: "flët", id: 300, name: "Kit Disc Fleet 2", clone: "flët:128",
        set: {
            "@0:i16": 720, "@2:i16x4": [721, 722, 723, 724], "@10:i16x4": [1, 1, 1, 1], "@18:i16x4": [1, 1, 1, 1],
            "@26:i16": 363, "@28:i16": 2128, "@30:str256": "", "@286:i16": -1, "@288:u16": 0,
        },
    });
    out.push(...ship(765, "Kit Prize", 136, { armor: 300, shield: 0, accel: 0, speed: 0, turn: 0, ai: 1, strength: 1, crew: 1, cost: 50000 }));
    const prize = dude(639, "Kit Prize", 1, 363, 765);
    prize.set = { ...prize.set, flags: 0x0041 };
    out.push(prize, ...misn(990, "Kit U9 prize", 9031, { shipCount: 1, shipDude: 639, shipGoal: -1, shipBehav: -1, shipStart: -1 }));
    [[2154, "Map B Inhab", -800, 280, true], [2155, "Map B Empty", -700, 280, false], [2156, "Map B Unland", -600, 280, "unlandable"]]
        .forEach(([id, name, x, y, port]) => {
            out.push(system(id, name, x, y, 380, port ? [id + 1] : []));
            if (port) out.push(spob(id + 1, `${name} Port`, 0, 0, 138, { flags: port === "unlandable" ? 0x02 : 0x43 }));
        });
    return out;
}

/**
 * Wave-2 experiments (docs/reference_experiments.md):
 *
 *  U3  oütf 611 Kit Speed Mod (ModType 8, +300), 612 Kit Accel Mod (7, +300),
 *      613 Kit Turn Mod (9, +100).
 *  U9  gövt 378 Kit Derelict Govt (flags 0x0800: ships start disabled);
 *      shïp 714 Kit Derelict; düde 610; mïsn 970 (bit 9011) puts one at
 *      Kit Port (ShipStart -1). shïp 715-718 Kit Crawler 50/100/150/200:
 *      inertialess player hulls of known top speed for the boarding gate.
 *  F1n sÿst 2128 Kit Fleet Range (govt 363). Wave 2's flët 1000 never
 *      spawned and was removed in wave 3 (see wave3Resources, flët 300).
 *  K9  sÿst 2129 Kit IFF Range (owner 370): AI 1 green discs (722) and AI 3
 *      red warships (730) of always-hostile govt 362; AI 1 blue discs (723)
 *      and AI 3 magenta discs (725, armed) of 370, hostile by record.
 *  E   oütf 614 Kit Fighter Bay (wëap 366 launches Kit Fighter 705) and
 *      615 its ammo (a fighter).
 */
/**
 * M1-M7: a linked map region around sÿst 2140 Map Hub at (-700, 400), far
 * from the stock map (x -358..587, y -330..300) and the other kit systems.
 *
 *   id    name        pos          owner              links
 *   2140  Map Hub     (-700, 400)  379 Major Red      2144 2142 2145 2141 2143 (link order differs from id order, M7)
 *   2141  Map South   (-700, 460)  379 Major Red      2140   (90 deg, 60)
 *   2142  Map NE      (-675, 357)  380 Major Blue     2140 2144? no: 2140 (300 deg, ~50)
 *   2143  Map East    (-660, 400)  380 Major Blue     2140 2146 (0 deg, 40)  unlandable stellar
 *   2144  Map SW      (-750, 450)  380 Major Blue     2140   (135 deg, ~71)
 *   2145  Map WSW     (-728, 390)  381 Minor Green    2140   (200 deg, ~30)  gövt Flags2 0x0002
 *   2146  Map Void    (-620, 400)  379 Major Red      2143 2147 no stellar (uninhabited)
 *   2147  Map Far     (-580, 400)  382 Borderless     2146 2148  gövt Flags2 0x0004
 *   2148  Map Island  (-580, 440)  379 Major Red      2147
 *   2149  Map Lone    (-640, 470)  379 Major Red      none (an explored, unlinked system)
 * Angles are screen angles (0 = east, 90 = south, y down). Ids are
 * deliberately not in angle or distance order (M7 Tab cycling).
 */
function mapRegion() {
    const out = [];
    out.push(govt(379, "Map Major Red", { color: 0xff0000 }));
    out.push(govt(380, "Map Major Blue", { color: 0x0000ff }));
    out.push(govt(381, "Map Minor Green", { color: 0x00ff00, flags2: 0x0002 }));
    out.push(govt(382, "Map Borderless", { color: 0xffff00, flags2: 0x0004 }));
    const sys = [
        [2140, "Map Hub", -700, 400, 379, [2144, 2142, 2145, 2141, 2143], true],
        [2141, "Map South", -700, 460, 379, [2140], true],
        [2142, "Map NE", -675, 357, 380, [2140], true],
        [2143, "Map East", -660, 400, 380, [2140, 2146], "unlandable"],
        [2144, "Map SW", -750, 450, 380, [2140], true],
        [2145, "Map WSW", -728, 390, 381, [2140], true],
        [2146, "Map Void", -620, 400, 379, [2143, 2147], false],
        [2147, "Map Far", -580, 400, 382, [2146, 2148], true],
        [2148, "Map Island", -580, 440, 379, [2147], true],
        [2149, "Map Lone", -640, 470, 379, [], true],
    ];
    for (const [id, name, x, y, g, links, port] of sys) {
        const s = system(id, name, x, y, g, port ? [id] : []);
        s.set = { ...s.set, links: [...links, ...none16].slice(0, 16) };
        out.push(s);
        // spöb 2140-2149 (spöb ids 2140+ are free; sÿst-less ids skip).
        if (port) out.push(spob(id, `${name} Port`, 0, 0, 138, { flags: port === "unlandable" ? 0x02 : 0x43 }));
    }
    return out;
}

/**
 * Jamming (J-series). Guided missiles (Speed 600, 10 s life, reload 15
 * frames, 1 damage, GuidedTurn 60) that differ only in JamVuln1 and Seeker:
 *   wëap 375 JamM V100 (vuln 100)      376 JamM V50 (vuln 50)
 *        377 JamM TurnAway (0x0010, vuln 100)
 *        378 JamM Parent (0x8000, vuln 100)
 *        379 JamM Decoy (0x0002, vuln 0)   380 JamM Plain (vuln 0)
 *        381 JamM Pass (0x0001, vuln 0)
 *   oütf 616-622 the launchers for 375-381; 623 Kit Jammer 25 (ModType 33,
 *        +25 type-1 jamming).
 *   shïp 732-736 Jam Target J0/J25/J50/J75/J100: immobile, shield 0, armor
 *        100 (one hit = 1% on the target panel), carrying 0-4 Kit Jammer 25.
 *   mïsn 971-975 (bits 9012-9016) put one at Kit Port (ShipStart -1).
 *   sÿst 2132 Kit Rock Range (16 asteroids, spöb 2132 Kit Rock Port);
 *        mïsn 976 (bit 9017, offered at Kit Rock Port) puts a J0 target there.
 */
function jammingKit() {
    const out = [];
    const jm = (id, name, vuln, seeker) => weap(id, name, 134, {
        reload: 15, duration: 300, armorDamage: 1, shieldDamage: 1, guidance: 1, speed: 600, guidedTurn: 60,
        seekerFlags: seeker, jamVuln: [vuln, 0, 0, 0], proxRadius: 25, blastRadius: 0, flags: 0x0002, // 0x0002: second trigger
    });
    out.push(jm(375, "JamM V100", 100, 0), jm(376, "JamM V50", 50, 0), jm(377, "JamM TurnAway", 100, 0x0010),
        // 378 (JamM Parent, 0x8000) and 380 (JamM Plain, vuln 0) were
        // retired in wave 4: they are now JamM Decoy V100 / JamM Pass V100
        // (wave4Rocks). Their launchers oütf 619/621 keep the ids.
        jm(379, "JamM Decoy", 0, 0x0002),
        jm(381, "JamM Pass", 0, 0x0001));
    for (let i = 0; i < 7; i++) out.push(gun(616 + i, `JamM Launcher ${375 + i}`, 375 + i));
    const jammer = gun(623, "Kit Jammer 25", 0);
    jammer.set = { ...jammer.set, modType: 33, modVal: 25, max: 8 };
    out.push(jammer);
    // Wave 3: Jam Target J75 (shïp 735, mïsn 974, bit 9015) was turned into
    // a "single" target carrying ONE jammer outfit (oütf 626) instead of
    // three Kit Jammer 25s, to test whether jammer outfits stack. Wave 2's
    // single v100_j75 run used the old hull. oütf 626 was +100 for the
    // runs single_v100 / single_v50 and +75 from single75_* on.
    const SINGLE_JAM = 75;
    const jammerSingle = gun(626, `Kit Jammer ${SINGLE_JAM}`, 0);
    jammerSingle.set = { ...jammerSingle.set, modType: 33, modVal: SINGLE_JAM, max: 8 };
    out.push(jammerSingle);
    for (let k = 0; k <= 4; k++) {
        const single = k === 3;
        const tname = single ? `Jam Target J${SINGLE_JAM} single` : `Jam Target J${25 * k}`;
        out.push(...ship(732 + k, tname, 136, {
            armor: 100, shield: 0, accel: 0, speed: 0, turn: 0, ai: 1, strength: 1, crew: 1,
            outfits: [single ? 626 : k ? 623 : -1, -1, -1, -1], outfitCounts: [single ? 1 : k, 0, 0, 0],
        }));
        out.push(dude(615 + k, tname, 1, 363, 732 + k));
        // ShipStart -2: at Kit Market, 900 px east of Kit Port, where the
        // player sits after taking off (a backed-off inertialess Lancer
        // keeps drifting and outruns its own missiles).
        out.push(...misn(971 + k, `Kit J target J${25 * k}`, 9012 + k, { shipCount: 1, shipDude: 615 + k, shipGoal: -1, shipBehav: -1, shipStart: -2 }));
    }
    const rock = system(2132, "Kit Rock Range", -900, -620, 363, [2132, 2134]);
    rock.set = { ...rock.set, asteroids: 16, asteroidTypes: 0xffff };
    out.push(rock, spob(2132, "Kit Rock Port", 0, 0, 138, { flags: 0x43 }),
        spob(2134, "Kit Rock Marker", 900, 0, 132, { flags: 0x20, techLevel: 0, specialTech: [-1, -1, -1] }));
    out.push(...misn(976, "Kit J rock target", 9017, { availStel: 2132, shipCount: 1, shipDude: 615, shipGoal: -1, shipBehav: -1, shipStart: -2 }));
    return out;
}

/**
 * AI states (A-series): one neutral (govt 363) subject per AI type, armed
 * with two Kit Raider Guns (20 dmg), spawned beside Kit Port by mïsn
 * 977-980 (bits 9018-9021) for AI 1-4; mïsn 981 (bit 9022) spawns an AI 3
 * subject of gövt 383 Kit Retreat Govt (flags 0x0010: warships retreat
 * below 25% shield). shïp 737 AI Subject (clone of the Kit Raider hull,
 * 1000/1000 shield/armor, Speed 300).
 */
function aiKit() {
    const out = [];
    out.push(govt(383, "Kit Retreat Govt", { flags: 0x0010 }));
    out.push(...ship(737, "AI Subject", 149, {
        armor: 1000, shield: 1000, accel: 300, speed: 300, turn: 30,
        weapons: [367, -1, -1, -1], weaponCounts: [2, 0, 0, 0], weaponAmmo: [0, 0, 0, 0], ai: 1, strength: 50, crew: 10,
    }));
    // A trackable version (yellow 24 px disc, same stats) for recordings.
    out.push(...discShip(760, "AI Subject Disc", 1999, DISC_COLOURS.yellow, {
        armor: 1000, shield: 1000, accel: 300, speed: 300, turn: 30, mass: 50, freeMass: 100, cargo: 10,
        weapons: [367, -1, -1, -1], weaponCounts: [2, 0, 0, 0], weaponAmmo: [0, 0, 0, 0], ai: 1, strength: 50, crew: 10, flags: 0, flags2: 0,
    }));
    for (let ai = 1; ai <= 4; ai++) {
        out.push(dude(629 + ai, `AI Subject ${ai}`, ai, 363, 760));
        out.push(...misn(976 + ai, `Kit AI ${ai} subject`, 9017 + ai, { shipCount: 1, shipDude: 629 + ai, shipGoal: -1, shipBehav: -1, shipStart: -1 }));
    }
    out.push(dude(634, "AI Subject 3 retreat", 3, 383, 760));
    out.push(...misn(981, "Kit AI 3 retreat subject", 9022, { shipCount: 1, shipDude: 634, shipGoal: -1, shipBehav: -1, shipStart: -1 }));
    return out;
}

function wave2Resources() {
    const out = [];
    const mod = (id, name, modType, modVal) => {
        const o = gun(id, name, 0);
        o.set = { ...o.set, modType, modVal };
        return o;
    };
    out.push(mod(611, "Kit Speed Mod", 8, 300), mod(612, "Kit Accel Mod", 7, 300), mod(613, "Kit Turn Mod", 9, 100));

    out.push(govt(378, "Kit Derelict Govt", { flags: 0x0800 }));
    out.push(...ship(714, "Kit Derelict", 138, { armor: 1000, shield: 1000, ai: 1, strength: 10, crew: 10 }));
    // düde 610 / mïsn 970 (the wave-2 U9 derelict) were retired in wave 4.
    [50, 100, 150, 200].forEach((sp, i) => out.push(...ship(715 + i, `Kit Crawler ${sp}`, 135, {
        accel: 2000, speed: sp, turn: 30, armor: 3000, shield: 3000, shieldRecharge: 0, mass: 50, freeMass: 1000,
        cargo: 50, maxGuns: 8, maxTurrets: 8, ai: 3, strength: 50, flags: 0, flags2: 0x00C8,
    })));

    // avgShips 6 and no dudes: the only traffic is the fleet (a first try
    // with avgShips 0 never spawned it). 2133 Kit Fleet Gate is linked, so
    // a pilot can also jump in and have the system populated on arrival.
    const fleetRange = system(2128, "Kit Fleet Range", -900, -700, 363, [2128, 2130]);
    // Wave 3: sÿst DudeTypes name fleets as -128..-383 (Bible), so the
    // system now places flët 300 (wave3Resources). Wave 2's flët 1000 is
    // gone: its id is past Max Fleets (256, ids 128-383) and it never spawned.
    fleetRange.set = { ...fleetRange.set, avgShips: 6, links: [2133, ...none16.slice(1)],
        dudes: [-300, ...none8.slice(1)], dudeProbs: [100, ...zero8.slice(1)] };
    const fleetGate = system(2133, "Kit Fleet Gate", -880, -700, 363, [2133]);
    fleetGate.set = { ...fleetGate.set, links: [2128, ...none16.slice(1)] };
    out.push(fleetRange, fleetGate, spob(2133, "Kit Fleet Gate Port", 0, 0, 138, { flags: 0x43 }));
    out.push(spob(2128, "Kit Fleet Port", 0, 0, 138, { flags: 0x43 }));
    out.push(spob(2130, "Kit Fleet Market", 1200, 0, 138, { flags: 0x43 }));

    out.push(system(2129, "Kit IFF Range", -900, -660, 370, [2131]));
    out.push(spob(2131, "Kit IFF Port", 0, 0, 138, { flags: 0x43 }));
    out.push(dude(611, "Kit K9 hostile-govt traders", 1, 362, 722));
    out.push(dude(612, "Kit K9 hostile-govt warships", 3, 362, 730));
    // düde 613/614 (the AI 1 and AI 3 record-hostile K9 ships of govt 370)
    // were retired in wave 4 (wave4Brackets); Kit IFF Range now spawns only
    // the 362 ships, 611 and 612.
    out.push(...discShip(731, "Kit Disc Magenta Armed", 1981, DISC_COLOURS.magenta, {
        accel: 400, speed: 400, turn: 40, armor: 2000, shield: 2000, mass: 50, freeMass: 100, cargo: 10,
        weapons: [374, -1, -1, -1], weaponCounts: [2, 0, 0, 0], weaponAmmo: [0, 0, 0, 0],
        ai: 3, strength: 50, crew: 10, flags: 0, flags2: 0,
    }));
    const k9 = out.find((r) => r.type === "sÿst" && r.id === 2129);
    k9.set = { ...k9.set, dudes: [611, 612, -1, -1, -1, -1, -1, -1], dudeProbs: [50, 50, 0, 0, 0, 0, 0, 0], avgShips: 6 };

    // F1b: does the escort slot spacing scale with hull size? 96 px discs:
    // shïp 740 Kit Big Leader (white, like 720), 741-744 Kit Big Red/Green/
    // Blue/Yellow (like 721-724); 745 Kit Long Leader = 720 with shïp
    // Length 200 (sprite unchanged).
    out.push(...discShip(740, "Kit Big Leader", 1982, DISC_COLOURS.white, { accel: 300, speed: 300, turn: 30, armor: 30000, shield: 30000, mass: 50, freeMass: 500, cargo: 50, maxGuns: 8, maxTurrets: 8, ai: 3, strength: 100, flags: 0, flags2: 0 }, 96));
    ["red", "green", "blue", "yellow"].forEach((c, i) => out.push(...discShip(741 + i, `Kit Big ${c[0].toUpperCase()}${c.slice(1)}`, 1983 + i, DISC_COLOURS[c],
        { accel: 600, speed: 600, turn: 60, armor: 30000, shield: 30000, mass: 50, freeMass: 100, cargo: 10, ai: 3, strength: 50, flags: 0, flags2: 0, cost: 10000 }, 96)));
    out.push(...discShip(745, "Kit Long Leader", 1987, DISC_COLOURS.white, { accel: 300, speed: 300, turn: 30, armor: 30000, shield: 30000, mass: 50, freeMass: 500, cargo: 50, maxGuns: 8, maxTurrets: 8, ai: 3, strength: 100, flags: 0, flags2: 0, length: 200 }));
    // F1b follow-up: two more leader sizes (48, 160 px) to fit the formula.
    out.push(...discShip(746, "Kit Mid Leader", 1988, DISC_COLOURS.white, { accel: 300, speed: 300, turn: 30, armor: 30000, shield: 30000, mass: 50, freeMass: 500, cargo: 50, maxGuns: 8, maxTurrets: 8, ai: 3, strength: 100, flags: 0, flags2: 0 }, 48));
    out.push(...discShip(747, "Kit Huge Leader", 1989, DISC_COLOURS.white, { accel: 300, speed: 300, turn: 30, armor: 30000, shield: 30000, mass: 50, freeMass: 500, cargo: 50, maxGuns: 8, maxTurrets: 8, ai: 3, strength: 100, flags: 0, flags2: 0 }, 160));
    // 748: a 12 px leader; 749: a 24 px disc drawn inside a 96 px frame
    // (frame size vs visible size).
    const leaderSet = { accel: 300, speed: 300, turn: 30, armor: 30000, shield: 30000, mass: 50, freeMass: 500, cargo: 50, maxGuns: 8, maxTurrets: 8, ai: 3, strength: 100, flags: 0, flags2: 0 };
    out.push(...discShip(748, "Kit Tiny Leader", 1990, DISC_COLOURS.white, leaderSet, 12, 10));
    out.push(...discShip(749, "Kit Framed Leader", 1991, DISC_COLOURS.white, leaderSet, 96, 22));
    // Size sweep: 750-755 leaders of 36, 64, 72, 112, 128, 200 px.
    [36, 64, 72, 112, 128, 200].forEach((s, i) =>
        out.push(...discShip(750 + i, `Kit Leader ${s}`, 1992 + i, DISC_COLOURS.white, leaderSet, s)));
    // Escort command view: one hull per shïp EscortType (0 fighter, 1
    // medium, 2 warship, 3 freighter), cloned from the Kit Escort.
    ["Fighter", "Medium", "Warship", "Freighter"].forEach((n, i) => out.push(...ship(756 + i, `Esc ${n}`, 163, {
        armor: 4000, shield: 4000, accel: 600, speed: 330, turn: 70, weapons: [365, -1, -1, -1], weaponCounts: [2, 0, 0, 0],
        weaponAmmo: [0, 0, 0, 0], ai: 3, strength: 100, crew: 20, escortType: i, cost: 10000,
    })));
    out.push(...mapRegion());
    out.push(...jammingKit());
    out.push(...aiKit());

    out.push(gun(614, "Kit Fighter Bay", 366));
    out.push({ type: "oütf", id: 615, name: "Kit Fighter", clone: "oütf:130", set: { ...gun(615, "Kit Fighter", 366).set, modType: 3, modVal: 366, max: 8 } });
    return out;
}

/**
 * A14: which legal record decides an NPC's hostility to the player? One
 * system per matrix cell, each spawning only warships (red disc hulls,
 * AI 3, a weak 5-damage turret) of ONE government via sÿst dudes. The
 * pilot starts beside the system's only stellar with legal records set
 * per system (EV Nova keeps them per sÿst). See docs/reference_experiments.md.
 *
 *  gövt 370 Owner   class 70, allied with class 71, CrimeTol 10
 *  gövt 371 Ally    class 71, allied with class 70, CrimeTol 10
 *  gövt 372 Unrel   no relations, CrimeTol 10
 *  gövt 373 Nosy    flags 0x0002, CrimeTol 10
 *  gövt 374 AllyHi  class 71, allied with class 70, CrimeTol 10000
 *  gövt 375 NosyHi  flags 0x0002, CrimeTol 10000
 *  gövt 376 OwnerHi class 73, allied with class 74, CrimeTol 10000
 *  gövt 377 AllyLo  class 74, allied with class 73, CrimeTol 10
 *  sÿst 2110 own (370 ships, owner 370)    2111 own2 (owner 370, empty)
 *       2112 ally (371 in 370's)  2113 unrel (372 in 370's)  2114 nosy (373 in 370's)
 *       2115 allyHi (374 in 370's)  2116 nosyHi (375 in 370's)
 *       2117 indep-unrel (372, no owner)  2118 indep-nosy (373, no owner)
 *       2119 hiOwner-allyLo (377 in 376's)  2120 hiOwner-self (376 in 376's)
 *       2121-2125 empty homes of 371, 372, 373, 374, 375
 *       2126 interceptors (AI 4) of 372 in 370's; 2127 AI 4 of 373 in 370's
 *  spöb 2110-2127 one landable stellar at (0,0) in each.
 */
function a14Resources() {
    const out = [];
    const g = (id, name, set) => out.push(govt(id, name, { maxOdds: 1000, crimeTol: 10, ...set }));
    g(370, "A14 Owner", { classes: [70, -1, -1, -1], allies: [71, -1, -1, -1] });
    g(371, "A14 Ally", { classes: [71, -1, -1, -1], allies: [70, -1, -1, -1] });
    g(372, "A14 Unrel", { classes: [72, -1, -1, -1] });
    g(373, "A14 Nosy", { classes: [75, -1, -1, -1], flags: 0x0002 });
    g(374, "A14 AllyHi", { classes: [71, -1, -1, -1], allies: [70, -1, -1, -1], crimeTol: 10000 });
    g(375, "A14 NosyHi", { classes: [76, -1, -1, -1], flags: 0x0002, crimeTol: 10000 });
    g(376, "A14 OwnerHi", { classes: [73, -1, -1, -1], allies: [74, -1, -1, -1], crimeTol: 10000 });
    g(377, "A14 AllyLo", { classes: [74, -1, -1, -1], allies: [73, -1, -1, -1] });
    // Weak turret so a hostile pass is visible on the player's shield bar
    // without killing it inside a minute.
    out.push(weap(374, "A14 Gun", 131, { reload: 20, duration: 60, armorDamage: 5, shieldDamage: 5, guidance: 4 }));
    out.push(...discShip(730, "A14 Warship", 1980, DISC_COLOURS.red, {
        accel: 400, speed: 400, turn: 40, armor: 2000, shield: 2000, mass: 50, freeMass: 100, cargo: 10,
        weapons: [374, -1, -1, -1], weaponCounts: [2, 0, 0, 0], weaponAmmo: [0, 0, 0, 0],
        ai: 3, strength: 50, crew: 10, flags: 0, flags2: 0,
    }));
    const dudes = [[620, 370], [621, 371], [622, 372], [623, 373], [624, 374], [625, 375], [626, 376], [627, 377]];
    for (const [id, gid] of dudes) out.push(dude(id, `A14 Warships ${gid}`, 3, gid, 730));
    out.push(dude(628, "A14 Interceptors 372", 4, 372, 730));
    out.push(dude(629, "A14 Interceptors 373", 4, 373, 730));
    const cell = (sid, name, owner, dudeId) => {
        const s = system(sid, name, -900 + (sid - 2110) * 30, -900, owner, [sid]);
        if (dudeId) s.set = { ...s.set, dudes: [dudeId, ...none8.slice(1)], dudeProbs: [100, ...zero8.slice(1)], avgShips: 2 };
        out.push(s, spob(sid, `${name} Port`, 0, 0, 138, { flags: 0x43 }));
    };
    cell(2110, "A14 Own", 370, 620);
    cell(2111, "A14 Own2", 370, null);
    cell(2112, "A14 Ally", 370, 621);
    cell(2113, "A14 Unrel", 370, 622);
    cell(2114, "A14 Nosy", 370, 623);
    cell(2115, "A14 AllyHi", 370, 624);
    cell(2116, "A14 NosyHi", 370, 625);
    cell(2117, "A14 IndepUnrel", -1, 622);
    cell(2118, "A14 IndepNosy", -1, 623);
    cell(2119, "A14 HiOwnAllyLo", 376, 627);
    cell(2120, "A14 HiOwnSelf", 376, 626);
    cell(2121, "A14 AllyHome", 371, null);
    cell(2122, "A14 UnrelHome", 372, null);
    cell(2123, "A14 NosyHome", 373, null);
    cell(2124, "A14 AllyHiHome", 374, null);
    cell(2125, "A14 NosyHiHome", 375, null);
    cell(2126, "A14 UnrelIcpt", 370, 628);
    cell(2127, "A14 NosyIcpt", 370, 629);
    return out;
}

/**
 * Wave-4 jamming leftovers. Retired for it: wëap 362-364 (#316b missiles),
 * düde 603-606 and 610 with mïsn 962, 963, 965, 966, 970 (Q2b/Q3/Q2c,
 * #316b target practice, the wave-2 derelict).
 *
 *  wëap 362/363/364 JamM V100 T2/T3/T4: wëap 375 (JamM V100) with JamVuln
 *       100 in jamming type 2/3/4 instead of type 1; oütf 602-604 launch them.
 *  oütf 627/628/629 Kit Jammer T2/T3/T4: ONE outfit, +100 jamming of type
 *       2/3/4 (ModType 34/35/36).
 *  shïp 773/774/775 Jam Target T2/T3/T4: the J0 target (immobile, armor
 *       100) carrying one of those jammers. düde 604/606/610 (AI 1, govt
 *       363); mïsn 963/966/970 (bits 9004/9007/9011) put one at Kit Market.
 *  InhJam on the other AI types: düde 603 (AI 2) and 605 (AI 4) are the J0
 *  target hull of gövt 364 (InhJam1 100); mïsn 962/965 (bits 9003/9006) put
 *  one at Kit Market. Wave 3 did AI 1 and AI 3 (mïsn 986).
 */
function jamWave4() {
    const out = [];
    [2, 3, 4].forEach((k, i) => {
        const vuln = [0, 0, 0, 0];
        vuln[k - 1] = 100;
        out.push(weap(362 + i, `JamM V100 T${k}`, 134, {
            reload: 15, duration: 300, armorDamage: 1, shieldDamage: 1, guidance: 1, speed: 600, guidedTurn: 60,
            seekerFlags: 0, jamVuln: vuln, proxRadius: 25, blastRadius: 0, flags: 0x0002,
        }));
        out.push(gun(602 + i, `JamM Launcher T${k}`, 362 + i));
        const jammer = gun(627 + i, `Kit Jammer T${k}`, 0);
        jammer.set = { ...jammer.set, modType: 32 + k, modVal: 100, max: 8 };
        out.push(jammer);
        out.push(...ship(773 + i, `Jam Target T${k}`, 136, {
            armor: 100, shield: 0, accel: 0, speed: 0, turn: 0, ai: 1, strength: 1, crew: 1,
            outfits: [627 + i, -1, -1, -1], outfitCounts: [1, 0, 0, 0],
        }));
        const [dudeId, misnId, bit] = [[604, 963, 9004], [606, 966, 9007], [610, 970, 9011]][i];
        out.push(dude(dudeId, `Jam Target T${k}`, 1, 363, 773 + i));
        out.push(...misn(misnId, `Kit J T${k} target`, bit, { shipCount: 1, shipDude: dudeId, shipGoal: -1, shipBehav: -1, shipStart: -2 }));
    });
    [[603, 2, 962, 9003], [605, 4, 965, 9006]].forEach(([dudeId, ai, misnId, bit]) => {
        out.push(dude(dudeId, `Jam Target InhJam AI ${ai}`, ai, 364, 732));
        out.push(...misn(misnId, `Kit J InhJam AI ${ai}`, bit, { shipCount: 1, shipDude: dudeId, shipGoal: -1, shipBehav: -1, shipStart: -2 }));
    });
    return out;
}

/**
 * Wave-4 asteroid tests (hub priority 2): seeker 0x0002 "decoyed by
 * asteroids" and 0x0001 "passes over asteroids" with and without jamming.
 *
 *  wëap 378 JamM Decoy V100 (Seeker 0x0002, JamVuln1 100), 380 JamM Pass
 *       V100 (0x0001, JamVuln1 100); oütf 619/621 launch them. wëap 379
 *       (JamM Decoy, vuln 0) is the no-jamming decoy missile.
 *  oütf 630/631 Kit Jammer 50/100: ONE outfit of +50/+100 type-1 jamming
 *       (stacked outfits don't add up, wave 3).
 *  shïp 776/777 Jam Target S50/S100: the J0 target with one of those.
 *       düde 607/608 (AI 1, govt 363); mïsn 967/968 (bits 9008/9009) put
 *       one on Kit Rock Marker (900 px) in sÿst 2132 Kit Rock Range (16
 *       asteroids), where mïsn 976 (bit 9017) puts the J0 target.
 *  sÿst 2170 Kit Rock Range 4: the same with 4 asteroids (spöb 2170 port,
 *       2171 marker at 900,0); mïsn 992 (bit 9033) puts the J0 target there.
 */
function wave4Rocks() {
    const out = [];
    const jm = (id, name, seeker) => weap(id, name, 134, {
        reload: 15, duration: 300, armorDamage: 1, shieldDamage: 1, guidance: 1, speed: 600, guidedTurn: 60,
        seekerFlags: seeker, jamVuln: [100, 0, 0, 0], proxRadius: 25, blastRadius: 0, flags: 0x0002,
    });
    out.push(jm(378, "JamM Decoy V100", 0x0002), jm(380, "JamM Pass V100", 0x0001));
    [[630, 50, 776, 607, 967, 9008], [631, 100, 777, 608, 968, 9009]].forEach(([oid, j, sid, did, mid, bit]) => {
        const jammer = gun(oid, `Kit Jammer ${j}`, 0);
        jammer.set = { ...jammer.set, modType: 33, modVal: j, max: 8 };
        out.push(jammer);
        out.push(...ship(sid, `Jam Target S${j}`, 136, {
            armor: 100, shield: 0, accel: 0, speed: 0, turn: 0, ai: 1, strength: 1, crew: 1,
            outfits: [oid, -1, -1, -1], outfitCounts: [1, 0, 0, 0],
        }));
        out.push(dude(did, `Jam Target S${j}`, 1, 363, sid));
        out.push(...misn(mid, `Kit rock S${j} target`, bit, { availStel: 2132, shipCount: 1, shipDude: did, shipGoal: -1, shipBehav: -1, shipStart: -2 }));
    });
    const rock4 = system(2170, "Kit Rock Range 4", -1110, -650, 363, [2170, 2171]);
    rock4.set = { ...rock4.set, asteroids: 4, asteroidTypes: 0xffff };
    out.push(rock4, spob(2170, "Kit Rock4 Port", 0, 0, 138, { flags: 0x43 }),
        spob(2171, "Kit Rock4 Marker", 900, 0, 132, { flags: 0x20, techLevel: 0, specialTech: [-1, -1, -1] }));
    out.push(...misn(992, "Kit rock4 J0 target", 9033, { availStel: 2170, shipCount: 1, shipDude: 615, shipGoal: -1, shipBehav: -1, shipStart: -2 }));
    return out;
}

/**
 * Wave-4 K9 follow-up: bracket colours of AI 2 and AI 4 ships. Each is the
 * armed yellow AI Subject Disc (shïp 760: two Kit Raider Guns, 1000/1000),
 * put at Kit Port (ShipStart -1) by a mission offered on landing there:
 *   düde 609 AI 2, gövt 362 (always attacks the player)  mïsn 993, bit 9034
 *   düde 613 AI 4, gövt 362                               mïsn 994, bit 9035
 *   düde 614 AI 4, gövt 360 (Kit Range's owner: hostile when the pilot has
 *            a -500 record in sÿst 2100)                    mïsn 995, bit 9036
 * The non-hostile AI 4 control is the wave-2 AI 4 subject (düde 633, gövt
 * 363, mïsn 980, bit 9021).
 */
function wave4Brackets() {
    const out = [];
    [[609, 2, 362, 993, 9034], [613, 4, 362, 994, 9035], [614, 4, 360, 995, 9036]].forEach(([did, ai, g, mid, bit]) => {
        out.push(dude(did, `K9b AI ${ai} govt ${g}`, ai, g, 760));
        out.push(...misn(mid, `Kit K9b AI ${ai} govt ${g}`, bit, { shipCount: 1, shipDude: did, shipGoal: -1, shipBehav: -1, shipStart: -1 }));
    });
    return out;
}
