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
    ].map(withoutRunningLights),
};

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
