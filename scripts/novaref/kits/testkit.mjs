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
function discShip(id, name, rledId, rgb, set) {
    const g = discShipGraphics(rledId, rgb, 24, 36);
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
    ],
};
