/**
 * Wave-6 B experiment: kits/viper_blast.mjs with the 1-damage Kit Blast
 * Shell (wëap 243, the test kit's) instead of the 50-damage one, so the
 * stock Fed Vipers live through their own blasts while every blast still
 * hits the carrier beside them. If the carrier retaliates, the Vipers'
 * shields (Tab panels) fall fast to its guns instead of 1 point a blast.
 * Overrides a stock resource: install only with experiment pilots.
 */
export default {
    name: "novaref-viper-blast1",
    resources: [
        {
            type: "shïp", id: 144, name: "Fed Viper", clone: "shïp:144", override: true,
            set: { weapons: [128, 243, -1, -1], weaponCounts: [3, 1, 0, 0], weaponAmmo: [-1, 0, 0, 0] },
        },
    ],
};
