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
 * explosion; the damage below is Matthew's ruling ("ships deal area
 * damage during their final explosion, scaling with the ship's mass"),
 * modelled on the one relationship the Bible does give — linear in mass.
 *
 * The Bible's 60-frame distinction (single fireball vs. huge
 * mass-proportional explosion) is deliberately NOT a gate here: the Mass
 * entry states the radius/impact relationship unconditionally, and
 * because everything scales from mass, the ships that fall below the
 * threshold are exactly the light ones whose blast rounds to nothing
 * anyway (of the 288 stock ships, the 86 with DeathDelay >= 60 range
 * from 90 to 10000 tons, while the rest bottom out at 1 ton).
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
 * radius, the same damage, and the same explosion spawn schedule.
 */

/**
 * Marks a blast entity as a ship's own final explosion rather than a
 * weapon's. Read by BlastCollisionSystem, which flags the DamagedEvent
 * `nonLethal` so DamageSystem clamps armor above the victim's disable
 * threshold; it carries the exploding hull's mass, which is what set the
 * blast's radius and damage.
 *
 * It lives in this leaf module (with the tunables, no plugin imports) so
 * blast_plugin.ts can read it without importing ship_explosion_plugin.ts
 * — the same cycle-avoidance blast_data.ts exists for.
 */
export const ShipExplosionComponent =
    new Component<{ mass: number }>('ShipExplosion');

// --- The final explosion's area damage (simulation) ---

/**
 * Shield and armor damage per ton of the exploding ship's mass.
 *
 * TUNABLE (the Bible gives no damage figure — see the module comment).
 * Calibrated against the stock mass range and the heaviest stock
 * weapons: a 10000-ton Leviathan lands 300 shield + 300 armor, half
 * again a Polaron Massive Torpedo's 400/400 and comfortably "dangerous";
 * a 6000-ton Cambrian 180, a 2000-ton Fed Carrier 60, a 650-ton IDA
 * Frigate ~20, while a 10-ton Viper's death is the 0.3 it should be.
 */
export const SHIP_EXPLOSION_DAMAGE_PER_TON = 0.03;

/**
 * Blast radius in pixels per ton, the Bible's "the blast radius ... when
 * the ship explodes is proportional to its mass".
 *
 * TUNABLE only in its constant of proportionality: 0.02 px/ton puts a
 * Leviathan at the 200 px cap — larger than the widest stock weapon
 * blast (the Hellhound Missile's 145) as befits a capital ship coming
 * apart — a Fed Carrier at 40 px, and everything under 1000 tons at the
 * floor below.
 */
export const SHIP_EXPLOSION_RADIUS_PER_TON = 0.02;

/**
 * Floor and ceiling on that radius, in pixels. The floor keeps a
 * feather-weight hull's blast from being a mathematical point (a 1-ton
 * escape pod would otherwise get 0.02 px); the ceiling stops the
 * heaviest hulls from reaching across a dogfight. Both TUNABLE; the
 * floor matches the small end of the stock weapon blast radii (4-12 px
 * for blasters, 10-20 for missiles) and the ceiling sits just above the
 * largest (145 px).
 */
export const SHIP_EXPLOSION_MIN_RADIUS = 20;
export const SHIP_EXPLOSION_MAX_RADIUS = 200;

/**
 * Knockback ("impact strength", per the Bible's Mass entry) per ton.
 * KnockbackSystem divides by the VICTIM's mass, which is the other half
 * of the Bible's rule (wëap Impact is "inversely proportional to the
 * ship's mass"), so this constant only fixes the scale: a Leviathan's
 * 500 shoves a 98-ton Starbridge at ~25 px/s, a firm push rather than a
 * launch. TUNABLE.
 */
export const SHIP_EXPLOSION_KNOCKBACK_PER_TON = 0.05;

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

/** The final explosion's blast radius in pixels, from the ship's mass. */
export function shipExplosionRadius(mass: number): number {
    // `!(mass > 0)` also catches NaN/undefined from a malformed plug-in.
    if (!(mass > 0)) {
        return SHIP_EXPLOSION_MIN_RADIUS;
    }
    return Math.min(SHIP_EXPLOSION_MAX_RADIUS, Math.max(
        SHIP_EXPLOSION_MIN_RADIUS, mass * SHIP_EXPLOSION_RADIUS_PER_TON));
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
    const damage = tons * SHIP_EXPLOSION_DAMAGE_PER_TON;
    return {
        shield: damage,
        armor: damage,
        ionization: 0,
        ionizationColor: 0xffffff,
        passThroughShield: 0,
        knockback: tons * SHIP_EXPLOSION_KNOCKBACK_PER_TON,
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
 * DERIVED, NOT TUNED. The fireball is drawn to cover exactly the blast
 * that damages: its radius IS {@link shipExplosionRadius}, so the mass
 * proportionality, the floor and the 200 px ceiling are the simulation's
 * and the picture cannot drift from the hitbox. A Leviathan's 10000 tons
 * reach the 200 px cap and so draw at 200/32 = 6.25x — a 400 px fireball
 * over a 400 px blast diameter; a 6000-ton Cambrian 3.75x; a 2000-ton
 * Fed Carrier 1.25x.
 *
 * Clamped at 1 from below: below ~1600 tons the mass-proportional radius
 * is smaller than the art, and the Bible's branch is a fireball that is
 * huge or ordinary, never shrunken. That floor covers most of the 86
 * qualifying stock ships (they start at 90 tons), which is the intended
 * reading — the threshold admits them, mass decides whether it shows.
 */
export function finalExplosionScale(mass: number): number {
    return Math.max(1,
        shipExplosionRadius(mass) / FINAL_EXPLOSION_NATURAL_RADIUS);
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
