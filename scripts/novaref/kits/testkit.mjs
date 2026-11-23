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
        weap(362, "Kit Missile T10", 134, { reload: 90, duration: 600, armorDamage: 1, shieldDamage: 1, guidance: 1, speed: 600, guidedTurn: 10 }),
        weap(363, "Kit Missile T30", 134, { reload: 90, duration: 600, armorDamage: 1, shieldDamage: 1, guidance: 1, speed: 600, guidedTurn: 30 }),
        weap(364, "Kit Missile T60", 134, { reload: 90, duration: 600, armorDamage: 1, shieldDamage: 1, guidance: 1, speed: 600, guidedTurn: 60 }),
        weap(365, "Kit Escort Gun", 131, { reload: 20, duration: 60, armorDamage: 30, shieldDamage: 30, guidance: 4 }),
        // Fighter bay: AmmoType of a bay is the carried shïp id - 128.
        weap(366, "Kit Fighter Bay", 149, { reload: 30, guidance: 99, ammoType: 705 - 128 }),
        weap(367, "Kit Raider Gun", 130, { reload: 20, duration: 60, armorDamage: 20, shieldDamage: 20, guidance: 4 }),
        // Unguided shots with round speeds for the speed-unit check (#316):
        // wëap Speed is documented as "100 = 1 pixel per frame".
        weap(368, "Kit Speed Gun 300", 128, { reload: 60, duration: 300, armorDamage: 1, shieldDamage: 1, guidance: -1, speed: 300 }),
        weap(369, "Kit Speed Gun 600", 128, { reload: 60, duration: 150, armorDamage: 1, shieldDamage: 1, guidance: -1, speed: 600 }),

        // --- Outfits (player weapons).
        gun(600, "Kit Beam Turret", 360),
        gun(601, "Kit Tickler", 361),
        gun(602, "Kit Missile T10", 362),
        gun(603, "Kit Missile T30", 363),
        gun(604, "Kit Missile T60", 364),
        gun(605, "Kit Speed Gun 300", 368),
        gun(606, "Kit Speed Gun 600", 369),
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
        dude(603, "Kit Traders", 1, 361, 708),
        dude(604, "Kit Own-Govt Raiders", 3, 360, 707),
        dude(605, "Kit Target", 1, 363, 709),
        dude(606, "Kit Hostile Traders", 1, 362, 708),

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
        ...misn(962, "Kit Q2b escort vs traders", 9003, { shipCount: 1, shipDude: 600, shipGoal: 3, shipBehav: 1, shipStart: -1, auxShipCount: 2, auxShipDude: 603, auxShipSyst: -1 }),
        ...misn(963, "Kit Q3 escort vs own govt", 9004, { shipCount: 1, shipDude: 600, shipGoal: 3, shipBehav: 1, shipStart: -1, auxShipCount: 2, auxShipDude: 604, auxShipSyst: -1 }),
        ...misn(964, "Kit Q4 carrier vs raiders", 9005, { shipCount: 1, shipDude: 601, shipGoal: 3, shipBehav: 1, shipStart: -1, auxShipCount: 2, auxShipDude: 602, auxShipSyst: -1 }),
        // A plain target ship for weapon tests.
        // The target appears on nav default 2 (Kit Market, 900 px east of Kit Port).
        ...misn(965, "Kit target practice", 9006, { shipCount: 1, shipDude: 605, shipGoal: -1, shipBehav: -1, shipStart: -2 }),
        // Q2c: escort + wimpy traders of the always-attacks-player govt 362
        // (hostile to the player by govt, but AI 1 never attacks).
        ...misn(966, "Kit Q2c escort vs hostile traders", 9007, { shipCount: 1, shipDude: 600, shipGoal: 3, shipBehav: 1, shipStart: -1, auxShipCount: 2, auxShipDude: 606, auxShipSyst: -1 }),
        // Q4b: the STOCK Fed Carrier (stock bays and Vipers) as the escort.
        ...misn(967, "Kit Q4b fed carrier vs raiders", 9008, { shipCount: 1, shipDude: 607, shipGoal: 3, shipBehav: 1, shipStart: -1, auxShipCount: 2, auxShipDude: 602, auxShipSyst: -1 }),
        // B: an NPC carrier (neutral govt 363) whose fighters drop the 1-frame blast bomb.
        ...misn(968, "Kit B bomb carrier", 9009, { shipCount: 1, shipDude: 608, shipGoal: -1, shipBehav: -1, shipStart: -1 }),

        // --- Blast-damage kit (does a blast hurt its firer's parent?):
        // the bomb detonates at the end of a 2-frame life (wëap flag 0x8000)
        // with a 300 px blast, i.e. right at the muzzle.
        weap(370, "Kit Blast Bomb", 134, { reload: 45, duration: 2, armorDamage: 50, shieldDamage: 50, guidance: -1, speed: 300, proxRadius: 0, blastRadius: 300, flags: 0x8000, guidedTurn: 0 }),
        // The AI only fires within range (Speed x Duration), so NPCs get a
        // ranged version: 180 px reach, proximity 30, 400 px blast.
        weap(372, "Kit Blast Shell", 134, { reload: 45, duration: 60, armorDamage: 50, shieldDamage: 50, guidance: -1, speed: 300, proxRadius: 30, blastRadius: 400, flags: 0x8000, guidedTurn: 0 }),
        weap(371, "Kit Bomber Bay", 149, { reload: 30, guidance: 99, ammoType: 711 - 128 }),
        gun(608, "Kit Bomber Bay", 371),
        gun(609, "Kit Blast Bomb", 370),
        // B4: the same muzzle blast at 2000 damage, to destroy one's own escort.
        weap(373, "Kit Big Blast", 134, { reload: 45, duration: 2, armorDamage: 2000, shieldDamage: 2000, guidance: -1, speed: 300, proxRadius: 0, blastRadius: 300, flags: 0x8000, guidedTurn: 0 }),
        gun(610, "Kit Big Blast", 373),
        ...ship(711, "Kit Bomber", 167, { armor: 500, shield: 500, weapons: [372, -1, -1, -1], weaponCounts: [1, 0, 0, 0], weaponAmmo: [0, 0, 0, 0], ai: 3, strength: 20, crew: 1 }),
        ...ship(712, "Kit Bomb Carrier", 143, { armor: 3000, shield: 3000, weapons: [365, 371, -1, -1], weaponCounts: [2, 1, 0, 0], weaponAmmo: [0, 4, 0, 0], ai: 3, strength: 100, crew: 40 }),
        dude(607, "Kit Fed Carrier Escort", 3, 360, 143),
        dude(608, "Kit Bomb Carrier", 3, 363, 712),
        // Two always-attack-the-player raiders armed only with the blast bomb:
        // do their own/each other's blasts hurt them, and do they retaliate?
        ...ship(713, "Kit Bomb Raider", 149, { armor: 1500, shield: 1500, weapons: [372, -1, -1, -1], weaponCounts: [1, 0, 0, 0], weaponAmmo: [0, 0, 0, 0], ai: 3, strength: 80, crew: 15 }),
        dude(609, "Kit Bomb Raiders", 3, 362, 713),

        // --- Trackable disc hulls (formation and motion experiments).
        // 720 leader (white): Speed/Accel 300, Turn 30. 721-726 escorts
        // (red, green, blue, yellow, magenta, cyan): Speed/Accel 600, Turn 60.
        ...discShip(720, "Kit Disc Leader", 1970, DISC_COLOURS.white, { accel: 300, speed: 300, turn: 30, armor: 30000, shield: 30000, mass: 50, freeMass: 500, cargo: 50, maxGuns: 8, maxTurrets: 8, ai: 3, strength: 100, flags: 0, flags2: 0 }),
        ...["red", "green", "blue", "yellow", "magenta", "cyan"].flatMap((c, i) =>
            discShip(721 + i, `Kit Disc ${c[0].toUpperCase()}${c.slice(1)}`, 1971 + i, DISC_COLOURS[c], { accel: 600, speed: 600, turn: 60, armor: 30000, shield: 30000, mass: 50, freeMass: 100, cargo: 10, ai: 3, strength: 50, flags: 0, flags2: 0, cost: 10000 })),
        ...misn(969, "Kit B bomb raiders", 9010, { shipCount: -1, auxShipCount: 2, auxShipDude: 609, auxShipSyst: -1 }),

        ...a14Resources(),
        ...wave2Resources(),
        ...wave3Resources(),
    ],
};

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
    // AI 3 since 06:54 wave 3: the first run (inh_v100) used AI 1 and lost nothing.
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
        jm(378, "JamM Parent", 100, 0x8000), jm(379, "JamM Decoy", 0, 0x0002), jm(380, "JamM Plain", 0, 0),
        jm(381, "JamM Pass", 0, 0x0001));
    for (let i = 0; i < 7; i++) out.push(gun(616 + i, `JamM Launcher ${375 + i}`, 375 + i));
    const jammer = gun(623, "Kit Jammer 25", 0);
    jammer.set = { ...jammer.set, modType: 33, modVal: 25, max: 8 };
    out.push(jammer);
    // Wave 3: Jam Target J75 (shïp 735, mïsn 974, bit 9015) was turned into
    // "J100 single", carrying ONE Kit Jammer 100 (oütf 626, +100) instead
    // of three Kit Jammer 25s, to test whether jammer outfits stack. Wave 2's
    // single v100_j75 run used the old hull.
    const jammer100 = gun(626, "Kit Jammer 100", 0);
    jammer100.set = { ...jammer100.set, modType: 33, modVal: 100, max: 8 };
    out.push(jammer100);
    for (let k = 0; k <= 4; k++) {
        const single = k === 3;
        const tname = single ? "Jam Target J100 single" : `Jam Target J${25 * k}`;
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
    out.push(dude(610, "Kit Derelict", 1, 378, 714));
    out.push(...misn(970, "Kit U9 derelict", 9011, { shipCount: 1, shipDude: 610, shipGoal: -1, shipBehav: -1, shipStart: -1 }));
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
    out.push(dude(613, "Kit K9 record traders", 1, 370, 723));
    out.push(...discShip(731, "Kit Disc Magenta Armed", 1981, DISC_COLOURS.magenta, {
        accel: 400, speed: 400, turn: 40, armor: 2000, shield: 2000, mass: 50, freeMass: 100, cargo: 10,
        weapons: [374, -1, -1, -1], weaponCounts: [2, 0, 0, 0], weaponAmmo: [0, 0, 0, 0],
        ai: 3, strength: 50, crew: 10, flags: 0, flags2: 0,
    }));
    out.push(dude(614, "Kit K9 record warships", 3, 370, 731));
    const k9 = out.find((r) => r.type === "sÿst" && r.id === 2129);
    k9.set = { ...k9.set, dudes: [611, 612, 613, 614, -1, -1, -1, -1], dudeProbs: [25, 25, 25, 25, 0, 0, 0, 0], avgShips: 6 };

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
