/**
 * Ship-cap experiment (beamcap, wave 60; Matthew: fill a system with escorts
 * and bay fighters so a planet's defence fleet can't spawn): what does the
 * original do at its "Max Ships In System 64" (EVN Bible, Part I)?
 *
 * Run-only plug-in (experiment pilots only; it sorts after "testkit", so
 * its overrides of kit resources take). All in Kit Sub Range (sÿst 2045):
 * - wëap 345 SC Bay: a SECONDARY fighter bay (Guidance 99) of Kit Bay Disc
 *   (shïp 602, wave 40; AmmoType = the hull id), Reload 1: one launch a
 *   Ctrl tap. The pilot carries 100.
 * - wëap 346 SC Killer: a PRIMARY TURRET (Guidance 4: `r` targets the stack), Reload 15 (2 a
 *   second), 32,000 armor damage (kills a 30,000-armor Kit Sub Target in
 *   one hit), 600 px/s, 1 s.
 * - mïsn 1023 (the kit's "Kit S sub target", bit 9064) and mïsn 1083 / 1052
 *   (kit missions retired here for the run only; bits 9344 / 9291)
 *   overridden: each offered on landing at Kit Sub Port and placing
 *   ShipCount 31 immobile Kit Sub Target (düde 319, shïp 836, AI 1) on nav
 *   default 2, Kit Sub Mark, 150 px north of the port: 93 asked for. Only
 *   1023 is offered (the pilot holds bit 9064); its OnAccept starts the
 *   other two (S1083 S1052).
 *
 * Ids: wëap 345-346 (free), run-only overrides of kit mïsn 1023 / 1083 / 1052.
 */
const zero4 = [0, 0, 0, 0];
const weapBase = {
    ammoType: -1, inaccuracy: 0, flags: 0, flags2: 0, flags3: 0, ionization: 0, recoil: 0, impact: 0,
    burstCount: 0, burstReload: 0, proxSafety: 0, jamVuln: zero4, maxAmmo: 0, armorDamage: 0, shieldDamage: 0,
    subCount: 0, subType: -1, subTheta: 0, subLimit: 0, explosion: -1, proxRadius: 0, blastRadius: 0, decay: 0,
};
const weap = (id, name, clone, set) => ({ type: "wëap", id, name, clone: `wëap:${clone}`, set: { ...weapBase, ...set } });
const misnBase = {
    availStel: 2045, availLoc: 3, availRecord: 0, availRating: -1, availRandom: 100,
    travelStel: -1, returnStel: -1, cargoType: -1, cargoQty: 0, pickupMode: -1, dropoffMode: -1,
    scanMask: 0, payVal: 0, shipCount: 31, shipSyst: -1, shipDude: 319, shipGoal: -1, shipBehav: -1,
    shipNameID: -1, shipStart: -2, compGovt: -1, compReward: 0, shipSubtitle: -1, briefText: -1,
    quickBrief: -1, loadCargText: -1, dropCargText: -1, compText: -1, failText: -1, timeLimit: -1,
    canAbort: 1, shipDoneText: -1, auxShipCount: -1, auxShipDude: -1, auxShipSyst: -1, flags: 0,
    flags2: 0, refuseText: -1, availShipType: -1, onAccept: "", onRefuse: "", onSuccess: "",
    onFailure: "", onAbort: "", require: 0, datePostInc: 0, onShipDone: "", acceptButton: "",
    refuseButton: "", dispWeight: 0,
};
const misn = (id, name, bit) => ({ type: "mïsn", id, name, clone: "mïsn:128",
    set: { ...misnBase, availBits: `b${bit}`, onAccept: `!b${bit}` } });
export default {
    name: "w60-shipcap",
    resources: [
        weap(345, "SC Bay", 149, { reload: 1, guidance: 99, ammoType: 602, speed: 100, flags: 0x0002 }),
        weap(346, "SC Killer", 130, { reload: 15, duration: 30, speed: 2000, graphic: 1, guidance: 4, armorDamage: 32000,
            shieldDamage: 32000 }),
        { ...misn(1023, "Kit SC 31 targets A", 9064), set: { ...misn(1023, "", 9064).set, onAccept: "!b9064 S1083 S1052" } },
        misn(1083, "Kit SC 31 targets B", 9344),
        misn(1052, "Kit SC 31 targets C", 9291),
    ],
};
