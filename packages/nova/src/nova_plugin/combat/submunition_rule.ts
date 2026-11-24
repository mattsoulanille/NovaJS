import { SubmunitionType } from 'novadatainterface/weapon_data';

/**
 * ============================================================================
 * When does a shot fire its submunitions?
 * ============================================================================
 *
 * How a shot (or beam) ended, as far as its submunitions care:
 *
 *  - 'expired': it ran out its life (wëap Count) without detonating.
 *  - 'proximity': its proximity fuse (wëap ProxRadius) fired before it
 *    touched anything (projectile_plugin's ProjectileProximityFuseSystem).
 *  - 'directHit': it struck a body: a projectile's sprite touched a ship
 *    (or anything else it can hit), or a beam ended while its ray lay on
 *    one.
 *
 * Measured on the original (docs/reference_experiments.md, "Submunitions
 * wave 10"): a DIRECT HIT NEVER FIRES SUBMUNITIONS. Subs come from exactly
 * two events, the Bible's "when the shot reaches the end of its life or
 * detonates because something wanders into its proximity radius": the
 * shot expiring (unless the wëap sets Flags2 0x0020, parsed as
 * `subIfExpire: false`), or its proximity fuse firing before the body is
 * touched. 18 direct hits over three runs (prox 0-20, two shot sizes, two
 * target sizes, guided and unguided, Flags2 0x0020 or not) subbed none;
 * every prox detonation and every expiry did. A turreted beam that hit
 * its target fired none either.
 *
 * This is the ONE place the rule lives, so a future plug-in-developer
 * escape hatch ("always sub", Matthew's idea, not built) is a single
 * bypass here: every caller routes its sub decision through
 * WeaponEntry.fireSubs, which asks this function per submunition entry.
 *
 * Pure and deterministic: a switch on two plain values.
 */
export type ShotEnd = 'expired' | 'proximity' | 'directHit';

export function submunitionFires(sub: Pick<SubmunitionType, 'subIfExpire'>,
    end: ShotEnd): boolean {
    switch (end) {
        case 'directHit':
            return false;
        case 'proximity':
            return true;
        case 'expired':
            return sub.subIfExpire;
    }
}
