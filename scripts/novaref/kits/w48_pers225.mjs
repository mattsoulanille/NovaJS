/**
 * Wave-48 SD2 / SF2 experiment (the in-flight bit reader): the STOCK
 * Refuel Trader përs 225 (alive in every pilot; wave 43: a kit përs never
 * appears) linked to sÿst 1488 Kit Bits Person, which lists përs 225 in its
 * Person slot at 100% (testkit wave48Resources), flying the immobile Kit
 * Pers Hulk (shïp 697), invincible (ShieldMod -1), Flags 0 (its hail offers
 * the LinkMission), LinkMission 1066 Kit SD2 person offer (AvailLoc 2,
 * AvailBits "b9307 | b9310": OnShipDone of mïsn 1064 or OnFailure of mïsn
 * 1065). A hail that offers the mission shows the bit set at that moment.
 * Overrides a stock resource: install only with experiment pilots, and only
 * for the SD2 scenario (scenarios/w48_pers_interactive.json); the shared kit
 * leaves 225 alone.
 */
const none4 = [-1, -1, -1, -1];
const zero4 = [0, 0, 0, 0];
export default {
    name: "novaref-w48-pers225",
    resources: [
        {
            type: "përs", id: 225, name: "Kit Bits Reader", clone: "përs:225", override: true,
            set: {
                linkSystem: 1488, govt: 363, ai: 1, aggression: 1, cowardice: 0, ship: 697, weapons: none4, weaponCounts: zero4,
                weaponAmmo: zero4, credits: 0, shieldMod: -1, hailPict: 0, commQuote: -1, hailQuote: -1, linkMission: 1066,
                flags: 0, activeOn: "", grantClass: 0, grantCount: 0, grantChance: 0, subtitle: "", color: 0, flags2: 0,
            },
        },
    ],
};
