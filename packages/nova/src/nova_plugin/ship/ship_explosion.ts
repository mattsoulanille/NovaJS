import { WeaponDamage } from 'novadatainterface/weapon_data';
import { Component } from 'nova_ecs/component';

/**
 * ============================================================================
 * Ship explosions: the accelerating death sequence and the final blast
 * ============================================================================
 *
 * WHAT THE BIBLE SAYS
 *
 * shïp DeathDelay (EVN Bible ~:2427): "The number of frames the ship
 * 'disintegrates' before finally exploding. 0-59: The ship disintegrates
 * for this number of frames and then disappears in a single fireball.
 * 60+: The ship disintegrates for this number of frames and then
 * disappears in a huge explosion. The exact size of the resulting
 * fireball is proportional to the ship's mass. (see below)"
 *
 * shïp Explode1 (~:2442): "Type of explosion to show (0-63) while the
 * ship is breaking up, or -1 to not show any explosions until the ship
 * is finished being destroyed." shïp Explode2 (~:2445): "Type of
 * explosion to show (0-63) when the ship is completely destroyed."
 * (ShipData.initialExplosion / .finalExplosion; every one of the 288
 * stock ships uses bööm 132 "ship breakup" -> snd 302 and bööm 133 "ship
 * exploding" -> snd 303.)
 *
 * shïp Mass (~:2456), the "see below" the DeathDelay entry points at:
 * "The mass of the ship, in tons. ... Also, the blast radius and impact
 * strength when the ship explodes is proportional to its mass."
 *
 * So the Bible documents, for the final explosion: a RADIUS and an
 * IMPACT STRENGTH (its word for knockback — cf. wëap Impact, "the
 * magnitude of the impact when the shot hits something ... inversely
 * proportional to the ship's mass"), both proportional to the exploding
 * ship's mass. It does NOT document a damage number for a ship's own
 * explosion. That ships deal area damage when they finally explode was
 * first Matthew's ruling; the amount is now MEASURED on the original
 * (reference "Plunder self-destruct blast, wave 27"): 25.5 + 0.037 x
 * mass to the shield and then the armor, from 100 tons up (see
 * SHIP_EXPLOSION_DAMAGE_PER_TON). Its "radius" is MEASURED to be no
 * circle at all but an axis-aligned SQUARE growing with the mass (about
 * twice the damage each way, {@link SHIP_EXPLOSION_REACH_PER_DAMAGE};
 * reference "Ship explosion blast, wave 28"), and an ORDINARY death is
 * the same blast as a plunder self-destruct (same wave, finding 2).
 *
 * The Bible's 60-frame distinction (single fireball vs. huge
 * mass-proportional explosion) is NOT a gate on the damage: MEASURED, a
 * 5,000-ton hulk with DeathDelay 10 and one with DeathDelay 60 dealt the
 * same blast (reference "Plunder self-destruct, wave 26"); only its
 * timing differed. Nor on the REACH: MEASURED, the 5,000-ton DeathDelay-60
 * wreck hit at 380 px and missed at 470 px exactly as the DeathDelay-10
 * one did, for the same damage, its blast landing about 0.9 s later
 * (reference "Ship explosion reach, wave 29", finding 3).
 *
 * The 60-frame threshold IS a gate on the fireball GRAPHIC, which is
 * the thing the Bible attaches it to — see
 * {@link finalExplosionScale} and ShipData.largeExplosion. Do not
 * confuse either with ShipData.finalExplosionSparks, the unrelated
 * Explode2 + 1000 scatter (~:2445 -> wëap ExplodType ~:3159).
 *
 * WHAT A SHIP EXPLOSION IS NOT. It is not an attack. It carries no
 * damager identity (the blast entity gets no FiringGroupComponent,
 * OwnerComponent or SourceComponent), so nobody is credited with the
 * kills or blamed for the damage, and — Matthew's hard rule — it can
 * never disable or destroy a ship: armor damage clamps just above the
 * victim's disable threshold (see {@link nonLethalArmorFloor}).
 *
 * DETERMINISM. Every function here is pure and free of randomness,
 * wall-clock and trigonometry: mass comes from static shïp data and the
 * cadence from the simulation clock, so every peer computes the same
 * reach, the same damage, and the same explosion spawn schedule.
 */

