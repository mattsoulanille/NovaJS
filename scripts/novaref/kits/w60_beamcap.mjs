/**
 * Beam-cap experiment (beamcap, wave 60; the hub's BEAM_LIMIT): what does
 * the original do past its "Max Beams On Screen 64" (EVN Bible, Part I's
 * engine limits)? Matthew: a friend's Vell-os Javelin bay launched about
 * 100 fighters with 3 beams each.
 *
 * Run-only plug-in (install with experiment pilots only, never the shared
 * kit). It installs under this FILE's basename, `w60_beamcap`, which sorts
 * after `testkit` (case-insensitive name order, last wins, wave 58), so its
 * wëap 333 override takes (the spec name below is not what orders it).
 *
 * - wëap 336 BC Spray: a PRIMARY fixed beam (Guidance 0) from the ship's
 *   centre (ExitType -1), Reload 6 (5 a second), Count 2000 (about 36 s at
 *   the player's Count / 56 s, wave 52), Inaccuracy 180, 230 px, pure green
 *   (0x00FF00) 1 px core: each beam is a spoke at a random angle, so the
 *   spokes born every 0.2 s are countable on a ring around the ship.
 * - wëap 337 BC Probe: a SECONDARY (Flags 0x0002) fixed beam straight
 *   ahead, Reload 600 (20 s), Count 2000, 300 px (reaches past the
 *   spray's 230), pure red: held while the table is full, it shows whether
 *   a refused beam fires at the first free slot or waits out its reload,
 *   and whether an old beam is cut for it.
 * - wëap 338 BC Hidden: a SECONDARY fixed beam fired from BeamPos (ExitType
 *   3), which shän 128 (the stock Shuttle, overridden) puts 360 px AHEAD of
 *   the ship: off the 636 x 604 play area at any heading but the diagonals.
 *   Reload 3, BurstCount 20, BurstReload 30000: exactly 20 beams a press,
 *   Count 2000, 100 px, pure blue. Turning the ship through a diagonal
 *   shows them (witness).
 * - wëap 339 BC Hidden Ctl: wëap 338 from the ship's centre (control).
 * - wëap 333 (the kit's Kit Turret Red Beam on shïp 614 Kit Fixed Beamer,
 *   wave 52 E10) overridden: Count 150 (5 s at an NPC turret's Count /
 *   30 s), magenta (0xFF00FF), 3,000 px: the NPC's beam, one live at a time.
 * - shän 128 (stock Shuttle) overridden: BeamPos x 0 / y 360 for all four
 *   points, z 0, Up/DnCompress 100 (only ExitType 3 weapons use BeamPos).
 * - (Prepared, NOT run: the explosion-cap / bay rig was dropped for the ship
 *   cap in kits/w60_shipcap.mjs.) wëap 340 BC Bay: a SECONDARY fighter bay (Guidance 99) of Kit Bay Disc
 *   (shïp 602, wave 40), Reload 1: as fast as the game launches.
 * - wëap 341 BC Boom Ring / 342 BC Boom Star: a PRIMARY gun (Reload 30)
 *   that expires at once into 40 stars (SubTheta -9: 9 degrees apart)
 *   that fly 1 px a frame for 200 frames and detonate at the end of their
 *   life (Flags 0x8000) into bööm 128 (ExplodType 0): 40 explosions in one
 *   frame on a 200 px circle (31 px apart), a ring a second.
 *
 * Ids: wëap 336-342 (free: the kit uses 330-333 and 360+), run-only.
 */
const zero4 = [0, 0, 0, 0];
const weapBase = {
    ammoType: -1, inaccuracy: 0, flags: 0, flags2: 0, flags3: 0, ionization: 0, recoil: 0, impact: 0,
    burstCount: 0, burstReload: 0, proxSafety: 0, jamVuln: zero4, maxAmmo: 0, armorDamage: 0, shieldDamage: 0,
    subCount: 0, subType: -1, subTheta: 0, subLimit: 0, explosion: -1, proxRadius: 0, blastRadius: 0, decay: 0,
};
const weap = (id, name, clone, set) => ({ type: "wëap", id, name, clone: `wëap:${clone}`, set: { ...weapBase, ...set } });
const beam = { guidance: 0, speed: 0, duration: 2000, beamWidth: 1, coronaFalloff: 4, exitType: -1 };
const i16s = (offset, values) => Object.fromEntries(values.map((v, k) => [`@${offset + 2 * k}:i16`, v]));
export default {
    name: "zz-novaref-w60-beamcap",
    resources: [
        weap(336, "BC Spray", 170, { ...beam, reload: 6, inaccuracy: 180, beamLength: 230, beamColor: 0x0000ff00, coronaColor: 0x00004000 }),
        weap(337, "BC Probe", 170, { ...beam, reload: 600, flags: 0x0002, beamLength: 300, beamWidth: 2, beamColor: 0x00ff0000,
            coronaColor: 0x00400000 }),
        weap(338, "BC Hidden", 170, { ...beam, reload: 3, flags: 0x0002, burstCount: 20, burstReload: 30000, beamLength: 100,
            beamWidth: 2, beamColor: 0x000000ff, coronaColor: 0x00000040, exitType: 3 }),
        // Added after w60_bc_c (the burst's size by taps was not exact): wëap 343 BC Hidden Volley, wëap 338 as ONE
        // simultaneous volley (Flags 0x0040 | 0x0002) of as many beams as the pilot holds copies, Reload 30000.
        weap(343, "BC Hidden Volley", 170, { ...beam, reload: 30000, flags: 0x0042, beamLength: 100, beamWidth: 2,
            beamColor: 0x000000ff, coronaColor: 0x00000040, exitType: 3 }),
        weap(339, "BC Hidden Ctl", 170, { ...beam, reload: 3, flags: 0x0002, burstCount: 20, burstReload: 30000, beamLength: 100,
            beamWidth: 2, beamColor: 0x000000ff, coronaColor: 0x00000040, exitType: -1 }),
        { ...weap(333, "Kit Turret Red Beam", 170, { ...beam, reload: 120, duration: 150, guidance: 3, beamLength: 3000, beamWidth: 2,
            beamColor: 0x00ff00ff, coronaColor: 0x00400040, armorDamage: 1, shieldDamage: 1 }) },
        weap(340, "BC Bay", 149, { reload: 1, guidance: 99, ammoType: 602, speed: 100, flags: 0x0002 }),
        weap(341, "BC Boom Ring", 130, { reload: 30, duration: 1, speed: 100, graphic: 1, guidance: -1,
            subCount: 40, subType: 342, subTheta: -9, subLimit: 0 }),
        weap(342, "BC Boom Star", 130, { reload: 30, duration: 200, speed: 100, graphic: 1, guidance: -1, flags: 0x8000,
            flags2: 0x0400, explosion: 0 }),
        {
            type: "shän", id: 128, name: "Shuttle", clone: "shän:128", override: true,
            set: { ...i16s(120, [0, 0, 0, 0]), ...i16s(128, [360, 360, 360, 360]), ...i16s(136, [100, 100, 100, 100]),
                ...i16s(168, [0, 0, 0, 0]) },
        },
    ],
};
