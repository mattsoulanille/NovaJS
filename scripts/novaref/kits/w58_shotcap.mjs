/**
 * Shot-cap experiment ("Max Shots On Screen", the hub's SUBMUNITION_OOM):
 * does the original cap the projectiles alive at once (EVN Bible, Part I's
 * engine limits: "Max Shots On Screen 128"), and what gives when the cap
 * is reached (the new shot, or an old one)?
 *
 * Run-only plug-in (install with experiment pilots; it adds two weapons and
 * overrides nothing). wëap 334 SC Ring, a PRIMARY (Space) that fires once a
 * second (Reload 30), flies 1 frame and expires at the nose into 16 x
 * wëap 335 SC Star in a 22-degree starburst (SubTheta -22). Each star
 * flies outward at 1 px a frame for 15 s (Count 450), Medium Blaster
 * sprite, no damage, planet-type (Flags2 0x0400) so it passes through
 * ships. From a ship at rest every second's ring is a circle 30 px wider
 * than the next younger one, so a frame shows each ring's age and how
 * many of its 16 stars exist. Held for 20 s with no cap: 15 rings, 240
 * stars. With a 128-shot cap: about 8 rings, and either the newest rings
 * come out short (new shots refused) or the oldest thin out (old shots
 * recycled). Rings older than 10 s are off the 640 px play area, which
 * also tells whether off-screen shots count.
 *
 * Ids: wëap 334 / 335 (next free after wave 53: 334).
 */
const zero4 = [0, 0, 0, 0];
const weapBase = {
    ammoType: -1, inaccuracy: 0, flags2: 0, flags3: 0, ionization: 0, recoil: 0,
    burstCount: 0, burstReload: 0, proxSafety: 0, jamVuln: zero4, maxAmmo: 0,
    subCount: 0, subType: -1, subTheta: 0, subLimit: 0,
};
const weap = (id, name, clone, set) => ({ type: "wëap", id, name, clone: `wëap:${clone}`, set: { ...weapBase, ...set } });
export default {
    name: "novaref-w58-shotcap",
    resources: [
        weap(334, "SC Ring", 130, {
            reload: 30, duration: 1, armorDamage: 0, shieldDamage: 0, guidance: -1, speed: 100, graphic: 1,
            proxRadius: 0, blastRadius: 0, flags: 0, flags2: 0, explosion: -1,
            subCount: 16, subType: 335, subTheta: -22, subLimit: 0,
        }),
        weap(335, "SC Star", 130, {
            reload: 30, duration: 450, armorDamage: 0, shieldDamage: 0, guidance: -1, speed: 100, graphic: 1,
            proxRadius: 0, blastRadius: 0, flags: 0, flags2: 0x0400, explosion: -1,
        }),
    ],
};