/**
 * Marks a blast entity as a ship's own final explosion rather than a
 * weapon's. Read by BlastCollisionSystem, which flags the DamagedEvent
 * `nonLethal` so DamageSystem clamps armor above the victim's disable
 * threshold; it carries the exploding hull's mass, which is what sets the
 * blast's reach (BlastCollisionSystem's centre-in-square test, {@link
 * shipExplosionReach}) and damage.
 *
 * It lives in this leaf module (with the tunables, no plugin imports) so
 * blast_plugin.ts can read it without importing ship_explosion_plugin.ts
 * — the same cycle-avoidance blast_data.ts exists for.
 */
export const ShipExplosionComponent =
    new Component<{ mass: number }>('ShipExplosion');

// --- The final explosion's area damage (simulation) ---

/**
 * The final explosion's shield and armor damage:
 * SHIP_EXPLOSION_DAMAGE_BASE + SHIP_EXPLOSION_DAMAGE_PER_TON x mass, from
 * SHIP_EXPLOSION_DAMAGE_MIN_MASS tons up, nothing below.
 *
 * MEASURED (reference "Plunder self-destruct blast, wave 27"): a plunder
 * self-destruct's blast on a boarder 5-10 px from the hulk, read off the
 * shield and armor bars frame by frame, was 28.4 / 32.4 / 44.6 / 63.5 /
 * about 100 / 210.6 / about 1,155 points from 100 / 200 / 500 / 1,000 /
 * 2,000 / 5,000 / 30,000-ton hulks, every repeat on the same pixel (no
 * random part). A least-squares line through the exact points is
 * 25.5 + 0.0371 x mass, every reading within about one point. The
 * self-destruct is the hulk's ORDINARY final explosion (the trip zeroes
 * its armor and fires the usual death; DeathDelay 10 and 60 gave the same
 * amount at 5,000 t), so this is every ship's death blast.
 *
 * Stock deaths, old 0.03 x mass against this: a 10-ton Viper 0.3 -> 0
 * (under the cut-off, as are 121 of the 288 stock hulls), a 650-ton IDA
 * Frigate 19.5 -> 49.55, a 6000-ton Cambrian 180 -> 247.5, a 10000-ton
 * Leviathan 300 -> 395.5.
 */
export const SHIP_EXPLOSION_DAMAGE_BASE = 25.5;
export const SHIP_EXPLOSION_DAMAGE_PER_TON = 0.037;

/**
 * The lightest hull whose final explosion does any damage.
 *
 * MEASURED (reference "Ship explosion blast, wave 28", finding 1): a
 * 99-ton hulk's blast did nothing to a boarder overlapping it (about
 * 4 px off), a 90-ton one nothing at 8 px, while 100 tons did the full
 * 28.4 at 5-8 px (wave 27). One ton cannot move a reach from under 4 px
 * to over 8, so the cut-off is a MASS rule, not a reach: the Bible's
 * smallest shïp Mass band, "1-99", does no blast damage at all.
 */
export const SHIP_EXPLOSION_DAMAGE_MIN_MASS = 100;

