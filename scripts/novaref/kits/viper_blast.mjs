/**
 * Wave-5 B experiment: the STOCK Fed Viper (shïp 144, carried by the stock
 * Fed Carrier's Viper bay, wëap 149) given the test kit's Kit Blast Shell
 * (wëap 372: 180 px reach, 400 px blast, hurts its firer's side) next to
 * its three stock guns. Used with the test kit, whose sÿst 2011 Kit Fed
 * Carrier Range has a hostile stock Fed Carrier as traffic, so the stock
 * launch behaviour puts blasts beside the carrier. Overrides a stock
 * resource: install only with experiment pilots (novaref run does).
 */
export default {
    name: "novaref-viper-blast",
    resources: [
        {
            type: "shïp", id: 144, name: "Fed Viper", clone: "shïp:144", override: true,
            set: { weapons: [128, 372, -1, -1], weaponCounts: [3, 1, 0, 0], weaponAmmo: [-1, 0, 0, 0] },
        },
    ],
};
