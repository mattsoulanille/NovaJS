/**
 * Wave-43 R16 experiment (the deferred përs auto-abort): the STOCK Refuel
 * Trader përs 225 (alive in every pilot) turned into wave 42's Kit Refuel
 * Person (përs 1151 never appeared, not even from a sÿst Person slot at
 * 100%: wave 43 r16_a): linked to sÿst 1455 Kit Pers Slot, which lists
 * përs 225 in its Person slots (testkit wave43Resources), flying the
 * immobile Kit Pers Hulk (shïp 697), Flags 0x0040 (replace it with the
 * mission's special ship), LinkMission 1044 (the kit's auto-abort rescue,
 * ShipGoal 5, DatePostInc 7, OnAbort b9282). Overrides a stock resource:
 * install only with experiment pilots, and only for the R16 scenario
 * (scenarios/w43_pers225_board.json); the shared kit leaves 225 alone.
 */
const none4 = [-1, -1, -1, -1];
const zero4 = [0, 0, 0, 0];
export default {
    name: "novaref-w43-pers225",
    resources: [
        {
            type: "përs", id: 225, name: "Kit Refuel 225", clone: "përs:225", override: true,
            set: {
                linkSystem: 1455, govt: 363, ai: 1, aggression: 1, cowardice: 0, ship: 697, weapons: none4, weaponCounts: zero4,
                weaponAmmo: zero4, credits: 0, shieldMod: 100, hailPict: 0, commQuote: -1, hailQuote: -1, linkMission: 1044,
                flags: 0x0040, activeOn: "", grantClass: 0, grantCount: 0, grantChance: 0, subtitle: "", color: 0, flags2: 0,
            },
        },
    ],
};