/**
 * THE BLAST'S REACH is an axis-aligned SQUARE centred on the wreck, of
 * half-side SHIP_EXPLOSION_REACH_PER_DAMAGE x the blast's damage
 * ({@link shipExplosionReach}); a ship is hit when its CENTRE lies
 * inside it, i.e. max(|dx|, |dy|) <= the half-side, with the full damage
 * (no falloff) and nothing outside.
 *
 * MEASURED (reference "Ship explosion blast, wave 28", findings 3-4,
 * fourteen runs, centre to centre): a 100-ton wreck hit at (55.3, 46.1)
 * (72 px away) and missed at (-60.2, -17.2) (62 px away), which rules out
 * any circle; by the larger coordinate every hit is inside and every
 * miss outside — 100 t hits up to 55.3, misses from 60.2; 1,000 t hits
 * up to 113, misses from 157.
 *
 * MEASURED, the FORM and NO CAP (reference "Ship explosion reach, wave
 * 29", findings 1 and 4; eighteen runs, the wreck placed exactly by a
 * mission): the half-side keeps growing as twice the blast's damage to
 * 10,000 t, bracketed at 2,000 t (190 hit, 210 miss; 2 x 99.5 = 199),
 * 5,000 t (400, 440; 421) and 10,000 t (760, 820; 791). With wave 28's
 * 100 t (57) and 1,000 t (127) that is five masses over two decades on
 * 2 x (25.5 + 0.037 x mass) = 51 + 0.074 x mass, the factor 2 good to
 * about 5%; so a 10,000-ton Leviathan reaches 791 px each way (a 1,582 px
 * square). Hull sizes play no part on EITHER side: a victim with the Fed
 * Carrier's art whose hull reached well inside the square, and a wreck
 * with that art whose side did, both missed: the test is centre to centre.
 * Whether anything caps it past 10,000 t is unmeasured.
 */
export const SHIP_EXPLOSION_REACH_PER_DAMAGE = 2;

/**
 * The final explosion's reach, the HALF-SIDE in pixels of its square
 * ({@link SHIP_EXPLOSION_REACH_PER_DAMAGE}): 2 x (25.5 + 0.037 x mass),
 * 58 px at 100 t, 127 px at 1,000 t, 791 px at 10,000 t.
 *
 * Below the damage cut-off the square keeps the same formula (51-58 px
 * for 0-99 t): such a blast hurts nothing, but its knockback still
 * shoves what is inside (GUESS: unmeasured, kept; see
 * SHIP_EXPLOSION_KNOCKBACK_PER_TON). A damaging blast's push reaches
 * exactly this square (MEASURED, reference "The ship-explosion push",
 * wave 47). A
 * degenerate mass reaches 51 px rather than NaN.
 */
export function shipExplosionReach(mass: number): number {
    const tons = mass > 0 ? mass : 0;
    return SHIP_EXPLOSION_REACH_PER_DAMAGE * (SHIP_EXPLOSION_DAMAGE_BASE
        + tons * SHIP_EXPLOSION_DAMAGE_PER_TON);
}

/**
 * Whether a ship centred at (dx, dy) from the wreck is inside a blast of
 * this reach: max(|dx|, |dy|) <= reach ({@link
 * SHIP_EXPLOSION_REACH_PER_DAMAGE}). Pure, no square root.
 */
export function insideShipExplosion(dx: number, dy: number,
    reach: number): boolean {
    return Math.max(Math.abs(dx), Math.abs(dy)) <= reach;
}

/**
 * The FIREBALL's radius in pixels per ton (DISPLAY ONLY: the mass-
 * proportional "huge explosion" of a DeathDelay >= 60 hull, see
 * {@link finalExplosionScale}). It used to be the blast's damage radius
 * too; the reach is now the measured square above, and the picture keeps
 * its old size (0.02 px/ton puts a Leviathan at the 200 px cap, a Fed
 * Carrier at 40 px, everything under 1600 tons at the art's own size).
 * TUNABLE.
 */
export const FINAL_FIREBALL_RADIUS_PER_TON = 0.02;

/**
 * Floor and ceiling on the fireball's radius, in pixels. DISPLAY ONLY
 * (see {@link FINAL_FIREBALL_RADIUS_PER_TON}). TUNABLE.
 */
export const FINAL_FIREBALL_MIN_RADIUS = 20;
export const FINAL_FIREBALL_MAX_RADIUS = 200;

