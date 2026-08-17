/**
 * ============================================================================
 * Ship explosions: the accelerating death sequence
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
 * stock ships uses bööm 132 "ship breakup" -> snd 302 for the first and
 * bööm 133 "ship exploding" -> snd 303 for the second.)
 *
 * The Bible does not give a RATE for the breakup explosions, only their
 * total duration; the accelerating cadence below is Matthew's ruling
 * ("during the death sequence there are secondary explosions whose
 * frequency INCREASES as the ship approaches its final explosion, and
 * the animations do the same").
 *
 * DETERMINISM. Every function here is pure and free of randomness,
 * wall-clock and trigonometry, and the cadence is driven by the
 * simulation clock, so two worlds stepping identically produce identical
 * explosion spawn ticks.
 */

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
 * nears its final explosion. 2 is a plain quadratic: the last gap is
 * about 1/(2*total) of the sequence against a first gap of
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