/**
 * The knockback ("impact strength", the Bible's Mass entry) of every
 * DAMAGING ship explosion (SHIP_EXPLOSION_DAMAGE_MIN_MASS tons up): ONE
 * fixed impact, whatever the wreck weighed. KnockbackSystem applies the
 * weapon law to it (KNOCKBACK_PER_IMPACT x impact / the VICTIM's mass,
 * death_plugin.ts), radially away from the wreck, capped at the victim's
 * top speed.
 *
 * MEASURED (reference "The ship-explosion push (the hub's knockback
 * follow-up), wave 47"): 2,000, 5,000 and 10,000 t wrecks each threw a
 * 300 t hull to 73-74 px/s (no growth with the wreck, no fall-off with
 * distance inside the square), and the 2,000 t one threw a 1,200 t
 * cruiser to 18.5: 300 x 73.5 = 22,050 and 1,200 x 18.5 = 22,200 t px/s,
 * one impulse of about 22,100 t px/s, so 22,100 / 30 = about 737 impact
 * units (good to about 2%). A 50 t hull was thrown to its top speed
 * (132.8 against 131 px/s). The push reaches exactly as far as the damage
 * (nothing just outside the square at 210 / 470 / 820 px): it rides the
 * blast's own square gate (insideShipExplosion, BlastCollisionSystem).
 *
 * Was 0.05 x the wreck's tons (SHIP_EXPLOSION_KNOCKBACK_PER_TON, GUESS):
 * 10 / 25 / 50 px/s on the 300 t hull where the original gave 73-74.
 */
export const SHIP_EXPLOSION_KNOCKBACK = 737;

/**
 * The knockback per ton of a DAMAGELESS ship explosion (under
 * SHIP_EXPLOSION_DAMAGE_MIN_MASS tons): main's old per-ton law, kept for
 * that band only. GUESS: whether a blast that hurts nothing pushes at all
 * was not run (the wave-47 section's proposal guesses no push); it keeps
 * the push it had (at most 4.95 impact units, a 99 t wreck's) until it is
 * measured. TUNABLE.
 */
export const SHIP_EXPLOSION_KNOCKBACK_PER_TON = 0.05;

/**
 * The final explosion's knockback, from the wreck's mass: the measured
 * fixed SHIP_EXPLOSION_KNOCKBACK from SHIP_EXPLOSION_DAMAGE_MIN_MASS tons
 * up, SHIP_EXPLOSION_KNOCKBACK_PER_TON x tons below (GUESS). Pure.
 */
export function shipExplosionKnockback(mass: number): number {
    const tons = mass > 0 ? mass : 0;
    return tons >= SHIP_EXPLOSION_DAMAGE_MIN_MASS
        ? SHIP_EXPLOSION_KNOCKBACK
        : tons * SHIP_EXPLOSION_KNOCKBACK_PER_TON;
}

/**
 * How far above the disable threshold a ship-explosion's armor damage
 * stops, as a fraction of max armor.
 *
 * Matthew's rule: ship-explosion damage "can reduce a victim's
 * shields/armor down to just ABOVE the disable threshold but can NEVER
 * disable or destroy a ship". isBelowDisableThreshold (disabled_
 * component.ts) disables at armor <= fraction * max, so the floor must
 * be strictly greater than that; 1% of max armor is the epsilon —
 * visually "just above", and far enough off the boundary that no
 * accumulation of float error can tip a victim over it.
 */
export const SHIP_EXPLOSION_ARMOR_MARGIN_FRACTION = 0.01;

/** The final fireball's radius in pixels, from the ship's mass (DISPLAY
 * ONLY; the blast's reach is {@link shipExplosionReach}). */
export function finalFireballRadius(mass: number): number {
    // `!(mass > 0)` also catches NaN/undefined from a malformed plug-in.
    if (!(mass > 0)) {
        return FINAL_FIREBALL_MIN_RADIUS;
    }
    return Math.min(FINAL_FIREBALL_MAX_RADIUS, Math.max(
        FINAL_FIREBALL_MIN_RADIUS, mass * FINAL_FIREBALL_RADIUS_PER_TON));
}

/**
 * The final explosion's damage payload, from the ship's mass.
 *
 * `passThroughShield: 0` — an explosion is a shock wave, not a
 * shield-piercing weapon, so shields absorb it first like any ordinary
 * hit. No ionization: the Bible ties ionization to ion weapons alone.
 */
export function shipExplosionDamage(mass: number): WeaponDamage {
    const tons = mass > 0 ? mass : 0;
    const damage = tons >= SHIP_EXPLOSION_DAMAGE_MIN_MASS
        ? SHIP_EXPLOSION_DAMAGE_BASE + tons * SHIP_EXPLOSION_DAMAGE_PER_TON
        : 0;
    return {
        shield: damage,
        armor: damage,
        ionization: 0,
        ionizationColor: 0xffffff,
        passThroughShield: 0,
        knockback: shipExplosionKnockback(tons),
    };
}

/**
 * The armor a non-lethal hit (a ship's final explosion) may take a ship
 * down to, but not past: its disable threshold plus
 * SHIP_EXPLOSION_ARMOR_MARGIN_FRACTION of max armor.
 *
 * Contrast DISABLE_ONLY_ARMOR_FLOOR (death_plugin.ts), the floor for a
 * wëap "can disable but not destroy" weapon, which is 1 armor point —
 * deliberately far BELOW the disable threshold, because such a weapon is
 * meant to disable. This floor is above it, because a ship explosion is
 * meant to hurt without ever taking anyone out of the fight.
 *
 * A degenerate hull (no armor, or a threshold at/above 100%) floors at
 * its max armor: it simply cannot be hurt by an explosion, which is the
 * only reading that keeps "never disables" true.
 */
export function nonLethalArmorFloor(maxArmor: number,
    disableArmorFraction: number): number {
    if (!(maxArmor > 0)) {
        return 0;
    }
    return Math.min(maxArmor, (disableArmorFraction
        + SHIP_EXPLOSION_ARMOR_MARGIN_FRACTION) * maxArmor);
}

/**
 * Applies a non-lethal armor hit: the damage lands, but never below
 * `floor`, and never HEALS a ship that is already below it (a hulk at
 * zero armor stays at zero rather than being lifted to 34%).
 */
export function nonLethalArmor(current: number, damage: number,
    floor: number): number {
    return Math.min(current, Math.max(floor, current - damage));
}

// --- The final explosion's fireball GRAPHIC (display) ---

/**
 * The radius, in pixels, that the final-explosion sprite already covers
 * at its natural size — half a frame's width.
 *
 * Measured from the stock data: every one of the 288 stock ships uses
 * bööm 133 "ship exploding" for Explode2, whose sprite sheet (nova:4004)
 * is 20 frames of 64x64 px, so the drawn fireball is 64 px across and
 * reaches 32 px from the ship. (bööm 128 "FAE Small", the sparks, is
 * 32x32 over 16 frames.)
 *
 * A CONSTANT rather than a read of the loaded sheet because the scale has
 * to be a pure function of mass — computed the same way on every peer,
 * before any texture has loaded, and testable without PIXI. A plug-in
 * with a differently-sized bööm 133 therefore gets a fireball off this
 * reference by the ratio of the two sheets; the alternative (waiting for
 * the sheet) would make the size depend on load timing.
 */
export const FINAL_EXPLOSION_NATURAL_RADIUS = 32;

/**
 * The sprite scale for a ship's final fireball: shïp DeathDelay >= 60,
 * "a huge explosion. The exact size of the resulting fireball is
 * proportional to the ship's mass" (EVN Bible ~:2427). Callers apply
 * this only when ShipData.largeExplosion is set; a DeathDelay < 60 ship
 * gets "a single fireball" at scale 1.
 *
 * Its radius is {@link finalFireballRadius}, mass-proportional with a
 * 200 px ceiling. It USED to be the blast's damage radius as well; since
 * the reach was measured to be a square of twice the damage (reference
 * "Ship explosion blast, wave 28" and "Ship explosion reach, wave 29";
 * 791 px each way for a Leviathan, with no cap and the same for a
 * DeathDelay-60 hull), the picture keeps its old size rather than growing to a
 * 1,600 px fireball nobody has seen on the original (the original's
 * fireball size is unmeasured). A Leviathan's 10000 tons reach the 200 px
 * cap and so draw at 200/32 = 6.25x — a 400 px fireball; a 6000-ton
 * Cambrian 3.75x; a 2000-ton Fed Carrier 1.25x.
 *
 * Clamped at 1 from below: below ~1600 tons the mass-proportional radius
 * is smaller than the art, and the Bible's branch is a fireball that is
 * huge or ordinary, never shrunken. That floor covers most of the 86
 * qualifying stock ships (they start at 90 tons), which is the intended
 * reading — the threshold admits them, mass decides whether it shows.
 */
export function finalExplosionScale(mass: number): number {
    return Math.max(1,
        finalFireballRadius(mass) / FINAL_EXPLOSION_NATURAL_RADIUS);
}

// --- The death sequence's secondary explosions (display) ---

/**
 * Average secondary explosions per second over a whole death sequence.
 *
 * The Bible gives no rate — only that the ship "disintegrates" for
 * DeathDelay frames — so this is TUNABLE, and it is an AVERAGE: the
 * cadence accelerates through the sequence (see
 * {@link secondaryExplosionsDue}), so a Leviathan's 8.3-second breakup
 * opens with gaps of ~1.4 s and closes with gaps of ~0.15 s.
 */
export const SECONDARY_EXPLOSIONS_PER_SECOND = 4;

/**
 * Bounds on the number of secondary explosions in one sequence. The
 * floor gives even the twitchiest hull (a Viper disintegrates for 10
 * frames) a couple of puffs; the ceiling keeps a 250-frame breakup from
 * turning into a wall of sprites and sound.
 */
export const MIN_SECONDARY_EXPLOSIONS = 2;
export const MAX_SECONDARY_EXPLOSIONS = 40;

/**
 * Acceleration exponent for the cadence: the count spawned by progress
 * `u` through the sequence goes as u^ACCEL, so gaps shrink as the ship
 * nears its final explosion — "the frequency increases as the ship
 * approaches its final explosion" (Matthew). 2 is a plain quadratic: the
 * last gap is about 1/(2*total) of the sequence against a first gap of
 * 1/sqrt(total), a ~7x speed-up over a 20-explosion sequence, computed
 * with one multiply (no logs, no roots, nothing whose last bit could
 * differ between engines).
 */
export const SECONDARY_EXPLOSION_ACCEL = 2;

/**
 * How many secondary explosions one display step may spawn. The
 * schedule below is a function of elapsed sim time, not of steps, so a
 * stalled tab (or a long frame) resumes with a backlog; this caps the
 * catch-up burst at something that still looks like an explosion rather
 * than a flashbulb.
 */
export const MAX_SECONDARY_EXPLOSIONS_PER_STEP = 3;

/**
 * The total number of secondary explosions for a death sequence of
 * `durationMs`, so that longer breakups get more of them at a
 * comparable average rate.
 */
export function secondaryExplosionTotal(durationMs: number): number {
    if (!(durationMs > 0)) {
        return MIN_SECONDARY_EXPLOSIONS;
    }
    const count = Math.round(
        durationMs / 1000 * SECONDARY_EXPLOSIONS_PER_SECOND);
    return Math.min(MAX_SECONDARY_EXPLOSIONS,
        Math.max(MIN_SECONDARY_EXPLOSIONS, count));
}

/**
 * How many of a sequence's `total` secondary explosions should have been
 * spawned by the time `progress` (0 at zero armor, 1 at the final
 * explosion) is reached.
 *
 * A CUMULATIVE COUNT rather than a "time of the next one": the caller
 * spawns the difference against what it has already spawned, which makes
 * the sequence frame-rate independent (the same explosions happen
 * whether the display runs at 30 or 144 fps, or hitches) and makes the
 * spawn ticks a pure function of the mirrored simulation clock — so two
 * worlds stepping identically produce identical spawn ticks, and no
 * random draw is involved at all.
 *
 * `ceil` (with the u > 0 test) rather than `floor` so the first
 * explosion appears as soon as the sequence starts instead of after the
 * first, longest gap; from there the gaps shrink monotonically.
 */
export function secondaryExplosionsDue(progress: number,
    total: number): number {
    if (!(progress > 0)) {
        return 0;
    }
    if (progress >= 1) {
        return total;
    }
    return Math.min(total, Math.ceil(
        total * progress ** SECONDARY_EXPLOSION_ACCEL));
}
